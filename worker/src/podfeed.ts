// Ad-free podcasts: pure helpers (no bindings), so test/podcasts.test.mjs can
// import them directly. Used by podroom.ts (the DO) and podcasts.ts (routes).
//
// The Mac mini (podcast_experiment/service/podcastd.py) downloads episodes,
// cuts the ads out, and uploads the result to the PODCASTS R2 bucket. This file
// owns the two rules that must not bend:
//   - The bucket never holds more than CAP_BYTES. planEviction() decides what
//     to delete before an upload is allowed to start; the DO enforces it.
//   - The feed is private. It is served only under an unguessable token
//     (tokenEquals is constant-time) and carries <itunes:block>.

export const CAP_BYTES = 5_000_000_000; // 5 GB, half of R2's 10 GB free tier
export const PART_BYTES = 32 * 1024 * 1024; // multipart part size the Mac uses (R2 needs equal parts)
export const MAX_PART_BYTES = 64 * 1024 * 1024; // Workers cap request bodies at 100 MB
export const EP_KEY_RE = /^ep\/[a-f0-9]{16}\.mp3$/;
export const ID_RE = /^[a-f0-9]{8,16}$/;

export type Cut = {
  start: number; // seconds in the ORIGINAL file
  end: number;
  kind: string; // inserted | sponsor | promo
  advertiser?: string;
  source: string; // bitstream | chapters | llm
};

export type Sub = {
  id: string;
  feedUrl: string;
  title?: string;
  author?: string;
  artwork?: string;
  link?: string;
  addedAt: number;
  error?: string | null;
  checkedAt?: number;
};

export type Episode = {
  id: string;
  subId: string;
  show: string;
  guid: string;
  title: string;
  pubDate: string; // ISO 8601
  description: string; // HTML from the original feed (trimmed)
  link?: string;
  image?: string;
  originalUrl: string;
  key: string; // R2 key, ep/<id>.mp3
  bytes: number;
  duration: number; // seconds, after cuts
  originalDuration: number;
  removed: Cut[];
  marked: Cut[]; // low-confidence ad candidates left in, marked with an "Ad?" chapter
  addedAt: number;
};

export function tokenEquals(presented: string, expected: string): boolean {
  if (!expected) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- storage cap ----------

export type EvictionPlan = {
  evict: string[]; // episode ids to delete (oldest first)
  orphans: string[]; // ep/ objects no episode points at (and not mid-upload)
  missing: string[]; // episode ids whose object is gone
  total: number; // bytes in the bucket after orphans + evictions, plus reserved
  ok: boolean; // total + incoming <= cap
};

export function planEviction(p: {
  objects: { key: string; size: number }[];
  episodes: { id: string; key: string; pubDate: string; addedAt: number }[];
  reserved: number; // bytes promised to in-flight uploads
  pendingKeys: Set<string>;
  incoming: number;
  cap: number;
}): EvictionPlan {
  const byKey = new Map(p.objects.map((o) => [o.key, o.size]));
  const epKeys = new Set(p.episodes.map((e) => e.key));
  const orphans = p.objects
    .filter((o) => o.key.startsWith("ep/") && !epKeys.has(o.key) && !p.pendingKeys.has(o.key))
    .map((o) => o.key);
  const orphanSet = new Set(orphans);
  const missing = p.episodes.filter((e) => !byKey.has(e.key)).map((e) => e.id);
  let total = p.reserved;
  for (const o of p.objects) if (!orphanSet.has(o.key)) total += o.size;
  const live = p.episodes
    .filter((e) => byKey.has(e.key))
    .sort((a, b) => a.pubDate.localeCompare(b.pubDate) || a.addedAt - b.addedAt);
  const evict: string[] = [];
  for (const e of live) {
    if (total + p.incoming <= p.cap) break;
    // An in-flight re-upload of the same key replaces this object; it is not reclaimable twice.
    evict.push(e.id);
    total -= byKey.get(e.key) ?? 0;
  }
  return { evict, orphans, missing, total, ok: total + p.incoming <= p.cap };
}

// ---------- HTTP byte ranges (podcast apps seek and resume with these) ----------

export type ByteRange = { offset: number; length: number };

// null = no usable Range header (serve the whole object); "unsatisfiable" = 416.
// Only single ranges are supported; a multi-range request gets the whole file,
// which RFC 9110 allows.
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "unsatisfiable";
    const len = Math.min(n, size);
    return { offset: size - len, length: len };
  }
  const start = Number(a);
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
}

// ---------- RSS ----------

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function cdata(s: string): string {
  return "<![CDATA[" + s.replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function rfc822(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
}

export function episodeSummary(e: Episode): string {
  const cut = e.removed.reduce((s, c) => s + (c.end - c.start), 0);
  const n = e.removed.length;
  const parts = [n ? `Ads removed: ${n} break${n === 1 ? "" : "s"} (${fmtClock(cut)}).` : "No ads found."];
  if (e.marked.length) parts.push(`${e.marked.length} possible ad${e.marked.length === 1 ? "" : "s"} left in, marked with an “Ad?” chapter.`);
  return parts.join(" ");
}

// Where things are in the TRIMMED file. Cuts are stored in original-file time;
// a cut's position in the new file is its start minus everything cut before it.
export function toNewTime(t: number, removed: Cut[]): number {
  let shift = 0;
  for (const c of [...removed].sort((a, b) => a.start - b.start)) {
    if (t >= c.end) shift += c.end - c.start;
    else if (t > c.start) return c.start - shift;
  }
  return t - shift;
}

export type Spot = { at: number; seconds: number; label: string };

export function breakSpots(e: Pick<Episode, "removed" | "marked">): { removed: Spot[]; marked: Spot[] } {
  const label = (c: Cut) => c.advertiser || (c.kind === "promo" ? "promo" : c.kind === "inserted" ? "inserted ad" : "sponsor");
  const spot = (c: Cut): Spot => ({ at: toNewTime(c.start, e.removed), seconds: c.end - c.start, label: label(c) });
  return {
    removed: [...e.removed].sort((a, b) => a.start - b.start).map(spot),
    marked: [...e.marked].sort((a, b) => a.start - b.start).map(spot),
  };
}

export function breakListHtml(e: Pick<Episode, "removed" | "marked">): string {
  const { removed, marked } = breakSpots(e);
  const li = (s: Spot, what: string) =>
    `<li>${fmtClock(s.at)} · ${escapeXml(s.label)} · ${what} ${fmtClock(s.seconds)}</li>`;
  let html = "";
  if (removed.length) html += `<p>Ads removed (times are in this edited file):</p><ul>${removed.map((s) => li(s, "cut")).join("")}</ul>`;
  if (marked.length) html += `<p>Possible ads left in, marked “Ad?”:</p><ul>${marked.map((s) => li(s, "length")).join("")}</ul>`;
  return html;
}

export function buildFeed(p: { base: string; episodes: Episode[]; subs: Sub[]; hasCover: boolean }): string {
  const shows = p.subs.map((s) => s.title || s.feedUrl).join(", ");
  const items = [...p.episodes]
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate))
    .map((e) => {
      const html =
        `<p><b>${escapeXml(e.show)}</b> · ${escapeXml(episodeSummary(e))} ` +
        `<a href="${escapeXml(e.originalUrl)}">Original audio</a></p>` + breakListHtml(e) + "<hr>" + e.description;
      return [
        "<item>",
        `<title>${escapeXml(`${e.show}: ${e.title}`)}</title>`,
        `<guid isPermaLink="false">adfree:${e.id}</guid>`,
        `<pubDate>${rfc822(e.pubDate)}</pubDate>`,
        `<enclosure url="${escapeXml(`${p.base}/ep/${e.id}.mp3`)}" length="${e.bytes}" type="audio/mpeg"/>`,
        `<itunes:duration>${Math.round(e.duration)}</itunes:duration>`,
        `<itunes:author>${escapeXml(e.show)}</itunes:author>`,
        e.link ? `<link>${escapeXml(e.link)}</link>` : "",
        e.image ? `<itunes:image href="${escapeXml(e.image)}"/>` : "",
        `<description>${cdata(html)}</description>`,
        `<content:encoded>${cdata(html)}</content:encoded>`,
        "</item>",
      ].filter(Boolean).join("\n");
    });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">`,
    "<channel>",
    "<title>Ad-Free Podcasts</title>",
    "<link>https://polkiewicz.com/apps/podcasts/</link>",
    "<language>en</language>",
    `<description>${escapeXml(`Private feed. Ads cut out on Matt's Mac mini. Shows: ${shows || "none yet"}.`)}</description>`,
    "<itunes:author>Ad-Free Podcasts</itunes:author>",
    "<itunes:block>Yes</itunes:block>",
    "<itunes:explicit>false</itunes:explicit>",
    p.hasCover ? `<itunes:image href="${escapeXml(p.base + "/cover.png")}"/>` : "",
    p.hasCover ? `<image><url>${escapeXml(p.base + "/cover.png")}</url><title>Ad-Free Podcasts</title><link>https://polkiewicz.com/apps/podcasts/</link></image>` : "",
    ...items,
    "</channel>",
    "</rss>",
  ].filter(Boolean).join("\n");
}

// ---------- validation of what the Mac sends ----------

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;

function cuts(v: unknown): Cut[] | null {
  if (!Array.isArray(v) || v.length > 100) return null;
  const out: Cut[] = [];
  for (const c of v) {
    const start = num(c?.start, 0, 1e6), end = num(c?.end, 0, 1e6);
    if (start === null || end === null || end < start) return null;
    out.push({ start, end, kind: str(c.kind, 20) ?? "ad", advertiser: str(c.advertiser, 100), source: str(c.source, 20) ?? "" });
  }
  return out;
}

// Returns null if the record is malformed. bytes/key/addedAt are filled in by the DO.
export function parseEpisode(v: any): Omit<Episode, "bytes" | "key" | "addedAt"> | null {
  if (!v || typeof v !== "object") return null;
  const id = str(v.id, 16), subId = str(v.subId, 16);
  if (!id || !/^[a-f0-9]{16}$/.test(id) || !subId || !ID_RE.test(subId)) return null;
  const duration = num(v.duration, 0, 1e6), originalDuration = num(v.originalDuration, 0, 1e6);
  const removed = cuts(v.removed), marked = cuts(v.marked ?? []);
  const pubDate = str(v.pubDate, 40);
  if (duration === null || originalDuration === null || !removed || !marked || !pubDate || isNaN(Date.parse(pubDate))) return null;
  const originalUrl = str(v.originalUrl, 2000) ?? "";
  if (!/^https?:\/\//.test(originalUrl)) return null;
  return {
    id, subId, duration, originalDuration, removed, marked,
    pubDate: new Date(pubDate).toISOString(),
    show: str(v.show, 200) ?? "",
    guid: str(v.guid, 500) ?? "",
    title: str(v.title, 500) ?? "",
    description: str(v.description, 20000) ?? "",
    link: str(v.link, 2000),
    image: str(v.image, 2000),
    originalUrl,
  };
}

export function normalizeFeedUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
