// 75 Hard: cron handler (*/15). Per-user local-time scheduling from stored
// IANA timezones; hard_notif_log's PK + INSERT OR IGNORE guarantees each
// reminder fires at most once per local day even if ticks overlap.

import {
  type HardEnv, type DayRow,
  effectiveDate, localMinutes, missingTasks,
  parsePrefs, toMinutes, inQuietHours, partnerOf, displayNameFor,
} from "./hardlogic";
import { sendPushToUser } from "./hardpush";

type CronUser = {
  email: string;
  display_name: string | null;
  timezone: string;
  grace_minutes: number;
  prefs: string;
  streak_start_date: string | null;
  completed_at: string | null;
};

export async function scheduled(_controller: ScheduledController, env: HardEnv, _ctx: ExecutionContext): Promise<void> {
  // 1. Finalization kick — the DO no-ops if nothing is due, and handles
  //    grace/team logic itself. Awaited so the reminder pass below reads
  //    post-finalize state rather than racing it.
  const stub = env.HARD_ROOM.get(env.HARD_ROOM.idFromName("couple"));
  await stub.fetch("https://do/finalize", { method: "POST" }).catch(() => {});

  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT u.email, u.display_name, u.timezone, u.grace_minutes, u.prefs,
            p.streak_start_date, p.completed_at
     FROM hard_users u LEFT JOIN hard_participants p ON p.email = u.email`,
  ).all<CronUser>();

  for (const u of results ?? []) {
    if (!u.streak_start_date || u.completed_at) continue; // not started or already done
    const prefs = parsePrefs(u.prefs);
    const minutes = localMinutes(now, u.timezone);
    const today = effectiveDate(now, u.timezone, u.grace_minutes);
    const day = await env.DB
      .prepare("SELECT * FROM hard_days WHERE email = ? AND date = ?")
      .bind(u.email, today).first<DayRow>();
    const missing = missingTasks(day);
    if (!missing.length) continue; // day already complete — nothing to nag about

    // 2. Daily reminders at configured local times (≤15 min late by design).
    for (const t of prefs.reminderTimes ?? []) {
      if (minutes < toMinutes(t) || inQuietHours(prefs, minutes)) continue;
      const r = await env.DB
        .prepare("INSERT OR IGNORE INTO hard_notif_log (email, kind, marker) VALUES (?, ?, ?)")
        .bind(u.email, `reminder:${t}`, today).run();
      if (r.meta.changes === 1) {
        await sendPushToUser(env, u.email, {
          type: "reminder",
          title: `${missing.length} task${missing.length === 1 ? "" : "s"} left today`,
          body: missing.join(", "),
          tag: "hard75-reminder",
        });
      }
    }

    // 3. Bedtime last-chance nudge — deliberately ignores quiet hours; it IS
    //    the point. Grace keeps this from re-firing after midnight: once local
    //    midnight passes, `minutes` resets and the window check fails.
    const nudgeMin = prefs.bedtimeNudgeMin ?? 60;
    if (nudgeMin > 0 && minutes >= 1440 - nudgeMin) {
      const r = await env.DB
        .prepare("INSERT OR IGNORE INTO hard_notif_log (email, kind, marker) VALUES (?, ?, ?)")
        .bind(u.email, "bedtime", today).run();
      if (r.meta.changes === 1) {
        await sendPushToUser(env, u.email, {
          type: "bedtime",
          title: "⏰ Last chance — midnight is coming",
          body: `Still missing: ${missing.join(", ")}`,
          tag: "hard75-bedtime",
          ignoreQuiet: true,
        });
      }
    }

    // 4. Partner at-risk: if I'm still incomplete at my configured local
    //    threshold, warn my partner (their notif prefs gate delivery).
    const atRisk = prefs.atRiskTime;
    if (atRisk && minutes >= toMinutes(atRisk)) {
      const r = await env.DB
        .prepare("INSERT OR IGNORE INTO hard_notif_log (email, kind, marker) VALUES (?, ?, ?)")
        .bind(u.email, "atrisk", today).run();
      if (r.meta.changes === 1) {
        const partner = partnerOf(env.ALLOWED_EMAILS, u.email);
        if (partner) {
          await sendPushToUser(env, partner, {
            type: "atRisk",
            title: `${displayNameFor(u)} is at risk ⚠️`,
            body: `Still open: ${missing.slice(0, 3).join(", ")}`,
            tag: "hard75-atrisk",
          });
        }
      }
    }
  }

  // 5. Housekeeping on the ~03:00 UTC tick. hard_notif_log uses SQLite's
  //    datetime('now') format; hard_actions/hard_events store ISO strings —
  //    compare each against a cutoff in its own format.
  const d = new Date(now);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (utcMin >= 180 && utcMin < 195) {
    const iso30 = new Date(now - 30 * 86400000).toISOString();
    const iso90 = new Date(now - 90 * 86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM hard_actions WHERE created_at < ?").bind(iso30),
      env.DB.prepare("DELETE FROM hard_notif_log WHERE sent_at < datetime('now', '-30 days')"),
      env.DB.prepare("DELETE FROM hard_events WHERE created_at < ?").bind(iso90),
    ]);
  }
}
