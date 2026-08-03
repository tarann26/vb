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
import { handleUpload, uploadPath, type UploadEnv } from '../upload';
import { signToken } from '../auth';
import { derivativePath } from '../../src/shared/derivative-path';
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

// Complete, not just correctly-headed: JPEG_BYTES ends in the real EOI
// marker (FF D9) and PNG_BYTES contains a real IEND chunk marker, so both
// pass `looksComplete` (worker/upload.ts) the same way a real, fully
// transferred photo would -- these are the "should succeed" fixtures used
// throughout this file, not the truncated ones exercised below.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...enc('IEND'), 0xae, 0x42, 0x60, 0x82,
]);
const HEIC_BYTES = isobmff('heic');
const NOT_AN_IMAGE = enc('this is a PDF or some other unrelated file, not a photo at all');

// Correct magic bytes, garbage/incomplete payload -- what a connection
// dropped mid-upload, or a hostile client testing the boundary, produces.
// Each is missing exactly the trailer `looksComplete` checks for its
// format.
const TRUNCATED_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]); // no FF D9
const TRUNCATED_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]); // no IEND
const TRUNCATED_GIF = new Uint8Array([...enc('GIF89a'), 1, 2, 3, 4]); // does not end 0x3B
// RIFF/WEBP whose declared chunk size (bytes 4-7, LE) claims far more data
// than the buffer actually holds.
const TRUNCATED_WEBP = new Uint8Array([...enc('RIFF'), 0xff, 0xff, 0x00, 0x00, ...enc('WEBP')]);
// Valid TIFF magic, garbage payload -- deliberately NOT expected to be
// caught by looksComplete (see that function's own comment on why TIFF has
// no cheap trailer check); this is the DNG/ProRAW-shaped case that Fix 2 in
// scripts/images.mjs exists to catch downstream instead.
const GARBAGE_TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);

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
  // Appended to the URL as `?stage=<value>` when present -- Task 5's
  // staged-upload branch. A caller passes the literal string it wants on
  // the query string (not a boolean) so a test can also exercise a
  // near-miss value like `'2'` or `'true'`, proving the check is `=== '1'`
  // exactly, not merely truthy.
  stage?: string;
}): Request {
  const form = new FormData();
  if (!opts.omitCategory && opts.category !== undefined) form.append('category', opts.category);
  if (!opts.omitFile && opts.file) {
    const blob = new Blob([opts.file.bytes], { type: opts.file.type ?? 'application/octet-stream' });
    form.append('file', blob, opts.file.filename ?? 'photo.jpg');
  }
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const url =
    opts.stage === undefined
      ? 'https://viabiancadelhi.com/api/upload'
      : `https://viabiancadelhi.com/api/upload?stage=${opts.stage}`;
  return new Request(url, { method: 'POST', headers, body: form });
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

// sha256Hex was deleted (security review, Task 6 follow-up): the hand-rolled
// synchronous SHA-256 existed only because the brief declared `uploadPath`
// synchronous. `uploadPath` is now async and calls `crypto.subtle.digest`
// directly -- the real primitive, not a from-scratch substitute -- so there
// is no longer a standalone hash function here to unit-test; `uploadPath`'s
// own tests below cover it through its one real behavior (content-addressed
// paths), and `crypto.subtle`'s own correctness is not this codebase's to
// verify.

describe('uploadPath', () => {
  it('builds a content-addressed path under assets-source/<category>/', async () => {
    const path = await uploadPath('food', enc('a photo'), 'png');
    expect(path).toMatch(/^assets-source\/food\/[0-9a-f]{12}\.png$/);
  });

  it('never collides two different photos', async () => {
    const a = await uploadPath('food', enc('photo A'), 'jpeg');
    const b = await uploadPath('food', enc('photo B'), 'jpeg');
    expect(a).not.toBe(b);
  });

  // The failure this guards against: IMG_1234.jpg and IMG_1234.png (or, at
  // the route level, the same photo submitted twice) mapping to the same
  // public/ output and tripping scripts/paths.mjs's findCollisions(), which
  // makes the whole image build write nothing and exit 1.
  it('uploading the same photo twice is idempotent, not duplicated', async () => {
    const bytes = enc('identical photo bytes');
    const first = await uploadPath('food', bytes, 'jpeg');
    const second = await uploadPath('food', bytes, 'jpeg');
    expect(first).toBe(second);
  });

  it('uses the extension the caller passes, not the category or any filename', async () => {
    expect(await uploadPath('hero', enc('x'), 'avif')).toMatch(/\.avif$/);
    expect(await uploadPath('hero', enc('x'), 'tiff')).toMatch(/\.tiff$/);
    expect(await uploadPath('hero', enc('x'), 'gif')).toMatch(/\.gif$/);
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

  // Security review finding: `detectFormat` reads only magic bytes, so a
  // file with a correct header and a garbage or truncated payload (a
  // connection dropped mid-upload; a hostile client probing the boundary)
  // used to sail straight through detection and get committed to
  // assets-source/ -- reproduced concretely against the pre-fix code: all
  // four of these buffers got a 200 and a real commit. `npm run images`
  // then failed to encode them ("Input file has corrupt header..."), which
  // -- before scripts/images.mjs's Fix 2 below -- failed `npm run images`
  // outright, so `npm run build` failed on every subsequent deploy with no
  // link back to the upload that caused it. `looksComplete`
  // (worker/upload.ts) catches the four formats with a cheap, well-defined
  // trailer; each case below is missing exactly that trailer.
  describe('truncated or corrupted files with otherwise-valid magic bytes', () => {
    it.each([
      ['jpeg', TRUNCATED_JPEG],
      ['png', TRUNCATED_PNG],
      ['gif', TRUNCATED_GIF],
      ['webp', TRUNCATED_WEBP],
    ] as const)('rejects a truncated %s (400, not committed)', async (_format, bytes) => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(uploadRequest({ category: 'food', file: { bytes }, cookie }), env);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { message: string };
      expect(body.message.toLowerCase()).toContain('incomplete');
      expect(stub.calls).toHaveLength(0);
    });

    // The deliberate boundary, not a gap: TIFF has no cheap trailer to
    // check (see looksComplete's own comment -- DNG/ProRAW carries fully
    // well-formed TIFF structure and is still undecodable by sharp, so
    // "structurally complete" doesn't imply "decodable" for this format the
    // way it does for the four above). This still commits; the safety net
    // for it is scripts/images.mjs's Fix 2, proved separately in
    // scripts/__tests__/images.derivatives.test.mjs.
    it('does not (and is not meant to) catch a structurally-intact-but-undecodable TIFF', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: GARBAGE_TIFF }, cookie }),
        env,
      );
      expect(response.status).toBe(200);
    });
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
    // "This upload", not "This photo": at this point the only thing known
    // is Content-Length, which is the whole multipart request (photo plus
    // envelope), not the photo alone -- see the pre-check's own comment.
    // Two decimal places, not one, so a boundary case (a photo sized right
    // at 25MB) can't render as "This photo is 25.0MB; the limit is 25MB",
    // which reads as a contradiction rather than useful guidance.
    expect(body.message).toBe('This upload is 26.00MB; the limit is 25MB.');
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
    // Here "This photo" is accurate: bytes.length at this point really is
    // just the file field's own byte count, no multipart envelope included.
    expect(body.message).toBe('This photo is 26.00MB; the limit is 25MB.');
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

  // Task 5: stops photos from being committed one at a time. Before this,
  // every one of these tests' own `it('commits a valid photo...')` above
  // was the ONLY shape a real upload could take -- twelve photos meant
  // twelve commits, and Cloudflare Pages cancelling eleven superseded
  // builds reported as eleven failures for photos that all actually landed.
  describe('?stage=1: stages the photo without committing it', () => {
    it('runs every existing check, then returns path and contentPath WITHOUT calling commitFiles', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie, stage: '1' }),
        env,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { path: string; contentPath: string; sha?: string };
      expect(body.path).toMatch(/^assets-source\/food\/[0-9a-f]{12}\.jpg$/);
      expect(body.contentPath).toMatch(/^\/food\/[0-9a-f]{12}\.webp$/);
      expect(body.sha).toBeUndefined();
      // The one assertion this whole step exists for: no request reached
      // GitHub at all, not even one that happened to succeed.
      expect(stub.calls).toHaveLength(0);
    });

    // Proves the route actually calls the real derivativePath, not a
    // route-local re-derivation that happens to agree with it on this
    // file's own fixtures -- derivativePath's OWN correctness (that it
    // agrees with scripts/paths.mjs's outputPathFor) is
    // src/shared/__tests__/derivative-path.test.ts's job, checked against
    // every real file under assets-source/, not a hand-picked list here.
    it('derives contentPath the same way src/shared/derivative-path.ts does', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(
        uploadRequest({ category: 'hero', file: { bytes: PNG_BYTES }, cookie, stage: '1' }),
        env,
      );
      const body = (await response.json()) as { path: string; contentPath: string };
      expect(body.contentPath).toBe(derivativePath(body.path));
    });

    // Staging must not become a second, weaker validation path -- every
    // check that would reject a committing upload rejects a staged one the
    // same way, before it ever reaches the "return without committing"
    // branch.
    it('still rejects a HEIC photo under ?stage=1, and makes no GitHub call', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: HEIC_BYTES, filename: 'IMG_0001.HEIC' }, cookie, stage: '1' }),
        env,
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    it('still rejects an over-25MB photo under ?stage=1', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const oversized = new Uint8Array(26 * 1024 * 1024);
      oversized.set(JPEG_BYTES);
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: oversized }, cookie, stage: '1' }),
        env,
      );
      expect(response.status).toBe(413);
      expect(stub.calls).toHaveLength(0);
    });

    // Idempotent staging: the path is content-addressed regardless of
    // whether it's ever committed, so staging the identical bytes twice
    // (e.g. a phone retrying a request it isn't sure landed) answers with
    // the identical path and contentPath both times, and neither call
    // touches GitHub.
    it('staging the same photo twice yields the same path and contentPath, with no GitHub call either time', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const first = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie, stage: '1' }),
        env,
      );
      const second = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie, stage: '1' }),
        env,
      );
      const firstBody = (await first.json()) as { path: string; contentPath: string };
      const secondBody = (await second.json()) as { path: string; contentPath: string };
      expect(firstBody).toEqual(secondBody);
      expect(stub.calls).toHaveLength(0);
    });

    // The equality check is `=== '1'` exactly -- `?stage=2` (or any other
    // value) must fall through to the ordinary, committing behavior, not be
    // treated as "any stage param at all means don't commit."
    it('a stage value other than "1" still commits, exactly like no stage param at all', async () => {
      env = freshEnv();
      const cookie = await sessionCookie();
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, cookie, stage: '2' }),
        env,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { sha?: string };
      expect(typeof body.sha).toBe('string');
      expect(stub.calls.length).toBeGreaterThan(0);
    });

    it('an unauthenticated staged upload is still 401 and makes no GitHub call', async () => {
      env = freshEnv();
      const response = await handleUpload(
        uploadRequest({ category: 'food', file: { bytes: JPEG_BYTES }, stage: '1' }),
        env,
      );
      expect(response.status).toBe(401);
      expect(stub.calls).toHaveLength(0);
    });
  });
});
