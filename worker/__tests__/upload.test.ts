// @vitest-environment node
//
// The one file in worker/__tests__/ that opts out of this repo's shared
// jsdom environment (see vitest.config.ts's own comment on why every other
// worker test stays on it). jsdom implements its own Blob/File/FormData --
// unlike fetch/Request/Response, which jsdom does not implement, so Node's
// real ones show through -- and that jsdom trio does not interoperate with
// Node's real Request/fetch machinery: constructing
// `new Request(url, { body: someJsdomFormData })` under jsdom silently
// produces a `text/plain` Content-Type instead of `multipart/form-data`
// (proven directly: `req.headers.get('content-type')` came back
// `'text/plain;charset=UTF-8'`), and even a correctly-content-typed raw
// multipart body then fails Node's own internal `webidl.is.File` check
// while `request.formData()` parses it. Both are jsdom/Node cross-realm
// mismatches in the test environment itself, not bugs in handleUpload --
// confirmed by the identical FormData/Request/Blob code working cleanly
// under a plain Node script and under this same docblock. worker/upload.ts
// touches no DOM/jsdom-only global (nothing under worker/ ever does; it
// targets workerd, which has no DOM at all), so running this file under
// Node's real, unshadowed fetch implementation is not just a workaround --
// it is the more faithful environment for what this code actually is.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleUpload, sha256Hex, uploadPath, type UploadEnv } from '../upload';
import { signToken } from '../auth';
import { envWith, makeGitHubStub, type GitHubStub } from './githubStub';

const TOKEN_SECRET = 'upload-test-token-secret';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// A minimal, real ISO-BMFF `ftyp` box -- see
// src/shared/__tests__/image-format.test.ts for the fuller version of this
// fixture builder; duplicated here in miniature rather than imported, since
// it's a private fixture for this file's own multipart bodies, not shared
// logic.
function isobmff(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HEIC_BYTES = isobmff('heic');
const NOT_AN_IMAGE = enc('this is a PDF or some other unrelated file, not a photo at all');

async function sessionCookie(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = await signToken(TOKEN_SECRET, expiresAt);
  return `vb_session=${token}`;
}

function uploadRequest(opts: {
  category?: string;
  file?: { bytes: Uint8Array; filename?: string; type?: string };
  cookie?: string;
  omitFile?: boolean;
  omitCategory?: boolean;
}): Request {
  const form = new FormData();
  if (!opts.omitCategory && opts.category !== undefined) form.append('category', opts.category);
  if (!opts.omitFile && opts.file) {
    const blob = new Blob([opts.file.bytes], { type: opts.file.type ?? 'application/octet-stream' });
    form.append('file', blob, opts.file.filename ?? 'photo.jpg');
  }
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  return new Request('https://viabiancadelhi.com/api/upload', { method: 'POST', headers, body: form });
}

// A ReadableStream that throws the moment anything tries to actually read
// from it. Used to prove the size guard rejects BEFORE the body is read
// into memory: if handleUpload called request.formData() (or anything else
// that reads the stream) before checking Content-Length, this would surface
// as a thrown error instead of the clean 413 the test asserts.
function bodyThatThrowsIfRead(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull() {
      throw new Error('the body was read despite exceeding the size limit');
    },
  });
}

describe('sha256Hex', () => {
  // FIPS 180-4's own published test vectors.
  it('matches the known SHA-256 of the empty string', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known SHA-256 of "abc"', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  // Cross-checked against the real crypto.subtle.digest -- not just against
  // more hand-copied hex strings -- for sizes that land exactly on, just
  // under, and just over SHA-256's 64-byte block boundary, where an
  // off-by-one in the padding logic would most likely show up.
  it.each([1, 55, 56, 57, 63, 64, 65, 1000, 65536])(
    'matches crypto.subtle.digest for a %i-byte buffer',
    async (size) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 2654435761) % 256;
      const expected = await crypto.subtle.digest('SHA-256', bytes);
      const expectedHex = Array.from(new Uint8Array(expected))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(sha256Hex(bytes)).toBe(expectedHex);
    },
  );
});

describe('uploadPath', () => {
  it('builds a content-addressed path under assets-source/<category>/', () => {
    const path = uploadPath('food', enc('a photo'), 'png');
    expect(path).toMatch(/^assets-source\/food\/[0-9a-f]{12}\.png$/);
  });

  it('never collides two different photos', () => {
    const a = uploadPath('food', enc('photo A'), 'jpeg');
    const b = uploadPath('food', enc('photo B'), 'jpeg');
    expect(a).not.toBe(b);
  });

  // The failure this guards against: IMG_1234.jpg and IMG_1234.png (or, at
  // the route level, the same photo submitted twice) mapping to the same
  // public/ output and tripping scripts/paths.mjs's findCollisions(), which
  // makes the whole image build write nothing and exit 1.
  it('uploading the same photo twice is idempotent, not duplicated', () => {
    const bytes = enc('identical photo bytes');
    const first = uploadPath('food', bytes, 'jpeg');
    const second = uploadPath('food', bytes, 'jpeg');
    expect(first).toBe(second);
  });

  it('uses the extension the caller passes, not the category or any filename', () => {
    expect(uploadPath('hero', enc('x'), 'avif')).toMatch(/\.avif$/);
    expect(uploadPath('hero', enc('x'), 'tiff')).toMatch(/\.tiff$/);
    expect(uploadPath('hero', enc('x'), 'gif')).toMatch(/\.gif$/);
  });
});

describe('POST /api/upload', () => {
  let stub: GitHubStub;
  let env: UploadEnv;

  function freshEnv(): UploadEnv {
    stub = makeGitHubStub();
    vi.stubGlobal('fetch', stub.fetch);
    return { ...envWith(stub), TOKEN_SECRET };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an unauthenticated upload is 401 and makes no GitHub call', async () => {
    env = freshEnv();
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES } }),
      env,
    );
    expect(response.status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it('a forged session cookie is also 401 and makes no GitHub call', async () => {
    env = freshEnv();
    const forged = await signToken('a-different-secret-entirely', Math.floor(Date.now() / 1000) + 3600);
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie: `vb_session=${forged}` }),
      env,
    );
    expect(response.status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it('an unknown category is 400 and makes no GitHub call', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ category: 'basement', file: { bytes: JPEG_BYTES }, cookie }),
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('basement');
    expect(stub.calls).toHaveLength(0);
  });

  it('a missing category is 400 and makes no GitHub call', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ file: { bytes: JPEG_BYTES }, cookie, omitCategory: true }),
      env,
    );
    expect(response.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  it('a missing file is 400 and makes no GitHub call', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(uploadRequest({ category: 'food', cookie, omitFile: true }), env);
    expect(response.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  it('an unrecognized format is 400, naming that nothing was recognized, and makes no GitHub call', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: NOT_AN_IMAGE, filename: 'notes.txt' }, cookie }),
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message.toLowerCase()).toContain('format');
    expect(stub.calls).toHaveLength(0);
  });

  // The bug this route exists to surface loudly: Task 9 converts a picked
  // HEIC file to JPEG in her own browser before it is ever uploaded, so a
  // HEIC file reaching this route means that conversion didn't happen.
  it('a HEIC upload is 400, telling her to convert before upload, and makes no GitHub call', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: HEIC_BYTES, filename: 'IMG_0001.HEIC' }, cookie }),
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('HEIC');
    expect(body.message.toLowerCase()).toContain('convert');
    expect(body.message.toLowerCase()).toContain('before upload');
    expect(stub.calls).toHaveLength(0);
  });

  it('rejects an over-25MB upload using Content-Length, before the body is ever read', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const oversized = 26 * 1024 * 1024;
    const request = new Request('https://viabiancadelhi.com/api/upload', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': String(oversized),
      },
      body: bodyThatThrowsIfRead(),
      duplex: 'half',
    } as RequestInit);

    const response = await handleUpload(request, env);
    expect(response.status).toBe(413);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('26.0MB');
    expect(stub.calls).toHaveLength(0);
  });

  // The safety net for a request whose Content-Length was absent (this
  // repo's own test-time Request, built from a FormData body, does not set
  // one -- see the comment on uploadRequest -- and a real client that
  // streams without one is not impossible either).
  it('rejects an over-25MB upload by its actual bytes when Content-Length is absent', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const oversized = new Uint8Array(26 * 1024 * 1024);
    oversized.set(JPEG_BYTES); // still looks like a real photo otherwise
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: oversized }, cookie }),
      env,
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('26.0MB');
    expect(stub.calls).toHaveLength(0);
  });

  it('an upload under the size limit is not rejected on size', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie }),
      env,
    );
    expect(response.status).not.toBe(413);
  });

  it('commits a valid photo through commitFiles as base64 and returns its path and sha', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sha: string; path: string };
    expect(body.path).toMatch(/^assets-source\/food\/[0-9a-f]{12}\.jpg$/);
    expect(typeof body.sha).toBe('string');

    const treeBody = stub.bodies.find((b) => Array.isArray((b as { tree?: unknown }).tree)) as
      | { tree: { path: string }[] }
      | undefined;
    expect(treeBody).toBeDefined();
    expect(treeBody!.tree).toHaveLength(1);
    expect(treeBody!.tree[0].path).toBe(body.path);

    const blobBody = stub.bodies.find((b) => 'encoding' in b) as { content: string; encoding: string } | undefined;
    expect(blobBody).toBeDefined();
    expect(blobBody!.encoding).toBe('base64');
    // Decodes back to the exact bytes she uploaded, proving the base64
    // round trip, not just that some string was sent as `content`.
    expect(new Uint8Array(Buffer.from(blobBody!.content, 'base64'))).toEqual(JPEG_BYTES);
  });

  // The property that belongs here, not in image-format.test.ts (which has
  // no filename to test against at all): a multipart upload's declared
  // filename is never trusted for either the format or the committed path.
  it('ignores a lying filename and commits under the extension its bytes actually are', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const response = await handleUpload(
      uploadRequest({
        category: 'food',
        file: { bytes: JPEG_BYTES, filename: 'totally-a-png.png', type: 'image/png' },
        cookie,
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string };
    expect(body.path).toMatch(/\.jpg$/);
    expect(body.path).not.toMatch(/\.png$/);
  });

  it('uploading the same photo twice commits the same path both times', async () => {
    env = freshEnv();
    const cookie = await sessionCookie();
    const first = await handleUpload(
      uploadRequest({ category: 'team', file: { bytes: PNG_BYTES }, cookie }),
      env,
    );
    const second = await handleUpload(
      uploadRequest({ category: 'team', file: { bytes: PNG_BYTES }, cookie }),
      env,
    );
    const firstBody = (await first.json()) as { path: string };
    const secondBody = (await second.json()) as { path: string };
    expect(firstBody.path).toBe(secondBody.path);
  });
});
