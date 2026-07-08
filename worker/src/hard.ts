// 75 Hard: REST routes, mounted at /hard by index.ts (after cors; the /hard/ws
// upgrade lives in index.ts BEFORE cors because 101 headers are immutable).
// Every route here is session-gated with the same Bearer-session pattern as
// /photos/*, re-checking the allowlist on each request.

import { Hono } from "hono";
import { type HardEnv, type HardAction, coupleEmails, partnerOf } from "./hardlogic";
import { sendPushToUser } from "./hardpush";

const SESSION_PREFIX = "__session:";
export const WS_TICKET_PREFIX = "__hardws:";

type Variables = { email: string };

function hardRoom(env: HardEnv): DurableObjectStub {
  return env.HARD_ROOM.get(env.HARD_ROOM.idFromName("couple"));
}

async function doApply(env: HardEnv, email: string, actions: HardAction[]): Promise<Response> {
  return hardRoom(env).fetch("https://do/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, actions }),
  });
}

// Rows are created lazily so /state works before onboarding actions arrive.
async function ensureUser(env: HardEnv, email: string): Promise<void> {
  const row = await env.DB.prepare("SELECT email FROM hard_users WHERE email = ?").bind(email).first();
  if (!row) {
    const prefix = email.split("@")[0];
    const name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    await env.DB.prepare("INSERT OR IGNORE INTO hard_users (email, display_name) VALUES (?, ?)").bind(email, name).run();
  }
}

export const hardApp = new Hono<{ Bindings: HardEnv; Variables: Variables }>();

hardApp.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);
  const email = await c.env.KV.get(`${SESSION_PREFIX}${auth.slice(7)}`);
  if (!email || !coupleEmails(c.env.ALLOWED_EMAILS).includes(email.toLowerCase())) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("email", email.toLowerCase());
  await next();
});

// ---- state + sync ----

hardApp.get("/state", async (c) => {
  const email = c.get("email");
  await ensureUser(c.env, email);
  const res = await doApply(c.env, email, []);
  if (!res.ok) return c.json({ error: "state failed" }, 502);
  const data = (await res.json()) as { state: unknown };
  return c.json(data.state as object);
});

hardApp.post("/sync", async (c) => {
  const email = c.get("email");
  await ensureUser(c.env, email);
  let body: { actions?: HardAction[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  if (!Array.isArray(body.actions)) return c.json({ error: "actions required" }, 400);
  if (body.actions.length > 100) return c.json({ error: "too many actions" }, 400);
  const res = await doApply(c.env, email, body.actions);
  if (!res.ok) return c.json({ error: "sync failed" }, 502);
  return c.json((await res.json()) as object);
});

hardApp.get("/history", async (c) => {
  const email = c.get("email");
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return c.json({ error: "bad range" }, 400);
  const partner = partnerOf(c.env.ALLOWED_EMAILS, email);
  const [mine, theirs] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM hard_days WHERE email = ? AND date >= ? AND date <= ? ORDER BY date").bind(email, from, to),
    c.env.DB.prepare("SELECT date, complete, finalized FROM hard_days WHERE email = ? AND date >= ? AND date <= ? ORDER BY date").bind(partner ?? "", from, to),
  ]);
  return c.json({ me: mine.results ?? [], partner: theirs.results ?? [] });
});

// ---- WebSocket ticket (the WS itself can't send an Authorization header) ----

hardApp.post("/ws-ticket", async (c) => {
  const ticket = crypto.randomUUID();
  await c.env.KV.put(`${WS_TICKET_PREFIX}${ticket}`, c.get("email"), { expirationTtl: 60 });
  return c.json({ ticket });
});

// ---- photos (R2 keys hard/original/<id> + hard/thumb/<id>) ----

hardApp.post("/photos/upload", async (c) => {
  const email = c.get("email");
  await ensureUser(c.env, email);
  const form = await c.req.formData();
  const original = form.get("original") as unknown;
  const thumbnail = form.get("thumbnail") as unknown;
  const date = String(form.get("date") ?? "");
  const photoId = String(form.get("photoId") ?? "");
  const actionId = String(form.get("actionId") ?? "");
  const shared = String(form.get("shared") ?? "0") === "1";
  const localTimestamp = Number(form.get("localTimestamp") ?? Date.now());
  const timezone = String(form.get("timezone") ?? "UTC");

  if (!(original instanceof File) || !(thumbnail instanceof File)) return c.json({ error: "missing files" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "bad date" }, 400);
  if (!/^[\w-]{8,64}$/.test(photoId) || !/^[\w-]{8,64}$/.test(actionId)) return c.json({ error: "bad ids" }, 400);
  if (original.size > 15 * 1024 * 1024 || thumbnail.size > 2 * 1024 * 1024) return c.json({ error: "too large" }, 413);

  // Idempotent by actionId: a replayed upload skips the R2 writes entirely.
  const dupe = await c.env.DB.prepare("SELECT 1 FROM hard_actions WHERE action_id = ?").bind(actionId).first();
  if (dupe) return c.json({ id: photoId, status: "duplicate" });

  // photoId is client-generated: refuse to write R2 bytes over an id that
  // already belongs to someone else (INSERT OR IGNORE below would keep the
  // old owner row while the object got replaced).
  const existing = await c.env.DB.prepare("SELECT email FROM hard_photos WHERE id = ?").bind(photoId).first<{ email: string }>();
  if (existing && existing.email !== email) return c.json({ error: "photo id in use" }, 409);

  await c.env.PHOTOS.put(`hard/original/${photoId}`, original.stream(), {
    httpMetadata: { contentType: original.type || "image/jpeg" },
  });
  await c.env.PHOTOS.put(`hard/thumb/${photoId}`, thumbnail.stream(), {
    httpMetadata: { contentType: thumbnail.type || "image/jpeg" },
  });
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO hard_photos (id, email, date, shared, content_type, size) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(photoId, email, date, shared ? 1 : 0, original.type || "image/jpeg", original.size).run();

  // Attach to the day through the DO — same idempotency/window rules as any action.
  const res = await doApply(c.env, email, [
    { actionId, type: "attach_photo", payload: { photoId }, date, localTimestamp, timezone },
  ]);
  let status = "applied";
  if (res.ok) {
    const data = (await res.json()) as { results?: { status?: string }[] };
    status = data.results?.[0]?.status ?? "applied";
  }
  return c.json({ id: photoId, status });
});

hardApp.get("/photos/:id/:kind", async (c) => {
  const email = c.get("email");
  const id = c.req.param("id");
  const kind = c.req.param("kind");
  if (kind !== "original" && kind !== "thumb") return c.json({ error: "not found" }, 404);
  const row = await c.env.DB
    .prepare("SELECT email, shared, content_type FROM hard_photos WHERE id = ?")
    .bind(id).first<{ email: string; shared: number; content_type: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const isOwner = row.email === email;
  const isSharedWithMe = !!row.shared && row.email === partnerOf(c.env.ALLOWED_EMAILS, email);
  if (!isOwner && !isSharedWithMe) return c.json({ error: "not found" }, 404);
  const obj = await c.env.PHOTOS.get(`hard/${kind}/${id}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? row.content_type ?? "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

hardApp.delete("/photos/:id", async (c) => {
  const email = c.get("email");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT email FROM hard_photos WHERE id = ?").bind(id).first<{ email: string }>();
  if (!row || row.email !== email) return c.json({ error: "not found" }, 404);
  await c.env.PHOTOS.delete(`hard/original/${id}`);
  await c.env.PHOTOS.delete(`hard/thumb/${id}`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM hard_photos WHERE id = ?").bind(id),
    c.env.DB.prepare("UPDATE hard_days SET photo_id = NULL WHERE email = ? AND photo_id = ? AND finalized = 0").bind(email, id),
  ]);
  return c.json({ deleted: true });
});

// ---- push ----

hardApp.post("/push/subscribe", async (c) => {
  const email = c.get("email");
  await ensureUser(c.env, email);
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; ua?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const sub = body.subscription ?? body;
  const endpoint = sub.endpoint ?? "";
  const p256dh = sub.keys?.p256dh ?? "";
  const auth = sub.keys?.auth ?? "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return c.json({ error: "bad subscription" }, 400);
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO hard_push_subs (endpoint, email, p256dh, auth, ua) VALUES (?, ?, ?, ?, ?)",
  ).bind(endpoint, email, p256dh, auth, (body.ua ?? "").slice(0, 200)).run();
  return c.json({ ok: true });
});

hardApp.delete("/push/subscribe", async (c) => {
  const email = c.get("email");
  let body: { endpoint?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  if (!body.endpoint) return c.json({ error: "endpoint required" }, 400);
  await c.env.DB.prepare("DELETE FROM hard_push_subs WHERE endpoint = ? AND email = ?").bind(body.endpoint, email).run();
  return c.json({ ok: true });
});

hardApp.get("/push/vapid", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));

hardApp.post("/push/test", async (c) => {
  await sendPushToUser(c.env, c.get("email"), {
    type: "test",
    title: "75 Hard 🔔",
    body: "Test notification — push is working.",
    tag: "hard75-test",
  });
  return c.json({ ok: true });
});
