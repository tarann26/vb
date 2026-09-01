import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  looksLikeWebp,
  cacheControlFor,
  contentTypeFor,
  detectImageType,
  storedContentType,
  localPathFor,
  manifestFrom,
  migrate,
} from '../migrate-images.mjs';

function webp(payload = 4) {
  const bytes = new Uint8Array(12 + payload);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, 4 + payload, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function riffWav() {
  const bytes = webp(4);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);   // 'WAVE'
  return bytes;
}

describe('what is refused before it can reach the bucket', () => {
  it('refuses an HTML document wearing a webp name', () => {
    expect(looksLikeWebp(new TextEncoder().encode('<!doctype html><html><head></head></html>'))).toBe(false);
  });

  it('refuses a RIFF file that is not a WEBP', () => {
    expect(looksLikeWebp(riffWav())).toBe(false);
  });

  it('refuses a truncated webp whose header is intact', () => {
    const good = webp(64);
    expect(looksLikeWebp(good.subarray(0, good.length - 10))).toBe(false);
  });

  it('accepts a well-formed one', () => {
    expect(looksLikeWebp(webp())).toBe(true);
  });
});

describe('cache policy', () => {
  it('makes a content-addressed key immutable', () => {
    expect(cacheControlFor('food/0123456789ab.webp')).toContain('immutable');
  });

  it('does not make a legacy named key immutable', () => {
    expect(cacheControlFor('food/pizza1.webp')).not.toContain('immutable');
  });

  it('does not make a menu pdf immutable, so a replacement appears without a purge', () => {
    expect(cacheControlFor('menus/food-menu.pdf')).not.toContain('immutable');
  });
});

describe('content type', () => {
  it('stops the migration rather than storing an unrenderable type', () => {
    expect(() => contentTypeFor('food/x.heic')).toThrow();
  });

  it('types a webp key from its extension', () => {
    expect(contentTypeFor('food/pizza1.webp')).toBe('image/webp');
  });
});

// The extension is a claim and the first bytes are the fact. Ten of the
// fifty-one archived originals disagree, so these read the real files rather
// than a fixture: a fixture could only ever prove the sniffer parses bytes
// this test wrote, not that it fixes the mislabelled photographs on disk.
const SOURCE_DIR = join(process.cwd(), 'assets-source');

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listSources(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('the archived original is typed by its bytes, not by its name', () => {
  const LIAR = join(SOURCE_DIR, 'atmosphere', 'dining.jpg');

  it('reads PNG data out of a file named .jpg', () => {
    expect(detectImageType(new Uint8Array(readFileSync(LIAR)))).toBe('image/png');
  });

  it('would have stored that same file as image/jpeg on its extension alone', () => {
    expect(contentTypeFor('source/atmosphere/dining.jpg')).toBe('image/jpeg');
  });

  it('stores an original under the type its bytes say', () => {
    expect(storedContentType('source/atmosphere/dining.jpg', 'original', new Uint8Array(readFileSync(LIAR))))
      .toBe('image/png');
  });

  // The sniff is deliberately NOT applied to a derivative: looksLikeWebp has
  // already proved those bytes, and the key's extension is chosen here rather
  // than by whoever handed the photograph over.
  it('leaves a derivative typed by its key', () => {
    expect(storedContentType('food/pizza1.webp', 'derivative', new Uint8Array(readFileSync(LIAR))))
      .toBe('image/webp');
  });

  it('falls back to the extension when it cannot recognise the bytes', () => {
    expect(detectImageType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(storedContentType('source/a/b.png', 'original', new Uint8Array([1, 2, 3]))).toBe('image/png');
  });

  // Guards the count in migrate-images.mjs's own comment. If this ever reads
  // zero, the sniffer has stopped being load-bearing and the comment lies.
  it('finds a real disagreement on disk, so the sniff is not decoration', () => {
    const disagreeing = listSources(SOURCE_DIR).filter((file) => {
      const bytes = new Uint8Array(readFileSync(file).subarray(0, 16));
      const sniffed = detectImageType(bytes);
      return sniffed !== null && sniffed !== contentTypeFor(file);
    });
    expect(disagreeing.length).toBeGreaterThanOrEqual(10);
  });
});

describe('where an object is read from', () => {
  it('reads an original out of assets-source, not out of public', () => {
    expect(localPathFor({ key: 'source/food/pizza1.JPG', kind: 'original' })).toBe('assets-source/food/pizza1.JPG');
  });

  it('reads a menu pdf out of public', () => {
    expect(localPathFor({ key: 'menus/food-menu.pdf', kind: 'menu' })).toBe('public/menus/food-menu.pdf');
  });

  // The headline claim of this whole task. A derivative that can be read off
  // disk is a derivative that was never fetched from the CDN.
  it('refuses to give a derivative a path on disk at all', () => {
    expect(() => localPathFor({ key: 'food/pizza1.webp', kind: 'derivative' })).toThrow();
  });
});

describe('the read-back', () => {
  const object = { key: 'food/a.webp', kind: 'derivative' };
  const ok = (bytes) => async () => ({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'image/webp' }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  it('fails the object when the served bytes differ from the stored ones', async () => {
    const result = await migrate([object], {
      fetchImpl: ok(webp(64)), put: vi.fn(),
      readBack: async () => ({ bytes: webp(8), contentType: 'image/webp' }), log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/digest mismatch/);
    expect(result.done).toHaveLength(0);
  });

  it('fails the object when the host serves it under the wrong type', async () => {
    const bytes = webp(64);
    const result = await migrate([object], {
      fetchImpl: ok(bytes), put: vi.fn(),
      readBack: async () => ({ bytes, contentType: 'application/octet-stream' }), log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/served as application\/octet-stream/);
  });

  it('refuses an HTML body the CDN served with an image content type', async () => {
    const html = new TextEncoder().encode('<!doctype html><html>poisoned</html>');
    const result = await migrate([object], {
      fetchImpl: ok(html), put: vi.fn(),
      readBack: async () => { throw new Error('should never be reached'); }, log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/not a complete RIFF WEBP/);
  });

  it('refuses a body the CDN declared as something other than image/webp', async () => {
    const bytes = webp(64);
    const result = await migrate([object], {
      fetchImpl: async () => ({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: async () => bytes.buffer.slice(0),
      }),
      put: vi.fn(),
      readBack: async () => { throw new Error('should never be reached'); }, log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/served it as "text\/html"/);
  });

  it('records the digest of an object that survives every check', async () => {
    const bytes = webp(64);
    const result = await migrate([object], {
      fetchImpl: ok(bytes), put: vi.fn(),
      readBack: async () => ({ bytes, contentType: 'image/webp' }), log: () => {},
    });
    expect(result.failed).toHaveLength(0);
    expect(result.done[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.done[0].verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // The single most valuable case in this file: it proves an object that fails
  // is not ALSO counted as done. Without it every assertion above could pass
  // while migrate() pushed to both arrays.
  it('never counts a failed object as done', async () => {
    const result = await migrate([object], {
      fetchImpl: async () => ({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
      put: vi.fn(), readBack: async () => { throw new Error('unreachable'); }, log: () => {},
    });
    expect(result.done).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  it('stores the object under the cache policy its key earns', async () => {
    const bytes = webp(64);
    const put = vi.fn();
    await migrate([{ key: 'food/0123456789ab.webp', kind: 'derivative' }], {
      fetchImpl: ok(bytes), put,
      readBack: async () => ({ bytes, contentType: 'image/webp' }), log: () => {},
    });
    expect(put.mock.calls[0][2].cacheControl).toContain('immutable');
  });
});

describe('the manifest a run writes', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('names the host the read-back was made against', () => {
    expect(manifestFrom({ done: [], failed: [] }, now).host).toBe('https://img.viabiancarestaurant.com');
  });

  it('gives a verified object a verifiedAt and keeps its digest', () => {
    const manifest = manifestFrom({
      done: [{ key: 'food/a.webp', bytes: 12, sha256: 'ab', contentType: 'image/webp', cacheControl: 'public, max-age=86400', kind: 'derivative', verifiedAt: '2026-09-01T00:00:00.000Z' }],
      failed: [],
    }, now);
    expect(manifest.objects['food/a.webp'].verifiedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(manifest.objects['food/a.webp'].sha256).toBe('ab');
    expect(manifest.objects['food/a.webp'].key).toBeUndefined();
  });

  // The property Task 6's refusal rests on. A failed object still appears --
  // so the manifest records what happened -- but it must never carry the mark
  // that lets a reference be rewritten to point at it.
  it('never gives a failed object a verifiedAt', () => {
    const manifest = manifestFrom({
      done: [],
      failed: [{ key: 'food/b.webp', kind: 'derivative', reason: 'read-back HTTP 404' }],
    }, now);
    expect(manifest.objects['food/b.webp'].verifiedAt).toBeUndefined();
    expect(manifest.objects['food/b.webp'].reason).toBe('read-back HTTP 404');
  });
});
