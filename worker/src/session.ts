// Session -> email resolution shared by /chat and /hard. One place owns the
// semantics that matter: the allowlist is re-checked on EVERY request, so
// removing an email from ALLOWED_EMAILS locks out live sessions immediately.

const SESSION_PREFIX = "__session:";

export async function sessionEmail(
  kv: KVNamespace,
  authHeader: string | undefined,
  allowedEmails: string,
): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const email = await kv.get(`${SESSION_PREFIX}${authHeader.slice(7)}`);
  if (!email) return null;
  const lower = email.toLowerCase();
  const allowed = allowedEmails.split(",").map((e) => e.trim().toLowerCase());
  return allowed.includes(lower) ? lower : null;
}

// Fixed-time bearer compare, shared by the ring relay and Claude's chat
// credential. Folds length into the accumulator rather than returning early,
// so neither the token's length nor the first differing byte is timeable.
function tokenMatches(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function authorized(header: string | undefined, expected: string): boolean {
  if (!expected) return false; // secret unset — fail closed, never open
  const m = /^Bearer (.+)$/.exec(header ?? "");
  return m ? tokenMatches(m[1], expected) : false;
}
