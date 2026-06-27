import { Hono } from "hono";
import { cors } from "hono/cors";
import { Kart3Room } from "./kart3room";
import { MahjongRoom } from "./mahjongroom";

export { Kart3Room, MahjongRoom };

const SESSION_TTL = 365 * 24 * 60 * 60; // 1 year in seconds
const SESSION_PREFIX = "__session:";

type Bindings = {
  KV: KVNamespace;
  PHOTOS: R2Bucket;
  DB: D1Database;
  KART3_ROOM: DurableObjectNamespace;
  MAHJONG_ROOM: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  ALLOWED_EMAILS: string;
};

type Variables = {
  email: string;
};

type GoogleJWKS = {
  keys: JsonWebKey[];
};

async function fetchGooglePublicKeys(): Promise<GoogleJWKS> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  return res.json();
}

function decodeBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
}

function parseAllowedEmails(allowedEmails: string): Set<string> {
  return new Set(allowedEmails.split(",").map((e) => e.trim().toLowerCase()));
}

async function verifyGoogleToken(
  token: string,
  clientId: string,
  allowedEmails: Set<string>
): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = JSON.parse(
    new TextDecoder().decode(decodeBase64Url(parts[0]))
  ) as { kid: string; alg: string };

  const jwks = await fetchGooglePublicKeys();
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) return null;

  const payload = decodeJwtPayload(token);
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
  if (payload.aud !== clientId) return null;
  if (typeof payload.exp === "number" && payload.exp < now) return null;
  if (!payload.email_verified) return null;
  if (!allowedEmails.has((payload.email as string).toLowerCase())) return null;

  return { email: payload.email as string };
}

async function createSession(kv: KVNamespace, email: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  await kv.put(`${SESSION_PREFIX}${sessionId}`, email, { expirationTtl: SESSION_TTL });
  return sessionId;
}

async function verifySession(
  kv: KVNamespace,
  sessionId: string,
  allowedEmails: Set<string>
): Promise<{ email: string } | null> {
  const email = await kv.get(`${SESSION_PREFIX}${sessionId}`);
  if (!email || !allowedEmails.has(email.toLowerCase())) return null;
  return { email };
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// --- Fable Kart multiplayer rooms: WebSocket upgrade ---
// Registered BEFORE the cors middleware: cors() mutates response headers,
// and a 101 WebSocket response's headers are immutable.
// No Google auth on /kart3/* by design — the unguessable room code is the
// credential (friends aren't in ALLOWED_EMAILS). Origin-gated instead.
const KART3_ORIGINS = ["https://polkiewicz.com", "https://maattp.github.io"];
function kart3OriginOk(origin: string | undefined): boolean {
  if (!origin) return false;
  return KART3_ORIGINS.includes(origin) || origin.startsWith("http://localhost:");
}
const ROOM_CODE_RE = /^[A-Z2-9]{5}$/;

app.get("/kart3/rooms/:code/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "expected websocket" }, 426);
  }
  if (!kart3OriginOk(c.req.header("Origin"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_CODE_RE.test(code)) {
    return c.json({ error: "bad room code" }, 400);
  }
  const stub = c.env.KART3_ROOM.get(c.env.KART3_ROOM.idFromName(code));
  return stub.fetch("https://do/ws", c.req.raw);
});

// --- Sichuan Mahjong online rooms: WebSocket upgrade (server-authoritative) ---
// Same origin-gated, code-as-credential model as kart3. Registered before cors
// for the same reason (immutable 101 headers).
app.get("/mahjong/rooms/:code/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "expected websocket" }, 426);
  if (!kart3OriginOk(c.req.header("Origin"))) return c.json({ error: "forbidden" }, 403);
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_CODE_RE.test(code)) return c.json({ error: "bad room code" }, 400);
  const stub = c.env.MAHJONG_ROOM.get(c.env.MAHJONG_ROOM.idFromName(code));
  return stub.fetch("https://do/ws", c.req.raw);
});

app.use("*", cors({
  // function form so any localhost port works for local development
  origin: (origin) => {
    if (!origin) return origin;
    if (
      origin === "https://polkiewicz.com" ||
      origin === "https://maattp.github.io" ||
      origin.startsWith("http://localhost:")
    ) {
      return origin;
    }
    return "";
  },
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
}));

// --- Fable Kart multiplayer rooms: create + status (CORS applies) ---
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

app.post("/kart3/rooms", async (c) => {
  if (!kart3OriginOk(c.req.header("Origin"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  const stub = c.env.KART3_ROOM.get(c.env.KART3_ROOM.idFromName(code));
  await stub.fetch("https://do/init", { method: "POST", body: code });
  return c.json({ code });
});

app.get("/kart3/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_CODE_RE.test(code)) {
    return c.json({ error: "bad room code" }, 400);
  }
  const stub = c.env.KART3_ROOM.get(c.env.KART3_ROOM.idFromName(code));
  const res = await stub.fetch("https://do/status");
  return c.json(await res.json());
});

// --- Sichuan Mahjong online rooms: create + status (CORS applies) ---
app.post("/mahjong/rooms", async (c) => {
  if (!kart3OriginOk(c.req.header("Origin"))) return c.json({ error: "forbidden" }, 403);
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    let code = "";
    for (const b of bytes) code += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
    const stub = c.env.MAHJONG_ROOM.get(c.env.MAHJONG_ROOM.idFromName(code));
    const res = await stub.fetch("https://do/init", { method: "POST", body: code });
    if (res.status !== 409) return c.json({ code });   // 409 = code already in use; try another
  }
  return c.json({ error: "could not allocate a room, please try again" }, 503);
});

app.get("/mahjong/rooms/:code", async (c) => {
  if (!kart3OriginOk(c.req.header("Origin"))) return c.json({ error: "forbidden" }, 403);
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_CODE_RE.test(code)) return c.json({ error: "bad room code" }, 400);
  const stub = c.env.MAHJONG_ROOM.get(c.env.MAHJONG_ROOM.idFromName(code));
  const res = await stub.fetch("https://do/status");
  return c.json(await res.json());
});

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

// Exchange Google ID token for a session
app.post("/auth", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  if (!token) {
    return c.json({ error: "missing token" }, 400);
  }
  const allowed = parseAllowedEmails(c.env.ALLOWED_EMAILS);
  const user = await verifyGoogleToken(token, c.env.GOOGLE_CLIENT_ID, allowed);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = await createSession(c.env.KV, user.email);
  return c.json({ sessionId, email: user.email });
});

// Public feedback endpoint (no auth required)
app.post("/feedback", async (c) => {
  const body = await c.req.text();
  if (!body || body.length === 0) {
    return c.json({ error: "empty feedback" }, 400);
  }
  if (body.length > 5000) {
    return c.json({ error: "feedback too long" }, 400);
  }
  const epoch = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `feedback:${epoch}:${rand}`;
  await c.env.KV.put(key, body);
  return c.json({ success: true });
});

// Require valid session on all /kv routes
app.use("/kv/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = auth.slice(7);
  const allowed = parseAllowedEmails(c.env.ALLOWED_EMAILS);
  const user = await verifySession(c.env.KV, sessionId, allowed);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("email", user.email);
  await next();
});

app.get("/kv", async (c) => {
  const list = await c.env.KV.list();
  return c.json({ keys: list.keys.map((k) => k.name) });
});

app.get("/kv/:key", async (c) => {
  const key = c.req.param("key");
  const value = await c.env.KV.get(key);
  if (value === null) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ key, value });
});

app.put("/kv/:key", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.text();
  await c.env.KV.put(key, body);
  return c.json({ key, stored: true });
});

app.delete("/kv/:key", async (c) => {
  const key = c.req.param("key");
  await c.env.KV.delete(key);
  return c.json({ key, deleted: true });
});

// --- Reddit proxy ---
// Browsers can't call reddit.com directly (no CORS), AND as of 2025 reddit
// returns 403 ("network security" block page) for the anonymous *.json API
// endpoints — only the OAuth API and the HTML site still serve listings.
// So instead of proxying the (now-dead) JSON API, we scrape old.reddit.com's
// HTML — which still works unauthenticated — and synthesize the same JSON
// listing shape (`{data:{children:[{data}], after}}`) the Feed client expects.
// This keeps the entire client unchanged.

const REDDIT_UA = "web:polkiewicz.com:v1.0 (by /u/mp_readonly)";

// Fetch from old.reddit with a hard timeout so a slow/hung upstream doesn't
// pin the Worker until Cloudflare's CPU deadline.
async function redditFetch(url: string, timeoutMs = 9000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": REDDIT_UA,
        "Accept": "text/html",
        // bypass the over-18 interstitial so NSFW subs/galleries return content
        "Cookie": "over18=1",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      const hex = /^&#x/i.test(m);
      const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    });
}

const IMG_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

// Turn one old.reddit `div.thing` block into a reddit-API-shaped post object,
// or null if it carries no displayable media (self/text/unsupported posts).
function buildPost(tag: string, block: string): Record<string, unknown> | null {
  const attr = (name: string): string | null => {
    const m = tag.match(new RegExp(`\\bdata-${name}="([^"]*)"`));
    return m ? decodeEntities(m[1]) : null;
  };

  const fullname = attr("fullname");
  if (!fullname || !fullname.startsWith("t3_")) return null;
  if (attr("promoted") === "true") return null;

  const url = attr("url") || "";
  const titleMatch = block.match(/<a[^>]*\bclass="title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, "")).trim() : "";

  const thumbMatch = block.match(
    /<a[^>]*\bclass="[^"]*\bthumbnail\b[^"]*"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]*)"/
  );
  let thumbnail = thumbMatch ? decodeEntities(thumbMatch[1]) : null;
  if (thumbnail && thumbnail.startsWith("//")) thumbnail = "https:" + thumbnail;

  const score = parseInt(attr("score") || "0", 10) || 0;
  const post: Record<string, unknown> = {
    id: fullname.slice(3),
    name: fullname,
    subreddit: attr("subreddit") || "",
    title,
    author: attr("author") || "[deleted]",
    score,
    ups: score,
    num_comments: parseInt(attr("comments-count") || "0", 10) || 0,
    created_utc: Math.floor((parseInt(attr("timestamp") || "0", 10) || 0) / 1000),
    permalink: attr("permalink") || url,
    domain: attr("domain") || "",
    url,
    thumbnail,
    is_video: false,
  };

  // reddit-hosted video: old.reddit only links to v.redd.it/<id>, but the HLS
  // manifest URL is deterministic from that id and serves publicly.
  const vredd = url.match(/v\.redd\.it\/([a-z0-9]+)/i);
  if (vredd) {
    post.is_video = true;
    post.media = {
      reddit_video: {
        hls_url: `https://v.redd.it/${vredd[1]}/HLSPlaylist.m3u8`,
        fallback_url: `https://v.redd.it/${vredd[1]}/DASHPlaylist.mpd`,
        width: 0,
        height: 0,
      },
    };
    return post;
  }

  // Direct image (i.redd.it, i.imgur.com, or any image-extension URL).
  if (IMG_EXT.test(url) || /(^|\.)i\.redd\.it$/.test(post.domain as string)) {
    post.post_hint = "image";
    return post;
  }

  // Reddit galleries: old.reddit only links to /gallery/<id>. We flag the post
  // so the route can enrich it with the full ordered image set (gallery_data +
  // media_metadata) by fetching its page. As a fallback we also derive the
  // full-res COVER image from the listing thumbnail (i.redd.it/<mediaId>.<ext>,
  // no extra request): if enrichment fails or is skipped, the client's
  // extractMedia falls through to render this single cover image instead.
  if (attr("is-gallery") === "true" || /\/gallery\//.test(url)) {
    const cover = (thumbnail || "").match(/(?:preview|i)\.redd\.it\/([a-z0-9]+)\.(jpg|jpeg|png|gif|webp)/i);
    if (cover) {
      post.is_gallery = true;
      post.post_hint = "image";
      post.url = `https://i.redd.it/${cover[1]}.${cover[2].toLowerCase()}`;
      return post;
    }
  }

  // Everything else (self/text, external links) carries no full-size media we
  // can show. We deliberately do NOT fall back to the ~140px listing
  // thumbnail: the client hides any image whose natural size is <200px (and
  // skip-scrolls if it's the current item), so a thumbnail-only post flashes
  // in and collapses mid-scroll — jank.
  return null;
}

// Extract a gallery's full ordered image set from its old.reddit page. Each
// image is a `<div class="gallery-tile" data-media-id="<id>">` whose preview
// <img> points at preview.redd.it/<id>.<ext>; the full-size original lives at
// i.redd.it/<id>.<ext>. The matched media-id must equal the <img>'s id so we
// only pick real gallery tiles (not sidebar/related-post thumbnails).
function parseGallery(
  page: string
): { items: { media_id: string }[]; media_metadata: Record<string, unknown> } | null {
  const start = page.indexOf('<div class="media-gallery">');
  if (start < 0) return null;
  const seg = page.slice(start, start + 60000);
  const re =
    /class="[^"]*gallery-tile[^"]*"[^>]*data-media-id="([a-z0-9]+)"[\s\S]*?<img[^>]*src="[^"]*?(?:preview|i)\.redd\.it\/([a-z0-9]+)\.(jpg|jpeg|png|gif|webp)/gi;
  const items: { media_id: string }[] = [];
  const media_metadata: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const [, tileId, imgId, ext] = m;
    if (tileId !== imgId || media_metadata[tileId]) continue;
    items.push({ media_id: tileId });
    media_metadata[tileId] = {
      status: "valid",
      e: "Image",
      s: { u: `https://i.redd.it/${tileId}.${ext.toLowerCase()}`, x: 0, y: 0 },
    };
  }
  return items.length ? { items, media_metadata } : null;
}

// Fetch a gallery post's page and attach gallery_data + media_metadata in the
// shape the client's extractMedia expects. On any failure the post keeps its
// cover-image fallback, so it still renders.
async function enrichGallery(post: Record<string, unknown>): Promise<void> {
  const permalink = post.permalink as string | undefined;
  if (!permalink) return;
  try {
    const res = await redditFetch("https://old.reddit.com" + permalink);
    if (!res.ok) return;
    const g = parseGallery(await res.text());
    if (g) {
      post.gallery_data = { items: g.items };
      post.media_metadata = g.media_metadata;
    }
  } catch {
    // timeout/abort/parse failure → leave the cover-image fallback in place
  }
}

// Run async tasks with bounded concurrency to avoid bursting old.reddit (which
// rate-limits hard per IP).
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function scrapeListing(html: string): { children: unknown[]; after: string | null } {
  const children: unknown[] = [];
  const thingRe = /<div[^>]*\bclass="[^"]*\bthing\b[^"]*"[^>]*>/g;
  const starts: { index: number; tag: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = thingRe.exec(html))) starts.push({ index: m.index, tag: m[0] });

  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i].index, starts[i + 1]?.index ?? html.length);
    const post = buildPost(starts[i].tag, block);
    if (post) children.push({ kind: "t3", data: post });
  }

  // Pagination token from the "next" button, else the last post's fullname.
  const next = html.match(/class="next-button"[\s\S]*?after=(t3_[a-z0-9]+)/i);
  let after: string | null = next ? next[1] : null;
  if (!after && children.length) {
    after = (children[children.length - 1] as { data: { name: string } }).data.name;
  }
  return { children, after };
}

app.get("/reddit-proxy", async (c) => {
  const target = c.req.query("url");
  if (!target) return c.json({ error: "missing url" }, 400);
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
  if (parsed.protocol !== "https:" || !/(^|\.)reddit\.com$/.test(parsed.hostname)) {
    return c.json({ error: "only reddit.com is allowed" }, 400);
  }

  // Rewrite the client's `.../<sort>.json?...` request to the equivalent
  // old.reddit HTML listing and scrape it.
  const oldUrl = new URL(parsed.toString());
  oldUrl.hostname = "old.reddit.com";
  oldUrl.pathname = oldUrl.pathname.replace(/\.json$/, "/");

  let upstream: Response;
  try {
    upstream = await redditFetch(oldUrl.toString());
  } catch {
    return new Response(JSON.stringify({ error: "reddit upstream timed out" }), {
      status: 504,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "reddit upstream", status: upstream.status }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const html = await upstream.text();
  const { children, after } = scrapeListing(html);

  // Enrich gallery posts with their full image set (one fetch each, capped and
  // throttled so we don't burst old.reddit). Galleries that aren't enriched
  // keep their cover-image fallback.
  const galleries = (children as { data: Record<string, unknown> }[])
    .map((c) => c.data)
    .filter((d) => d.is_gallery);
  await pooled(galleries.slice(0, 12), 4, enrichGallery);

  return new Response(JSON.stringify({ kind: "Listing", data: { after, children } }), {
    headers: {
      "Content-Type": "application/json",
      // s-maxage caches at Cloudflare's edge (softening reddit's per-IP rate
      // limiting) without forcing a stale window on the client.
      "Cache-Control": "s-maxage=45, max-age=0",
    },
  });
});

// --- Pixels (shared canvas) ---

const PIXELS_KEY = "pixels";
const PIXELS_GRID_SIZE = 25;

app.get("/pixels", async (c) => {
  const data = await c.env.KV.get(PIXELS_KEY);
  if (!data) {
    return c.json({ grid: null });
  }
  return c.json({ grid: JSON.parse(data) });
});

app.post("/pixels", async (c) => {
  const { changes } = await c.req.json<{ changes: { x: number; y: number; color: string }[] }>();
  if (!Array.isArray(changes) || changes.length === 0) {
    return c.json({ error: "missing changes" }, 400);
  }

  // Load existing grid or create empty one
  const data = await c.env.KV.get(PIXELS_KEY);
  const grid: string[][] = data
    ? JSON.parse(data)
    : Array.from({ length: PIXELS_GRID_SIZE }, () => Array(PIXELS_GRID_SIZE).fill("#111"));

  // Apply changes
  const colorPattern = /^#[0-9a-f]{3,6}$/i;
  for (const { x, y, color } of changes) {
    if (x >= 0 && x < PIXELS_GRID_SIZE && y >= 0 && y < PIXELS_GRID_SIZE && colorPattern.test(color)) {
      grid[y][x] = color;
    }
  }

  await c.env.KV.put(PIXELS_KEY, JSON.stringify(grid));
  return c.json({ success: true });
});

// --- Photos ---

// Require valid session on all /photos routes
app.use("/photos/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = auth.slice(7);
  const allowed = parseAllowedEmails(c.env.ALLOWED_EMAILS);
  const user = await verifySession(c.env.KV, sessionId, allowed);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("email", user.email);
  await next();
});

// List photos (newest first, scoped to owner)
app.get("/photos/list", async (c) => {
  const email = c.get("email");
  const cursor = c.req.query("cursor") || "0";
  const limit = 50;
  const offset = parseInt(cursor, 10);
  const rows = await c.env.DB.prepare(
    "SELECT id, filename, content_type, size, width, height, created_at FROM photos WHERE owner = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(email, limit, offset)
    .all();
  return c.json({
    photos: rows.results,
    nextCursor: rows.results.length === limit ? String(offset + limit) : null,
  });
});

// Upload photo (multipart: original + thumbnail)
app.post("/photos/upload", async (c) => {
  const form = await c.req.formData();
  const original = form.get("original") as File | null;
  const thumbnail = form.get("thumbnail") as File | null;
  const width = form.get("width") as string | null;
  const height = form.get("height") as string | null;

  if (!original || !thumbnail) {
    return c.json({ error: "missing original or thumbnail" }, 400);
  }

  const id = crypto.randomUUID();

  await Promise.all([
    c.env.PHOTOS.put(`original/${id}`, original.stream(), {
      httpMetadata: { contentType: original.type },
    }),
    c.env.PHOTOS.put(`thumb/${id}`, thumbnail.stream(), {
      httpMetadata: { contentType: thumbnail.type },
    }),
  ]);

  const email = c.get("email");
  await c.env.DB.prepare(
    "INSERT INTO photos (id, owner, filename, content_type, size, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, email, original.name, original.type, original.size, width ? parseInt(width, 10) : null, height ? parseInt(height, 10) : null)
    .run();

  return c.json({ id });
});

// Get original photo (verify ownership)
app.get("/photos/:id/original", async (c) => {
  const id = c.req.param("id");
  const email = c.get("email");
  const row = await c.env.DB.prepare("SELECT 1 FROM photos WHERE id = ? AND owner = ?").bind(id, email).first();
  if (!row) return c.json({ error: "not found" }, 404);
  const obj = await c.env.PHOTOS.get(`original/${id}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

// Get thumbnail (verify ownership)
app.get("/photos/:id/thumb", async (c) => {
  const id = c.req.param("id");
  const email = c.get("email");
  const row = await c.env.DB.prepare("SELECT 1 FROM photos WHERE id = ? AND owner = ?").bind(id, email).first();
  if (!row) return c.json({ error: "not found" }, 404);
  const obj = await c.env.PHOTOS.get(`thumb/${id}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

// Delete photo (verify ownership)
app.delete("/photos/:id", async (c) => {
  const id = c.req.param("id");
  const email = c.get("email");
  const row = await c.env.DB.prepare("SELECT 1 FROM photos WHERE id = ? AND owner = ?").bind(id, email).first();
  if (!row) return c.json({ error: "not found" }, 404);
  await Promise.all([
    c.env.PHOTOS.delete(`original/${id}`),
    c.env.PHOTOS.delete(`thumb/${id}`),
  ]);
  await c.env.DB.prepare("DELETE FROM photos WHERE id = ? AND owner = ?").bind(id, email).run();
  return c.json({ deleted: true });
});

export default app;
