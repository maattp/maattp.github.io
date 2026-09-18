// LLM: chat with OpenRouter's free models. REST routes, mounted at /llm by
// index.ts (after cors — nothing here upgrades to a WebSocket).
//
// Two rules that must not bend:
//   - Free models only. OPENROUTER_API_KEY is a real key; if it ever holds
//     credits, a request naming a paid model would spend them. /chat checks the
//     requested model against the free list derived from OpenRouter's own
//     catalogue, and fails closed when that list can't be fetched.
//   - Conversations are keyed by the SESSION's email, never by anything in the
//     request, so each account sees only its own chats.

import { Hono } from "hono";
import { sessionEmail } from "./session.ts";

export type LlmBindings = {
  KV: KVNamespace;
  ALLOWED_EMAILS: string;
  OPENROUTER_API_KEY: string; // secret
};

type Variables = { email: string };

const OPENROUTER = "https://openrouter.ai/api/v1";
const CONV_PREFIX = "__llm:conv:";
const MODELS_TTL_MS = 10 * 60 * 1000;
export const MAX_REQUEST_CHARS = 8 * 1024 * 1024;
export const MAX_CONV_CHARS = 4 * 1024 * 1024;
export const CONV_ID_RE = /^[\w-]{8,64}$/;
const MODEL_ID_RE = /^[\w.:/@~+-]{1,150}$/;

export type FreeModel = {
  id: string;
  name: string;
  description: string;
  context: number;
  vision: boolean;
  reasoning: boolean;
  created: number;
};

type CatalogueModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  created?: unknown;
  pricing?: Record<string, unknown>;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
};

// Only a literal zero counts. Number("") and Number("  ") are 0 as well, so a
// blank price from a malformed catalogue entry must not read as free.
export const isZeroPrice = (p: unknown): boolean =>
  typeof p === "number" ? p === 0 : typeof p === "string" && /^0(\.0+)?$/.test(p.trim());

// Free means every price OpenRouter quotes is zero — not just the token prices.
// Usable means it answers in text only: music and image generators can carry
// zero token prices while billing per output, so text-only output is part of
// the free test, not a UI nicety.
export function freeModels(data: CatalogueModel[]): FreeModel[] {
  const out: FreeModel[] = [];
  for (const m of data) {
    if (typeof m.id !== "string" || !m.pricing) continue;
    if (m.pricing.prompt === undefined || m.pricing.completion === undefined) continue;
    if (!Object.values(m.pricing).every(isZeroPrice)) continue;
    const outputs = m.architecture?.output_modalities ?? ["text"];
    if (!outputs.length || !outputs.every((x) => x === "text")) continue;
    const params = m.supported_parameters ?? [];
    out.push({
      id: m.id,
      name: (typeof m.name === "string" ? m.name : m.id).replace(/\s*\(free\)\s*$/i, ""),
      description: typeof m.description === "string" ? m.description.slice(0, 400) : "",
      context: typeof m.context_length === "number" ? m.context_length : 0,
      vision: (m.architecture?.input_modalities ?? []).includes("image"),
      reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
      created: typeof m.created === "number" ? m.created : 0,
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

// Per-isolate memo: the catalogue is ~450 models and changes a few times a day.
let modelCache: { at: number; models: FreeModel[] } | null = null;

async function loadFreeModels(): Promise<FreeModel[]> {
  if (modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache.models;
  const res = await fetch(`${OPENROUTER}/models`);
  if (!res.ok) throw new Error(`models ${res.status}`);
  const body = (await res.json()) as { data?: CatalogueModel[] };
  const models = freeModels(body.data ?? []);
  modelCache = { at: Date.now(), models };
  return models;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user" | "assistant"; content: string | Part[] };
export type ChatRequest = { model: string; messages: Message[] };

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,/;

// Rebuilds the request from known fields only, so nothing the client adds
// (tools, provider routing, a max_price override…) reaches OpenRouter.
// Images must be inline data URLs: the worker never hands OpenRouter a URL to go fetch.
export function parseChat(body: unknown): ChatRequest | string {
  const b = body as { model?: unknown; messages?: unknown } | null;
  if (!b || typeof b.model !== "string" || !b.model) return "model required";
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > 1000) return "bad messages";
  const messages: Message[] = [];
  for (const raw of b.messages) {
    const m = raw as { role?: unknown; content?: unknown } | null;
    if (!m || (m.role !== "system" && m.role !== "user" && m.role !== "assistant")) return "bad role";
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role !== "user" || !Array.isArray(m.content) || m.content.length === 0) return "bad content";
    const parts: Part[] = [];
    for (const rawPart of m.content) {
      const p = rawPart as { type?: unknown; text?: unknown; image_url?: { url?: unknown } } | null;
      if (p?.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: p.text });
      else if (p?.type === "image_url" && typeof p.image_url?.url === "string" && IMAGE_DATA_URL.test(p.image_url.url)) {
        parts.push({ type: "image_url", image_url: { url: p.image_url.url } });
      } else return "bad content part";
    }
    messages.push({ role: "user", content: parts });
  }
  if (messages[messages.length - 1].role !== "user") return "last message must be from the user";
  return { model: b.model, messages };
}

export type ConvMeta = { title: string; updatedAt: number; model: string };

// Messages are the account's own opaque data (the app renders them sanitized),
// so only the fields that feed the KV metadata are checked.
export function parseConv(raw: string): { title: string; model: string; createdAt: number; messages: unknown[] } | string {
  let c: { title?: unknown; model?: unknown; createdAt?: unknown; messages?: unknown };
  try {
    c = JSON.parse(raw);
  } catch {
    return "bad json";
  }
  if (!c || typeof c !== "object" || !Array.isArray(c.messages)) return "bad conversation";
  // Both land in KV metadata, capped at 1024 bytes. The title is cut by code
  // point, never mid-surrogate; a lone surrogate serializes as a 6-byte \uXXXX,
  // so the worst case is 100 × 6. The model is client-supplied too, so it must
  // look like a model id rather than being truncated into a wrong one.
  const title = Array.from(typeof c.title === "string" ? c.title.trim() : "").slice(0, 100).join("") || "New chat";
  const model = typeof c.model === "string" && MODEL_ID_RE.test(c.model) ? c.model : "";
  const createdAt = typeof c.createdAt === "number" ? c.createdAt : Date.now();
  return { title, model, createdAt, messages: c.messages };
}

const convKey = (email: string, id: string) => `${CONV_PREFIX}${email}:${id}`;

const jsonError = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error, ...extra }), { status, headers: { "Content-Type": "application/json" } });

export const llmApp = new Hono<{ Bindings: LlmBindings; Variables: Variables }>();

llmApp.use("*", async (c, next) => {
  const email = await sessionEmail(c.env.KV, c.req.header("Authorization"), c.env.ALLOWED_EMAILS);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  c.set("email", email);
  await next();
});

llmApp.get("/me", (c) => c.json({ email: c.get("email") }));

llmApp.get("/models", async (c) => {
  try {
    return c.json({ models: await loadFreeModels() });
  } catch {
    return c.json({ error: "could not load models from OpenRouter" }, 502);
  }
});

// Free-model quota for the current UTC day (50/day, or 1000/day once the
// account has bought $10 of credits). The app asks on launch, on every
// foreground and after every reply; OpenRouter's own counter lags anyway, so a
// short per-isolate memo costs nothing. One entry: the quota belongs to the key,
// which every account shares.
let usageCache: { at: number; free: unknown } | null = null;
const USAGE_TTL_MS = 30 * 1000;

llmApp.get("/usage", async (c) => {
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: "OPENROUTER_API_KEY is not set" }, 503);
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return c.json({ free: usageCache.free });
  const res = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}` } });
  if (!res.ok) return c.json({ error: "usage unavailable" }, 502);
  const { data } = (await res.json()) as { data?: Record<string, unknown> };
  usageCache = { at: Date.now(), free: data?.free_model_daily_requests ?? null };
  return c.json({ free: usageCache.free });
});

llmApp.post("/chat", async (c) => {
  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: "OPENROUTER_API_KEY is not set" }, 503);
  const raw = await c.req.text();
  if (raw.length > MAX_REQUEST_CHARS) return c.json({ error: "request too large" }, 413);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const req = parseChat(body);
  if (typeof req === "string") return c.json({ error: req }, 400);

  let models: FreeModel[];
  try {
    models = await loadFreeModels();
  } catch {
    return c.json({ error: "could not confirm the model is free" }, 502);
  }
  if (!models.some((m) => m.id === req.model)) return c.json({ error: "not a free model" }, 400);

  const upstream = await fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://polkiewicz.com",
      "X-Title": "polkiewicz.com LLM",
    },
    body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.json().catch(() => null)) as { error?: { message?: string } } | null;
    // A 401/403 from OpenRouter means the worker's key is bad, not the caller's
    // session. Passing it through would make the app sign the user out.
    const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
    return jsonError(detail?.error?.message ?? `OpenRouter returned ${upstream.status}`, status, { upstream: upstream.status });
  }

  // Straight passthrough of the SSE stream; the app parses it. Mid-stream
  // failures arrive as an `error` object inside a data event, not a status.
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
  });
});

llmApp.get("/convs", async (c) => {
  const prefix = `${CONV_PREFIX}${c.get("email")}:`;
  const convs: (ConvMeta & { id: string })[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.KV.list<ConvMeta>({ prefix, cursor });
    for (const k of page.keys) if (k.metadata) convs.push({ id: k.name.slice(prefix.length), ...k.metadata });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  convs.sort((a, b) => b.updatedAt - a.updatedAt);
  return c.json({ convs });
});

llmApp.get("/convs/:id", async (c) => {
  const id = c.req.param("id");
  if (!CONV_ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const raw = await c.env.KV.get(convKey(c.get("email"), id));
  if (raw === null) return c.json({ error: "not found" }, 404);
  return new Response(raw, { headers: { "Content-Type": "application/json" } });
});

llmApp.put("/convs/:id", async (c) => {
  const id = c.req.param("id");
  if (!CONV_ID_RE.test(id)) return c.json({ error: "bad id" }, 400);
  const raw = await c.req.text();
  if (raw.length > MAX_CONV_CHARS) return c.json({ error: "conversation too large to save" }, 413);
  const conv = parseConv(raw);
  if (typeof conv === "string") return c.json({ error: conv }, 400);
  const updatedAt = Date.now();
  await c.env.KV.put(convKey(c.get("email"), id), JSON.stringify({ ...conv, id, updatedAt }), {
    metadata: { title: conv.title, updatedAt, model: conv.model } satisfies ConvMeta,
  });
  return c.json({ id, updatedAt });
});

llmApp.delete("/convs/:id", async (c) => {
  const id = c.req.param("id");
  if (!CONV_ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  await c.env.KV.delete(convKey(c.get("email"), id));
  return c.json({ deleted: true });
});
