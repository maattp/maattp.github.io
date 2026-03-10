import { Hono } from "hono";
import { cors } from "hono/cors";

const SESSION_TTL = 365 * 24 * 60 * 60; // 1 year in seconds
const SESSION_PREFIX = "__session:";

type Bindings = {
  KV: KVNamespace;
  PHOTOS: R2Bucket;
  DB: D1Database;
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

app.use("*", cors({
  origin: ["https://polkiewicz.com", "https://maattp.github.io", "http://localhost:8000"],
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
}));

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
  for (const { x, y, color } of changes) {
    if (x >= 0 && x < PIXELS_GRID_SIZE && y >= 0 && y < PIXELS_GRID_SIZE) {
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
