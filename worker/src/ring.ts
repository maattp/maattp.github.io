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

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const ringApp = new Hono<{ Bindings: RingBindings }>();

// Clients probe this endpoint with GET before POSTing. The Streamable HTTP
// spec says a server with no SSE stream should answer 405, but Pebble's client
// treats anything other than 200 as the endpoint being down ("Expected status
// code 200 but was 405"), so GET returns a small 200 health body instead. No
// SSE stream is opened — every real response is a JSON body on the POST.
// DELETE (session teardown) has no meaning here; 405 is fine for it, since no
// client health-checks with DELETE.
ringApp.get("/mcp", (c) =>
  c.json({ ok: true, server: SERVER_INFO.name, transport: "streamable-http", method: "POST" })
);
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
      return c.json(
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
      return c.json(result(id, {}));

    case "tools/list":
      return c.json(result(id, { tools: [TOOL] }));

    case "prompts/list":
      return c.json(result(id, { prompts: [PROMPT] }));

    case "prompts/get":
      return c.json(
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
        return c.json(failure(id, -32602, `unknown tool: ${name}`));
      }
      const args = (params?.arguments ?? {}) as { text?: unknown };
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) {
        return c.json(
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

      return c.json(
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
      return c.json(failure(id, -32601, `method not found: ${method}`));
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
