// Login rate limiting, backed by KV rather than the Workers Rate Limiting
// binding. That binding cannot express what this needs: its `period` must
// be exactly 10 or 60 seconds (no 15-minute window), it counts per
// Cloudflare location rather than globally per IP, and it has no reset API
// -- there is no way to clear a counter the instant she logs in
// successfully. KV does all three.
//
// Limits by IP only, never by password -- recordLoginFailure/checkLoginRate
// never see or touch the supplied password, only the caller's IP string.

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900; // 15 minutes. Also comfortably above KV's own
// 60-second minimum expirationTtl, so this isn't relying on Cloudflare to
// silently round it up.

function keyFor(ip: string): string {
  return `login:${ip}`;
}

async function failureCount(kv: KVNamespace, ip: string): Promise<number> {
  return Number(await kv.get(keyFor(ip))) || 0;
}

// True when this IP is still allowed to attempt a login. Checked before the
// password is ever touched, so a blocked IP never causes a PBKDF2 hash to
// run at all.
export async function checkLoginRate(kv: KVNamespace, ip: string): Promise<boolean> {
  return (await failureCount(kv, ip)) < MAX_ATTEMPTS;
}

export async function recordLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
  const n = await failureCount(kv, ip);
  await kv.put(keyFor(ip), String(n + 1), { expirationTtl: WINDOW_SECONDS });
}

export async function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(keyFor(ip));
}
