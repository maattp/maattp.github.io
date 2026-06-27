// Sichuan Mahjong online room — one Durable Object instance per room code.
//
// Unlike Kart3Room (an opaque relay), this DO is SERVER-AUTHORITATIVE: it runs
// the shared rules engine (mahjongCore.js — the same code the browser uses for
// local play) and is the only place that holds the full hidden state. Each
// connected client is sent ONLY its own redacted view (viewFor), so no client
// can ever see another player's concealed tiles — the anti-cheat property a
// host-authoritative model can't give a hidden-information game.
//
// Hibernation-safe: the entire game lives in DO storage (the engine state is
// plain JSON). Every message loads state, mutates, saves, and broadcasts. Bots
// run server-side, paced by the alarm so play looks human and survives eviction.
//
// No Google auth: friends join with a room code (origin-gated in index.ts).

import { createGame, getLegalActions, pendingDeciders, applyAction, botChooseAction, viewFor, makeConfig } from "./mahjongCore.js";

type Attachment = { id: number; name: string; ready: boolean; host: boolean; ver: string };
type LobbyCfg = { mode: "bloody" | "single"; sevenPairs: boolean; difficulty: "easy" | "normal" | "hard" };

const MAX_PLAYERS = 4;
const ROOM_TTL_MS = 45 * 60 * 1000;
const EMPTY_GRACE_MS = 90 * 1000;   // keep an empty room briefly so a blip can reconnect
const BOT_DELAY_MS = 650;
const NAME_MAX = 12;

function sanitizeVer(raw: unknown): string { return String(raw ?? "legacy").slice(0, 24); }
function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[<>&"'`]/g, "").trim();
  return (s || "Player").slice(0, NAME_MAX);
}
const DEFAULT_CFG: LobbyCfg = { mode: "bloody", sevenPairs: true, difficulty: "normal" };

export class MahjongRoom {
  private state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }

  // ---- storage helpers ----
  private async phase(): Promise<"lobby" | "playing"> {
    return ((await this.state.storage.get<string>("phase")) as any) || "lobby";
  }
  private async cfg(): Promise<LobbyCfg> {
    return (await this.state.storage.get<LobbyCfg>("cfg")) || { ...DEFAULT_CFG };
  }
  private async loadGame(): Promise<any | null> { return (await this.state.storage.get<any>("game")) || null; }
  private async saveGame(g: any): Promise<void> { await this.state.storage.put("game", g); }
  private async bumpTtl(): Promise<number> { const at = Date.now() + ROOM_TTL_MS; await this.state.storage.put("ttlAt", at); return at; }

  private roster(): Attachment[] {
    const out: Attachment[] = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) out.push(a);
    }
    return out.sort((x, y) => x.id - y.id);
  }
  private socketFor(id: number): WebSocket | null {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.id === id) return ws;
    }
    return null;
  }
  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) { try { ws.send(data); } catch { /* closing */ } }
  }
  private sendId(id: number, msg: unknown): void {
    const ws = this.socketFor(id);
    if (ws) { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } }
  }

  // ---- lobby + game broadcasting ----
  private async broadcastLobby(): Promise<void> {
    const cfg = await this.cfg();
    const code = (await this.state.storage.get<string>("code")) || "";
    const players = this.roster().map((a) => ({ id: a.id, name: a.name, ready: a.ready, host: a.host }));
    this.broadcast({ t: "lobby", code, phase: "lobby", cfg, players, maxPlayers: MAX_PLAYERS });
  }
  private broadcastViews(game: any): void {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      try { ws.send(JSON.stringify({ t: "view", view: viewFor(game, a.id) })); } catch { /* closing */ }
    }
  }

  // ====================================================================
  // HTTP (init / ws upgrade / status)
  // ====================================================================
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      // guard a (vanishingly unlikely) code collision: don't re-init a live room — that
      // would merge phase:"lobby"/default cfg over an in-progress game and strand players.
      if (await this.state.storage.get("created")) return new Response("conflict", { status: 409 });
      const code = await request.text();
      await this.state.storage.put({ created: true, code, phase: "lobby", cfg: { ...DEFAULT_CFG } });
      await this.bumpTtl();
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response("ok");
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (!(await this.state.storage.get("created"))) return new Response("no such room", { status: 404 });
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

  // ====================================================================
  // WebSocket messages
  // ====================================================================
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    if (!(await this.state.storage.get("created"))) { try { ws.close(1001, "room gone"); } catch { /* */ } return; }
    const me = ws.deserializeAttachment() as Attachment | null;

    if (!me) { await this.handleHello(ws, msg); return; }
    await this.bumpTtl();   // any activity from a connected client keeps the room alive

    switch (msg.t) {
      case "ready": {
        if ((await this.phase()) !== "lobby") return;
        me.ready = !!msg.ready; ws.serializeAttachment(me);
        await this.broadcastLobby();
        return;
      }
      case "config": {
        if (!me.host || (await this.phase()) !== "lobby") return;
        const cur = await this.cfg();
        const next: LobbyCfg = {
          mode: msg.mode === "single" ? "single" : "bloody",
          sevenPairs: msg.sevenPairs !== false,
          difficulty: ["easy", "normal", "hard"].includes(msg.difficulty) ? msg.difficulty : cur.difficulty,
        };
        await this.state.storage.put("cfg", next);
        await this.broadcastLobby();
        return;
      }
      case "start": {
        if (!me.host || (await this.phase()) !== "lobby") return;
        await this.startHand();
        return;
      }
      case "rematch": {
        if (!me.host || (await this.phase()) !== "playing") return;
        const g = await this.loadGame();
        if (!g || g.phase !== "HAND_ENDED") return;
        await this.startHand(g);
        return;
      }
      case "action": {
        if ((await this.phase()) !== "playing") return;
        await this.handleAction(me.id, msg.action);
        return;
      }
      case "pp": { ws.send(JSON.stringify({ t: "pp", ts: msg.ts })); return; }
    }
  }

  private async handleHello(ws: WebSocket, msg: any): Promise<void> {
    if (msg.t !== "hello") { ws.close(1008, "hello first"); return; }
    const name = sanitizeName(msg.name);
    const ver = sanitizeVer(msg.ver);
    const players = this.roster();

    if ((await this.phase()) === "playing") {
      // mid-game REJOIN: reclaim a seat using the secret reconnect TOKEN issued at join
      // (persisted in the player's own browser). A name is public — matching on it would
      // let anyone in the room steal a disconnected player's seat and see their hand.
      // No version gate here on purpose: the server runs the authoritative engine, so a
      // redeploy mid-hand shouldn't lock a reconnecting player out.
      const humanSeats = (await this.state.storage.get<number[]>("humanSeats")) || [];
      const seatTokens = (await this.state.storage.get<Record<number, string>>("seatTokens")) || {};
      const connected = new Set(players.map((p) => p.id));
      const token = typeof msg.token === "string" ? msg.token : "";
      const g = await this.loadGame();
      if (!g) { ws.send(JSON.stringify({ t: "error", msg: "Game state unavailable — please try again" })); ws.close(1011, "no game"); return; }
      let seatId = -1;
      if (token) for (const id of humanSeats) {
        if (!connected.has(id) && seatTokens[id] && seatTokens[id] === token) { seatId = id; break; }
      }
      if (seatId < 0) { ws.send(JSON.stringify({ t: "error", msg: "Game in progress — seat unavailable" })); ws.close(1008, "in progress"); return; }
      const hostSeat = await this.state.storage.get<number>("hostSeat");
      const a: Attachment = { id: seatId, name: g.players[seatId].name, ready: true, host: seatId === hostSeat, ver };
      ws.serializeAttachment(a);
      g.players[seatId].isBot = false; g.players[seatId].connected = true;
      await this.saveGame(g);
      await this.bumpTtl();
      const code = (await this.state.storage.get<string>("code")) || "";
      ws.send(JSON.stringify({ t: "welcome", id: seatId, host: a.host, code, rejoin: true }));
      ws.send(JSON.stringify({ t: "view", view: viewFor(g, seatId) }));
      this.broadcastViews(g);
      await this.armAlarm(g);
      return;
    }

    // New lobby join: gate against the room's pinned version (set by the creator) so
    // mismatched builds can't form a lobby together.
    const roomVer = await this.state.storage.get<string>("roomVer");
    if (roomVer && ver !== roomVer) {
      ws.send(JSON.stringify({ t: "error", msg: "Game versions differ — fully close the app and reopen it, then rejoin" }));
      ws.close(1008, "version mismatch");
      return;
    }
    if (players.length >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: "error", msg: "room full" })); ws.close(1008, "room full"); return; }
    const used = new Set(players.map((p) => p.id));
    let id = 0; while (used.has(id)) id++;
    if (players.length === 0) {                 // first arrival pins the room version + host seat
      await this.state.storage.put("roomVer", ver);
      await this.state.storage.put("hostSeat", id);
    }
    const hostSeat = await this.state.storage.get<number>("hostSeat");
    // issue a secret reconnect token for this seat (used to reclaim it after a drop)
    const token = crypto.randomUUID();
    const seatTokens = (await this.state.storage.get<Record<number, string>>("seatTokens")) || {};
    seatTokens[id] = token;
    await this.state.storage.put("seatTokens", seatTokens);
    const a: Attachment = { id, name, ready: false, host: id === hostSeat, ver };
    ws.serializeAttachment(a);
    const code = (await this.state.storage.get<string>("code")) || "";
    ws.send(JSON.stringify({ t: "welcome", id, host: a.host, code, reconnect: token }));
    await this.broadcastLobby();
    await this.bumpTtl();
  }

  // ---- start a fresh hand (carrying scores/dealer if a prior game is passed) ----
  private async startHand(prev?: any): Promise<void> {
    const cfg = await this.cfg();
    const roster = this.roster();
    const humanSeats = roster.map((a) => a.id);
    const names: string[] = [];
    const seats: any[] = [];
    for (let i = 0; i < 4; i++) {
      const a = roster.find((p) => p.id === i);
      seats.push({ isBot: !a, difficulty: cfg.difficulty });
      names[i] = a ? a.name : `Bot ${i + 1}`;
    }
    const seed = (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff))) | 0;
    const config = makeConfig({ mode: cfg.mode, allowSevenPairs: cfg.sevenPairs });
    const game = createGame({
      seed, config, names, seats,
      dealer: prev ? (prev.nextDealer ?? 0) : 0,
      seatScores: prev ? prev.players.map((p: any) => p.score) : [0, 0, 0, 0],
      handNo: prev ? (prev.handNo + 1) : 1,
    });
    // mark which seats are humans (vs disconnected) for connection bookkeeping
    for (let i = 0; i < 4; i++) game.players[i].connected = humanSeats.includes(i);
    await this.state.storage.put("phase", "playing");
    await this.state.storage.put("humanSeats", humanSeats);
    await this.saveGame(game);
    await this.bumpTtl();
    this.broadcastViews(game);
    await this.armAlarm(game);
  }

  // ---- a human submitted an action ----
  private async handleAction(seat: number, action: any): Promise<void> {
    const game = await this.loadGame();
    if (!game) return;
    const res = applyAction(game, seat, action);
    if (!res.ok) {
      this.sendId(seat, { t: "reject", error: res.error });
      this.sendId(seat, { t: "view", view: viewFor(game, seat) });
      return;
    }
    await this.saveGame(game);
    await this.bumpTtl();
    this.broadcastViews(game);
    await this.armAlarm(game);
  }

  // ---- alarm: bot pacing + TTL cleanup ----
  private botPending(game: any): number {
    if (!game || game.phase === "HAND_ENDED") return -1;
    for (const seat of pendingDeciders(game)) {
      if (game.players[seat].isBot && !game.players[seat].hasWon) return seat;
    }
    return -1;
  }
  private async armAlarm(game: any): Promise<void> {
    const hasSockets = this.state.getWebSockets().length > 0;
    const ttlAt = (await this.state.storage.get<number>("ttlAt")) || (Date.now() + ROOM_TTL_MS);
    // only pace bots while at least one human is watching
    if (game && this.botPending(game) >= 0 && hasSockets) {
      await this.state.storage.setAlarm(Date.now() + BOT_DELAY_MS);
    } else {
      await this.state.storage.setAlarm(ttlAt);
    }
  }
  async alarm(): Promise<void> {
    if (!(await this.state.storage.get("created"))) return;
    const ttlAt = (await this.state.storage.get<number>("ttlAt")) || 0;
    if (Date.now() >= ttlAt) {   // idle too long → shut the room down
      for (const ws of this.state.getWebSockets()) { try { ws.close(1001, "room expired"); } catch { /* */ } }
      await this.state.storage.deleteAll();
      return;
    }
    if ((await this.phase()) !== "playing") { await this.state.storage.setAlarm(ttlAt); return; }
    const game = await this.loadGame();
    const seat = this.botPending(game);
    if (seat < 0 || this.state.getWebSockets().length === 0) { await this.state.storage.setAlarm(ttlAt); return; }
    const action = botChooseAction(game, seat);
    const res = action ? applyAction(game, seat, action) : { ok: false };
    if (!res.ok) { await this.state.storage.setAlarm(ttlAt); return; }  // never spin the alarm on a stuck seat
    await this.saveGame(game);
    this.broadcastViews(game);
    await this.armAlarm(game);
  }

  // ====================================================================
  // disconnect
  // ====================================================================
  async webSocketClose(ws: WebSocket): Promise<void> { await this.handleGone(ws); }
  async webSocketError(ws: WebSocket): Promise<void> { await this.handleGone(ws); }

  private async handleGone(ws: WebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as Attachment | null;
    try { ws.close(); } catch { /* */ }
    if (!me) return;
    const remaining = this.roster().filter((p) => p.id !== me.id);

    // if the host left and others remain, promote a connected player so host-only
    // actions (config/start/rematch) stay reachable — in both lobby and play.
    if (me.host && remaining.length) await this.promoteHost(remaining[0].id);

    if ((await this.phase()) === "playing") {
      // seat is taken over by a bot so the hand keeps going; human may rejoin by name
      const game = await this.loadGame();
      if (game && game.players[me.id]) {
        game.players[me.id].isBot = true;
        game.players[me.id].connected = false;
        await this.saveGame(game);
        if (remaining.length > 0) { this.broadcastViews(game); await this.armAlarm(game); }
      }
      if (remaining.length === 0) {
        // nobody watching — let TTL reap it (state preserved for a possible rejoin)
        const ttlAt = (await this.state.storage.get<number>("ttlAt")) || (Date.now() + ROOM_TTL_MS);
        await this.state.storage.setAlarm(ttlAt);
      }
      return;
    }

    // lobby cleanup — don't destroy the room on a brief disconnect (a sole creator whose
    // network blips would otherwise 404 on reconnect). Keep it alive for a short grace
    // window; the alarm reaps it if still empty.
    if (remaining.length === 0) {
      const reapAt = Date.now() + EMPTY_GRACE_MS;
      await this.state.storage.put("ttlAt", reapAt);
      await this.state.storage.setAlarm(reapAt);
      return;
    }
    await this.broadcastLobby();
  }

  private async promoteHost(heirId: number): Promise<void> {
    const heir = this.socketFor(heirId);
    if (!heir) return;
    const a = heir.deserializeAttachment() as Attachment;
    a.host = true; heir.serializeAttachment(a);
    await this.state.storage.put("hostSeat", a.id);
    try { heir.send(JSON.stringify({ t: "you-are-host" })); } catch { /* */ }
  }
}
