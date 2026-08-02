import { describe, it, expect } from 'vitest';
import { checkLoginRate, recordLoginFailure, clearLoginFailures } from '../ratelimit';

// A hand-built fake, not an import from @cloudflare/workers-types --
// KVNamespace has no runtime shape in this repo's test environment (see
// vitest.config.ts's comment), only a type-only ambient declaration, so a
// real instance cannot exist here. This fake implements exactly the three
// methods ratelimit.ts calls (get/put/delete) and records every put() call
// so tests can assert on the TTL and value it was given, not just on the
// externally-visible behaviour.
class FakeKV {
  store = new Map<string, string>();
  puts: { key: string; value: string; options?: { expirationTtl?: number } }[] = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.puts.push({ key, value, options });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function fakeKV() {
  return new FakeKV() as unknown as KVNamespace;
}

describe('checkLoginRate', () => {
  it('allows a fresh IP with no recorded failures', async () => {
    expect(await checkLoginRate(fakeKV(), '1.2.3.4')).toBe(true);
  });

  it('still allows the IP after 4 failures', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 4; i++) await recordLoginFailure(kv, '1.2.3.4');
    expect(await checkLoginRate(kv, '1.2.3.4')).toBe(true);
  });

  it('blocks the IP once 5 failures have been recorded', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 5; i++) await recordLoginFailure(kv, '1.2.3.4');
    expect(await checkLoginRate(kv, '1.2.3.4')).toBe(false);
  });

  it('keeps blocking past 5 -- a flood does not reset the count', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 8; i++) await recordLoginFailure(kv, '1.2.3.4');
    expect(await checkLoginRate(kv, '1.2.3.4')).toBe(false);
  });

  it('never limits by password -- only the IP is the key', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 5; i++) await recordLoginFailure(kv, '1.2.3.4');
    // A different IP guessing a different password is unaffected.
    expect(await checkLoginRate(kv, '5.6.7.8')).toBe(true);
  });

  it('clearLoginFailures resets the count so the IP is allowed again', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 5; i++) await recordLoginFailure(kv, '1.2.3.4');
    expect(await checkLoginRate(kv, '1.2.3.4')).toBe(false);
    await clearLoginFailures(kv, '1.2.3.4');
    expect(await checkLoginRate(kv, '1.2.3.4')).toBe(true);
  });

  it('records failures with a 900-second (15 minute) TTL', async () => {
    const kv = new FakeKV();
    await recordLoginFailure(kv as unknown as KVNamespace, '1.2.3.4');
    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0].options?.expirationTtl).toBe(900);
  });

  it('clearing an IP that was never recorded does not throw', async () => {
    await expect(clearLoginFailures(fakeKV(), '9.9.9.9')).resolves.toBeUndefined();
  });
});
