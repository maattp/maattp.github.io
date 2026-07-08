// 75 Hard: pure business logic. No bindings, no I/O — everything here is
// unit-testable and the day-boundary rules are mirrored verbatim in
// apps/75hard/index.html (keep the two in sync).

export type HardEnv = {
  KV: KVNamespace;
  PHOTOS: R2Bucket;
  DB: D1Database;
  HARD_ROOM: DurableObjectNamespace;
  ALLOWED_EMAILS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  VAPID_PRIVATE_KEY: string;
};

// The couple: the two ALLOWED_EMAILS. Everyone's partner is the other one.
export function coupleEmails(allowedEmails: string): string[] {
  return allowedEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function partnerOf(allowedEmails: string, email: string): string | null {
  return coupleEmails(allowedEmails).find((e) => e !== email.toLowerCase()) ?? null;
}

export function displayNameFor(row: { display_name?: string | null; email: string } | null | undefined): string {
  if (!row) return "Partner";
  return row.display_name || row.email.split("@")[0];
}

export type DayRow = {
  email: string;
  date: string; // local YYYY-MM-DD
  diet: number;
  reading_done: number;
  pages: number | null;
  book_id: string | null;
  workout1_done: number;
  workout1_min: number;
  workout1_outdoor: number;
  workout2_done: number;
  workout2_min: number;
  workout2_outdoor: number;
  water_oz: number;
  photo_id: string | null;
  finalized: number;
  complete: number;
  day_number: number | null;
  updated_at: string | null;
};

export type Participant = {
  email: string;
  start_date: string;
  streak_start_date: string;
  last_finalized_date: string | null;
  completed_at: string | null;
};

export type HardAction = {
  actionId: string;
  type: string;
  payload: Record<string, unknown>;
  date: string; // client-computed local day the action targets
  localTimestamp: number; // epoch ms at action time
  timezone: string; // IANA zone at action time
};

export type NotifPrefs = {
  reminderTimes?: string[]; // "HH:MM" local
  bedtimeNudgeMin?: number; // minutes before local midnight
  atRiskTime?: string; // "HH:MM" local — if still incomplete then, warn partner
  quietHours?: { start: string; end: string } | null;
  notif?: Record<string, boolean>; // per-type on/off: poke, partnerTask, partnerDay, milestone, reset, atRisk, reminders
  shareMeasurements?: boolean; // weight/fat % visible to partner (default false)
  units?: string; // client display preference: 'lb' | 'kg'
};

export const TASK_LABELS: Record<string, string> = {
  diet: "diet",
  water: "water",
  workout1: "workout #1",
  workout2: "workout #2",
  outdoor: "outdoor workout",
  reading: "reading",
  photo: "photo",
};

// ---- timezone / date math ------------------------------------------------

const DAY_MS = 86400000;

// 'en-CA' formats as YYYY-MM-DD directly.
export function localDate(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function localMinutes(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function dateToUTC(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const d = new Date(dateToUTC(date) + n * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export function nextDay(date: string): string {
  return addDays(date, 1);
}

export function prevDay(date: string): string {
  return addDays(date, -1);
}

// DST-safe calendar-day difference (a → b).
export function daysBetween(a: string, b: string): number {
  return Math.round((dateToUTC(b) - dateToUTC(a)) / DAY_MS);
}

// Grace formula (shared rule 1): the "effective" local date only rolls over
// graceMinutes past midnight, so 00:40 with a 3h grace still counts as yesterday.
export function effectiveDate(nowMs: number, timezone: string, graceMinutes: number): string {
  return localDate(nowMs - graceMinutes * 60000, timezone);
}

export function dayNumberOf(streakStartDate: string, date: string): number {
  return daysBetween(streakStartDate, date) + 1;
}

// ---- completion rules (shared rule 3) --------------------------------------

export function isDayComplete(d: DayRow | undefined | null): boolean {
  if (!d) return false;
  return !!(
    d.diet &&
    d.reading_done &&
    d.workout1_done &&
    d.workout1_min >= 45 &&
    d.workout2_done &&
    d.workout2_min >= 45 &&
    (d.workout1_outdoor || d.workout2_outdoor) &&
    d.water_oz >= 128 &&
    d.photo_id
  );
}

export function missingTasks(d: DayRow | undefined | null): string[] {
  const out: string[] = [];
  if (!d) return ["diet", "water", "workout #1", "workout #2", "reading", "photo"];
  if (!d.diet) out.push("diet");
  if (d.water_oz < 128) out.push(`water (${128 - d.water_oz}oz left)`);
  if (!d.workout1_done || d.workout1_min < 45) out.push("workout #1");
  if (!d.workout2_done || d.workout2_min < 45) out.push("workout #2");
  if (
    d.workout1_done && d.workout2_done &&
    !d.workout1_outdoor && !d.workout2_outdoor
  ) out.push("outdoor workout");
  if (!d.reading_done) out.push("reading");
  if (!d.photo_id) out.push("photo");
  return out;
}

export function remainingCount(d: DayRow | undefined | null): number {
  let n = 0;
  if (!d) return 5;
  if (!d.diet) n++;
  if (d.water_oz < 128) n++;
  if (!(d.workout1_done && d.workout1_min >= 45 && d.workout2_done && d.workout2_min >= 45 &&
        (d.workout1_outdoor || d.workout2_outdoor))) n++;
  if (!d.reading_done) n++;
  if (!d.photo_id) n++;
  return n;
}

// ---- action validation (shared rules 1 & 4) --------------------------------

export type StampCheck = { ok: true } | { ok: false; reason: string };

// Sanity: the claimed target date must sit within ±48h of the stamped moment,
// and the stamp itself can't be implausibly far in the future.
export function validateStamp(a: HardAction, serverNowMs: number): StampCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return { ok: false, reason: "bad date" };
  if (typeof a.localTimestamp !== "number" || !isFinite(a.localTimestamp)) {
    return { ok: false, reason: "bad timestamp" };
  }
  if (a.localTimestamp > serverNowMs + 26 * 3600 * 1000) {
    return { ok: false, reason: "timestamp in future" };
  }
  let stampDate: string;
  try {
    stampDate = localDate(a.localTimestamp, a.timezone);
  } catch {
    return { ok: false, reason: "bad timezone" };
  }
  if (Math.abs(daysBetween(stampDate, a.date)) > 2) {
    return { ok: false, reason: "date too far from timestamp" };
  }
  return { ok: true };
}

// Shared rule 4: an action for day d counts iff its stamped local datetime is
// before d+1 00:00 + grace.
export function stampInWindow(a: HardAction, graceMinutes: number): boolean {
  const stampDate = localDate(a.localTimestamp, a.timezone);
  if (stampDate <= a.date) return true;
  if (stampDate === nextDay(a.date)) {
    return localMinutes(a.localTimestamp, a.timezone) < graceMinutes;
  }
  return false;
}

// ---- day action reducers ---------------------------------------------------

export const DAY_ACTION_TYPES = new Set([
  "set_task", "set_workout", "add_water", "set_water", "attach_photo",
]);

export function emptyDay(email: string, date: string): DayRow {
  return {
    email, date,
    diet: 0, reading_done: 0, pages: null, book_id: null,
    workout1_done: 0, workout1_min: 0, workout1_outdoor: 0,
    workout2_done: 0, workout2_min: 0, workout2_outdoor: 0,
    water_oz: 0, photo_id: null,
    finalized: 0, complete: 0, day_number: null, updated_at: null,
  };
}

const clampInt = (v: unknown, lo: number, hi: number): number => {
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

// Mutates a copy of the day row per the action. Returns the new row, or null
// if the action is malformed. Pure: same function backs optimistic client
// apply (mirrored in JS) and server apply.
export function applyDayAction(day: DayRow, a: HardAction): DayRow | null {
  const d = { ...day };
  const p = a.payload ?? {};
  switch (a.type) {
    case "set_task": {
      if (p.field === "diet") d.diet = p.value ? 1 : 0;
      else if (p.field === "reading") {
        d.reading_done = p.value ? 1 : 0;
        if (p.pages != null) d.pages = clampInt(p.pages, 0, 2000);
        if (typeof p.bookId === "string") d.book_id = p.bookId;
      } else return null;
      return d;
    }
    case "set_workout": {
      const slot = p.slot === 1 || p.slot === "1" ? 1 : p.slot === 2 || p.slot === "2" ? 2 : 0;
      if (!slot) return null;
      const done = p.done ? 1 : 0;
      const min = clampInt(p.minutes, 0, 600);
      const outdoor = p.outdoor ? 1 : 0;
      if (slot === 1) { d.workout1_done = done; d.workout1_min = min; d.workout1_outdoor = outdoor; }
      else { d.workout2_done = done; d.workout2_min = min; d.workout2_outdoor = outdoor; }
      return d;
    }
    case "add_water":
      d.water_oz = clampInt(d.water_oz + clampInt(p.oz, -512, 512), 0, 1024);
      return d;
    case "set_water":
      d.water_oz = clampInt(p.oz, 0, 1024);
      return d;
    case "attach_photo":
      if (typeof p.photoId !== "string" || !p.photoId) return null;
      d.photo_id = p.photoId;
      return d;
    default:
      return null;
  }
}

// ---- finalization planner ----------------------------------------------------

export type FinalizeStep = {
  date: string;
  dayNumber: number;
  complete: boolean;
  missing: string[];
};

export type FinalizePlan = {
  steps: FinalizeStep[];             // every day to mark finalized, in order
  newStreakStart: string | null;     // set if any reset happened (solo semantics)
  lastFinalized: string | null;      // new cursor value
  resets: FinalizeStep[];            // incomplete days encountered
  milestones: number[];              // 25/50 hit on complete days
  completed75: boolean;              // participant crossed day 75 complete
};

// Walks unfinalized past days for one user. Pure: caller supplies the rows.
// A reset moves the streak start to the day after the miss and later days are
// renumbered against it; multiple consecutive misses collapse naturally.
export function planFinalize(
  p: Participant,
  daysByDate: Map<string, DayRow>,
  timezone: string,
  graceMinutes: number,
  nowMs: number,
): FinalizePlan {
  const plan: FinalizePlan = {
    steps: [], newStreakStart: null, lastFinalized: null,
    resets: [], milestones: [], completed75: false,
  };
  if (p.completed_at) return plan; // challenge already finished for this user

  const today = effectiveDate(nowMs, timezone, graceMinutes);
  let cursor = p.last_finalized_date ? nextDay(p.last_finalized_date) : p.streak_start_date;
  if (cursor < p.streak_start_date) cursor = p.streak_start_date;
  let streakStart = p.streak_start_date;

  // effectiveDate already encodes the grace wait: a day only becomes < today
  // once local midnight + grace has passed.
  while (cursor < today && plan.steps.length < 400) {
    const row = daysByDate.get(cursor);
    const dayNumber = dayNumberOf(streakStart, cursor);
    const complete = isDayComplete(row);
    const step: FinalizeStep = { date: cursor, dayNumber, complete, missing: complete ? [] : missingTasks(row) };
    plan.steps.push(step);
    if (complete) {
      if (dayNumber === 25 || dayNumber === 50) plan.milestones.push(dayNumber);
      if (dayNumber >= 75) {
        plan.completed75 = true;
        plan.lastFinalized = cursor;
        break; // done — nothing after day 75 matters
      }
    } else {
      plan.resets.push(step);
      streakStart = nextDay(cursor);
      plan.newStreakStart = streakStart;
    }
    plan.lastFinalized = cursor;
    cursor = nextDay(cursor);
  }
  return plan;
}

// ---- notification helpers ----------------------------------------------------

export function parsePrefs(raw: string | null | undefined): NotifPrefs {
  try {
    return raw ? (JSON.parse(raw) as NotifPrefs) : {};
  } catch {
    return {};
  }
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Quiet hours may wrap midnight (e.g. 22:30 → 07:00).
export function inQuietHours(prefs: NotifPrefs, minutes: number): boolean {
  const q = prefs.quietHours;
  if (!q || !q.start || !q.end) return false;
  const s = toMinutes(q.start);
  const e = toMinutes(q.end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export function notifEnabled(prefs: NotifPrefs, type: string): boolean {
  const n = prefs.notif;
  if (!n) return true; // default: everything on
  return n[type] !== false;
}
