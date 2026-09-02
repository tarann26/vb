import { describe, expect, it } from 'vitest';
import { handleImage, servesImageBytes, type ImagesEnv } from '../images';

// A Map standing in for the bucket, in the same spirit as fakeD1.ts: real
// enough to prove what this handler does with what R2 hands back (a hit, a
// miss, the stored http metadata, the etag) without pulling in workerd's
// actual R2 binding, which has no runtime shape in this repo's jsdom test
// environment.
//
// `writeHttpMetadata` is modelled rather than stubbed away, because the whole
// question of what Content-Type a photograph is served under runs through it,
// and a stub that always wrote a type would make the "no stored type" case
// untestable.
interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  etag: string;
}

class FakeBucket {
  store = new Map<string, StoredObject>();
  reads: string[] = [];

  put(key: string, object: StoredObject): void {
    this.store.set(key, object);
  }

  async get(key: string): Promise<unknown> {
    this.reads.push(key);
    const object = this.store.get(key);
    if (!object) return null;
    return {
      body: new Response(object.bytes).body,
      httpEtag: `"${object.etag}"`,
      writeHttpMetadata(headers: Headers) {
        if (object.contentType) headers.set('Content-Type', object.contentType);
        if (object.cacheControl) headers.set('Cache-Control', object.cacheControl);
      },
    };
  }
}

function envWith(bucket: FakeBucket): ImagesEnv {
  return { R2: bucket as unknown as R2Bucket };
}

const PIXEL = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

function bucketWith(entries: Record<string, Partial<StoredObject>> = {}): FakeBucket {
  const bucket = new FakeBucket();
  for (const [key, object] of Object.entries(entries)) {
    bucket.put(key, { bytes: PIXEL, etag: 'abc123', ...object });
  }
  return bucket;
}

function get(path: string, init?: RequestInit): Request {
  return new Request(`https://viabiancarestaurant.com${path}`, init);
}

describe('which requests this handler answers', () => {
  it.each([
    ['a photograph', '/images/food/pizza1.webp'],
    ['a nested key', '/images/press/2026/hotelier.webp'],
    ['a percent-encoded filename', '/images/mocktails/signor%20bianca.webp'],
  ])('takes %s', (_name, path) => {
    expect(servesImageBytes(get(path))).toBe(true);
  });

  it.each([
    ['the homepage', '/'],
    ['a post page, which belongs to worker/post-page.ts', '/blog/assassina'],
    ['an api route', '/api/published'],
    ['the admin surface', '/edit'],
    ['a path that merely starts the same way', '/imagesets/food/x.webp'],
    ['the bare prefix', '/images'],
  ])('leaves %s alone', (_name, path) => {
    expect(servesImageBytes(get(path))).toBe(false);
  });

  // HEAD is in because every uptime monitor, link checker and crawler probes
  // with one before fetching, and the Workers runtime does not turn a HEAD
  // into a GET on a handler's behalf. Everything else falls to the router's
  // 404: there is nothing to POST to a photograph.
  it('answers HEAD as well as GET', () => {
    expect(servesImageBytes(get('/images/food/pizza1.webp', { method: 'HEAD' }))).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('does not answer %s', (method) => {
    expect(servesImageBytes(get('/images/food/pizza1.webp', { method }))).toBe(false);
  });
});

describe('an object that is in the bucket', () => {
  it('comes back with its bytes', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    const response = await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PIXEL);
  });

  it('is read under the key the path names, with no leading slash', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(bucket.reads).toEqual(['food/pizza1.webp']);
  });

  // Five filenames in this library carry spaces, so the request arrives
  // percent-encoded and R2 holds the key with a real space in it. Decoding is
  // src/shared/image-host.ts's job and this is the end that proves the two
  // halves meet.
  it('is read under the decoded key when the filename carries a space', async () => {
    const bucket = bucketWith({ 'mocktails/signor bianca.webp': {} });
    const response = await handleImage(get('/images/mocktails/signor%20bianca.webp'), envWith(bucket));
    expect(response.status).toBe(200);
    expect(bucket.reads).toEqual(['mocktails/signor bianca.webp']);
  });

  it('carries the content type the object was stored under', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': { contentType: 'image/webp' } });
    const response = await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(response.headers.get('Content-Type')).toBe('image/webp');
  });

  it('carries the object etag, so a hard refresh has something to compare', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': { etag: 'deadbeef' } });
    const response = await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(response.headers.get('ETag')).toBe('"deadbeef"');
  });

  it('answers HEAD with the headers and no body', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': { contentType: 'image/webp' } });
    const response = await handleImage(get('/images/food/pizza1.webp', { method: 'HEAD' }), envWith(bucket));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.body).toBeNull();
  });

  it('answers 304 when the browser already has this exact object', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': { etag: 'deadbeef' } });
    const response = await handleImage(
      get('/images/food/pizza1.webp', { headers: { 'If-None-Match': '"deadbeef"' } }),
      envWith(bucket),
    );
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it('sends the bytes when the browser holds a different version', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': { etag: 'deadbeef' } });
    const response = await handleImage(
      get('/images/food/pizza1.webp', { headers: { 'If-None-Match': '"stale"' } }),
      envWith(bucket),
    );
    expect(response.status).toBe(200);
  });
});

// The header this whole design turns on. Workers Free allows 100,000 requests
// a day and photographs are the highest-volume request type on any site; a
// Worker route is invoked for every request that reaches Cloudflare, so the
// only thing that makes a page view cost nothing is a browser that does not
// ask. See worker/images.ts.
describe('how long a browser is told it may keep a photograph', () => {
  it('gives a content-addressed key a year, and says it will never change', async () => {
    const bucket = bucketWith({ 'food/a1b2c3d4e5f6.webp': {} });
    const response = await handleImage(get('/images/food/a1b2c3d4e5f6.webp'), envWith(bucket));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  // A legacy human-named photograph can be re-uploaded under the same key and
  // nothing in this system purges R2 or the edge, so a year here would mean a
  // correction that never reaches a returning diner.
  it('gives a re-uploadable name a day instead', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    const response = await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  // The stored metadata is replayed by writeHttpMetadata, so an object
  // uploaded by hand -- or by a future path that forgets -- would otherwise be
  // served under whatever happened to be attached to it. One rule, applied
  // here, to every object.
  it('overrides whatever the object itself was stored with', async () => {
    const bucket = bucketWith({
      'food/a1b2c3d4e5f6.webp': { cacheControl: 'no-store' },
      'food/pizza1.webp': { cacheControl: 'public, max-age=31536000, immutable' },
    });
    const hashed = await handleImage(get('/images/food/a1b2c3d4e5f6.webp'), envWith(bucket));
    expect(hashed.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const named = await handleImage(get('/images/food/pizza1.webp'), envWith(bucket));
    expect(named.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  // The prefix is exempt from worker/index.ts's blanket no-store, so a miss
  // has to say it itself or it says nothing -- and RFC 9110 lets a cache store
  // a 404 heuristically when nothing says otherwise. A 404 held after the
  // object lands is a photograph that stays missing with its bytes in the
  // bucket, which is exactly the window this migration runs in.
  it('refuses caching on a miss, rather than leaving it to a heuristic', async () => {
    const response = await handleImage(get('/images/food/gone.webp'), envWith(bucketWith()));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

// A 200 with no body is how a broken photograph looks fine to a crawler, fine
// to an uptime check and blank to a diner: the status code says the picture is
// there and the body says nothing. A 500 is not the answer either -- an object
// that was never uploaded is not an error on this site's part.
describe('an object that is not in the bucket', () => {
  it('is a 404, not a 200 and not a 500', async () => {
    const response = await handleImage(get('/images/food/gone.webp'), envWith(bucketWith()));
    expect(response.status).toBe(404);
  });

  it('has a body that says so, rather than being empty', async () => {
    const response = await handleImage(get('/images/food/gone.webp'), envWith(bucketWith()));
    expect(await response.text()).not.toBe('');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('is a 404 for a key that names no object, not a read of some other key', async () => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    const response = await handleImage(get('/images/'), envWith(bucket));
    expect(response.status).toBe(404);
    expect(bucket.reads).toEqual([]);
  });

  // Refused before R2 is asked anything. Two mechanisms end up doing it and
  // both are worth naming, because reading the first as the whole answer is
  // how the second gets deleted: the URL parser resolves dot segments while it
  // is parsing (so `/images/../x` has already become `/x` by the time this
  // handler sees a pathname, `%2E%2E` included), and `keyFromImageUrl` refuses
  // anything still carrying `..` after decoding. A key space a request can
  // walk upward through is not one worth handing to a bucket that also holds
  // every archived original.
  it.each([
    ['traversal out of the prefix', '/images/../wrangler.toml'],
    ['traversal buried in the middle', '/images/food/../../wrangler.toml'],
    ['percent-encoded traversal', '/images/%2E%2E/wrangler.toml'],
  ])('refuses %s without asking the bucket', async (_name, path) => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    const response = await handleImage(get(path), envWith(bucket));
    expect(response.status).toBe(404);
    expect(bucket.reads).toEqual([]);
  });

  // A malformed escape makes `decodeURI` throw, and an uncaught throw in a
  // fetch handler is a 500 on a photograph. Anybody can type this URL.
  it.each([
    ['a malformed escape', '/images/%zz.webp'],
    ['a bare percent sign', '/images/food/%.webp'],
  ])('answers 404 for %s rather than throwing', async (_name, path) => {
    const bucket = bucketWith({ 'food/pizza1.webp': {} });
    const response = await handleImage(get(path), envWith(bucket));
    expect(response.status).toBe(404);
    expect(bucket.reads).toEqual([]);
  });
});
