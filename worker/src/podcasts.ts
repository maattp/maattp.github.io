// Ad-free podcasts: REST routes, mounted at /podcasts by index.ts (after cors).
// The Mac's WebSocket (/podcasts/mac/ws) is registered in index.ts BEFORE cors
// (immutable 101 headers, same as /ring/ws).
//
// Three audiences, three credentials:
//   /podcasts/api/*   the podmanager app — Google session AND email == PODCAST_OWNER
//   /podcasts/mac/*   the Mac mini — Bearer PODCAST_MAC_TOKEN (wrangler secret)
//   /podcasts/feed/:token/*   the podcast app (Downcast) — unguessable token in
//                     the path, kept in the DO and rotatable from the app
// All state lives in the PodRoom DO (podroom.ts); the 5 GB cap is enforced there.

import { Hono } from "hono";
import { sessionEmail, authorized } from "./session.ts";
import { MAX_PART_BYTES, EP_KEY_RE, parseRange } from "./podfeed.ts";

export type PodBindings = {
  KV: KVNamespace;
  ALLOWED_EMAILS: string;
  PODCAST_OWNER: string;
  PODCAST_MAC_TOKEN: string; // secret
  POD_ROOM: DurableObjectNamespace;
  PODCASTS: R2Bucket;
};

type Variables = { email: string };
type C = { Bindings: PodBindings; Variables: Variables };

export const podStub = (env: { POD_ROOM: DurableObjectNamespace }) => env.POD_ROOM.get(env.POD_ROOM.idFromName("pod"));

// Forward a request to the DO, keeping method/body/query, rewriting the path.
function toDo(env: PodBindings, req: Request, path: string): Promise<Response> {
  const src = new URL(req.url);
  const url = new URL("https://do" + path);
  url.search = src.search;
  return podStub(env).fetch(url.toString(), {
    method: req.method,
    headers: { "Content-Type": req.headers.get("Content-Type") ?? "application/json" },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
  });
}

export const podcastsApp = new Hono<C>();

// ---------- app (Google session, owner only) ----------

podcastsApp.use("/api/*", async (c, next) => {
  const email = await sessionEmail(c.env.KV, c.req.header("Authorization"), c.env.ALLOWED_EMAILS);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  if (email !== (c.env.PODCAST_OWNER ?? "").toLowerCase()) return c.json({ error: "forbidden" }, 403);
  c.set("email", email);
  await next();
});

podcastsApp.get("/api/state", (c) => toDo(c.env, c.req.raw, "/state"));
podcastsApp.post("/api/subs", (c) => toDo(c.env, c.req.raw, "/subs"));
podcastsApp.delete("/api/subs/:id", (c) => toDo(c.env, c.req.raw, `/subs/${encodeURIComponent(c.req.param("id"))}`));
podcastsApp.delete("/api/episodes/:id", (c) => toDo(c.env, c.req.raw, `/episodes/${encodeURIComponent(c.req.param("id"))}`));
podcastsApp.post("/api/poll", (c) => toDo(c.env, c.req.raw, "/poll"));
podcastsApp.post("/api/token/rotate", (c) => toDo(c.env, c.req.raw, "/token/rotate"));

// Apple's podcast directory, for "search to subscribe". Proxied so the app's
// CSP only needs to allow this Worker.
podcastsApp.get("/api/search", async (c) => {
  const term = (c.req.query("term") ?? "").trim().slice(0, 100);
  if (!term) return c.json({ results: [] });
  const u = new URL("https://itunes.apple.com/search");
  u.searchParams.set("media", "podcast");
  u.searchParams.set("entity", "podcast");
  u.searchParams.set("limit", "20");
  u.searchParams.set("term", term);
  // Apple has refused bare requests from Cloudflare; look like a browser. (The app
  // calls Apple directly first; this proxy is its fallback.)
  const r = await fetch(u.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: "application/json" },
  });
  if (!r.ok) return c.json({ error: "search failed" }, 502);
  const j: any = await r.json();
  const results = (j.results ?? [])
    .filter((x: any) => typeof x.feedUrl === "string")
    .map((x: any) => ({
      title: x.collectionName ?? x.trackName ?? "",
      author: x.artistName ?? "",
      feedUrl: x.feedUrl,
      artwork: x.artworkUrl600 ?? x.artworkUrl100 ?? "",
      genre: x.primaryGenreName ?? "",
    }));
  return c.json({ results });
});

// ---------- Mac (bearer token) ----------

podcastsApp.use("/mac/*", async (c, next) => {
  if (!authorized(c.req.header("Authorization"), c.env.PODCAST_MAC_TOKEN)) return c.json({ error: "unauthorized" }, 401);
  await next();
});

podcastsApp.get("/mac/state", (c) => toDo(c.env, c.req.raw, "/state"));
podcastsApp.post("/mac/status", (c) => toDo(c.env, c.req.raw, "/status"));
// Same as the app's add, for `podcastd.py add <feed url>` on the Mac.
podcastsApp.post("/mac/subs", (c) => toDo(c.env, c.req.raw, "/subs"));
podcastsApp.post("/mac/subs/:id/meta", (c) => toDo(c.env, c.req.raw, `/subs/${encodeURIComponent(c.req.param("id"))}/meta`));
podcastsApp.post("/mac/uploads/create", (c) => toDo(c.env, c.req.raw, "/uploads/create"));
podcastsApp.post("/mac/uploads/complete", (c) => toDo(c.env, c.req.raw, "/uploads/complete"));
podcastsApp.post("/mac/uploads/abort", (c) => toDo(c.env, c.req.raw, "/uploads/abort"));
podcastsApp.put("/mac/cover", (c) => toDo(c.env, c.req.raw, "/cover"));

// Parts stream straight into R2 (not through the DO). Only uploads the DO
// admitted under the cap are accepted.
podcastsApp.put("/mac/uploads/part", async (c) => {
  const key = c.req.query("key") ?? "", uploadId = c.req.query("uploadId") ?? "";
  const part = Number(c.req.query("part"));
  const len = Number(c.req.header("Content-Length") ?? NaN);
  if (!EP_KEY_RE.test(key) || !uploadId || !Number.isInteger(part) || part < 1 || part > 1000) return c.json({ error: "bad request" }, 400);
  if (!Number.isFinite(len) || len <= 0 || len > MAX_PART_BYTES) return c.json({ error: "part size" }, 400);
  const check = await podStub(c.env).fetch(`https://do/uploads/check?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`);
  if (!((await check.json()) as { ok: boolean }).ok) return c.json({ error: "unknown upload" }, 404);
  const up = c.env.PODCASTS.resumeMultipartUpload(key, uploadId);
  const r = await up.uploadPart(part, c.req.raw.body!);
  return c.json({ partNumber: r.partNumber, etag: r.etag });
});

// ---------- feed (token in path) ----------

async function feedOk(env: PodBindings, token: string): Promise<boolean> {
  if (!/^[a-f0-9]{40}$/.test(token)) return false;
  const r = await podStub(env).fetch(`https://do/feed-auth?token=${token}`);
  return r.ok;
}

const NOT_FOUND = () => new Response("not found", { status: 404 });

podcastsApp.on(["GET", "HEAD"], "/feed/:token/feed.xml", async (c) => {
  const token = c.req.param("token");
  if (!(await feedOk(c.env, token))) return NOT_FOUND();
  const base = `${new URL(c.req.url).origin}/podcasts/feed/${token}`;
  const r = await podStub(c.env).fetch(`https://do/feed.xml?base=${encodeURIComponent(base)}`);
  return new Response(c.req.method === "HEAD" ? null : r.body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "private, no-cache" },
  });
});

async function serveObject(env: PodBindings, req: Request, key: string, type: string): Promise<Response> {
  const head = await env.PODCASTS.head(key);
  if (!head) return NOT_FOUND();
  const size = head.size;
  const range = parseRange(req.headers.get("Range"), size);
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    ETag: head.httpEtag,
  });
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (req.method === "HEAD") {
    headers.set("Content-Length", String(size));
    return new Response(null, { status: 200, headers });
  }
  if (range) {
    const obj = await env.PODCASTS.get(key, { range });
    if (!obj) return NOT_FOUND();
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response((obj as R2ObjectBody).body, { status: 206, headers });
  }
  const obj = await env.PODCASTS.get(key);
  if (!obj) return NOT_FOUND();
  headers.set("Content-Length", String(size));
  return new Response((obj as R2ObjectBody).body, { status: 200, headers });
}

podcastsApp.on(["GET", "HEAD"], "/feed/:token/ep/:file", async (c) => {
  if (!(await feedOk(c.env, c.req.param("token")))) return NOT_FOUND();
  const key = `ep/${c.req.param("file")}`;
  if (!EP_KEY_RE.test(key)) return NOT_FOUND();
  return serveObject(c.env, c.req.raw, key, "audio/mpeg");
});

podcastsApp.on(["GET", "HEAD"], "/feed/:token/cover.png", async (c) => {
  if (!(await feedOk(c.env, c.req.param("token")))) return NOT_FOUND();
  return serveObject(c.env, c.req.raw, "cover.png", "image/png");
});
