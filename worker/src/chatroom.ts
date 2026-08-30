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

export type ChatEnv = {
  DB: D1Database;
};

const BODY_MAX = 8 * 1024;        // one paste must not wedge a thread
const EMOJI_MAX_PER_MESSAGE = 8;  // distinct emoji per message
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
      const body = (b.body ?? "").slice(0, BODY_MAX);
      if (!body.trim()) return Response.json({ error: "empty" }, { status: 400 });
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
        const mine = await this.env.DB.prepare(
          "SELECT emoji FROM chat_reactions WHERE message_id = ? AND sender = ? AND emoji = ?"
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
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("not found", { status: 404 });
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
}
