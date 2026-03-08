import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  ALLOWED_EMAIL: string;
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

async function verifyGoogleToken(
  token: string,
  clientId: string,
  allowedEmail: string
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
  if (payload.email !== allowedEmail) return null;

  return { email: payload.email as string };
}

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors({
  origin: ["https://polkiewicz.com", "https://maattp.github.io", "http://localhost:8000"],
  allowHeaders: ["Authorization"],
  allowMethods: ["GET", "PUT", "DELETE"],
}));

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

// Require Google auth on all /kv routes
app.use("/kv/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await verifyGoogleToken(token, c.env.GOOGLE_CLIENT_ID, c.env.ALLOWED_EMAIL);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
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

export default app;
