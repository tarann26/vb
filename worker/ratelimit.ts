// IP-keyed rate limiting, backed by KV rather than the Workers Rate
// Limiting binding. That binding cannot express what this needs: its
// `period` must be exactly 10 or 60 seconds (no 15-minute window), it
// counts per Cloudflare location rather than globally per IP, and it has no
// reset API -- there is no way to clear a counter the instant she logs in
// successfully. KV does all three.
//
// `checkRate`/`recordHit` below are the generic mechanism -- a plain
// count-with-TTL against whatever key the caller supplies. Login's own
// checkLoginRate/recordLoginFailure/clearLoginFailures (further down) are
// the first caller, keyed by `login:${ip}` with a 5-attempt/15-minute
// policy; POST /api/wa (worker/index.ts) is the second, keyed by `wa:${ip}`
// with its own, more generous policy -- an unauthenticated public button a
// real visitor might legitimately tap more than once is a different threat
// model than a password guess, so it gets its own numbers, not login's.
// Both share this one mechanism rather than each hand-rolling their own KV
// counter, which is the whole point of a second caller reusing this file
// instead of duplicating it.

async function hitCount(kv: KVNamespace, key: string): Promise<number> {
  return Number(await kv.get(key)) || 0;
}

// True when `key` is still under `max` recorded hits. Never mutates --
// callers check first, so a blocked key never causes whatever expensive or
// sensitive work the caller is guarding (a PBKDF2 hash, a KV write against
// today's tap counter) to run at all.
export async function checkRate(kv: KVNamespace, key: string, max: number): Promise<boolean> {
  return (await hitCount(kv, key)) < max;
}

// Records one hit against `key`, expiring after `windowSeconds` -- also
// comfortably above KV's own 60-second minimum expirationTtl, so this isn't
// relying on Cloudflare to silently round a shorter window up.
export async function recordHit(kv: KVNamespace, key: string, windowSeconds: number): Promise<void> {
  const n = await hitCount(kv, key);
  await kv.put(key, String(n + 1), { expirationTtl: windowSeconds });
}

export async function clearHits(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

// ---------------------------------------------------------------------------
// Login rate limiting: 5 attempts per 15 minutes, by IP only -- never by
// password. recordLoginFailure/checkLoginRate never see or touch the
// supplied password, only the caller's IP string.
// ---------------------------------------------------------------------------

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 900; // 15 minutes.

function loginKeyFor(ip: string): string {
  return `login:${ip}`;
}

// True when this IP is still allowed to attempt a login. Checked before the
// password is ever touched, so a blocked IP never causes a PBKDF2 hash to
// run at all.
export async function checkLoginRate(kv: KVNamespace, ip: string): Promise<boolean> {
  return checkRate(kv, loginKeyFor(ip), LOGIN_MAX_ATTEMPTS);
}

export async function recordLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
  await recordHit(kv, loginKeyFor(ip), LOGIN_WINDOW_SECONDS);
}

export async function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void> {
  await clearHits(kv, loginKeyFor(ip));
}
