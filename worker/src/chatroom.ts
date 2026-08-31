// Chat: ChatRoom Durable Object. One instance per thread — idFromName("dm"),
// idFromName("group") — so the private thread's sockets are physically separate
// from the group's and a fan-out bug cannot leak one into the other.
//
// Same architecture as HardRoom: D1 is the source of truth, this DO serialises
// writes (its input gate makes seq allocation race-free), holds the WebSockets,
// and broadcasts AFTER commit. The DO stores nothing authoritative — only the
// seq counter (recoverable from D1) and rate-limit windows.
//
// The worker routes in chat.ts do all authentication and membership checks
// before anything reaches this object; requests here carry an already-resolved
// sender. Reads never come here — the worker queries D1 directly.

import { buildPushRequest } from "./hardpush.ts";
import { parseSenderMap, THREADS, DEVICE_OWNERS } from "./chat.ts";

export type ChatEnv = {
  DB: D1Database;
  RING_ROOM: DurableObjectNamespace;
  CHAT_SENDERS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

const BODY_MAX = 8 * 1024;        // one paste must not wedge a thread
const EMOJI_MAX_PER_MESSAGE = 8;  // distinct emoji per message
const PING_MS = 4 * 60 * 1000; // keep hibernating sockets honest, like RingRoom
const RATE_MSG_PER_MIN = 30;
const RATE_REACT_PER_MIN = 60;
const WINDOW_MS = 60_000;

type SendBody = {
  thread: string;
  sender: string;
  msgId: string;
  body: string;
  clientAt?: number;
  replyTo?: string;
};

type ReactBody = {
  thread: string;
  sender: string;
  messageId: string;
  emoji: string;
  op: "add" | "remove"; // explicit, never toggle: retries must be idempotent
};

type Attachment = { sender: string };

export class ChatRoom {
  private state: DurableObjectState;
  private env: ChatEnv;

  constructor(state: DurableObjectState, env: ChatEnv) {
    this.state = state;
    this.env = env;
  }

  // seq is authoritative here while the DO lives; recovered from D1 if the
  // object is ever rebuilt. Messages and reactions share one stream so clients
  // catch up with a single cursor.
  private async nextSeq(thread: string): Promise<number> {
    let seq = (await this.state.storage.get<number>("seq")) ?? 0;
    if (seq === 0) {
      const m = await this.env.DB.prepare(
        "SELECT MAX(s) AS s FROM (SELECT MAX(seq) AS s FROM chat_messages WHERE thread = ? UNION ALL SELECT MAX(seq) FROM chat_reactions WHERE thread = ?)"
      ).bind(thread, thread).first<{ s: number | null }>();
      seq = m?.s ?? 0;
    }
    seq += 1;
    await this.state.storage.put("seq", seq);
    return seq;
  }

  private async rateOk(kind: "m" | "r", sender: string): Promise<boolean> {
    const key = `rl:${kind}:${sender}`;
    const now = Date.now();
    const w = (await this.state.storage.get<{ start: number; count: number }>(key)) ?? { start: now, count: 0 };
    if (now - w.start >= WINDOW_MS) { w.start = now; w.count = 0; }
    w.count += 1;
    await this.state.storage.put(key, w);
    return w.count <= (kind === "m" ? RATE_MSG_PER_MIN : RATE_REACT_PER_MIN);
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(data); } catch { /* closing socket */ }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/send" && request.method === "POST") {
      const b = (await request.json()) as SendBody;
      const body = b.body ?? "";
      if (!body.trim()) return Response.json({ error: "empty" }, { status: 400 });
      // Reject rather than silently truncate — a user who pastes 8KB+ should
      // know it didn't send, not discover a cut-off message later.
      if (body.length > BODY_MAX) return Response.json({ error: "too long" }, { status: 413 });
      if (!/^[0-9a-f-]{16,64}$/i.test(b.msgId ?? "")) return Response.json({ error: "bad msgId" }, { status: 400 });

      // Idempotency: same msgId returns the original row, so the offline
      // outbox can retry an ambiguous failure without double-posting.
      const existing = await this.env.DB.prepare(
        "SELECT id, thread, seq, sender, body, created_at, client_at, reply_to FROM chat_messages WHERE id = ?"
      ).bind(b.msgId).first();
      if (existing) return Response.json({ message: existing, duplicate: true });

      if (!(await this.rateOk("m", b.sender))) return Response.json({ error: "rate limited" }, { status: 429 });

      const seq = await this.nextSeq(b.thread);
      const createdAt = Date.now();
      await this.env.DB.prepare(
        "INSERT INTO chat_messages (id, thread, seq, sender, body, created_at, client_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(b.msgId, b.thread, seq, b.sender, body, createdAt, b.clientAt ?? null, b.replyTo ?? null).run();

      const message = { id: b.msgId, thread: b.thread, seq, sender: b.sender, body, created_at: createdAt, client_at: b.clientAt ?? null, reply_to: b.replyTo ?? null };
      this.broadcast({ type: "message", message }); // after commit, never before
      // Push + Claude-forward are best-effort and must not delay the sender's
      // 200 — waitUntil keeps them running after the response is returned.
      this.state.waitUntil(this.afterMessage(message));
      return Response.json({ message });
    }

    if (url.pathname === "/react" && request.method === "POST") {
      const b = (await request.json()) as ReactBody;
      if (!b.emoji || b.emoji.length > 16) return Response.json({ error: "bad emoji" }, { status: 400 });
      if (b.op !== "add" && b.op !== "remove") return Response.json({ error: "bad op" }, { status: 400 });

      const msg = await this.env.DB.prepare(
        "SELECT id FROM chat_messages WHERE id = ? AND thread = ?"
      ).bind(b.messageId, b.thread).first();
      if (!msg) return Response.json({ error: "no such message" }, { status: 404 });

      if (!(await this.rateOk("r", b.sender))) return Response.json({ error: "rate limited" }, { status: 429 });

      const now = Date.now();
      if (b.op === "add") {
        const distinct = await this.env.DB.prepare(
          "SELECT COUNT(DISTINCT emoji) AS n FROM chat_reactions WHERE message_id = ? AND removed_at IS NULL"
        ).bind(b.messageId).first<{ n: number }>();
        // Active rows only: a tombstoned reaction is not "already on the
        // message", and counting it let a revived emoji slip past the cap.
        const mine = await this.env.DB.prepare(
          "SELECT emoji FROM chat_reactions WHERE message_id = ? AND sender = ? AND emoji = ? AND removed_at IS NULL"
        ).bind(b.messageId, b.sender, b.emoji).first();
        if ((distinct?.n ?? 0) >= EMOJI_MAX_PER_MESSAGE && !mine) {
          return Response.json({ error: "emoji cap" }, { status: 409 });
        }
      }

      const seq = await this.nextSeq(b.thread);
      // Tombstone semantics: add revives (removed_at = NULL), remove stamps it.
      // Either way the row takes a fresh seq so ?after= sync sees the change.
      await this.env.DB.prepare(
        `INSERT INTO chat_reactions (message_id, thread, sender, emoji, seq, created_at, removed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (message_id, sender, emoji)
         DO UPDATE SET seq = excluded.seq, removed_at = excluded.removed_at`
      ).bind(b.messageId, b.thread, b.sender, b.emoji, seq, now, b.op === "remove" ? now : null).run();

      const reaction = { message_id: b.messageId, thread: b.thread, sender: b.sender, emoji: b.emoji, seq, removed: b.op === "remove" };
      this.broadcast({ type: "reaction", reaction });
      return Response.json({ reaction });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const sender = url.searchParams.get("sender") ?? "";
      if (!sender) return new Response("no sender", { status: 400 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ sender } satisfies Attachment);
      // A silently-dead socket (mobile NAT drop, backgrounded iOS PWA) never
      // fires close on its own, and connectedSenders() would then suppress
      // that member's push forever. The alarm ping forces the failure: the
      // send errors, the runtime closes the socket, and push resumes.
      await this.state.storage.setAlarm(Date.now() + PING_MS);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("not found", { status: 404 });
  }

  // Who has a live socket right now — used to avoid buzzing a phone for a
  // message already on screen.
  private connectedSenders(): Set<string> {
    const set = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) set.add(a.sender);
    }
    return set;
  }

  private async afterMessage(message: { thread: string; sender: string; body: string; id: string; seq: number }): Promise<void> {
    const members = THREADS[message.thread] ?? [];
    const connected = this.connectedSenders();
    const owner = DEVICE_OWNERS[message.sender]; // set => this is Matt's own voice

    // --- Web Push to offline humans (assumption 11: body included) ---
    const emailOf = new Map<string, string>();
    for (const [email, name] of parseSenderMap(this.env.CHAT_SENDERS)) emailOf.set(name, email);
    const vapid = { subject: this.env.VAPID_SUBJECT, publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY };
    for (const member of members) {
      if (member === message.sender || member === owner || member === "claude" || connected.has(member)) continue;
      const email = emailOf.get(member);
      if (!email) continue;
      const subs = await this.env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM chat_push_subs WHERE email = ?"
      ).bind(email).all<{ endpoint: string; p256dh: string; auth: string }>();
      await Promise.allSettled(subs.results.map(async (sub) => {
        const req = await buildPushRequest(
          { title: message.sender === "claude" ? "Claude" : message.sender.charAt(0).toUpperCase() + message.sender.slice(1),
            body: message.body.slice(0, 500), thread: message.thread, seq: message.seq },
          sub, vapid, 24 * 3600
        );
        const res = await fetch(sub.endpoint, { method: req.method, headers: req.headers, body: req.body as unknown as BodyInit });
        if (res.status === 404 || res.status === 410) {
          await this.env.DB.prepare("DELETE FROM chat_push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
        }
      }));
    }

    // --- Forward to Claude's channel (the ring agent's socket) ---
    // dm: everything that isn't Claude's own message. group: only @claude
    // mentions — the agent should not read the couple's chatter.
    // Every non-Claude message in a Claude thread is forwarded — group
    // included. The agent hears the whole room and decides for itself
    // whether to speak; @claude mentions oblige a reply, the rest are its
    // judgment (policy lives in the ring agent's CLAUDE.md).
    if (message.sender !== "claude" && members.includes("claude")) {
      try {
        const stub = this.env.RING_ROOM.get(this.env.RING_ROOM.idFromName("ring"));
        await stub.fetch("https://do/forward", {
          method: "POST",
          body: JSON.stringify({ type: "chat", thread: message.thread, sender: message.sender, message_id: message.id, seq: message.seq, text: message.body, at: Date.now() }),
        });
      } catch { /* agent offline; the message is in the thread regardless */ }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // The socket is delivery-only; all writes go through the HTTP routes so
    // every mutation passes the same validation. Keepalive is the exception.
    if (typeof message === "string" && message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch { /* closing */ }
    }
    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + PING_MS);
    }
  }
}
