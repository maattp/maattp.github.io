// LLM: chat with the free models of OpenRouter and the Gemini API. REST routes,
// mounted at /llm by index.ts (after cors — nothing here upgrades to a WebSocket).
//
// Two rules that must not bend:
//   - Free models only. OPENROUTER_API_KEY is a real key; if it ever holds
//     credits, a request naming a paid model would spend them. /chat checks the
//     requested model against the free list derived from OpenRouter's own
//     catalogue, and fails closed when that list can't be fetched. Gemini's API
//     reports no prices, so its free list is GEMINI_FREE_MODELS below.
//   - Conversations are keyed by the SESSION's email, never by anything in the
//     request, so each account sees only its own chats.

import { Hono } from "hono";
import { sessionEmail } from "./session.ts";

export type LlmBindings = {
  KV: KVNamespace;
  ALLOWED_EMAILS: string;
  OPENROUTER_API_KEY: string; // secret
  GEMINI_API_KEY?: string; // secret; unset → no Gemini models
};

type Variables = { email: string };

const OPENROUTER = "https://openrouter.ai/api/v1";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_PREFIX = "gemini:";
const SSE_HEADERS = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" };
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
  provider: "openrouter" | "gemini";
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
      provider: "openrouter",
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

// Gemini's API reports no prices, so free is this list: the text-chat models
// https://ai.google.dev/gemini-api/docs/pricing marks "Free of charge", each
// confirmed with a real free-tier request (2026-09-18). Newest first, which is
// the picker's order. Deliberately left out:
//   - the 2.5 series: priced free, but 404 "no longer available to new users"
//   - Pro and Omni: not on the free tier (429 with a zero quota)
//   - the -latest aliases and gemini-3.1-flash-lite-preview: duplicates whose
//     target changes underneath you
//   - image, TTS, Live, transcribe, robotics and computer-use models: not chat
// Before adding a model, confirm it answers on the free tier. There is no price
// to check at runtime, so this only stays free while the Google Cloud project
// has no billing account.
export const GEMINI_FREE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
];

type GeminiCatalogueModel = {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  inputTokenLimit?: unknown;
  thinking?: unknown;
  supportedGenerationMethods?: string[];
};

// What the key can list, narrowed to GEMINI_FREE_MODELS: a model Google retires
// drops out on its own; a newly free one has to be added above.
export function geminiFreeModels(data: GeminiCatalogueModel[]): FreeModel[] {
  const listed = new Map<string, GeminiCatalogueModel>();
  for (const m of data) {
    if (typeof m.name !== "string" || !m.supportedGenerationMethods?.includes("generateContent")) continue;
    listed.set(m.name.replace(/^models\//, ""), m);
  }
  const out: FreeModel[] = [];
  for (const id of GEMINI_FREE_MODELS) {
    const m = listed.get(id);
    if (!m) continue;
    const name = typeof m.displayName === "string" ? m.displayName : id;
    out.push({
      id: GEMINI_PREFIX + id,
      name,
      description: typeof m.description === "string" && m.description !== name ? m.description.slice(0, 400) : "",
      context: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : 0,
      vision: true, // every model on the list takes images
      reasoning: m.thinking === true,
      created: 0,
      provider: "gemini",
    });
  }
  return out;
}

// Per-isolate memos: each catalogue changes a few times a day at most.
let openRouterCache: { at: number; models: FreeModel[] } | null = null;
let geminiCache: { at: number; models: FreeModel[] } | null = null;

async function loadOpenRouterModels(): Promise<FreeModel[]> {
  if (openRouterCache && Date.now() - openRouterCache.at < MODELS_TTL_MS) return openRouterCache.models;
  const res = await fetch(`${OPENROUTER}/models`);
  if (!res.ok) throw new Error(`openrouter models ${res.status}`);
  const body = (await res.json()) as { data?: CatalogueModel[] };
  const models = freeModels(body.data ?? []);
  openRouterCache = { at: Date.now(), models };
  return models;
}

async function loadGeminiModels(key: string | undefined): Promise<FreeModel[]> {
  if (!key) return [];
  if (geminiCache && Date.now() - geminiCache.at < MODELS_TTL_MS) return geminiCache.models;
  const res = await fetch(`${GEMINI}/models?pageSize=500`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`gemini models ${res.status}`);
  const body = (await res.json()) as { models?: GeminiCatalogueModel[] };
  const models = geminiFreeModels(body.models ?? []);
  geminiCache = { at: Date.now(), models };
  return models;
}

// Gemini first (the picker's order). One provider being down must not hide the
// other; a provider whose list can't be fetched contributes no models, so /chat
// refuses its ids — fail closed. Only when both fail is there nothing to offer.
async function loadFreeModels(env: LlmBindings): Promise<FreeModel[]> {
  const [gemini, openrouter] = await Promise.allSettled([loadGeminiModels(env.GEMINI_API_KEY), loadOpenRouterModels()]);
  if (gemini.status === "rejected" && openrouter.status === "rejected") throw new Error("no model list available");
  return [
    ...(gemini.status === "fulfilled" ? gemini.value : []),
    ...(openrouter.status === "fulfilled" ? openrouter.value : []),
  ];
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

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type GeminiRequest = {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: GeminiPart[] }[];
};

// The app speaks OpenAI-style messages to both providers. Gemini takes system
// text separately and calls the assistant "model". Input comes from parseChat,
// so every image is already a known-good data URL.
export function toGemini(messages: Message[]): GeminiRequest {
  const system: string[] = [];
  const contents: GeminiRequest["contents"] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content) system.push(m.content);
      continue;
    }
    const parts: GeminiPart[] =
      typeof m.content === "string"
        ? [{ text: m.content }]
        : m.content.map((p) => {
            if (p.type === "text") return { text: p.text };
            const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(p.image_url.url)!;
            return { inlineData: { mimeType, data } };
          });
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return { ...(system.length ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } } : {}), contents };
}

type GeminiEvent = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number };
};

const GEMINI_FINISH: Record<string, string> = { STOP: "stop", MAX_TOKENS: "length" };

// One Gemini SSE event → the OpenRouter-shaped event(s) the app already parses,
// so the app has a single stream reader. Thought parts become `reasoning`;
// empty parts (Gemini's closing thoughtSignature) are dropped; a safety stop or
// a blocked prompt becomes an `error` event rather than a silent empty reply.
export function geminiEventToSse(ev: GeminiEvent): string {
  const out: string[] = [];
  const send = (o: unknown) => out.push(`data: ${JSON.stringify(o)}\n\n`);
  if (ev.error) send({ error: { message: ev.error.message ?? "Gemini returned an error.", code: ev.error.code } });
  if (ev.promptFeedback?.blockReason) send({ error: { message: `Gemini blocked this prompt (${ev.promptFeedback.blockReason}).` } });
  const cand = ev.candidates?.[0];
  if (!cand) return out.join("");
  let content = "", reasoning = "";
  for (const p of cand.content?.parts ?? []) {
    if (typeof p.text !== "string" || !p.text) continue;
    if (p.thought) reasoning += p.text;
    else content += p.text;
  }
  const reason = cand.finishReason && cand.finishReason !== "FINISH_REASON_UNSPECIFIED" ? cand.finishReason : undefined;
  const finish = reason ? GEMINI_FINISH[reason] : undefined;
  if (content || reasoning || finish) {
    send({ choices: [{ delta: { ...(content ? { content } : {}), ...(reasoning ? { reasoning } : {}) }, finish_reason: finish ?? null }] });
  }
  if (reason && !finish) send({ error: { message: `Gemini stopped the reply (${reason}).` } });
  return out.join("");
}

function geminiStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const emit = (line: string, ctrl: TransformStreamDefaultController<Uint8Array>) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    let ev: GeminiEvent;
    try {
      ev = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    const sse = geminiEventToSse(ev);
    if (sse) ctrl.enqueue(enc.encode(sse));
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          emit(buf.slice(0, nl), ctrl);
          buf = buf.slice(nl + 1);
        }
      },
      flush(ctrl) {
        emit(buf + dec.decode(), ctrl);
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      },
    }),
  );
}

type GoogleError = {
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string; retryDelay?: string }[] };
};

// Gemini's HTTP failures → what the app shows. A rejected key must not look
// like the caller's session failing (a 401 signs the user out), and a quota
// error is a wall of text whose one useful fact — when to retry — is in details.
export function geminiError(status: number, body: GoogleError | null): { status: number; error: string } {
  const e = body?.error;
  const details = e?.details ?? [];
  if (status === 401 || status === 403 || details.some((d) => d.reason === "API_KEY_INVALID")) {
    return { status: 502, error: "The worker's Gemini API key was rejected." };
  }
  if (status === 429) {
    const secs = parseFloat(details.find((d) => d.retryDelay)?.retryDelay ?? "");
    return {
      status,
      error: Number.isFinite(secs)
        ? `Gemini's free-tier limit for this model is used up. Try again in ${Math.ceil(secs)}s.`
        : "Gemini's free-tier limit for this model is used up. Daily limits reset at midnight Pacific.",
    };
  }
  return { status: status >= 400 ? status : 502, error: e?.message ?? `Gemini returned ${status}.` };
}

async function geminiChat(key: string, model: string, messages: Message[]): Promise<Response> {
  const upstream = await fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ ...toGemini(messages), generationConfig: { thinkingConfig: { includeThoughts: true } } }),
  });
  if (!upstream.ok || !upstream.body) {
    const { status, error } = geminiError(upstream.status, (await upstream.json().catch(() => null)) as GoogleError | null);
    return jsonError(error, status, { upstream: upstream.status });
  }
  return new Response(geminiStream(upstream.body), { headers: SSE_HEADERS });
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
    return c.json({ models: await loadFreeModels(c.env) });
  } catch {
    return c.json({ error: "could not load models" }, 502);
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
    models = await loadFreeModels(c.env);
  } catch {
    return c.json({ error: "could not confirm the model is free" }, 502);
  }
  const model = models.find((m) => m.id === req.model);
  if (!model) return c.json({ error: "not a free model" }, 400);

  if (model.provider === "gemini") {
    if (!c.env.GEMINI_API_KEY) return c.json({ error: "GEMINI_API_KEY is not set" }, 503);
    return geminiChat(c.env.GEMINI_API_KEY, model.id.slice(GEMINI_PREFIX.length), req.messages);
  }

  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: "OPENROUTER_API_KEY is not set" }, 503);
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
  return new Response(upstream.body, { headers: SSE_HEADERS });
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
