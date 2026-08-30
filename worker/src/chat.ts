// Chat: REST routes, mounted at /chat by index.ts (after cors; the /chat/ws
// upgrade lives in index.ts BEFORE cors — immutable 101 headers, same as
// kart3/mahjong/hard).
//
// Identity is the rule that must not bend: `sender` is assigned HERE from the
// credential and passed to the DO — it never comes from a request body.
//   - Matt / Tingting: Bearer <session UUID> (the existing /auth flow), mapped
//     email -> sender name via the CHAT_SENDERS var.
//   - Claude: Bearer CHAT_CLAUDE_TOKEN (wrangler secret), constant-time
//     compared, stamped 'claude'. A human session cannot produce 'claude' and
//     Claude's token cannot produce a human sender.

import { Hono } from "hono";
import { authorized } from "./ring.ts";

export type ChatBindings = {
  DB: D1Database;
  KV: KVNamespace;
  CHAT_ROOM: DurableObjectNamespace;
  ALLOWED_EMAILS: string;
  CHAT_SENDERS: string;      // "email:name,email:name"
  CHAT_CLAUDE_TOKEN: string; // secret
};

type Variables = { sender: string; email: string | null };

const SESSION_PREFIX = "__session:";
export const CHAT_WS_TICKET_PREFIX = "__chatws:";

export const THREADS: Record<string, string[]> = {
  dm: ["matt", "claude"],
  group: ["matt", "tingting", "claude"],
};

export function parseSenderMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const [email, name] = pair.split(":").map((s) => s.trim().toLowerCase());
    if (email && name) map.set(email, name);
  }
  return map;
}

export function memberOf(thread: string, sender: string): boolean {
  return (THREADS[thread] ?? []).includes(sender);
}

function room(env: ChatBindings, thread: string): DurableObjectStub {
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(thread));
}

// Resolve the caller to a sender name, or null. Claude's token is checked
// first with the same constant-time compare the ring uses; anything else is
// treated as a session UUID.
async function resolveSender(env: ChatBindings, authHeader: string | undefined): Promise<{ sender: string; email: string | null } | null> {
  if (authorized(authHeader, env.CHAT_CLAUDE_TOKEN)) return { sender: "claude", email: null };
  if (!authHeader?.startsWith("Bearer ")) return null;
  const email = await env.KV.get(`${SESSION_PREFIX}${authHeader.slice(7)}`);
  if (!email) return null;
  const lower = email.toLowerCase();
  // Allowlist re-checked on every request, matching /kv and /hard behaviour.
  const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
  if (!allowed.includes(lower)) return null;
  const sender = parseSenderMap(env.CHAT_SENDERS).get(lower);
  return sender ? { sender, email: lower } : null;
}

export const chatApp = new Hono<{ Bindings: ChatBindings; Variables: Variables }>();

chatApp.use("*", async (c, next) => {
  const who = await resolveSender(c.env, c.req.header("Authorization"));
  if (!who) return c.json({ error: "unauthorized" }, 401);
  c.set("sender", who.sender);
  c.set("email", who.email);
  await next();
});

// Who am I, and which threads can I see? The client builds its thread list
// from this rather than hardcoding membership — Tingting's app never learns
// that dm exists.
chatApp.get("/me", (c) => {
  const sender = c.get("sender");
  const threads = Object.keys(THREADS).filter((t) => memberOf(t, sender));
  return c.json({ sender, threads });
});

// Web Push subscriptions, keyed by endpoint, owned by email. Claude has no
// email and no lock screen; its token gets 400 here.
chatApp.post("/push/subscribe", async (c) => {
  const email = c.get("email");
  if (!email) return c.json({ error: "humans only" }, 400);
  const b = (await c.req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth) return c.json({ error: "bad subscription" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO chat_push_subs (endpoint, email, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(b.endpoint, email, b.keys.p256dh, b.keys.auth, Date.now()).run();
  return c.json({ ok: true });
});

chatApp.post("/push/unsubscribe", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!b?.endpoint) return c.json({ error: "bad request" }, 400);
  await c.env.DB.prepare("DELETE FROM chat_push_subs WHERE endpoint = ?").bind(b.endpoint).run();
  return c.json({ ok: true });
});

// Membership gate for thread-addressed routes. Non-members get 404, not 403:
// Tingting's session must not be able to confirm that `dm` exists.
chatApp.use("/:thread/*", async (c, next) => {
  const thread = c.req.param("thread");
  if (!THREADS[thread] || !memberOf(thread, c.get("sender"))) {
    return c.json({ error: "not found" }, 404);
  }
  await next();
});

// List messages. Two modes:
//   ?after=<seq>   — catch-up: everything (messages + reaction events) past the
//                    cursor, oldest first. One stream, one cursor.
//   ?before=<seq>  — history paging: messages only, newest first, with the
//                    CURRENT reactions for those messages attached.
chatApp.get("/:thread/messages", async (c) => {
  const thread = c.req.param("thread");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const after = c.req.query("after");
  const before = c.req.query("before");

  if (after !== undefined) {
    const cursor = parseInt(after, 10) || 0;
    const messages = await c.env.DB.prepare(
      "SELECT id, thread, seq, sender, body, created_at, client_at, reply_to FROM chat_messages WHERE thread = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
    ).bind(thread, cursor, limit).all();
    const reactions = await c.env.DB.prepare(
      "SELECT message_id, sender, emoji, seq, removed_at FROM chat_reactions WHERE thread = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
    ).bind(thread, cursor, limit).all();
    return c.json({ messages: messages.results, reactions: reactions.results });
  }

  const cursor = before ? parseInt(before, 10) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  const messages = await c.env.DB.prepare(
    "SELECT id, thread, seq, sender, body, created_at, client_at, reply_to FROM chat_messages WHERE thread = ? AND seq < ? ORDER BY seq DESC LIMIT ?"
  ).bind(thread, cursor, limit).all();
  const ids = messages.results.map((m) => (m as { id: string }).id);
  let reactions: unknown[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const r = await c.env.DB.prepare(
      `SELECT message_id, sender, emoji, seq FROM chat_reactions WHERE message_id IN (${placeholders}) AND removed_at IS NULL`
    ).bind(...ids).all();
    reactions = r.results;
  }
  return c.json({ messages: messages.results, reactions });
});

chatApp.post("/:thread/send", async (c) => {
  const thread = c.req.param("thread");
  const b = (await c.req.json().catch(() => null)) as { id?: string; body?: string; clientAt?: number; replyTo?: string } | null;
  if (!b?.id || typeof b.body !== "string") return c.json({ error: "bad request" }, 400);
  const res = await room(c.env, thread).fetch("https://do/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread, sender: c.get("sender"), msgId: b.id, body: b.body, clientAt: b.clientAt, replyTo: b.replyTo }),
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
});

chatApp.post("/:thread/react", async (c) => {
  const thread = c.req.param("thread");
  const b = (await c.req.json().catch(() => null)) as { messageId?: string; emoji?: string; op?: string } | null;
  if (!b?.messageId || !b.emoji || (b.op !== "add" && b.op !== "remove")) return c.json({ error: "bad request" }, 400);
  const res = await room(c.env, thread).fetch("https://do/react", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread, sender: c.get("sender"), messageId: b.messageId, emoji: b.emoji, op: b.op }),
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
});

chatApp.post("/:thread/read", async (c) => {
  const thread = c.req.param("thread");
  const b = (await c.req.json().catch(() => null)) as { lastSeq?: number } | null;
  if (typeof b?.lastSeq !== "number") return c.json({ error: "bad request" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO chat_reads (thread, sender, last_seq, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (thread, sender) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq), updated_at = excluded.updated_at`
  ).bind(thread, c.get("sender"), b.lastSeq, Date.now()).run();
  return c.json({ ok: true });
});

// Full-thread JSON export — the "data is never hostage" route.
chatApp.get("/:thread/export", async (c) => {
  const thread = c.req.param("thread");
  const messages = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE thread = ? ORDER BY seq ASC"
  ).bind(thread).all();
  const reactions = await c.env.DB.prepare(
    "SELECT * FROM chat_reactions WHERE thread = ? AND removed_at IS NULL ORDER BY seq ASC"
  ).bind(thread).all();
  return c.json({ thread, exported_at: Date.now(), messages: messages.results, reactions: reactions.results });
});

// Mint a single-use 60s WebSocket ticket (browsers cannot set headers on a WS
// upgrade). The ticket pins both sender and thread; membership was already
// checked by the middleware above.
chatApp.post("/:thread/ws-ticket", async (c) => {
  const thread = c.req.param("thread");
  const ticket = crypto.randomUUID();
  await c.env.KV.put(`${CHAT_WS_TICKET_PREFIX}${ticket}`, JSON.stringify({ sender: c.get("sender"), thread }), { expirationTtl: 60 });
  return c.json({ ticket });
});
