/* Web Push crypto round-trip test for worker/src/hardpush.ts (RFC 8291/8292).
 * Builds a push request with the worker's own code, then plays the SUBSCRIBER:
 * verifies the VAPID ES256 JWT with the public key and fully DECRYPTS the
 * aes128gcm body with the subscriber's private key — so broken key handling,
 * a wrong HKDF chain, or a non-Apple-compatible content coding fails loudly.
 * Run: node --experimental-strip-types worker/test/push.test.mjs             */
import { buildPushRequest } from '../src/hardpush.ts';
import { webcrypto as crypto } from 'node:crypto';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const utf8 = (s) => new TextEncoder().encode(s);
const concat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));

// VAPID keypair (server identity)
const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
const vapidPublic = b64u(concat([4], Buffer.from(vapidJwk.x, 'base64url'), Buffer.from(vapidJwk.y, 'base64url')));
const vapid = { subject: 'mailto:test@example.com', publicKey: vapidPublic, privateKey: vapidJwk.d };

// Subscriber keypair + auth secret (what pushManager.subscribe() creates)
const uaKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const sub = {
  endpoint: 'https://web.push.apple.com/QOZpHzNNSGRUTvXZGGSJHT',
  p256dh: b64u(uaPublicRaw),
  auth: b64u(authSecret),
};

const data = { type: 'reminder', title: '2 tasks left today', body: 'water (40oz left), photo', tag: 'hard75-reminder', badge: 2 };
const init = await buildPushRequest(data, sub, vapid, 4 * 3600);

/* ===== request shape ===== */
eq(init.method, 'POST', 'method');
eq(init.headers['Content-Encoding'], 'aes128gcm', 'RFC 8291 content coding (Apple requires this)');
eq(init.headers['Content-Type'], 'application/octet-stream', 'content type');
eq(init.headers.TTL, String(4 * 3600), 'TTL forwarded');
eq(init.headers['Content-Length'], String(init.body.length), 'content length');

/* ===== VAPID JWT (RFC 8292 `vapid t=..., k=...` scheme) ===== */
const auth = init.headers.Authorization;
ok(auth.startsWith('vapid t='), 'vapid scheme');
ok(auth.endsWith(`k=${vapidPublic}`), 'k= carries our public key');
const jwt = auth.match(/t=([^,]+),/)[1];
const [h, p, sig] = jwt.split('.');
const header = JSON.parse(Buffer.from(h, 'base64url').toString());
const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
eq(header.alg, 'ES256', 'JWT alg');
eq(claims.aud, 'https://web.push.apple.com', 'aud = push service origin');
eq(claims.sub, 'mailto:test@example.com', 'sub = VAPID subject');
ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'exp within 24h');
ok(await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, vapidKeys.publicKey,
  Buffer.from(sig, 'base64url'), utf8(`${h}.${p}`),
), 'JWT signature verifies with the VAPID public key');

/* ===== decrypt the body as the subscriber (full RFC 8291 round-trip) ===== */
const body = Buffer.from(init.body);
const salt = body.subarray(0, 16);
const rs = body.readUInt32BE(16);
const idlen = body[20];
eq(idlen, 65, 'keyid is an uncompressed P-256 point');
eq(rs, 4096, 'record size');
const asPublic = body.subarray(21, 21 + 65);
eq(asPublic[0], 4, 'keyid uncompressed marker');
const ciphertext = body.subarray(21 + 65);

const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
const hkdf = async (s, ikm, info, len) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, k, len * 8));
};
const prk = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublicRaw, asPublic), 32);
const cek = await hkdf(salt, prk, utf8('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, prk, utf8('Content-Encoding: nonce\0'), 12);
const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
let plain;
try {
  plain = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));
  ok(true, 'decrypts');
} catch (e) {
  ok(false, 'AES-GCM decryption failed: ' + e.message);
}
if (plain) {
  eq(plain[plain.length - 1], 2, 'last-record delimiter 0x02');
  const decoded = JSON.parse(plain.subarray(0, plain.length - 1).toString());
  eq(decoded.title, data.title, 'title survives the round-trip');
  eq(decoded.badge, 2, 'badge survives the round-trip');
  eq(decoded.type, 'reminder', 'type survives the round-trip');
}

/* ===== two sends never share salt/keys (fresh randomness per message) ===== */
const init2 = await buildPushRequest(data, sub, vapid, 60);
ok(!Buffer.from(init2.body).subarray(0, 16).equals(salt), 'fresh salt per message');
ok(!Buffer.from(init2.body).subarray(21, 86).equals(asPublic), 'fresh ephemeral key per message');

console.log(`push.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
