import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  buildPublishRequest,
  dirtyContentFiles,
  dirtyDraftMap,
  fetchBuildInfo,
  fetchBuildStatus,
  isDirty,
  nextPollDelay,
  refreshBaseShas,
  requestPublish,
  trackPublish,
  useContentRegistry,
  CONFIRM_TIMEOUT_MS,
  POLL_MAX_INTERVAL_MS,
  POLL_MIN_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  type ContentEntries,
  type PollDeps,
  type PublishProgress,
} from '../publish';
import type { StagedFile } from '../staged';

afterEach(() => {
  vi.unstubAllGlobals();
});

// A real-shaped base64 blob, not a placeholder -- several tests below assert
// against THIS shape specifically, not `expect.any(String)`, which the
// brief calls out by name as accepting `''` (the exact defect a dropped
// staged file would produce).
const REAL_BASE64_JPEG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function isRealBase64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

describe('isDirty / dirtyContentFiles', () => {
  it('clean when data and initial are structurally identical', () => {
    expect(isDirty({ data: [{ id: 'a' }], initial: [{ id: 'a' }], sha: 's' })).toBe(false);
  });

  it('dirty when data differs from initial', () => {
    expect(isDirty({ data: [{ id: 'a', name: 'X' }], initial: [{ id: 'a', name: '' }], sha: 's' })).toBe(true);
  });

  it('dirtyContentFiles lists only entries that changed, unregistered files absent entirely', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 1 }], initial: [{ id: 1 }], sha: 's1' }, // clean
      'drinks.json': { data: [{ id: 2 }], initial: [], sha: 's2' }, // dirty
    };
    expect(dirtyContentFiles(entries)).toEqual(['drinks.json']);
  });

  it('lists dirty files in CONTENT_FILES order, not registration order', () => {
    const entries: ContentEntries = {
      'copy.json': { data: { a: 1 }, initial: {}, sha: 's' },
      'site.json': { data: { a: 1 }, initial: {}, sha: 's' },
      'dishes.json': { data: [1], initial: [], sha: 's' },
    };
    expect(dirtyContentFiles(entries)).toEqual(['site.json', 'dishes.json', 'copy.json']);
  });
});

// buildPublishRequest returns a discriminated union ({ok: true, ...} | {ok:
// false, reason: 'too-many-staged-files', ...}) so a caller (and this test
// file) is FORCED to handle the refusal case, not just the happy path --
// this helper unwraps the ok:true branch for every test below that expects
// the request to actually be built, failing loudly (not silently narrowing
// to `undefined`) if a refusal ever slips through unexpectedly.
function expectOk(plan: ReturnType<typeof buildPublishRequest>) {
  if (!plan.ok) throw new Error(`expected buildPublishRequest to succeed, got a refusal: ${plan.reason}`);
  return plan;
}

describe('buildPublishRequest', () => {
  it('a dirty content file is sent as utf-8 JSON with its baseSha attached', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 'a', name: 'Edited' }], initial: [{ id: 'a', name: '' }], sha: 'dishes-sha-1' },
    };
    const plan = expectOk(buildPublishRequest(entries, {}));
    expect(plan.files).toEqual([
      {
        path: 'src/content/dishes.json',
        content: JSON.stringify([{ id: 'a', name: 'Edited' }]),
        encoding: 'utf-8',
        baseSha: 'dishes-sha-1',
      },
    ]);
    expect(plan.contentSnapshots).toEqual({ 'dishes.json': [{ id: 'a', name: 'Edited' }] });
  });

  // Carried requirement 1's own regression shape: dropping `baseSha` here
  // is exactly what turns Task 3's conditional write back into a silent
  // overwrite, with no test failing elsewhere to catch it -- this pins the
  // field directly, on the request this module actually builds.
  it('never omits baseSha for a dirty content file', () => {
    const entries: ContentEntries = {
      'site.json': { data: { hours: [] }, initial: { hours: [{ opens: '10:00' }] }, sha: 'site-sha' },
    };
    const plan = expectOk(buildPublishRequest(entries, {}));
    expect(plan.files[0].baseSha).toBe('site-sha');
  });

  it('a clean content file is not included at all', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 'a' }], initial: [{ id: 'a' }], sha: 'sha' },
    };
    const plan = expectOk(buildPublishRequest(entries, {}));
    expect(plan.files).toEqual([]);
    expect(plan.contentSnapshots).toEqual({});
  });

  it('a staged file is included even with no content entry registered at all', () => {
    const staged: Record<string, StagedFile> = {
      'dishes.json:a:image': { path: 'assets-source/food/aaa.jpg', content: REAL_BASE64_JPEG, encoding: 'base64', contentPath: '/food/aaa.webp' },
    };
    const plan = expectOk(buildPublishRequest({}, staged));
    expect(plan.files).toEqual([{ path: 'assets-source/food/aaa.jpg', content: REAL_BASE64_JPEG, encoding: 'base64' }]);
    expect(plan.stagedKeys).toEqual(['dishes.json:a:image']);
  });

  // Carried requirement 3, exactly: a same-name menu PDF replacement leaves
  // menus.json's own `file` field byte-identical (worker/upload.ts's
  // menuAssetPath is name-based, not content-addressed) -- so menus.json
  // itself is CLEAN and excluded from `files`, and the staged PDF's real
  // bytes are the only proof in the whole payload that a replacement
  // happened. Matched against a real base64 SHAPE, not `expect.any(String)`
  // -- the brief names that exact assertion as one that would still pass
  // for `content: ''`, which is the silent-no-op defect itself.
  it('a same-name menu PDF replacement: menus.json stays out of files, the PDF bytes are in it, and they are REAL base64', () => {
    const entries: ContentEntries = {
      'menus.json': {
        data: [{ id: 'food', label: 'Food Menu', file: '/menus/food-menu.pdf' }],
        initial: [{ id: 'food', label: 'Food Menu', file: '/menus/food-menu.pdf' }], // byte-identical: unchanged by design
        sha: 'menus-sha',
      },
    };
    const staged: Record<string, StagedFile> = {
      'menus.json:food:file': { path: 'public/menus/food-menu.pdf', content: REAL_BASE64_JPEG, encoding: 'base64', contentPath: '/menus/food-menu.pdf' },
    };
    const plan = expectOk(buildPublishRequest(entries, staged));

    expect(plan.files.some((f) => f.path === 'src/content/menus.json')).toBe(false);
    const pdfEntry = plan.files.find((f) => f.path === 'public/menus/food-menu.pdf');
    expect(pdfEntry).toBeDefined();
    expect(pdfEntry!.encoding).toBe('base64');
    expect(isRealBase64(pdfEntry!.content)).toBe(true);
    // The trap named verbatim in the brief: an empty string passes
    // `expect.any(String)` but is the defect itself. Pinned directly.
    expect(pdfEntry!.content).not.toBe('');
    expect(pdfEntry!.content.length).toBeGreaterThan(0);
  });

  // Review finding: MAX_STAGED_PHOTOS_PER_PUBLISH (PhotoField.tsx, = 8)
  // exists specifically so a publish assembler imports it -- nothing did,
  // until this fix. 8 staged photos at up to 5MB each, base64-inflated
  // (4/3, RFC 4648), is already ~53MB of request body; a build that instead
  // let an arbitrary count through (this test used to assert TWELVE landed
  // in one request, before the cap was enforced) would fail as an opaque
  // network error on a real phone, indistinguishable from a genuine outage
  // and impossible to act on by retrying.
  function stagedPhotos(count: number): Record<string, StagedFile> {
    const staged: Record<string, StagedFile> = {};
    for (let i = 0; i < count; i++) {
      staged[`dishes.json:dish-${i}:image`] = {
        path: `assets-source/food/photo-${i}.jpg`,
        content: REAL_BASE64_JPEG,
        encoding: 'base64',
        contentPath: `/food/photo-${i}.webp`,
      };
    }
    return staged;
  }

  it('exactly the cap (8) succeeds -- every one lands in ONE request, none dropped', () => {
    const plan = expectOk(buildPublishRequest({}, stagedPhotos(8)));
    expect(plan.files).toHaveLength(8);
    expect(plan.files.every((f) => isRealBase64(f.content))).toBe(true);
    expect(new Set(plan.files.map((f) => f.path)).size).toBe(8);
  });

  it('one over the cap (9) is refused, not silently truncated or sent oversized', () => {
    const plan = buildPublishRequest({}, stagedPhotos(9));
    expect(plan).toEqual({ ok: false, reason: 'too-many-staged-files', stagedCount: 9, limit: 8 });
  });

  it('twelve -- the number this suite used to assert succeeded -- is refused the same way', () => {
    const plan = buildPublishRequest({}, stagedPhotos(12));
    expect(plan.ok).toBe(false);
  });

  it('dirty content files and staged files combine in one request', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 'a', image: '/food/x.webp' }], initial: [{ id: 'a', image: '' }], sha: 'dishes-sha' },
    };
    const staged: Record<string, StagedFile> = {
      'dishes.json:a:image': { path: 'assets-source/food/x.jpg', content: REAL_BASE64_JPEG, encoding: 'base64', contentPath: '/food/x.webp' },
    };
    const plan = expectOk(buildPublishRequest(entries, staged));
    expect(plan.files).toHaveLength(2);
    expect(plan.files.some((f) => f.path === 'src/content/dishes.json')).toBe(true);
    expect(plan.files.some((f) => f.path === 'assets-source/food/x.jpg')).toBe(true);
  });
});

describe('dirtyDraftMap', () => {
  it('only includes dirty files, stamped with the given now', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 'a', name: 'Edited' }], initial: [{ id: 'a', name: '' }], sha: 's' },
      'drinks.json': { data: [{ id: 'b' }], initial: [{ id: 'b' }], sha: 's' }, // clean
    };
    expect(dirtyDraftMap(entries, {}, 12_345)).toEqual({
      'dishes.json': { data: [{ id: 'a', name: 'Edited' }], savedAt: 12_345 },
    });
  });

  it('empty when nothing is dirty', () => {
    expect(dirtyDraftMap({}, {}, 1)).toEqual({});
  });

  // Critical review finding, reproduced exactly: she stages a photo, the tab
  // dies before Publish, she reloads, Restore, publish -- the RESTORED
  // record still names the staged contentPath, whose bytes died with the
  // tab. Proven here at the exact function the fix lives in: a dirty
  // dish carrying a currently-staged contentPath must never reach
  // localStorage with that reference intact.
  function staged(contentPath: string): Record<string, StagedFile> {
    return { 'dishes.json:a:image': { path: 'assets-source/food/new.jpg', content: REAL_BASE64_JPEG, encoding: 'base64', contentPath } };
  }

  it('a leaf equal to a staged contentPath is reverted to the value at the SAME location in initial', () => {
    const entries: ContentEntries = {
      'dishes.json': {
        data: [{ id: 'a', name: 'Dish A', image: '/food/new.webp' }],
        initial: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }],
        sha: 's',
      },
    };
    expect(dirtyDraftMap(entries, staged('/food/new.webp'))).toEqual({
      'dishes.json': { data: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }], savedAt: expect.any(Number) },
    });
  });

  // The scrub is surgical -- an unrelated edit made in the SAME record
  // (and the same publish session) is not collateral damage of reverting
  // the one dangling leaf.
  it('an unrelated field edited in the SAME record survives the scrub untouched', () => {
    const entries: ContentEntries = {
      'dishes.json': {
        data: [{ id: 'a', name: 'Dish A Edited', image: '/food/new.webp' }],
        initial: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }],
        sha: 's',
      },
    };
    const map = dirtyDraftMap(entries, staged('/food/new.webp'));
    expect(map['dishes.json']?.data).toEqual([{ id: 'a', name: 'Dish A Edited', image: '/food/old.webp' }]);
  });

  // A record added THIS session has no counterpart in `initial` at all --
  // there is no committed value to fall back to, so the leaf is blanked
  // rather than left dangling. A blank image is exactly what
  // validateContent's own "needs an image" rule already treats as a
  // normal, actionable state, never a broken reference.
  it('a brand-new record with no counterpart in initial falls back to blank, not the dangling path', () => {
    const entries: ContentEntries = {
      'dishes.json': {
        data: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }, { id: 'new', name: 'New Dish', image: '/food/new.webp' }],
        initial: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }],
        sha: 's',
      },
    };
    const map = dirtyDraftMap(entries, staged('/food/new.webp'));
    expect((map['dishes.json']?.data as { id: string; image: string }[]).find((d) => d.id === 'new')?.image).toBe('');
  });

  // Matched by `id`, not raw array index -- reordering the SAME list in the
  // SAME session must not pair a record against a DIFFERENT record's
  // committed value just because they now share a position.
  it('matches the initial counterpart by id, not position, after a reorder', () => {
    const entries: ContentEntries = {
      'dishes.json': {
        // Reordered relative to `initial`: 'b' now comes first.
        data: [{ id: 'b', name: 'Dish B', image: '/food/b.webp' }, { id: 'a', name: 'Dish A', image: '/food/new.webp' }],
        initial: [{ id: 'a', name: 'Dish A', image: '/food/old.webp' }, { id: 'b', name: 'Dish B', image: '/food/b.webp' }],
        sha: 's',
      },
    };
    const map = dirtyDraftMap(entries, staged('/food/new.webp'));
    expect((map['dishes.json']?.data as { id: string; image: string }[]).find((d) => d.id === 'a')?.image).toBe('/food/old.webp');
  });

  it('nothing currently staged -- data passes through unscrubbed, byte for byte', () => {
    const entries: ContentEntries = {
      'dishes.json': { data: [{ id: 'a', image: '/food/x.webp' }], initial: [{ id: 'a', image: '' }], sha: 's' },
    };
    const map = dirtyDraftMap(entries, {});
    expect(map['dishes.json']?.data).toEqual([{ id: 'a', image: '/food/x.webp' }]);
  });
});

describe('refreshBaseShas', () => {
  it('returns the fresh sha for every file that resolves', async () => {
    const result = await refreshBaseShas(['dishes.json', 'drinks.json'], async (file) => ({
      sha: `fresh-${file}`,
    }));
    expect(result).toEqual({ 'dishes.json': 'fresh-dishes.json', 'drinks.json': 'fresh-drinks.json' });
  });

  it('a failure on one file is swallowed and simply omitted, not thrown', async () => {
    const result = await refreshBaseShas(['dishes.json', 'drinks.json'], async (file) => {
      if (file === 'drinks.json') throw new Error('network blip');
      return { sha: 'fresh-dishes-sha' };
    });
    expect(result).toEqual({ 'dishes.json': 'fresh-dishes-sha' });
  });

  it('empty file list resolves to an empty map with no calls', async () => {
    const impl = vi.fn();
    const result = await refreshBaseShas([], impl);
    expect(result).toEqual({});
    expect(impl).not.toHaveBeenCalled();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('requestPublish', () => {
  it('200 with a sha -> success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sha: 'commit-sha-1' }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'success', sha: 'commit-sha-1' });
  });

  it('200 with a malformed body (no sha) -> server-error, not a crash', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe('server-error');
  });

  it('401 -> unauthenticated', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'Not authenticated.' }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'unauthenticated' });
  });

  // The brief's own "409, not a parsed error string": both real-world 409
  // body shapes (Task 3's baseSha `{ problems }`, and PublishConflictError's
  // `{ message }`) must map to the identical `{ status: 'conflict' }` --
  // proving the branch is on STATUS, never on which key the body happens to
  // carry.
  it('409 with a problems body -> conflict', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this.' }] }),
    );
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'conflict' });
  });

  it('409 with a message body -> the SAME conflict status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { message: 'someone else published while you were editing' }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'conflict' });
  });

  it('422 -> validation, with the problems array passed through', async () => {
    const problems = [{ field: '[0].name', message: 'Name is required.' }];
    const fetchImpl = vi.fn(async () => jsonResponse(422, { problems }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'validation', problems });
  });

  it('422 with no problems array -> validation with an empty list, not a throw', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, {}));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'validation', problems: [] });
  });

  it('502 (GitHub 5xx) -> server-error, carrying the message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, { message: 'could not update main (GitHub returned 503)' }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'server-error', message: 'could not update main (GitHub returned 503)' });
  });

  it('a status with no message body still produces a readable fallback', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result.status).toBe('server-error');
    expect((result as { message: string }).message).toMatch(/500/);
  });

  it('a thrown fetch (offline) -> network-error, not an unhandled rejection', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const result = await requestPublish([], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 'network-error' });
  });

  it('sends the files array as the request body, POST, same-origin credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sha: 's' }));
    const files = [{ path: 'src/content/dishes.json', content: '[]', encoding: 'utf-8' as const, baseSha: 'x' }];
    await requestPublish(files, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/publish',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ files }),
      }),
    );
  });
});

describe('nextPollDelay', () => {
  it('grows from the minimum interval', () => {
    expect(nextPollDelay(POLL_MIN_INTERVAL_MS)).toBeGreaterThan(POLL_MIN_INTERVAL_MS);
  });

  it('never exceeds the maximum interval', () => {
    expect(nextPollDelay(POLL_MAX_INTERVAL_MS)).toBe(POLL_MAX_INTERVAL_MS);
    expect(nextPollDelay(1_000_000)).toBe(POLL_MAX_INTERVAL_MS);
  });
});

describe('fetchBuildStatus', () => {
  it('maps a well-formed 200 body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { state: 'building', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/abc' }));
    const result = await fetchBuildStatus('abc', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      kind: 'ok',
      result: { state: 'building', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/abc' },
    });
  });

  it('401 -> unauthenticated', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'Not authenticated.' }));
    const result = await fetchBuildStatus('abc', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'unauthenticated' });
  });

  it('an unrecognized state value -> error, not a crash or a false "queued"', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { state: 'something-new', commitUrl: 'https://x' }));
    const result = await fetchBuildStatus('abc', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'error' });
  });

  it('a non-ok, non-401 status -> error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    const result = await fetchBuildStatus('abc', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'error' });
  });

  it('a thrown fetch -> error, not an unhandled rejection', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await fetchBuildStatus('abc', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'error' });
  });
});

describe('fetchBuildInfo', () => {
  it('maps a well-formed body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sha: 'abc', builtAt: '2026-08-03T00:00:00.000Z' }));
    const result = await fetchBuildInfo(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'ok', info: { sha: 'abc', builtAt: '2026-08-03T00:00:00.000Z' } });
  });

  it('requests no-store', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sha: 'abc', builtAt: 'now' }));
    await fetchBuildInfo(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/build-info.json', expect.objectContaining({ cache: 'no-store' }));
  });

  it('a malformed body -> error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sha: 42 }));
    const result = await fetchBuildInfo(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'error' });
  });

  it('a non-ok status -> error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const result = await fetchBuildInfo(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: 'error' });
  });
});

describe('useContentRegistry', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useContentRegistry());
    expect(result.current.getEntries()).toEqual({});
  });

  it('the first register call pins `initial` to the just-loaded value', () => {
    const { result } = renderHook(() => useContentRegistry());
    act(() => result.current.register('dishes.json', [{ id: 'a' }], 'sha-1'));
    expect(result.current.getEntries()['dishes.json']).toEqual({
      data: [{ id: 'a' }],
      initial: [{ id: 'a' }],
      sha: 'sha-1',
    });
  });

  it('a later register call updates data but leaves initial pinned to the FIRST value', () => {
    const { result } = renderHook(() => useContentRegistry());
    act(() => result.current.register('dishes.json', [{ id: 'a', name: '' }], 'sha-1'));
    act(() => result.current.register('dishes.json', [{ id: 'a', name: 'Edited' }], 'sha-1'));
    const entry = result.current.getEntries()['dishes.json']!;
    expect(entry.data).toEqual([{ id: 'a', name: 'Edited' }]);
    expect(entry.initial).toEqual([{ id: 'a', name: '' }]);
  });

  it('getEntries() reflects a register() call made in the SAME synchronous call, before any re-render', () => {
    const { result } = renderHook(() => useContentRegistry());
    // The assertion reads getEntries() in the SAME synchronous statement
    // block that called register(), with no `await`/render in between --
    // proving the ref mutation itself, not React's own commit/re-render
    // cycle, is what makes this visible. This is the exact property Step
    // 1's "flush the focused field before reading the payload" depends on:
    // losing focus -> onChange -> ... -> register() must be visible to a
    // getEntries() call made immediately afterward, in the same synchronous
    // publish-click handler, not one render later. (act() here only
    // flushes React's OWN state update for `version`; it does not delay the
    // ref mutation register() already performed synchronously above it.)
    let dataAfterRegister: unknown;
    act(() => {
      result.current.register('dishes.json', [{ id: 'a' }], 'sha-1');
      dataAfterRegister = result.current.getEntries()['dishes.json']?.data;
    });
    expect(dataAfterRegister).toEqual([{ id: 'a' }]);
  });

  it('different files register independently -- one does not evict another', () => {
    const { result } = renderHook(() => useContentRegistry());
    act(() => {
      result.current.register('dishes.json', [{ id: 'a' }], 'sha-dishes');
      result.current.register('drinks.json', [{ id: 'b' }], 'sha-drinks');
    });
    const entries = result.current.getEntries();
    expect(entries['dishes.json']?.data).toEqual([{ id: 'a' }]);
    expect(entries['drinks.json']?.data).toEqual([{ id: 'b' }]);
  });

  it('version increments on every register call', () => {
    const { result } = renderHook(() => useContentRegistry());
    const before = result.current.version;
    act(() => result.current.register('dishes.json', [{ id: 'a' }], 'sha-1'));
    expect(result.current.version).toBeGreaterThan(before);
  });

  // Critical review finding: every section's own write path used to call
  // `register` -- which unconditionally overwrites `sha` -- passing its own
  // stale, load-time `sha` back in on every edit. `updateData` is the fix:
  // proven here as the API's own contract, independent of AdminApp's wiring.
  describe('updateData', () => {
    it('updates data, leaves sha and initial exactly as they were', () => {
      const { result } = renderHook(() => useContentRegistry());
      act(() => result.current.register('dishes.json', [{ id: 'a', name: '' }], 'sha-1'));
      act(() => result.current.updateData('dishes.json', [{ id: 'a', name: 'Edited' }]));
      const entry = result.current.getEntries()['dishes.json']!;
      expect(entry.data).toEqual([{ id: 'a', name: 'Edited' }]);
      expect(entry.initial).toEqual([{ id: 'a', name: '' }]);
      expect(entry.sha).toBe('sha-1');
    });

    // The exact shape of the Critical: a publish refreshes `sha` via
    // markPublished, and she keeps editing in the SAME session. The OLD
    // `register`-based write path would clobber that fresh sha right back
    // to the stale one -- proven by NAME below (revert this call to
    // `register(file, next, sha)` with the load-time `sha` closed over, and
    // this assertion fails: `entry.sha` reads back 'sha-stale', not
    // 'sha-fresh-from-publish').
    it('a fresh sha set by markPublished survives a LATER edit made through updateData', () => {
      const { result } = renderHook(() => useContentRegistry());
      act(() => result.current.register('dishes.json', [{ id: 'a', name: 'Edited' }], 'sha-stale'));
      act(() => result.current.markPublished({ 'dishes.json': { data: [{ id: 'a', name: 'Edited' }], sha: 'sha-fresh-from-publish' } }));
      // She edits again, in the same session, before ever reloading.
      act(() => result.current.updateData('dishes.json', [{ id: 'a', name: 'Edited again' }]));
      const entry = result.current.getEntries()['dishes.json']!;
      expect(entry.sha).toBe('sha-fresh-from-publish');
      expect(entry.data).toEqual([{ id: 'a', name: 'Edited again' }]);
    });

    it('a file never registered is a no-op, not a crash or a fabricated entry', () => {
      const { result } = renderHook(() => useContentRegistry());
      act(() => result.current.updateData('dishes.json', [{ id: 'a' }]));
      expect(result.current.getEntries()['dishes.json']).toBeUndefined();
    });

    it('version increments on updateData, the same way it does on register', () => {
      const { result } = renderHook(() => useContentRegistry());
      act(() => result.current.register('dishes.json', [{ id: 'a', name: '' }], 'sha-1'));
      const before = result.current.version;
      act(() => result.current.updateData('dishes.json', [{ id: 'a', name: 'Edited' }]));
      expect(result.current.version).toBeGreaterThan(before);
    });
  });

  it('markPublished resets initial to the published snapshot and refreshes sha, but keeps the CURRENT live data', () => {
    const { result } = renderHook(() => useContentRegistry());
    act(() => result.current.register('dishes.json', [{ id: 'a', name: '' }], 'sha-1'));
    // A snapshot is taken and sent...
    const published = [{ id: 'a', name: 'Edited' }];
    // ...but she keeps typing before the response comes back...
    act(() => result.current.register('dishes.json', [{ id: 'a', name: 'Edited further' }], 'sha-1'));
    // ...and only THEN does the publish resolve.
    act(() => result.current.markPublished({ 'dishes.json': { data: published, sha: 'sha-2-fresh' } }));

    const entry = result.current.getEntries()['dishes.json']!;
    expect(entry.data).toEqual([{ id: 'a', name: 'Edited further' }]); // her later edit survives
    expect(entry.initial).toEqual(published); // baseline moves to what was actually published
    expect(entry.sha).toBe('sha-2-fresh'); // baseSha is now current, not stale
    // No further edits since the snapshot -> this file reads as dirty
    // relative to the NEW initial only because of the edit made mid-flight,
    // which is correct: it really is unpublished.
    expect(isDirty(entry)).toBe(true);
  });

  it('markPublished with no further edits since the snapshot leaves the file clean', () => {
    const { result } = renderHook(() => useContentRegistry());
    const data = [{ id: 'a', name: 'Edited' }];
    act(() => result.current.register('dishes.json', data, 'sha-1'));
    act(() => result.current.markPublished({ 'dishes.json': { data, sha: 'sha-2-fresh' } }));
    const entry = result.current.getEntries()['dishes.json']!;
    expect(isDirty(entry)).toBe(false);
  });

  it('markPublished only touches the files named in its update, others are untouched', () => {
    const { result } = renderHook(() => useContentRegistry());
    act(() => {
      result.current.register('dishes.json', [{ id: 'a' }], 'sha-dishes');
      result.current.register('drinks.json', [{ id: 'b', name: 'still dirty' }], 'sha-drinks');
    });
    act(() => result.current.markPublished({ 'dishes.json': { data: [{ id: 'a' }], sha: 'sha-dishes-2' } }));
    expect(result.current.getEntries()['drinks.json']?.sha).toBe('sha-drinks');
  });
});

// trackPublish: the full polling/backoff/timeout/confirm state machine,
// driven entirely by an injected fake clock and an instantly-resolving
// `sleep` -- no real timers anywhere, so every test below runs in
// milliseconds regardless of how many minutes of *simulated* time it covers.
describe('trackPublish', () => {
  function fakeClock() {
    let now = 0;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      sleeps,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('queued, then building, then live with a matching build-info sha -> live', async () => {
    const clock = fakeClock();
    let call = 0;
    const deps: PollDeps = {
      fetchBuildStatus: async () => {
        call += 1;
        if (call === 1) return { kind: 'ok', result: { state: 'queued', deploymentUrl: null, commitUrl: 'https://c/1' } };
        if (call === 2) return { kind: 'ok', result: { state: 'building', deploymentUrl: null, commitUrl: 'https://c/1' } };
        return { kind: 'ok', result: { state: 'live', deploymentUrl: 'https://live', commitUrl: 'https://c/1' } };
      },
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'abc', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const progress: PublishProgress[] = [];
    const result = await trackPublish('abc', deps, (p) => progress.push(p));
    expect(result).toEqual({ phase: 'live' });
    expect(progress.map((p) => p.phase)).toEqual(['polling', 'polling', 'confirming', 'live']);
    expect(call).toBe(3);
  });

  it('confirms against build-info.json ONLY after live is observed -- never before', async () => {
    const clock = fakeClock();
    const buildInfoCalls: number[] = [];
    const deps: PollDeps = {
      fetchBuildStatus: async () => ({ kind: 'ok', result: { state: 'building', deploymentUrl: null, commitUrl: 'https://c' } }),
      fetchBuildInfo: async () => {
        buildInfoCalls.push(clock.now());
        return { kind: 'ok', info: { sha: 'abc', builtAt: 'now' } };
      },
      now: clock.now,
      sleep: clock.sleep,
    };
    // Runs forever (always 'building') -- race it against the timeout by
    // advancing the clock past POLL_TIMEOUT_MS via the injected sleep itself
    // (each loop iteration sleeps a real, growing amount).
    const result = await trackPublish('abc', deps, () => {});
    expect(result.phase).toBe('stalled');
    expect(buildInfoCalls).toHaveLength(0);
  });

  it('a build-status state of "failed" stops immediately -- it does not wait out the 10-minute timeout', async () => {
    const clock = fakeClock();
    let call = 0;
    const deps: PollDeps = {
      fetchBuildStatus: async () => {
        call += 1;
        if (call === 1) return { kind: 'ok', result: { state: 'building', deploymentUrl: null, commitUrl: 'https://c/1' } };
        return { kind: 'ok', result: { state: 'failed', deploymentUrl: null, commitUrl: 'https://c/1' } };
      },
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'x', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'build-failed', commitUrl: 'https://c/1' });
    // Stopped at the second call, not after exhausting the full timeout --
    // proves this is an early exit, not a coincidence of the fake clock.
    expect(call).toBe(2);
    expect(clock.now()).toBeLessThan(POLL_TIMEOUT_MS);
  });

  it('never reaching live or failed gives up after 10 minutes, carrying the last known commit link', async () => {
    const clock = fakeClock();
    const deps: PollDeps = {
      fetchBuildStatus: async () => ({ kind: 'ok', result: { state: 'queued', deploymentUrl: null, commitUrl: 'https://c/stalled' } }),
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'x', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'stalled', commitUrl: 'https://c/stalled' });
    expect(clock.now()).toBeGreaterThanOrEqual(POLL_TIMEOUT_MS);
  });

  it('a transient fetch error mid-poll is tolerated, not fatal -- polling continues past it to a real outcome', async () => {
    const clock = fakeClock();
    let call = 0;
    const deps: PollDeps = {
      fetchBuildStatus: async () => {
        call += 1;
        if (call === 1) return { kind: 'error' };
        return { kind: 'ok', result: { state: 'live', deploymentUrl: null, commitUrl: 'https://c' } };
      },
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'abc', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'live' });
    expect(call).toBe(2);
  });

  it('a 401 mid-poll stops immediately with an unauthenticated result, not folded into "stalled"', async () => {
    const clock = fakeClock();
    let call = 0;
    const deps: PollDeps = {
      fetchBuildStatus: async () => {
        call += 1;
        if (call === 1) return { kind: 'ok', result: { state: 'building', deploymentUrl: null, commitUrl: 'https://c' } };
        return { kind: 'unauthenticated' };
      },
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'abc', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'unauthenticated' });
    expect(call).toBe(2);
  });

  it('live but build-info.json never reports the matching sha within 60s -> mismatch', async () => {
    const clock = fakeClock();
    const deps: PollDeps = {
      fetchBuildStatus: async () => ({ kind: 'ok', result: { state: 'live', deploymentUrl: null, commitUrl: 'https://c' } }),
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'a-different-sha', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'mismatch' });
    expect(clock.now()).toBeGreaterThanOrEqual(CONFIRM_TIMEOUT_MS);
  });

  it('live, build-info catches up on a LATER attempt (not the first) -> live', async () => {
    const clock = fakeClock();
    let call = 0;
    const deps: PollDeps = {
      fetchBuildStatus: async () => ({ kind: 'ok', result: { state: 'live', deploymentUrl: null, commitUrl: 'https://c' } }),
      fetchBuildInfo: async () => {
        call += 1;
        if (call < 3) return { kind: 'ok', info: { sha: 'stale', builtAt: 'now' } };
        return { kind: 'ok', info: { sha: 'abc', builtAt: 'now' } };
      },
      now: clock.now,
      sleep: clock.sleep,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result).toEqual({ phase: 'live' });
    expect(call).toBe(3);
  });

  it('backs off between attempts -- each sleep is at least as long as the last, capped at the maximum', async () => {
    const clock = fakeClock();
    const deps: PollDeps = {
      fetchBuildStatus: async () => ({ kind: 'ok', result: { state: 'queued', deploymentUrl: null, commitUrl: 'https://c' } }),
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'x', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
    };
    await trackPublish('abc', deps, () => {});
    expect(clock.sleeps[0]).toBe(POLL_MIN_INTERVAL_MS);
    for (let i = 1; i < clock.sleeps.length; i++) {
      expect(clock.sleeps[i]).toBeGreaterThanOrEqual(clock.sleeps[i - 1]);
      expect(clock.sleeps[i]).toBeLessThanOrEqual(POLL_MAX_INTERVAL_MS);
    }
    // Genuinely reaches the cap at some point during a full 10-minute stall
    // -- otherwise "capped" is an assertion nothing above exercises.
    expect(Math.max(...clock.sleeps)).toBe(POLL_MAX_INTERVAL_MS);
  });

  it('an already-aborted signal stops before making any request at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const clock = fakeClock();
    const fetchBuildStatusSpy = vi.fn(async () => ({ kind: 'ok' as const, result: { state: 'queued' as const, deploymentUrl: null, commitUrl: 'https://c' } }));
    const deps: PollDeps = {
      fetchBuildStatus: fetchBuildStatusSpy,
      fetchBuildInfo: async () => ({ kind: 'ok', info: { sha: 'x', builtAt: 'now' } }),
      now: clock.now,
      sleep: clock.sleep,
      signal: controller.signal,
    };
    const result = await trackPublish('abc', deps, () => {});
    expect(result.phase).toBe('stalled');
    expect(fetchBuildStatusSpy).not.toHaveBeenCalled();
  });
});
