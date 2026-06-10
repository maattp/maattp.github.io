// Kart 3 multiplayer room — one Durable Object instance per room code.
//
// Responsibilities (M1, see apps/kart3/VISION.md):
//   - WebSocket hub for up to 4 players (hibernation API: the DO sleeps
//     between messages, attachments survive)
//   - lobby state: roster, character picks, ready flags, host designation
//   - star-topology message relay: client inputs → host; host snapshots/
//     events → everyone else (payloads are opaque to the DO)
//   - lifecycle: created via POST /kart3/rooms (uninitialized rooms reject
//     sockets), idle cleanup via alarm
//
// No Google auth here by design: friends join with just a room code. The
// locked-down /kv/* API is untouched.

type Attachment = {
  id: number;
  name: string;
  charIdx: number;
  ready: boolean;
  host: boolean;
};

type Phase = "lobby" | "racing";

const MAX_PLAYERS = 4;
const ROOM_TTL_MS = 45 * 60 * 1000; // hard kill switch for abandoned rooms
const NAME_MAX = 12;

function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[<>&"'`]/g, "").trim();
  return (s || "Racer").slice(0, NAME_MAX);
}

export class Kart3Room {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async phase(): Promise<Phase> {
    return ((await this.state.storage.get<string>("phase")) as Phase) || "lobby";
  }

  private roster(): Attachment[] {
    const players: Attachment[] = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) players.push(a);
    }
    return players.sort((x, y) => x.id - y.id);
  }

  private broadcast(msg: unknown, exceptId?: number): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.id === exceptId) continue;
      try { ws.send(data); } catch { /* closing socket */ }
    }
  }

  private sendTo(pred: (a: Attachment) => boolean, msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && pred(a)) {
        try { ws.send(data); } catch { /* closing socket */ }
      }
    }
  }

  private async broadcastRoster(): Promise<void> {
    this.broadcast({ t: "roster", players: this.roster(), phase: await this.phase() });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const code = await request.text();
      await this.state.storage.put({ created: true, code, phase: "lobby" });
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response("ok");
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      if (!(await this.state.storage.get("created"))) {
        return new Response("no such room", { status: 404 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/status") {
      return Response.json({
        exists: !!(await this.state.storage.get("created")),
        phase: await this.phase(),
        players: this.roster().length,
      });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") { ws.send("pong"); return; }

    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    const me = ws.deserializeAttachment() as Attachment | null;

    // first message must be hello
    if (!me) {
      if (msg.t !== "hello") { ws.close(1008, "hello first"); return; }
      if ((await this.phase()) === "racing") {
        ws.send(JSON.stringify({ t: "error", msg: "race in progress" }));
        ws.close(1008, "race in progress");
        return;
      }
      const players = this.roster();
      if (players.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: "error", msg: "room full" }));
        ws.close(1008, "room full");
        return;
      }
      const used = new Set(players.map((p) => p.id));
      let id = 0;
      while (used.has(id)) id++;
      const a: Attachment = {
        id,
        name: sanitizeName(msg.name),
        charIdx: Number.isInteger(msg.charIdx) ? Math.max(0, Math.min(7, msg.charIdx)) : 0,
        ready: false,
        host: players.length === 0,
      };
      ws.serializeAttachment(a);
      const code = (await this.state.storage.get<string>("code")) || "";
      ws.send(JSON.stringify({ t: "welcome", id: a.id, host: a.host, code }));
      await this.broadcastRoster();
      return;
    }

    switch (msg.t) {
      case "char": {
        if ((await this.phase()) !== "lobby") return;
        me.charIdx = Number.isInteger(msg.charIdx) ? Math.max(0, Math.min(7, msg.charIdx)) : me.charIdx;
        me.ready = false; // re-confirm after changing character
        ws.serializeAttachment(me);
        await this.broadcastRoster();
        return;
      }
      case "ready": {
        if ((await this.phase()) !== "lobby") return;
        me.ready = !!msg.ready;
        ws.serializeAttachment(me);
        await this.broadcastRoster();
        return;
      }
      case "start": {
        if (!me.host) return;
        if ((await this.phase()) !== "lobby") return;
        const players = this.roster();
        if (players.length < 2) {
          ws.send(JSON.stringify({ t: "error", msg: "need at least 2 players" }));
          return;
        }
        if (!players.every((p) => p.ready || p.host)) {
          ws.send(JSON.stringify({ t: "error", msg: "not everyone is ready" }));
          return;
        }
        await this.state.storage.put("phase", "racing");
        await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
        this.broadcast({ t: "start", seed: msg.seed >>> 0, laps: msg.laps, players });
        return;
      }
      case "end": {
        // host returns the room to the lobby (rematch)
        if (!me.host) return;
        await this.state.storage.put("phase", "lobby");
        for (const sock of this.state.getWebSockets()) {
          const a = sock.deserializeAttachment() as Attachment | null;
          if (a) { a.ready = false; sock.serializeAttachment(a); }
        }
        await this.broadcastRoster();
        return;
      }
      case "input": {
        // client → host only (tiny, high-rate; payload opaque)
        if (me.host) return;
        msg.from = me.id;
        this.sendTo((a) => a.host, msg);
        return;
      }
      case "snap":
      case "event": {
        // host → everyone else (payload opaque)
        if (!me.host) return;
        this.broadcast(msg, me.id);
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleGone(ws);
  }

  private async handleGone(ws: WebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as Attachment | null;
    try { ws.close(); } catch { /* already closed */ }
    if (!me) return;
    // serializeAttachment(null) isn't allowed; the socket is already out of
    // getWebSockets() after close, so just announce and re-roster.
    const remaining = this.roster().filter((p) => p.id !== me.id);
    if (me.host) {
      // host gone: end any race, promote the longest-waiting player in lobby
      this.broadcast({ t: "host-left" }, me.id);
      await this.state.storage.put("phase", "lobby");
      const heir = remaining[0];
      if (heir) {
        for (const sock of this.state.getWebSockets()) {
          const a = sock.deserializeAttachment() as Attachment | null;
          if (a && a.id === heir.id) {
            a.host = true; a.ready = false;
            sock.serializeAttachment(a);
            sock.send(JSON.stringify({ t: "you-are-host" }));
          }
        }
      }
    } else {
      this.broadcast({ t: "peer-left", id: me.id, name: me.name }, me.id);
    }
    if (remaining.length === 0) {
      await this.state.storage.deleteAll();
    } else {
      await this.broadcastRoster();
    }
  }

  async alarm(): Promise<void> {
    // room expired: boot everyone, wipe state
    for (const ws of this.state.getWebSockets()) {
      try { ws.close(1001, "room expired"); } catch { /* already closed */ }
    }
    await this.state.storage.deleteAll();
  }
}
