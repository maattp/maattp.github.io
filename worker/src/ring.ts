// Ring relay — an MCP server (Streamable HTTP) exposing exactly one tool.
//
// Pebble's cloud agent is the client. When Matt double-clicks the ring and
// explicitly names the coordinator, the agent calls send_to_coordinator; the
// text is handed to the RingRoom DO, which pushes it down the Mac mini's
// outbound WebSocket. The ack we return is read back into Matt's Answers feed,
// so it has to be short and say what actually happened.
//
// Nothing else from the ring reaches the mini: one tool, no resources, no
// history, no read path.
//
// Auth is a single bearer token (RING_MCP_TOKEN, a wrangler secret). This
// endpoint is public, so the token is the only thing between the internet and
// text in front of a Claude session — hence the constant-time compare and a
// bare 401 that leaks nothing about why.

import { Hono } from "hono";

type RingBindings = {
  RING_ROOM: DurableObjectNamespace;
  RING_MCP_TOKEN: string;
};

const SERVER_INFO = { name: "ring-relay", version: "1.0.0" };
const FALLBACK_PROTOCOL = "2025-06-18";
const TEXT_MAX = 2000;

// Fixed-time comparison: fold length into the result rather than returning
// early, so neither the length nor the first differing byte is timeable.
function tokenMatches(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function authorized(header: string | undefined, expected: string): boolean {
  if (!expected) return false; // secret unset — fail closed, never open
  const m = /^Bearer (.+)$/.exec(header ?? "");
  return m ? tokenMatches(m[1], expected) : false;
}

const ROUTING_RULE = [
  "Call send_to_coordinator ONLY when Matt explicitly names the coordinator",
  '(for example: "tell the coordinator ...", "ask the coordinator to ...",',
  '"send this to the coordinator"). If he does not name it, do not call this',
  "tool — answer him yourself. Never call it to check whether the coordinator",
  "is reachable, to say hello, or to forward a request he did not address to",
  "it. There is no read path: this tool cannot fetch anything back, so calling",
  "it speculatively accomplishes nothing.",
].join(" ");

const TOOL = {
  name: "send_to_coordinator",
  description:
    "Send one message to Matt's coordinator Claude Code session on his Mac mini. " +
    ROUTING_RULE +
    " The message is delivered one-way; this call returns only a delivery ack, " +
    "never the coordinator's answer. The coordinator replies separately by " +
    "pushing a notification to Matt's phone, so tell him to expect that rather " +
    "than waiting for a result here.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "What to send, in Matt's words. Include the whole request — the " +
          "coordinator has no other context about what he just said.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
} as const;

const PROMPT = {
  name: "coordinator_routing",
  description: "When to route a ring request to Matt's coordinator, and when not to.",
};

// A Streamable HTTP client may ask for its POST reply as SSE instead of JSON.
// Same JSON-RPC payload either way; only the framing differs. Single event,
// then the stream closes — there is nothing further to send.
function respond(c: any, payload: unknown) {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: SSE_HEADERS,
    });
  }
  return c.json(payload);
}

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const ringApp = new Hono<{ Bindings: RingBindings }>();

// GET opens the Streamable HTTP server->client SSE stream. This server never
// initiates anything (the one tool is fire-and-forget, and there is no read
// path), so the stream carries nothing but keepalive comments — but Pebble's
// client requires it to be a real text/event-stream and refuses anything else.
// It closes itself after STREAM_TTL_MS so a forgotten client can't hold a
// request open indefinitely; clients reconnect on their own.
const STREAM_TTL_MS = 30 * 60 * 1000;
const KEEPALIVE_MS = 20 * 1000;

const SSE_COMMENT_CONNECTED = ": connected\n\n";
const SSE_COMMENT_KEEPALIVE = ": keepalive\n\n";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

ringApp.get("/mcp", (c) => {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(SSE_COMMENT_CONNECTED));
      const until = Date.now() + STREAM_TTL_MS;
      try {
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, KEEPALIVE_MS));
          controller.enqueue(enc.encode(SSE_COMMENT_KEEPALIVE));
        }
        controller.close();
      } catch {
        // client hung up mid-write; nothing to clean up
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
});
ringApp.delete("/mcp", (c) =>
  c.json({ error: "method not allowed; POST JSON-RPC to this endpoint" }, 405, { Allow: "POST" })
);

ringApp.post("/mcp", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.RING_MCP_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = await c.req.json();
  } catch {
    return c.json(failure(null, -32700, "parse error"), 400);
  }

  const { id, method, params } = msg;
  // A JSON-RPC notification (no id) gets no body — the client isn't waiting.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const asked = (params?.protocolVersion as string) || FALLBACK_PROTOCOL;
      return respond(c,
        result(id, {
          protocolVersion: asked,
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: ROUTING_RULE,
        })
      );
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return c.body(null, 202);

    case "ping":
      return respond(c, result(id, {}));

    case "tools/list":
      return respond(c, result(id, { tools: [TOOL] }));

    case "prompts/list":
      return respond(c, result(id, { prompts: [PROMPT] }));

    case "prompts/get":
      return respond(c,
        result(id, {
          description: PROMPT.description,
          messages: [
            { role: "user", content: { type: "text", text: ROUTING_RULE } },
          ],
        })
      );

    case "tools/call": {
      const name = params?.name as string;
      if (name !== TOOL.name) {
        return respond(c, failure(id, -32602, `unknown tool: ${name}`));
      }
      const args = (params?.arguments ?? {}) as { text?: unknown };
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) {
        return respond(c,
          result(id, {
            content: [{ type: "text", text: "Nothing sent — the message was empty." }],
            isError: true,
          })
        );
      }

      const stub = c.env.RING_ROOM.get(c.env.RING_ROOM.idFromName("ring"));
      let delivered = false;
      try {
        const res = await stub.fetch("https://do/send", {
          method: "POST",
          body: text.slice(0, TEXT_MAX),
        });
        delivered = ((await res.json()) as { delivered: boolean }).delivered;
      } catch {
        delivered = false;
      }

      return respond(c,
        result(id, {
          content: [
            {
              type: "text",
              text: delivered
                ? "Sent to coordinator. It will push a notification to your phone when it's done."
                : "Coordinator offline — nothing was sent. It isn't connected right now.",
            },
          ],
        })
      );
    }

    default:
      if (isNotification) return c.body(null, 202);
      return respond(c, failure(id, -32601, `method not found: ${method}`));
  }
});

// Liveness probe for the mini's own use — is the socket actually attached?
ringApp.get("/status", async (c) => {
  if (!authorized(c.req.header("Authorization"), c.env.RING_MCP_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const stub = c.env.RING_ROOM.get(c.env.RING_ROOM.idFromName("ring"));
  return stub.fetch("https://do/status");
});
