// Ad-free podcasts — a single Durable Object instance (idFromName("pod")).
//
// Source of truth for the podcast manager: subscriptions, the episode index,
// the private feed token, and the Mac mini's live connection. Every mutation
// runs here, so the DO's input gate serializes them — in particular the 5 GB
// cap check (planEviction) and the uploads it admits can't race each other.
//
// The Mac holds an outbound WebSocket (it has no public address). When the
// subscription list changes the DO pushes it down that socket, so an add or
// remove in the app reaches the Mac in about a second. The Mac also polls
// GET /podcasts/mac/state on its own schedule, so a dropped socket only delays
// things — nothing is lost.
//
// Storage keys: sub:<id> → Sub, ep:<id> → Episode, up:<r2 key> → pending
// upload, meta:token, meta:mac (last status the Mac reported), meta:usage.

import { Hono } from "hono";
import {
  CAP_BYTES, EP_KEY_RE, ID_RE, buildFeed, normalizeFeedUrl, parseEpisode, planEviction, randomHex,
  tokenEquals, type Episode, type Sub,
} from "./podfeed.ts";

type Env = { PODCASTS: R2Bucket };
type Pending = { uploadId: string; size: number; created: number };
const STALE_UPLOAD_MS = 3 * 60 * 60 * 1000;

export class PodRoom {
  private state: DurableObjectState;
  private env: Env;
  private app: Hono;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // The Mac pings every minute; answered without waking the DO.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.app = this.routes();
  }

  fetch(request: Request): Response | Promise<Response> {
    return this.app.fetch(request);
  }

  // ---------- storage helpers ----------

  private async subs(): Promise<Sub[]> {
    const m = await this.state.storage.list<Sub>({ prefix: "sub:" });
    return [...m.values()].sort((a, b) => a.addedAt - b.addedAt);
  }

  private async episodes(): Promise<Episode[]> {
    const m = await this.state.storage.list<Episode>({ prefix: "ep:" });
    return [...m.values()].sort((a, b) => b.pubDate.localeCompare(a.pubDate));
  }

  private async pending(): Promise<Map<string, Pending>> {
    const m = await this.state.storage.list<Pending>({ prefix: "up:" });
    return new Map([...m].map(([k, v]) => [k.slice(3), v]));
  }

  private async token(): Promise<string> {
    let t = await this.state.storage.get<string>("meta:token");
    if (!t) {
      t = randomHex(20);
      await this.state.storage.put("meta:token", t);
    }
    return t;
  }

  private async listObjects(): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.env.PODCASTS.list({ cursor, limit: 1000 });
      for (const o of r.objects) out.push({ key: o.key, size: o.size });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return out;
  }

  private async recount(): Promise<number> {
    const objs = await this.listObjects();
    const bytes = objs.reduce((s, o) => s + o.size, 0);
    await this.state.storage.put("meta:usage", { bytes, at: Date.now() });
    return bytes;
  }

  private async deleteEpisode(id: string): Promise<void> {
    const e = await this.state.storage.get<Episode>(`ep:${id}`);
    if (e) await this.env.PODCASTS.delete(e.key);
    await this.state.storage.delete(`ep:${id}`);
  }

  private macSockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  private push(msg: unknown): boolean {
    const text = JSON.stringify(msg);
    let delivered = false;
    for (const ws of this.macSockets()) {
      try { ws.send(text); delivered = true; } catch { /* closing */ }
    }
    return delivered;
  }

  private async pushSubs(): Promise<void> {
    this.push({ type: "subs", subs: await this.subs() });
  }

  // ---------- routes (called by podcasts.ts / index.ts; auth already checked there) ----------

  private routes(): Hono {
    const app = new Hono();

    // The Mac's outbound socket. Only one at a time: a reconnect can race the
    // old socket's close, so evict any existing ones (same as RingRoom).
    app.get("/ws", async (c) => {
      if (c.req.header("Upgrade") !== "websocket") return c.text("expected websocket", 426);
      for (const ws of this.macSockets()) {
        try { ws.close(1012, "replaced"); } catch { /* gone */ }
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "subs", subs: await this.subs() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    });

    app.get("/state", async (c) => {
      const socks = this.macSockets();
      const lastPing = socks.length ? this.state.getWebSocketAutoResponseTimestamp(socks[0])?.getTime() ?? null : null;
      return c.json({
        subs: await this.subs(),
        episodes: (await this.episodes()).map(({ description, ...e }) => e),
        usage: { ...((await this.state.storage.get<{ bytes: number; at: number }>("meta:usage")) ?? { bytes: 0, at: 0 }), cap: CAP_BYTES },
        mac: { online: socks.length > 0, lastPing, ...((await this.state.storage.get<object>("meta:mac")) ?? {}) },
        token: await this.token(),
        hasCover: (await this.env.PODCASTS.head("cover.png")) !== null,
      });
    });

    // ----- subscriptions (app) -----
    app.post("/subs", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const feedUrl = normalizeFeedUrl(body.feedUrl);
      if (!feedUrl) return c.json({ error: "feedUrl must be an http(s) URL" }, 400);
      const existing = (await this.subs()).find((s) => s.feedUrl === feedUrl);
      if (existing) return c.json({ sub: existing, existed: true });
      const sub: Sub = {
        id: randomHex(4), feedUrl, addedAt: Date.now(),
        title: typeof body.title === "string" ? body.title.slice(0, 200) : undefined,
        author: typeof body.author === "string" ? body.author.slice(0, 200) : undefined,
        artwork: typeof body.artwork === "string" && /^https:\/\//.test(body.artwork) ? body.artwork.slice(0, 2000) : undefined,
      };
      await this.state.storage.put(`sub:${sub.id}`, sub);
      await this.pushSubs();
      return c.json({ sub });
    });

    app.delete("/subs/:id", async (c) => {
      const id = c.req.param("id");
      if (!(await this.state.storage.get(`sub:${id}`))) return c.json({ error: "not found" }, 404);
      // Removing a show removes its episodes from the feed and the bucket.
      const eps = (await this.episodes()).filter((e) => e.subId === id);
      for (const e of eps) await this.deleteEpisode(e.id);
      await this.state.storage.delete(`sub:${id}`);
      await this.recount();
      await this.pushSubs();
      return c.json({ deleted: true, episodes: eps.length });
    });

    app.post("/poll", (c) => c.json({ delivered: this.push({ type: "poll" }) }));

    app.delete("/episodes/:id", async (c) => {
      const id = c.req.param("id");
      if (!(await this.state.storage.get(`ep:${id}`))) return c.json({ error: "not found" }, 404);
      await this.deleteEpisode(id);
      await this.recount();
      return c.json({ deleted: true });
    });

    app.post("/token/rotate", async (c) => {
      const t = randomHex(20);
      await this.state.storage.put("meta:token", t);
      return c.json({ token: t });
    });

    // ----- feed (public, token-gated) -----
    app.get("/feed-auth", async (c) => {
      const ok = tokenEquals(c.req.query("token") ?? "", await this.token());
      return c.json({ ok }, ok ? 200 : 403);
    });

    app.get("/feed.xml", async (c) => {
      const base = c.req.query("base") ?? "";
      const xml = buildFeed({
        base,
        episodes: await this.episodes(),
        subs: await this.subs(),
        hasCover: (await this.env.PODCASTS.head("cover.png")) !== null,
      });
      return c.body(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8" });
    });

    // ----- Mac -----
    app.post("/subs/:id/meta", async (c) => {
      const id = c.req.param("id");
      const sub = await this.state.storage.get<Sub>(`sub:${id}`);
      if (!sub) return c.json({ error: "not found" }, 404);
      const b = await c.req.json().catch(() => ({}));
      const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
      const next: Sub = {
        ...sub,
        title: s(b.title, 200) ?? sub.title,
        author: s(b.author, 200) ?? sub.author,
        artwork: (s(b.artwork, 2000) ?? sub.artwork),
        link: s(b.link, 2000) ?? sub.link,
        error: b.error === null ? null : s(b.error, 500) ?? sub.error ?? null,
        checkedAt: Date.now(),
      };
      await this.state.storage.put(`sub:${id}`, next);
      return c.json({ sub: next });
    });

    app.post("/status", async (c) => {
      const b = await c.req.json().catch(() => null);
      if (b) await this.state.storage.put("meta:mac", { status: b, at: Date.now() });
      return c.json({ ok: true });
    });

    // Admission control for the 5 GB cap. Evicts oldest episodes (and stray
    // objects) until the incoming file fits, counting bytes already promised
    // to other in-flight uploads, then opens the multipart upload.
    app.post("/uploads/create", async (c) => {
      const b = await c.req.json().catch(() => ({}));
      const key = String(b.key ?? ""), size = Number(b.size);
      if (!EP_KEY_RE.test(key)) return c.json({ error: "bad key" }, 400);
      if (!Number.isInteger(size) || size <= 0 || size > CAP_BYTES) return c.json({ error: "bad size" }, 400);

      const pend = await this.pending();
      for (const [k, p] of pend) {
        if (k === key || Date.now() - p.created > STALE_UPLOAD_MS) {
          try { await this.env.PODCASTS.resumeMultipartUpload(k, p.uploadId).abort(); } catch { /* already gone */ }
          await this.state.storage.delete(`up:${k}`);
          pend.delete(k);
        }
      }
      const eps = await this.episodes();
      const objects = (await this.listObjects()).filter((o) => o.key !== key); // a re-upload replaces its own key
      const plan = planEviction({
        objects,
        episodes: eps.filter((e) => e.key !== key),
        reserved: [...pend.values()].reduce((s, p) => s + p.size, 0),
        pendingKeys: new Set(pend.keys()),
        incoming: size,
        cap: CAP_BYTES,
      });
      for (const k of plan.orphans) await this.env.PODCASTS.delete(k);
      for (const id of plan.missing) await this.state.storage.delete(`ep:${id}`);
      for (const id of plan.evict) await this.deleteEpisode(id);
      if (!plan.ok) {
        await this.recount();
        return c.json({ error: "over cap", total: plan.total, cap: CAP_BYTES }, 507);
      }
      const up = await this.env.PODCASTS.createMultipartUpload(key, { httpMetadata: { contentType: "audio/mpeg" } });
      await this.state.storage.put(`up:${key}`, { uploadId: up.uploadId, size, created: Date.now() } satisfies Pending);
      await this.recount();
      return c.json({ uploadId: up.uploadId, evicted: plan.evict });
    });

    app.post("/uploads/complete", async (c) => {
      const b = await c.req.json().catch(() => ({}));
      const key = String(b.key ?? "");
      const p = await this.state.storage.get<Pending>(`up:${key}`);
      if (!p || p.uploadId !== b.uploadId) return c.json({ error: "unknown upload" }, 404);
      const ep = parseEpisode(b.episode);
      if (!ep || `ep/${ep.id}.mp3` !== key) return c.json({ error: "bad episode" }, 400);
      if (!(await this.state.storage.get(`sub:${ep.subId}`))) {
        // The show was removed while this episode was being processed.
        try { await this.env.PODCASTS.resumeMultipartUpload(key, p.uploadId).abort(); } catch { /* gone */ }
        await this.state.storage.delete(`up:${key}`);
        return c.json({ error: "subscription removed" }, 410);
      }
      const parts = Array.isArray(b.parts) ? b.parts : [];
      const obj = await this.env.PODCASTS.resumeMultipartUpload(key, p.uploadId).complete(parts);
      await this.state.storage.delete(`up:${key}`);
      // The cap was checked against the declared size; never keep more than that.
      if (obj.size > p.size) {
        await this.env.PODCASTS.delete(key);
        await this.recount();
        return c.json({ error: "upload larger than declared" }, 400);
      }
      const episode: Episode = { ...ep, key, bytes: obj.size, addedAt: Date.now() };
      await this.state.storage.put(`ep:${ep.id}`, episode);
      await this.recount();
      return c.json({ ok: true, bytes: obj.size });
    });

    app.post("/uploads/abort", async (c) => {
      const b = await c.req.json().catch(() => ({}));
      const key = String(b.key ?? "");
      const p = await this.state.storage.get<Pending>(`up:${key}`);
      if (p) {
        try { await this.env.PODCASTS.resumeMultipartUpload(key, p.uploadId).abort(); } catch { /* gone */ }
        await this.state.storage.delete(`up:${key}`);
      }
      return c.json({ ok: true });
    });

    // Part uploads go straight from the Worker to R2; the DO only vouches that
    // the upload is one it admitted.
    app.get("/uploads/check", async (c) => {
      const key = c.req.query("key") ?? "";
      const p = await this.state.storage.get<Pending>(`up:${key}`);
      return c.json({ ok: !!p && p.uploadId === c.req.query("uploadId") });
    });

    app.put("/cover", async (c) => {
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > 2 * 1024 * 1024) return c.json({ error: "cover must be under 2 MB" }, 400);
      await this.env.PODCASTS.put("cover.png", buf, { httpMetadata: { contentType: "image/png" } });
      await this.recount();
      return c.json({ ok: true });
    });

    app.all("*", (c) => c.json({ error: "not found" }, 404));
    return app;
  }

  // ---------- Mac socket ----------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 20000) return;
    let m: any;
    try { m = JSON.parse(message); } catch { return; }
    if (m?.type === "status") await this.state.storage.put("meta:mac", { status: m.status ?? null, at: Date.now() });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* closed */ }
  }
}

export const isId = (s: string) => ID_RE.test(s);
