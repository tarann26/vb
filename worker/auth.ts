// Password hashing (PBKDF2-SHA256) and signed session tokens (HMAC-SHA256)
// for the admin Worker's single shared-password login. Deliberately typed
// against `@cloudflare/workers-types` (tsconfig.worker.json), so `crypto`,
// `btoa`/`atob` and `TextEncoder` here are the real WebCrypto globals, not a
// polyfill -- and, under this repo's jsdom Vitest environment, they come
// from Node itself (see vitest.config.ts's comment), not from jsdom.
//
// One deliberate omission: `crypto.subtle.timingSafeEqual`. It is a
// Cloudflare-only, non-standard extension to SubtleCrypto, present in
// neither Node's WebCrypto nor jsdom -- calling it here would be `undefined
// is not a function` in every test run. `timingSafeEqual` below is a
// hand-rolled XOR accumulator instead, which works identically in workerd
// and in this test environment.

// ---------------------------------------------------------------------------
// Byte <-> base64 helpers. Not base64url: the token format below splits on
// `.`, and standard base64's alphabet (A-Za-z0-9+/=) never contains `.`, so
// there is no ambiguity to avoid by switching alphabets.
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// timingSafeEqual: hand-rolled, see the file comment above for why.
// XOR-accumulates over every character of both strings; never short-circuits
// on the first mismatch, so how much of a guess is correct cannot be
// inferred from how long the comparison takes. Length is checked first and
// can return early: it is not attacker-derived secret material here (every
// value compared against is a fixed-size base64-encoded 32-byte HMAC-SHA256
// digest, or a stored salt/hash pulled from a hash the attacker already
// doesn't control), so branching on length leaks nothing that isn't already
// public.
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// PBKDF2 password hashing. Format: pbkdf2$<iterations>$<saltB64>$<hashB64>.
// The iteration count travels with the hash (not just a constant elsewhere)
// so a future rehash at a different cost doesn't invalidate the stored value
// for verification purposes -- verifyPassword always uses whatever count is
// written into the string it's checking, not PBKDF2_ITERATIONS below.
// ---------------------------------------------------------------------------

// Measured under real workerd, not guessed: `wrangler dev --local` runs
// Miniflare on the actual Workers runtime, and Workers Free allows only
// 10ms CPU per invocation. Timed crypto.subtle.deriveBits(..., 256)
// directly against a throwaway route on this Worker, 10 runs each, three
// costs:
//   25,000 iterations:  avg 2.07ms, max 3ms  (10ms / 3ms  ~= 3.33x margin)
//   50,000 iterations:  avg 3.97ms, max 5ms  (10ms / 5ms  =  2.0x  margin)
//  100,000 iterations:  avg 7.4ms,  max 8ms  (10ms / 8ms  ~= 1.25x margin)
// Only 25,000 clears the "at least 3x margin under 10ms" bar this task
// requires -- 50k and 100k would return Error 1102 (CPU limit exceeded) on
// a real Workers Free login often enough to matter. Local timing is not
// production timing (this is exactly why the margin is this large, not
// because 3.33x is generous), and the spec's own threat model says the
// realistic threat here is defacement with a `git revert` recovery, not a
// nation-state cracking this hash offline -- a login that reliably
// completes beats a slower one that sometimes 500s.
//
// Correction: an earlier version of this comment additionally claimed
// "workerd hard-caps PBKDF2 at 100,000 iterations." That's false -- a
// security review independently measured 1,000,000 iterations under this
// same `wrangler dev --local` setup: 79ms, no error, no cap enforced.
// 25,000 is still the right number; the 10ms-CPU-budget/3x-margin
// reasoning above justifies it on its own and never depended on a cap
// existing.
const PBKDF2_ITERATIONS = 25_000;
const SALT_BYTES = 16;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(supplied: string, stored: string): Promise<boolean> {
  // Never throws: a malformed stored value (corrupted secret, wrong format)
  // must fail closed, not crash the login route into a 500 that could leak
  // more than a clean 401 would.
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    // `iterations` is parsed out of `stored` (env.ADMIN_PASSWORD_HASH), a
    // server-set secret written by scripts/hash-password.mjs -- never out
    // of anything the request supplies. An attacker controls only
    // `supplied`, so there is no attacker-controlled-iteration-count DoS to
    // defend against by bounding this number, the way there would be if
    // this string arrived in a request body instead of a secret.
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    const salt = base64ToBytes(parts[2]);
    const expectedB64 = parts[3];
    const candidate = await pbkdf2(supplied, salt, iterations);
    return timingSafeEqual(bytesToBase64(candidate), expectedB64);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signed session tokens: `<payloadB64>.<sigB64>`, HMAC-SHA256 over the
// payload. Verification checks the signature FIRST, before ever parsing the
// payload as JSON or looking at `exp` -- see verifyToken below for why that
// order is the entire point.
// ---------------------------------------------------------------------------

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToBase64(new Uint8Array(signature));
}

// The signing key is TOKEN_SECRET **bound to the current password hash**, not
// TOKEN_SECRET alone. That one detail is what makes changing the password
// revoke every session already issued.
//
// Without it, a session cookie's validity came entirely from an HMAC over
// TOKEN_SECRET, and the token's payload (`{exp}`) said nothing about which
// password produced it -- so rotating ADMIN_PASSWORD_HASH left every
// outstanding 7-day cookie working. The failure that matters: someone gets in,
// the owner changes the password to lock them out, and the attacker keeps full
// write access to the site's GitHub repo for up to another week. Changing your
// password and not being logged out is not a behaviour any human expects, and
// the old runbook's answer -- "rotate TOKEN_SECRET too, in the same sitting"
// -- only worked for someone who knew to read it first.
//
// Binding costs nothing: the hash is already in `env`, it is already a
// high-entropy string, no extra byte goes into the cookie, no storage is
// added, and verification stays a single HMAC with no lookup. `\u0000` as the
// separator so a hash and a secret can never be concatenated two different
// ways into the same key.
function sessionKey(secret: string, passwordHash: string): string {
  return `${secret}\u0000${passwordHash}`;
}

export async function signToken(secret: string, passwordHash: string, expiresAt: number): Promise<string> {
  const payloadB64 = btoa(JSON.stringify({ exp: expiresAt }));
  const sigB64 = await hmac(sessionKey(secret, passwordHash), payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export async function verifyToken(
  secret: string,
  passwordHash: string,
  token: string,
  now: number,
): Promise<boolean> {
  // Exactly two segments, not "at least two": `token.split('.')` alone
  // would destructure only the first two elements and silently ignore any
  // more, so `<payload>.<sig>.` and `<payload>.<sig>.evil` would both
  // verify identically to `<payload>.<sig>`. No privilege gain today (an
  // attacker still needs a valid token to append to), but it means one
  // session would have unbounded string representations -- a problem the
  // moment anything downstream uses the raw cookie string as a lookup or
  // revocation-list key, where string-keyed revocation becomes trivially
  // evadable by appending garbage.
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  // `!secret` first: `crypto.subtle.importKey` rejects a zero-length raw
  // HMAC key with an unhandled `DataError`, not a returned failure -- an
  // unset or empty TOKEN_SECRET would otherwise make this function throw
  // instead of failing closed, which is the wrong shape for an auth gate
  // (the moment a caller wraps it in a try/catch expecting only `boolean`,
  // a misconfigured secret becomes fail-open in whatever that catch does).
  if (!secret || !passwordHash || !payloadB64 || !sigB64) return false;

  // Signature FIRST, on principle: a scheme that parses the payload (or
  // checks `exp`) before verifying the signature trusts attacker-controlled
  // bytes before establishing they came from this server at all. Whole-branch
  // review, M6: an earlier version of this comment went further and claimed
  // auth.test.ts's tampered-payload test ("rejects a token whose payload was
  // edited to extend it") proves THIS ORDERING specifically. It doesn't --
  // checked directly. That test's tampered token carries the ORIGINAL
  // signature (computed over the original payload) attached to an EDITED
  // payload, so the HMAC comparison fails no matter when it runs: a
  // hypothetical expiry-then-signature reordering would check `exp` first
  // (attacker set it to something huge, so that check alone would pass), but
  // then still runs the same signature check afterward and gets the same
  // mismatch, landing on the same `false`. What that test actually proves is
  // that a signature check exists and is correct, not that it runs before
  // the expiry check -- reordering the two is observationally equivalent as
  // far as this suite can tell. The ordering here is real defense-in-depth
  // (don't act on unverified bytes at all, not even to read `exp` off them),
  // it just isn't what this specific test demonstrates.
  const expectedSig = await hmac(sessionKey(secret, passwordHash), payloadB64);
  if (!timingSafeEqual(expectedSig, sigB64)) return false;

  try {
    const parsed: unknown = JSON.parse(atob(payloadB64));
    const exp = (parsed as { exp?: unknown }).exp;
    // Number.isFinite, not just typeof: a raw payload of `{"exp":1e400}` is
    // valid JSON syntax (a number literal with a huge exponent) that
    // overflows to `Infinity` on parse -- `typeof Infinity === 'number'`
    // and `Infinity > now` is always true, so without this check such a
    // payload would never expire. Only server-mintable in practice --
    // `signToken` builds its payload with `JSON.stringify`, which turns a
    // non-finite `exp` into `null` long before signing, so this can't
    // happen through the one public token-minting path today -- but
    // `verifyToken` shouldn't depend on every future signer getting that
    // right. Defence in depth, not a live exploit.
    return typeof exp === 'number' && Number.isFinite(exp) && exp > now;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cookie header parsing.
// ---------------------------------------------------------------------------

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}
