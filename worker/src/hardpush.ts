// 75 Hard: Web Push delivery — RFC 8291 (aes128gcm) message encryption and
// RFC 8292 (vapid t=..., k=...) auth, implemented directly on WebCrypto.
// Hand-rolled deliberately: the available webcrypto libraries emit the legacy
// `aesgcm` coding, but Apple's push service (this app's only real target)
// requires aes128gcm. worker/test/push.test.mjs proves the full round-trip by
// decrypting a payload with the subscriber's private key.
//
// Every push MUST render a visible notification on iOS — silent pushes get the
// subscription revoked by Apple. The payload always carries title/body plus a
// `badge` count (remaining tasks today) because iOS can only update the icon
// badge from the SW push handler.

import {
  type HardEnv, type DayRow,
  effectiveDate, localMinutes, remainingCount,
  parsePrefs, inQuietHours, notifEnabled,
} from "./hardlogic.ts"; // explicit extension so node --experimental-strip-types can run the test suite against this module

export type HardPush = {
  type: string; // poke | partnerTask | partnerDay | milestone | reset | atRisk | reminder | bedtime | test | reaction
  title: string;
  body: string;
  tag?: string;
  ignoreQuiet?: boolean; // bedtime last-chance nudge is deliberately exempt
};

type SubRow = { endpoint: string; p256dh: string; auth: string };
type UserRow = { email: string; timezone: string; grace_minutes: number; prefs: string };

// ---- small byte helpers ----

const te = new TextEncoder();
const utf8 = (s: string) => te.encode(s);

function b64uToBytes(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return Uint8Array.from(atob(base64 + pad), (c) => c.charCodeAt(0));
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, len * 8,
  ));
}

// ---- RFC 8291: aes128gcm single-record encryption ----

export async function encryptPushPayload(plaintext: Uint8Array, p256dhB64u: string, authB64u: string): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(p256dhB64u); // subscriber's 65-byte uncompressed point
  const authSecret = b64uToBytes(authB64u); // subscriber's 16-byte auth secret
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh");
  if (authSecret.length !== 16) throw new Error("bad auth secret");

  const asKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  )) as CryptoKeyPair;
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // workers-types spell the standard `public` param `$public`; the runtime is standard
  const ecdhAlg = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlg, asKeys.privateKey, 256));
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asKeys.publicKey)) as ArrayBuffer);

  // RFC 8291 §3.3-3.4: IKM = HKDF(auth, ecdh, "WebPush: info" || ua_public || as_public)
  const prk = await hkdf(authSecret, ecdhSecret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, utf8("Content-Encoding: nonce\0"), 12);

  // RFC 8188: single record = plaintext || 0x02 (last-record delimiter)
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource }, key, concat(plaintext, new Uint8Array([2])) as BufferSource,
  ));

  // aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(=as_public, 65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---- RFC 8292: VAPID Authorization header ----

export async function vapidAuthorization(endpoint: string, subject: string, publicKeyB64u: string, privateKeyB64u: string): Promise<string> {
  const pub = b64uToBytes(publicKeyB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("bad VAPID public key");
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privateKeyB64u,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // ≤ 24h per RFC
    sub: subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`) as BufferSource,
  ));
  return `vapid t=${header}.${claims}.${bytesToB64u(sig)}, k=${publicKeyB64u}`;
}

export async function buildPushRequest(
  data: unknown,
  sub: { endpoint: string; p256dh: string; auth: string },
  vapid: { subject: string; publicKey: string; privateKey: string },
  ttlSeconds: number,
): Promise<{ method: string; headers: Record<string, string>; body: Uint8Array }> {
  const body = await encryptPushPayload(utf8(JSON.stringify(data)), sub.p256dh, sub.auth);
  return {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      TTL: String(ttlSeconds),
      Urgency: "normal",
    },
    body,
  };
}

// ---- delivery ----

export async function sendPushToUser(env: HardEnv, email: string, push: HardPush): Promise<void> {
  const user = await env.DB
    .prepare("SELECT email, timezone, grace_minutes, prefs FROM hard_users WHERE email = ?")
    .bind(email).first<UserRow>();
  if (!user) return;

  const prefs = parsePrefs(user.prefs);
  if (push.type !== "test") {
    if (!notifEnabled(prefs, push.type)) return;
    const nowMin = localMinutes(Date.now(), user.timezone);
    if (!push.ignoreQuiet && inQuietHours(prefs, nowMin)) return;
  }

  const { results: subs } = await env.DB
    .prepare("SELECT endpoint, p256dh, auth FROM hard_push_subs WHERE email = ?")
    .bind(email).all<SubRow>();
  if (!subs || subs.length === 0) return;

  // Badge = the recipient's remaining tasks for their current effective day.
  const today = effectiveDate(Date.now(), user.timezone, user.grace_minutes);
  const day = await env.DB
    .prepare("SELECT * FROM hard_days WHERE email = ? AND date = ?")
    .bind(email, today).first<DayRow>();
  const badge = remainingCount(day);

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const data = { type: push.type, title: push.title, body: push.body, tag: push.tag ?? `hard75-${push.type}`, badge };
  const ttl = push.type === "reminder" || push.type === "bedtime" ? 4 * 3600 : 24 * 3600;

  for (const sub of subs) {
    try {
      const init = await buildPushRequest(data, sub, vapid, ttl);
      const res = await fetch(sub.endpoint, init as RequestInit);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM hard_push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
      } else if (!res.ok) {
        console.log("push send non-ok", email, res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.log("push send failed", email, String(err));
    }
  }
}

export async function sendPushes(env: HardEnv, pushes: { email: string; push: HardPush }[]): Promise<void> {
  for (const p of pushes) {
    await sendPushToUser(env, p.email, p.push);
  }
}
