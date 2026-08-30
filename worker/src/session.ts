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
