import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signToken, verifyToken, parseCookie } from '../auth';

// Runs under this repo's single jsdom Vitest environment (see
// vitest.config.ts's comment). crypto.subtle's standard methods (importKey,
// deriveBits, sign) come from Node itself, not jsdom, so this is a faithful
// test of the real WebCrypto behaviour even though it isn't running inside
// workerd. crypto.subtle.timingSafeEqual is undefined in this environment
// (Cloudflare-only extension) -- auth.ts must never call it.

const SECRET = 'test-secret-not-a-real-one';

describe('signToken / verifyToken', () => {
  it('accepts a token it just signed', async () => {
    expect(await verifyToken(SECRET, await signToken(SECRET, 2_000_000), 1_000_000)).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    expect(await verifyToken(SECRET, await signToken('other', 2_000_000), 1_000_000)).toBe(false);
  });

  it('rejects an expired token', async () => {
    expect(await verifyToken(SECRET, await signToken(SECRET, 1_000_000), 1_000_001)).toBe(false);
  });

  // Boundary: the pseudocode in the brief is `exp > now`, not `exp >= now`
  // -- a token expires the instant `now` reaches its `exp`, not one second
  // later.
  it('rejects a token whose exp equals now (expiry is exclusive)', async () => {
    expect(await verifyToken(SECRET, await signToken(SECRET, 1_000_000), 1_000_000)).toBe(false);
  });

  // The test that matters most. A scheme that checks expiry before the
  // signature, or trusts the payload it just parsed, passes every other
  // test in this file and is trivially forgeable: an attacker who can see
  // one valid (expired or not) token can read its signature, mint any
  // payload they like, and reuse that signature verbatim.
  it('rejects a token whose payload was edited to extend it', async () => {
    const token = await signToken(SECRET, 1_000_000);
    const tampered =
      btoa(JSON.stringify({ exp: 9_999_999 })).replace(/=+$/, '') + '.' + token.split('.')[1];
    expect(tampered).not.toBe(token);
    expect(await verifyToken(SECRET, tampered, 1_000_001)).toBe(false);
  });

  it('rejects a token with no signature at all', async () => {
    expect(await verifyToken(SECRET, btoa(JSON.stringify({ exp: 9_999_999 })), 1)).toBe(false);
  });

  it('rejects an empty string', async () => {
    expect(await verifyToken(SECRET, '', 1)).toBe(false);
  });

  it('rejects garbage that merely contains a dot', async () => {
    expect(await verifyToken(SECRET, 'not-base64.also-not-base64', 1)).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password through the real hash and verify', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('Correct Horse', stored)).toBe(false);
  });

  it('produces a different hash each time, so the salt is real', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('produces the documented pbkdf2$<iterations>$<saltB64>$<hashB64> format', async () => {
    const stored = await hashPassword('whatever');
    expect(stored).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('returns false rather than throwing for a malformed stored hash', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'pbkdf2$notanumber$abc$def')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });
});

describe('parseCookie', () => {
  it('finds the named cookie among several', () => {
    expect(parseCookie('a=1; vb_session=xyz; b=2', 'vb_session')).toBe('xyz');
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    expect(parseCookie('not_vb_session=xyz', 'vb_session')).toBeNull();
  });

  it('returns null for a missing header', () => {
    expect(parseCookie(null, 'vb_session')).toBeNull();
  });

  it('returns null when the cookie is simply absent', () => {
    expect(parseCookie('a=1; b=2', 'vb_session')).toBeNull();
  });
});
