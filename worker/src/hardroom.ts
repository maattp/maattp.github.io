// 75 Hard: HardRoom Durable Object. A single instance (idFromName("couple"))
// serializes ALL mutations. NOTE: the DO input gate only covers
// `state.storage` awaits — D1 calls are external fetches, so every `await
// env.DB...` is a yield point where a second request could interleave.
// `runExclusive` therefore chains /apply and /finalize on an in-memory
// promise queue (safe: exactly one live instance exists per name), making
// idempotency checks, finalization, and team-mode double-resets actually
// race-free. D1 is the sole source of truth; this DO stores nothing
// authoritative and holds the live WebSockets (hibernation API) for
// broadcast-after-commit.

import {
  type HardEnv, type HardAction, type DayRow, type Participant,
  coupleEmails, partnerOf, displayNameFor,
  effectiveDate, nextDay, prevDay, dayNumberOf,
  isDayComplete, missingTasks, remainingCount, TASK_LABELS,
  validateStamp, stampInWindow, applyDayAction, emptyDay, DAY_ACTION_TYPES,
  planFinalize, parsePrefs,
} from "./hardlogic";
import { sendPushes, type HardPush } from "./hardpush";

type ChallengeRow = {
  id: number; mode: string; reward_text: string | null;
  status: string; completed_at: string | null;
};
type UserRow = {
  email: string; display_name: string | null; timezone: string;
  grace_minutes: number; prefs: string;
};
type BookRow = {
  id: string; email: string; title: string; author: string | null;
  started_date: string | null; finished_date: string | null;
};
type NewEvent = { id: string; email: string; type: string; payload: Record<string, unknown>; created_at: string };
type PushIntent = { email: string; push: HardPush };
type ActionResult = { actionId: string; status: "applied" | "duplicate" | "late" | "rejected"; error?: string };

type Ctx = {
  challenge: ChallengeRow | null;
  users: Map<string, UserRow>;
  parts: Map<string, Participant>;
  emails: string[];
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export class HardRoom {
  private state: DurableObjectState;
  private env: HardEnv;
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: HardEnv) {
    this.state = state;
    this.env = env;
  }

  // All mutating entry points run one-at-a-time. The chain never rejects
  // (each link swallows its predecessor's error), so one failed request
  // can't poison the queue.
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(fn, fn);
    this.mutationChain = run.catch(() => {});
    return run;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return this.handleWs(request, url);
    if (url.pathname === "/apply" && request.method === "POST") {
      return this.runExclusive(() => this.handleApply(request));
    }
    if (url.pathname === "/finalize" && request.method === "POST") {
      return this.runExclusive(() => this.handleFinalize());
    }
    return json({ error: "not found" }, 404);
  }

  // ---- WebSocket (hibernation API) ----

  private async handleWs(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
    const email = url.searchParams.get("email") ?? "";
    if (!email) return json({ error: "forbidden" }, 403);
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ email });
    this.state.waitUntil(this.sendState(pair[1], email));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      const msg = JSON.parse(String(message));
      if (msg.t === "ping") ws.send(JSON.stringify({ t: "pong", now: Date.now() }));
    } catch {
      /* ignore junk */
    }
  }

  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}

  private async sendState(ws: WebSocket, email: string): Promise<void> {
    try {
      ws.send(JSON.stringify({ t: "state", state: await this.snapshotFor(email) }));
    } catch {
      /* socket already gone */
    }
  }

  private async broadcast(newEvents: NewEvent[]): Promise<void> {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;
    const snaps = new Map<string, unknown>();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as { email: string } | null;
      const email = att?.email;
      if (!email) continue;
      if (!snaps.has(email)) snaps.set(email, await this.snapshotFor(email));
      try {
        if (newEvents.length) ws.send(JSON.stringify({ t: "events", events: newEvents }));
        ws.send(JSON.stringify({ t: "state", state: snaps.get(email) }));
      } catch {
        /* dead socket; runtime reaps it */
      }
    }
  }

  // ---- shared context ----

  private async loadCtx(): Promise<Ctx> {
    const db = this.env.DB;
    const [c, u, p] = await db.batch([
      db.prepare("SELECT * FROM hard_challenge WHERE id = 1"),
      db.prepare("SELECT * FROM hard_users"),
      db.prepare("SELECT * FROM hard_participants"),
    ]);
    const users = new Map<string, UserRow>();
    for (const row of (u.results ?? []) as UserRow[]) users.set(row.email, row);
    const parts = new Map<string, Participant>();
    for (const row of (p.results ?? []) as Participant[]) parts.set(row.email, row);
    return {
      challenge: ((c.results ?? [])[0] as ChallengeRow | undefined) ?? null,
      users,
      parts,
      emails: coupleEmails(this.env.ALLOWED_EMAILS),
    };
  }

  private ev(email: string, type: string, payload: Record<string, unknown>, nowMs: number): NewEvent {
    return { id: crypto.randomUUID(), email, type, payload, created_at: new Date(nowMs).toISOString() };
  }

  private insertEvent(e: NewEvent): D1PreparedStatement {
    return this.env.DB
      .prepare("INSERT INTO hard_events (id, email, type, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(e.id, e.email, e.type, JSON.stringify(e.payload), e.created_at);
  }

  private upsertDay(d: DayRow): D1PreparedStatement {
    return this.env.DB.prepare(
      `INSERT INTO hard_days (email, date, diet, reading_done, pages, book_id,
         workout1_done, workout1_min, workout1_outdoor,
         workout2_done, workout2_min, workout2_outdoor,
         water_oz, photo_id, finalized, complete, day_number, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
       ON CONFLICT(email, date) DO UPDATE SET
         diet = excluded.diet, reading_done = excluded.reading_done,
         pages = excluded.pages, book_id = excluded.book_id,
         workout1_done = excluded.workout1_done, workout1_min = excluded.workout1_min,
         workout1_outdoor = excluded.workout1_outdoor,
         workout2_done = excluded.workout2_done, workout2_min = excluded.workout2_min,
         workout2_outdoor = excluded.workout2_outdoor,
         water_oz = excluded.water_oz, photo_id = excluded.photo_id,
         updated_at = excluded.updated_at
       WHERE hard_days.finalized = 0`,
    ).bind(
      d.email, d.date, d.diet, d.reading_done, d.pages, d.book_id,
      d.workout1_done, d.workout1_min, d.workout1_outdoor,
      d.workout2_done, d.workout2_min, d.workout2_outdoor,
      d.water_oz, d.photo_id, d.updated_at,
    );
  }

  // ---- finalization (lazy + cron) ----

  private async finalizeAll(nowMs: number): Promise<{ changed: boolean; events: NewEvent[]; pushes: PushIntent[] }> {
    const none = { changed: false, events: [] as NewEvent[], pushes: [] as PushIntent[] };
    const ctx = await this.loadCtx();
    if (!ctx.challenge || ctx.challenge.status !== "active") return none;

    const db = this.env.DB;
    const plans: { email: string; user: UserRow; part: Participant; plan: ReturnType<typeof planFinalize> }[] = [];
    for (const email of ctx.emails) {
      const part = ctx.parts.get(email);
      const user = ctx.users.get(email);
      if (!part || !user || part.completed_at) continue;
      const today = effectiveDate(nowMs, user.timezone, user.grace_minutes);
      const cursorStart = part.last_finalized_date ? nextDay(part.last_finalized_date) : part.streak_start_date;
      if (cursorStart >= today) continue;
      const { results } = await db
        .prepare("SELECT * FROM hard_days WHERE email = ? AND date >= ? AND date < ?")
        .bind(email, cursorStart, today).all<DayRow>();
      const map = new Map<string, DayRow>((results ?? []).map((r) => [r.date, r]));
      const plan = planFinalize(part, map, user.timezone, user.grace_minutes, nowMs);
      if (plan.steps.length) plans.push({ email, user, part, plan });
    }
    if (!plans.length) return none;

    const teamMode = ctx.challenge.mode === "team";
    const teamReset = teamMode && plans.some((p) => p.plan.resets.length > 0);
    const stmts: D1PreparedStatement[] = [];
    const events: NewEvent[] = [];
    const pushes: PushIntent[] = [];
    const completedNow = new Set<string>();

    for (const { email, part, plan } of plans) {
      for (const step of plan.steps) {
        stmts.push(db.prepare(
          `INSERT INTO hard_days (email, date, finalized, complete, day_number, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)
           ON CONFLICT(email, date) DO UPDATE SET
             finalized = 1, complete = excluded.complete, day_number = excluded.day_number
           WHERE hard_days.finalized = 0`,
        ).bind(email, step.date, step.complete ? 1 : 0, step.dayNumber, new Date(nowMs).toISOString()));
      }
      let completedAt = part.completed_at;
      if (plan.completed75) {
        completedAt = new Date(nowMs).toISOString();
        completedNow.add(email);
      }
      stmts.push(db.prepare(
        "UPDATE hard_participants SET streak_start_date = ?, last_finalized_date = ?, completed_at = ? WHERE email = ?",
      ).bind(plan.newStreakStart ?? part.streak_start_date, plan.lastFinalized ?? part.last_finalized_date, completedAt, email));

      for (const r of plan.resets) {
        events.push(this.ev(email, "reset", { date: r.date, dayNumber: r.dayNumber, missing: r.missing, team: teamReset }, nowMs));
      }
      for (const m of plan.milestones) events.push(this.ev(email, "milestone", { day: m }, nowMs));
      if (plan.completed75) events.push(this.ev(email, "milestone", { day: 75 }, nowMs));
    }

    // Team mode: any miss restarts BOTH partners at their current local day —
    // including a partner whose own plan already reset them, so the two
    // streak starts can never drift apart when both missed in the same pass.
    // These UPDATEs run after the per-plan ones in the same batch, so they win.
    if (teamReset) {
      for (const email of ctx.emails) {
        const part = ctx.parts.get(email);
        const user = ctx.users.get(email);
        if (!part || !user || part.completed_at || completedNow.has(email)) continue;
        const today = effectiveDate(nowMs, user.timezone, user.grace_minutes);
        stmts.push(db.prepare(
          "UPDATE hard_participants SET streak_start_date = ?, last_finalized_date = ? WHERE email = ?",
        ).bind(today, prevDay(today), email));
        const ownMiss = plans.some((p) => p.email === email && p.plan.resets.length > 0);
        if (!ownMiss) events.push(this.ev(email, "reset", { team: true, causedByPartner: true }, nowMs));
      }
    }

    const bothComplete =
      ctx.emails.length === 2 &&
      ctx.emails.every((e) => completedNow.has(e) || ctx.parts.get(e)?.completed_at);
    if (bothComplete) {
      stmts.push(db.prepare(
        "UPDATE hard_challenge SET status = 'complete', completed_at = ? WHERE id = 1",
      ).bind(new Date(nowMs).toISOString()));
      events.push(this.ev(ctx.emails[0], "challenge_complete", {}, nowMs));
      for (const email of ctx.emails) {
        pushes.push({ email, push: { type: "milestone", title: "You both made it! 🏆", body: "75 Hard complete. Your reward is unlocked." } });
      }
    }

    // Push intents from resets/milestones (recipient prefs filter at send time).
    const resetEvents = events.filter((e) => e.type === "reset");
    if (resetEvents.length) {
      for (const email of ctx.emails) {
        const ownReset = resetEvents.find((e) => e.email === email && !e.payload.causedByPartner);
        const user = ctx.users.get(email);
        if (!user) continue;
        const partnerName = displayNameFor(ctx.users.get(partnerOf(this.env.ALLOWED_EMAILS, email) ?? ""));
        let title: string, body: string;
        if (teamReset) {
          title = "You both restarted 💔";
          body = ownReset
            ? `Day ${ownReset.payload.dayNumber} ended incomplete. Team mode: back to Day 1 together.`
            : `${partnerName} missed a day. Team mode: back to Day 1 together.`;
        } else if (ownReset) {
          title = `Day ${ownReset.payload.dayNumber} ended incomplete`;
          body = `Missing: ${(ownReset.payload.missing as string[]).join(", ")}. Restarting at Day 1.`;
        } else if (resetEvents.some((e) => e.email !== email)) {
          title = `${partnerName} restarted at Day 1`;
          body = "Send some encouragement.";
        } else continue;
        pushes.push({ email, push: { type: "reset", title, body } });
      }
    }
    for (const e of events) {
      if (e.type !== "milestone") continue;
      const day = e.payload.day;
      pushes.push({ email: e.email, push: { type: "milestone", title: `Day ${day}! 🎉`, body: `You hit the Day ${day} milestone.` } });
      const partner = partnerOf(this.env.ALLOWED_EMAILS, e.email);
      if (partner) {
        const name = displayNameFor(ctx.users.get(e.email));
        pushes.push({ email: partner, push: { type: "milestone", title: `${name} hit Day ${day}! 🎉`, body: "Milestone reached." } });
      }
    }

    for (const e of events) stmts.push(this.insertEvent(e));
    await db.batch(stmts); // one atomic transaction — team resets touch both rows together
    return { changed: true, events, pushes };
  }

  private async handleFinalize(): Promise<Response> {
    const fin = await this.finalizeAll(Date.now());
    if (fin.changed) {
      await this.broadcast(fin.events);
      if (fin.pushes.length) this.state.waitUntil(sendPushes(this.env, fin.pushes));
    }
    return json({ changed: fin.changed });
  }

  // ---- apply (the single mutation path) ----

  private async handleApply(request: Request): Promise<Response> {
    const body = (await request.json()) as { email?: string; actions?: HardAction[] };
    const email = (body.email ?? "").toLowerCase();
    if (!email) return json({ error: "email required" }, 400);
    const nowMs = Date.now();

    const fin = await this.finalizeAll(nowMs);
    const events: NewEvent[] = [...fin.events];
    const pushes: PushIntent[] = [...fin.pushes];
    const results: ActionResult[] = [];

    const actions = (body.actions ?? []).slice(0, 100);
    if (actions.length) {
      const ctx = await this.loadCtx(); // reload: finalize may have moved streaks
      const user = ctx.users.get(email);
      if (!user) return json({ error: "unknown user" }, 400);
      const partnerEmail = partnerOf(this.env.ALLOWED_EMAILS, email);
      const myName = displayNameFor(user);

      for (const a of actions) {
        if (!a || typeof a.actionId !== "string" || !a.actionId) {
          results.push({ actionId: a?.actionId ?? "?", status: "rejected", error: "bad action" });
          continue;
        }
        const dupe = await this.env.DB
          .prepare("SELECT result FROM hard_actions WHERE action_id = ?")
          .bind(a.actionId).first<{ result: string | null }>();
        if (dupe) {
          results.push({ actionId: a.actionId, status: "duplicate" });
          continue;
        }
        const check = validateStamp(a, nowMs);
        if (!check.ok) {
          results.push({ actionId: a.actionId, status: "rejected", error: check.reason });
          continue;
        }

        const out = await this.applyOne(a, email, myName, partnerEmail, ctx, nowMs);
        if (out.events) events.push(...out.events);
        if (out.pushes) pushes.push(...out.pushes);
        results.push({ actionId: a.actionId, status: out.status, error: out.error });
      }
    }

    if (events.length || results.some((r) => r.status === "applied")) {
      await this.broadcast(events);
    }
    if (pushes.length) this.state.waitUntil(sendPushes(this.env, pushes));
    return json({ results, state: await this.snapshotFor(email) });
  }

  private async applyOne(
    a: HardAction,
    email: string,
    myName: string,
    partnerEmail: string | null,
    ctx: Ctx,
    nowMs: number,
  ): Promise<{ status: ActionResult["status"]; error?: string; events?: NewEvent[]; pushes?: PushIntent[] }> {
    const db = this.env.DB;
    const user = ctx.users.get(email)!;
    const part = ctx.parts.get(email) ?? null;
    const p = a.payload ?? {};
    const newEvents: NewEvent[] = [];
    const newPushes: PushIntent[] = [];
    const stmts: D1PreparedStatement[] = [];
    let status: ActionResult["status"] = "applied";

    // Rejected actions deliberately skip the ledger: rejections are pure
    // payload/stamp checks, so a replay deterministically re-rejects — and the
    // client clears its queue row on any ack status, so nothing retries anyway.
    const ledger = (result: string) =>
      db.prepare("INSERT OR IGNORE INTO hard_actions (action_id, email, type, result, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(a.actionId, email, a.type, result, new Date(nowMs).toISOString());

    if (DAY_ACTION_TYPES.has(a.type)) {
      const before =
        (await db.prepare("SELECT * FROM hard_days WHERE email = ? AND date = ?").bind(email, a.date).first<DayRow>()) ??
        emptyDay(email, a.date);
      if (before.finalized || !stampInWindow(a, user.grace_minutes)) {
        status = "late";
        newEvents.push(this.ev(email, "late_action", { type: a.type, date: a.date }, nowMs));
      } else {
        const after = applyDayAction(before, a);
        if (!after) return { status: "rejected", error: "bad payload" };
        after.updated_at = new Date(nowMs).toISOString();
        stmts.push(this.upsertDay(after));

        for (const task of taskTransitions(before, after)) {
          newEvents.push(this.ev(email, "task_done", { task, date: a.date }, nowMs));
          if (partnerEmail && !(!isDayComplete(before) && isDayComplete(after))) {
            newPushes.push({
              email: partnerEmail,
              push: { type: "partnerTask", title: `${myName}: ${TASK_LABELS[task] ?? task} ✓`, body: `Done for ${a.date}.`, tag: "hard75-partnerTask" },
            });
          }
        }
        if (!isDayComplete(before) && isDayComplete(after)) {
          const dayNumber = part ? dayNumberOf(part.streak_start_date, a.date) : 0;
          newEvents.push(this.ev(email, "day_complete", { date: a.date, dayNumber }, nowMs));
          if (partnerEmail) {
            newPushes.push({
              email: partnerEmail,
              push: { type: "partnerDay", title: `${myName} finished Day ${dayNumber}! ✅`, body: "All five tasks done." },
            });
          }
        }
      }
    } else {
      switch (a.type) {
        case "start_challenge": {
          const startDate = typeof p.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate) ? p.startDate : a.date;
          const mode = p.mode === "team" ? "team" : "solo";
          stmts.push(db.prepare(
            "INSERT INTO hard_challenge (id, mode, status) VALUES (1, ?, 'active') ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, status = 'active', completed_at = NULL",
          ).bind(mode));
          stmts.push(db.prepare(
            "INSERT OR REPLACE INTO hard_participants (email, start_date, streak_start_date, last_finalized_date, completed_at) VALUES (?, ?, ?, NULL, NULL)",
          ).bind(email, startDate, startDate));
          if (typeof p.timezone === "string" && p.timezone) {
            stmts.push(db.prepare("UPDATE hard_users SET timezone = ? WHERE email = ?").bind(p.timezone, email));
          }
          newEvents.push(this.ev(email, "start", { startDate, mode }, nowMs));
          break;
        }
        case "set_settings": {
          if (typeof p.timezone === "string" && p.timezone) {
            try {
              new Intl.DateTimeFormat("en-CA", { timeZone: p.timezone });
              stmts.push(db.prepare("UPDATE hard_users SET timezone = ? WHERE email = ?").bind(p.timezone, email));
            } catch {
              return { status: "rejected", error: "bad timezone" };
            }
          }
          if (p.graceMinutes != null) {
            const g = Math.min(720, Math.max(0, Math.round(Number(p.graceMinutes)) || 0));
            stmts.push(db.prepare("UPDATE hard_users SET grace_minutes = ? WHERE email = ?").bind(g, email));
          }
          if (p.prefs && typeof p.prefs === "object") {
            stmts.push(db.prepare("UPDATE hard_users SET prefs = ? WHERE email = ?").bind(JSON.stringify(p.prefs), email));
          }
          if (typeof p.displayName === "string") {
            stmts.push(db.prepare("UPDATE hard_users SET display_name = ? WHERE email = ?").bind(p.displayName.slice(0, 40), email));
          }
          break;
        }
        // set_mode / set_reward upsert the singleton row: during onboarding
        // they can arrive before start_challenge has created it.
        case "set_mode": {
          const mode = p.mode === "team" ? "team" : "solo";
          stmts.push(db.prepare(
            "INSERT INTO hard_challenge (id, mode) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode",
          ).bind(mode));
          newEvents.push(this.ev(email, "mode_change", { mode }, nowMs));
          break;
        }
        case "set_reward": {
          if (typeof p.text !== "string") return { status: "rejected", error: "bad reward" };
          stmts.push(db.prepare(
            "INSERT INTO hard_challenge (id, reward_text) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET reward_text = excluded.reward_text",
          ).bind(p.text.slice(0, 500)));
          newEvents.push(this.ev(email, "reward_set", {}, nowMs)); // payload deliberately empty: the reward stays sealed
          break;
        }
        case "add_book": {
          const id = typeof p.bookId === "string" ? p.bookId : typeof p.id === "string" ? p.id : "";
          if (!id || typeof p.title !== "string" || !p.title) return { status: "rejected", error: "bad book" };
          stmts.push(db.prepare(
            "INSERT OR REPLACE INTO hard_books (id, email, title, author, started_date, finished_date) VALUES (?, ?, ?, ?, ?, NULL)",
          ).bind(id, email, p.title.slice(0, 200), typeof p.author === "string" ? p.author.slice(0, 200) : null, a.date));
          break;
        }
        case "finish_book": {
          const id = typeof p.bookId === "string" ? p.bookId : typeof p.id === "string" ? p.id : "";
          if (!id) return { status: "rejected", error: "bad book" };
          stmts.push(db.prepare("UPDATE hard_books SET finished_date = ? WHERE id = ? AND email = ?").bind(a.date, id, email));
          break;
        }
        case "set_photo_shared": {
          if (typeof p.photoId !== "string" || !p.photoId) return { status: "rejected", error: "bad photo" };
          const shared = p.shared ? 1 : 0;
          stmts.push(db.prepare("UPDATE hard_photos SET shared = ? WHERE id = ? AND email = ?").bind(shared, p.photoId, email));
          if (shared) newEvents.push(this.ev(email, "photo_shared", { photoId: p.photoId, date: a.date }, nowMs));
          break;
        }
        case "react": {
          const emoji = typeof p.emoji === "string" ? [...p.emoji].slice(0, 4).join("") : "";
          if (!emoji) return { status: "rejected", error: "bad emoji" };
          const task = typeof p.task === "string" ? p.task : null;
          newEvents.push(this.ev(email, "reaction", { emoji, targetDate: p.targetDate ?? a.date, task }, nowMs));
          if (partnerEmail) {
            newPushes.push({
              email: partnerEmail,
              push: { type: "reaction", title: `${myName} reacted ${emoji}`, body: task ? `To your ${TASK_LABELS[task] ?? task}.` : "To your day." },
            });
          }
          break;
        }
        case "poke": {
          newEvents.push(this.ev(email, "poke", {}, nowMs));
          if (partnerEmail) {
            const pu = ctx.users.get(partnerEmail);
            let body = "Keep going!";
            if (pu) {
              const pToday = effectiveDate(nowMs, pu.timezone, pu.grace_minutes);
              const pDay = await db.prepare("SELECT * FROM hard_days WHERE email = ? AND date = ?").bind(partnerEmail, pToday).first<DayRow>();
              const missing = missingTasks(pDay);
              if (missing.length) body = `Still open: ${missing.slice(0, 3).join(", ")}`;
            }
            newPushes.push({ email: partnerEmail, push: { type: "poke", title: `${myName} poked you 👉`, body, tag: "hard75-poke" } });
          }
          break;
        }
        // Scale entry — not one of the five tasks, so no completion rules and
        // no late-window: back-filling yesterday's weigh-in is fine (the ±48h
        // stamp sanity check still applies). One row per day; a re-weigh
        // updates it, merging so weight-only doesn't erase fat % and vice versa.
        case "log_measurement": {
          const w = p.weightKg == null ? null : Math.round(Number(p.weightKg) * 100) / 100;
          const f = p.fatPct == null ? null : Math.round(Number(p.fatPct) * 10) / 10;
          if (w == null && f == null) return { status: "rejected", error: "empty measurement" };
          if (w != null && !(w >= 20 && w <= 300)) return { status: "rejected", error: "bad weight" };
          if (f != null && !(f >= 1 && f <= 75)) return { status: "rejected", error: "bad fat %" };
          const cur = await db
            .prepare("SELECT weight_kg, fat_pct FROM hard_measurements WHERE email = ? AND date = ?")
            .bind(email, a.date).first<{ weight_kg: number | null; fat_pct: number | null }>();
          stmts.push(db.prepare(
            "INSERT OR REPLACE INTO hard_measurements (email, date, weight_kg, fat_pct, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(email, a.date, w ?? cur?.weight_kg ?? null, f ?? cur?.fat_pct ?? null, new Date(nowMs).toISOString()));
          break;
        }
        case "reset": {
          // Client-side reset acknowledgement. Finalization is authoritative;
          // recording the ack in the ledger is all that's needed.
          break;
        }
        default:
          return { status: "rejected", error: "unknown action type" };
      }
    }

    stmts.push(ledger(status));
    for (const e of newEvents) stmts.push(this.insertEvent(e));
    await db.batch(stmts); // action + ledger + events commit atomically
    return { status, events: newEvents, pushes: newPushes };
  }

  // ---- snapshot ----

  private async snapshotFor(email: string): Promise<Record<string, unknown>> {
    const nowMs = Date.now();
    const db = this.env.DB;
    const ctx = await this.loadCtx();
    const user = ctx.users.get(email) ?? null;
    const part = ctx.parts.get(email) ?? null;
    const partnerEmail = partnerOf(this.env.ALLOWED_EMAILS, email);
    const pUser = partnerEmail ? ctx.users.get(partnerEmail) ?? null : null;
    const pPart = partnerEmail ? ctx.parts.get(partnerEmail) ?? null : null;

    const tz = user?.timezone ?? "UTC";
    const grace = user?.grace_minutes ?? 0;
    const today = effectiveDate(nowMs, tz, grace);
    const pToday = pUser ? effectiveDate(nowMs, pUser.timezone, pUser.grace_minutes) : null;

    const [daysQ, booksQ, photosQ, pDayQ, pPhotosQ, eventsQ, measQ, pMeasQ] = await db.batch([
      db.prepare("SELECT * FROM hard_days WHERE email = ? ORDER BY date DESC LIMIT 100").bind(email),
      db.prepare("SELECT * FROM hard_books WHERE email = ?").bind(email),
      db.prepare("SELECT id, date, shared FROM hard_photos WHERE email = ?").bind(email),
      db.prepare("SELECT * FROM hard_days WHERE email = ? AND date = ?").bind(partnerEmail ?? "", pToday ?? ""),
      db.prepare("SELECT id, date FROM hard_photos WHERE email = ? AND shared = 1").bind(partnerEmail ?? ""),
      db.prepare("SELECT * FROM hard_events ORDER BY created_at DESC LIMIT 50"),
      db.prepare("SELECT date, weight_kg, fat_pct FROM hard_measurements WHERE email = ? ORDER BY date DESC LIMIT 120").bind(email),
      db.prepare("SELECT date, weight_kg, fat_pct FROM hard_measurements WHERE email = ? ORDER BY date DESC LIMIT 120").bind(partnerEmail ?? ""),
    ]);
    const partnerShares = parsePrefs(pUser?.prefs).shareMeasurements === true;

    const days = (daysQ.results ?? []) as DayRow[];
    const todayRow = days.find((d) => d.date === today) ?? emptyDay(email, today);
    const photosByDate: Record<string, { id: string; shared: number }> = {};
    for (const ph of (photosQ.results ?? []) as { id: string; date: string; shared: number }[]) {
      photosByDate[ph.date] = { id: ph.id, shared: ph.shared };
    }
    const sharedPhotosByDate: Record<string, string> = {};
    for (const ph of (pPhotosQ.results ?? []) as { id: string; date: string }[]) {
      sharedPhotosByDate[ph.date] = ph.id;
    }
    const pDayRow = ((pDayQ.results ?? [])[0] as DayRow | undefined) ?? null;

    return {
      challenge: ctx.challenge
        ? {
            started: true,
            mode: ctx.challenge.mode,
            status: ctx.challenge.status,
            rewardSet: !!ctx.challenge.reward_text,
            rewardText: ctx.challenge.status === "complete" ? ctx.challenge.reward_text : null,
          }
        : { started: false, mode: "solo", status: "none", rewardSet: false, rewardText: null },
      me: {
        email,
        displayName: displayNameFor(user ?? { email }),
        timezone: tz,
        graceMinutes: grace,
        prefs: parsePrefs(user?.prefs),
        started: !!part,
        startDate: part?.start_date ?? null,
        streakStartDate: part?.streak_start_date ?? null,
        dayNumber: part && !part.completed_at ? dayNumberOf(part.streak_start_date, today) : part ? 75 : 0,
        completedAt: part?.completed_at ?? null,
        todayDate: today,
        today: todayRow,
        days,
        books: (booksQ.results ?? []) as BookRow[],
        photosByDate,
        measurements: (measQ.results ?? []) as { date: string; weight_kg: number | null; fat_pct: number | null }[],
      },
      partner: pUser
        ? {
            email: partnerEmail,
            displayName: displayNameFor(pUser),
            started: !!pPart,
            dayNumber: pPart && !pPart.completed_at ? dayNumberOf(pPart.streak_start_date, pToday!) : pPart ? 75 : 0,
            completedAt: pPart?.completed_at ?? null,
            todayDate: pToday,
            today: redactDay(pDayRow),
            updatedAt: pDayRow?.updated_at ?? null,
            sharedPhotosByDate,
            // weight/fat stay private unless the partner opted in
            measurements: partnerShares
              ? ((pMeasQ.results ?? []) as { date: string; weight_kg: number | null; fat_pct: number | null }[])
              : null,
          }
        : null,
      events: ((eventsQ.results ?? []) as { id: string; email: string; type: string; payload: string; created_at: string }[]).map((e) => ({
        ...e,
        payload: safeParse(e.payload),
      })),
      serverNow: nowMs,
      vapidPublicKey: this.env.VAPID_PUBLIC_KEY,
    };
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Partner sees task status, never private detail (notes, unshared photo ids).
function redactDay(d: DayRow | null) {
  return {
    diet: !!d?.diet,
    waterOz: d?.water_oz ?? 0,
    workout1: { done: !!(d && d.workout1_done && d.workout1_min >= 45), outdoor: !!d?.workout1_outdoor },
    workout2: { done: !!(d && d.workout2_done && d.workout2_min >= 45), outdoor: !!d?.workout2_outdoor },
    reading: !!d?.reading_done,
    photo: !!d?.photo_id,
    remaining: remainingCount(d),
    complete: isDayComplete(d),
  };
}

// Which of the five tasks flipped from unsatisfied → satisfied?
function taskTransitions(before: DayRow, after: DayRow): string[] {
  const out: string[] = [];
  if (!before.diet && after.diet) out.push("diet");
  if (before.water_oz < 128 && after.water_oz >= 128) out.push("water");
  const w = (d: DayRow, s: 1 | 2) =>
    s === 1 ? d.workout1_done && d.workout1_min >= 45 : d.workout2_done && d.workout2_min >= 45;
  if (!w(before, 1) && w(after, 1)) out.push("workout1");
  if (!w(before, 2) && w(after, 2)) out.push("workout2");
  if (!before.reading_done && after.reading_done) out.push("reading");
  if (!before.photo_id && after.photo_id) out.push("photo");
  return out;
}
