// 75 Hard: Web Push delivery. RFC 8291 encryption + RFC 8292 VAPID via
// @block65/webcrypto-web-push (pure WebCrypto, Workers-compatible).
//
// Every push MUST render a visible notification on iOS — silent pushes get the
// subscription revoked by Apple. The payload always carries title/body plus a
// `badge` count (remaining tasks today) because iOS can only update the icon
// badge from the SW push handler.

import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import {
  type HardEnv, type DayRow,
  effectiveDate, localMinutes, remainingCount,
  parsePrefs, inQuietHours, notifEnabled,
} from "./hardlogic";

export type HardPush = {
  type: string; // poke | partnerTask | partnerDay | milestone | reset | atRisk | reminder | bedtime | test | reaction
  title: string;
  body: string;
  tag?: string;
  ignoreQuiet?: boolean; // bedtime last-chance nudge is deliberately exempt
};

type SubRow = { endpoint: string; p256dh: string; auth: string };
type UserRow = { email: string; timezone: string; grace_minutes: number; prefs: string };

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
  const message = {
    data: { type: push.type, title: push.title, body: push.body, tag: push.tag ?? `hard75-${push.type}`, badge },
    options: { ttl: push.type === "reminder" || push.type === "bedtime" ? 4 * 3600 : 24 * 3600 },
  };

  for (const sub of subs) {
    const subscription: PushSubscription = {
      endpoint: sub.endpoint,
      expirationTime: null,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      const init = await buildPushPayload(message, subscription, vapid);
      const res = await fetch(sub.endpoint, init as RequestInit);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM hard_push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
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
