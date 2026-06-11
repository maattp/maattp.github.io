// Fable Kart multiplayer room — one Durable Object instance per room code.
// (File/DO/routes keep the pre-rename "kart3" name: shipped clients use them.)
//
// Responsibilities (M1, see apps/fablekart/VISION.md):
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
  ver: string;
};

type Phase = "lobby" | "racing";

const MAX_PLAYERS = 4;
const ROOM_TTL_MS = 45 * 60 * 1000; // hard kill switch for abandoned rooms
const NAME_MAX = 12;

function sanitizeVer(raw: unknown): string {
  // old clients send no version — 'legacy' never matches a tagged build
  return String(raw ?? "legacy").slice(0, 24);
}

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
    this.broadcast({
      t: "roster",
      players: this.roster(),
      phase: await this.phase(),
      track: (await this.state.storage.get<number>("track")) || 0,
    });
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
      const players = this.roster();
      const name = sanitizeName(msg.name);
      if ((await this.phase()) === "racing") {
        // mid-race REJOIN: a disconnected player can reclaim their seat by
        // name (host has been driving their kart as AI meanwhile)
        const seats = (await this.state.storage.get<{ id: number; name: string }[]>("seats")) || [];
        const connected = new Set(players.map((p) => p.id));
        const seat = seats.find(
          (s) => !connected.has(s.id) && s.name.toLowerCase() === name.toLowerCase()
        );
        if (!seat) {
          ws.send(JSON.stringify({ t: "error", msg: "race in progress" }));
          ws.close(1008, "race in progress");
          return;
        }
        const hostP0 = players.find((p) => p.host);
        if (hostP0 && sanitizeVer(msg.ver) !== hostP0.ver) {
          ws.send(JSON.stringify({
            t: "error",
            msg: "Game versions differ — close the app fully and reopen it, then rejoin",
          }));
          ws.close(1008, "version mismatch");
          return;
        }
        const a: Attachment = { id: seat.id, name: seat.name, charIdx: 0, ready: true, host: false, ver: sanitizeVer(msg.ver) };
        ws.serializeAttachment(a);
        const code0 = (await this.state.storage.get<string>("code")) || "";
        ws.send(JSON.stringify({ t: "welcome", id: a.id, host: false, code: code0, rejoin: true }));
        // host fetches them back up to speed with a state event
        this.sendTo((p) => p.host, { t: "rejoined", id: a.id });
        await this.broadcastRoster();
        return;
      }
      if (players.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: "error", msg: "room full" }));
        ws.close(1008, "room full");
        return;
      }
      // version gate: different builds desync (track geometry, snapshot
      // format) — only pair clients matching the host's version
      const hostP = players.find((p) => p.host);
      if (hostP && sanitizeVer(msg.ver) !== hostP.ver) {
        ws.send(JSON.stringify({
          t: "error",
          msg: "Game versions differ — close the app fully and reopen it on the older phone, then rejoin",
        }));
        ws.close(1008, "version mismatch");
        return;
      }
      const used = new Set(players.map((p) => p.id));
      let id = 0;
      while (used.has(id)) id++;
      const a: Attachment = {
        id,
        name,
        charIdx: Number.isInteger(msg.charIdx) ? Math.max(0, Math.min(7, msg.charIdx)) : 0,
        ready: false,
        host: players.length === 0,
        ver: sanitizeVer(msg.ver),
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
      case "track": {
        // host picks the track in the lobby; everyone's backdrop follows
        if (!me.host) return;
        if ((await this.phase()) !== "lobby") return;
        await this.state.storage.put("track", Number.isInteger(msg.track) && msg.track >= 0 ? msg.track : 0);
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
        // remember who holds each seat so they can rejoin mid-race by name
        await this.state.storage.put("seats", players.map((p) => ({ id: p.id, name: p.name })));
        await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
        this.broadcast({
          t: "start", seed: msg.seed >>> 0, laps: msg.laps, players,
          track: (await this.state.storage.get<number>("track")) || 0,
        });
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
        // host → everyone else, or a single peer when msg.to is set
        if (!me.host) return;
        if (typeof msg.to === "number") this.sendTo((a) => a.id === msg.to, msg);
        else this.broadcast(msg, me.id);
        return;
      }
      case "rtc": {
        // WebRTC signaling (offer/answer/ICE) relayed peer→peer
        if (typeof msg.to !== "number") return;
        msg.from = me.id;
        this.sendTo((a) => a.id === msg.to, msg);
        return;
      }
      case "pp": {
        // latency probe: echo straight back to the sender
        ws.send(JSON.stringify({ t: "pp", ts: msg.ts }));
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
