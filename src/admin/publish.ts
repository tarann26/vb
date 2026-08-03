// Assembles and sends POST /api/publish -- Task 10, Step 1's "one request,
// one commit" -- and tracks what happens to it afterward (Steps 2/3/5). Not
// built on top of AdminApp's existing per-section `useState<{data, sha}>`
// pattern directly: every section (ArraySection, HoursSection, MenusSection,
// GallerySection, StorySection, CopySection, SectionsSection) already owns
// its OWN loaded content independently, so this module's ContentRegistry is
// the one place a publish can see all nine files at once, each still tagged
// with the blob `sha` GET /api/content read it at (content.ts's own
// LoadedContent.sha) -- what makes `baseSha` below possible at all.
import { useCallback, useRef, useState } from 'react';
import { CONTENT_FILES, fetchContent, type ContentFileName } from './content';
import type { StagedFile } from './staged';
import type { ValidationProblem } from '../content/validate';
import type { DraftMap } from './drafts';
import { MAX_STAGED_PHOTOS_PER_PUBLISH } from './PhotoField';

// ---------------------------------------------------------------------------
// The content registry: one entry per content file that has ever loaded on
// this page, holding its live, editable `data`, the `sha` GET /api/content
// most recently handed back for it, and `initial` -- the committed value at
// the moment this file was FIRST registered, frozen from then on (see
// `register` below). `data !== initial` (compared as JSON, since content
// files are plain JSON.parse-produced values with stable key order -- every
// write in AdminApp.tsx spreads rather than reconstructs, so key order never
// shuffles on its own) is this module's whole definition of "dirty".

export interface ContentEntry {
  data: unknown;
  initial: unknown;
  sha: string;
}

export type ContentEntries = Partial<Record<ContentFileName, ContentEntry>>;

export interface ContentRegistry {
  // Called by a section's own load-effect (once, with the freshly-fetched
  // value) AND by its commit/onChange path (on every edit) -- see
  // AdminApp.tsx's call sites. Mutates a ref SYNCHRONOUSLY, not through
  // setState: the Publish button's own click handler un-focuses whatever
  // field is currently focused before reading anything (Step 1's "flush the
  // focused field" requirement, TagsInput's onBlur-commits-the-buffer
  // contract), and that focus-loss's own onChange -> ... -> register() chain
  // runs synchronously, in the SAME call stack, as part of dispatching the
  // underlying DOM focus-out notification -- a version of this that only
  // updated REACT STATE would not be visible to
  // getEntries() until the next render, which is too late: the whole point
  // is that Publish reads the flushed value in the SAME synchronous call
  // that triggered the flush, not a value from before it.
  register: (file: ContentFileName, data: unknown, sha: string) => void;
  // A function, not a plain object property -- returns whatever the ref
  // CURRENTLY holds, always fresh, regardless of whether the component that
  // holds this registry has re-rendered since the last `register` call (see
  // `register`'s own comment for why that distinction matters here).
  getEntries: () => ContentEntries;
  // Bumped on every `register` call -- a plain number a caller (AdminApp's
  // own draft-persistence effect) can put in a `useEffect` dependency array
  // to react to "something changed", since `getEntries()` itself is a
  // ref-backed function call, not a value React's own dependency comparison
  // can see change.
  version: number;
  // Called once a publish actually succeeds, for exactly the files that
  // request included -- resets `initial` to the value that was PUBLISHED
  // (not necessarily whatever `data` holds NOW; she may have kept typing
  // while the request was in flight, and that later edit must stay dirty),
  // and refreshes `sha` to the fresh blob sha a post-publish re-read
  // returned (see refreshBaseShas below) -- without this, a second publish
  // later in the same session would still carry the now-stale `sha` from
  // before this publish and get refused with a false 409, as if someone
  // else had published, when the only "someone else" was her own prior,
  // already-successful publish.
  markPublished: (updates: Partial<Record<ContentFileName, { data: unknown; sha: string }>>) => void;
}

export function useContentRegistry(): ContentRegistry {
  const ref = useRef<ContentEntries>({});
  const [version, setVersion] = useState(0);

  const register = useCallback((file: ContentFileName, data: unknown, sha: string) => {
    const existing = ref.current[file];
    ref.current = {
      ...ref.current,
      [file]: { data, sha, initial: existing ? existing.initial : data },
    };
    setVersion((v) => v + 1);
  }, []);

  const getEntries = useCallback(() => ref.current, []);

  const markPublished = useCallback((updates: Partial<Record<ContentFileName, { data: unknown; sha: string }>>) => {
    const next = { ...ref.current };
    (Object.keys(updates) as ContentFileName[]).forEach((file) => {
      const update = updates[file];
      if (!update) return;
      const existing = next[file];
      next[file] = {
        // Whatever she has typed SINCE the snapshot that was actually sent
        // -- never reverted to the published snapshot itself, which would
        // silently discard an edit made while the request was in flight.
        data: existing ? existing.data : update.data,
        initial: update.data,
        sha: update.sha,
      };
    });
    ref.current = next;
    setVersion((v) => v + 1);
  }, []);

  return { register, getEntries, version, markPublished };
}

// True when `data` differs from the committed `initial` it started from.
// JSON.stringify, not a deep-equal library: every content file is plain
// JSON.parse output, and every write path in AdminApp.tsx (replaceAt,
// withLeaf, the spread in HoursSection/GallerySection/StorySection's own
// onChange) preserves key order rather than reconstructing objects from a
// named field list -- so two structurally-identical values always
// stringify identically here, and a real edit always produces a different
// string.
export function isDirty(entry: ContentEntry): boolean {
  return JSON.stringify(entry.data) !== JSON.stringify(entry.initial);
}

// CONTENT_FILES order, not `Object.keys(entries)` order -- a stable,
// predictable order for anything that lists dirty files (the publish
// request body, the draft map) rather than one that depends on which
// section happened to register first.
export function dirtyContentFiles(entries: ContentEntries): ContentFileName[] {
  return CONTENT_FILES.filter((file) => {
    const entry = entries[file];
    return entry !== undefined && isDirty(entry);
  });
}

// ---------------------------------------------------------------------------
// Assembling one publish request. Every DIRTY content file, `baseSha`
// attached (Step 1's carried requirement 1 -- omitting this is what turns
// the conditional write Task 3 built back into a silent overwrite, and no
// test would go red for it if this function simply left the field off).
// Every STAGED file too, unconditionally, regardless of whether the content
// file that references it is itself dirty -- a same-name menu PDF
// replacement leaves menus.json's own `file` field UNCHANGED by design
// (worker/upload.ts's menuAssetPath is name-based, not content-addressed),
// so the staged bytes are the ONLY evidence in this whole payload that
// anything happened at all (Step 1's carried requirement 3).

export interface PublishFilePayload {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  baseSha?: string;
}

export interface PublishRequestFiles {
  files: PublishFilePayload[];
  // Exactly the content files included above, each with the precise `data`
  // value that was serialized into `files` -- handed to markPublished after
  // a success so its own "what was actually published" snapshot can never
  // drift from what this function actually built the request body from.
  contentSnapshots: Partial<Record<ContentFileName, unknown>>;
  // Exactly the staged.ts keys included above -- a caller clears these (via
  // `stage(key, null)`) after a success, and ONLY these: a photo staged
  // AFTER this request was built (mid-flight) must not be silently dropped
  // just because it happens to share the same overall stagedFiles map.
  stagedKeys: string[];
}

// Review finding: PhotoField.tsx's own MAX_STAGED_PHOTOS_PER_PUBLISH exists
// specifically so "whatever DOES assemble a publish" (that component's own
// words, naming this module) imports ONE shared number rather than a
// second, independently-chosen one -- and nothing here ever did, until this
// fix. The arithmetic that constant's own comment already worked out still
// holds: 8 staged photos at up to MAX_STAGED_PHOTO_BYTES (5MB) each, once
// base64-inflated (4/3, RFC 4648), is already ~53MB of request body: real
// phones on real connections can fail an upload of that size in ways that
// surface as nothing more specific than requestPublish's own generic
// network-error sentence, which would then repeat identically on every
// retry -- a dead end, not a transient failure. Refusing BEFORE the request
// is ever built, with a plain reason, is what turns that dead end into
// something she can act on ("remove some, publish in two batches").
export { MAX_STAGED_PHOTOS_PER_PUBLISH };

export type PublishRequestPlan =
  | ({ ok: true } & PublishRequestFiles)
  | { ok: false; reason: 'too-many-staged-files'; stagedCount: number; limit: number };

export function buildPublishRequest(entries: ContentEntries, staged: Record<string, StagedFile>): PublishRequestPlan {
  const stagedKeys = Object.keys(staged);
  if (stagedKeys.length > MAX_STAGED_PHOTOS_PER_PUBLISH) {
    return { ok: false, reason: 'too-many-staged-files', stagedCount: stagedKeys.length, limit: MAX_STAGED_PHOTOS_PER_PUBLISH };
  }

  const dirty = dirtyContentFiles(entries);

  const contentFiles: PublishFilePayload[] = dirty.map((file) => {
    const entry = entries[file]!;
    return {
      path: `src/content/${file}`,
      content: JSON.stringify(entry.data),
      encoding: 'utf-8',
      baseSha: entry.sha,
    };
  });

  const stagedPayload: PublishFilePayload[] = stagedKeys.map((key) => {
    const file = staged[key];
    return { path: file.path, content: file.content, encoding: file.encoding };
  });

  const contentSnapshots = Object.fromEntries(dirty.map((file) => [file, entries[file]!.data])) as Partial<
    Record<ContentFileName, unknown>
  >;

  return { ok: true, files: [...contentFiles, ...stagedPayload], contentSnapshots, stagedKeys };
}

// The draft map (drafts.ts) is scoped to content JSON only -- see that
// file's own comment on why staged photo/PDF bytes are deliberately left
// out (localStorage's practical quota). Every currently dirty file is
// re-stamped with `now` on every call: this only ever runs from AdminApp's
// own persistence effect, which only fires when the registry's `version`
// actually moved (a real edit, or a fresh load) -- so `now` genuinely means
// "as of the last thing she touched", not a fabricated recency.
export function dirtyDraftMap(entries: ContentEntries, now: number = Date.now()): DraftMap {
  const map: DraftMap = {};
  dirtyContentFiles(entries).forEach((file) => {
    map[file] = { data: entries[file]!.data, savedAt: now };
  });
  return map;
}

// ---------------------------------------------------------------------------
// After a successful publish, this file's tracked `sha` is stale -- it still
// names the blob from BEFORE this publish, not the one the commit just
// created (commitFiles' own return value is only the COMMIT sha; see
// worker/github.ts). Left uncorrected, a second publish later in the same
// session would send that stale `baseSha` and be refused with a 409 against
// her own prior, already-successful publish -- annoying (she'd have to
// reload), never destructive (a 409 refuses the write, it never overwrites
// silently), but avoidable at the cost of one extra GET per published
// content file, reusing the exact same GET /api/content route (content.ts's
// fetchContent) the dashboard already trusts for everything else. A failed
// refresh for one file is swallowed, not thrown -- worst case that one
// file's next publish risks the same false-409, which is the same
// fail-closed (never fail-silent) outcome this whole task's brief is built
// around.
export async function refreshBaseShas(
  files: ContentFileName[],
  fetchContentImpl: (file: ContentFileName) => Promise<{ sha: string }> = fetchContent,
): Promise<Partial<Record<ContentFileName, string>>> {
  const results = await Promise.all(
    files.map(async (file): Promise<[ContentFileName, string | undefined]> => {
      try {
        const { sha } = await fetchContentImpl(file);
        return [file, sha];
      } catch {
        return [file, undefined];
      }
    }),
  );
  return Object.fromEntries(results.filter((entry): entry is [ContentFileName, string] => entry[1] !== undefined));
}

// ---------------------------------------------------------------------------
// POST /api/publish itself. One outcome per row of Step 5's translation
// table, plus the two this table doesn't need translating (success, and a
// request that never reached the server at all).

export type PublishRequestResult =
  | { status: 'success'; sha: string }
  | { status: 'validation'; problems: ValidationProblem[] }
  | { status: 'conflict' }
  | { status: 'unauthenticated' }
  | { status: 'server-error'; message: string }
  | { status: 'network-error' };

async function readMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : undefined;
  } catch {
    return undefined;
  }
}

export async function requestPublish(files: PublishFilePayload[], fetchImpl: typeof fetch = fetch): Promise<PublishRequestResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/publish', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
  } catch {
    return { status: 'network-error' };
  }

  if (response.status === 200) {
    try {
      const body = (await response.json()) as { sha?: unknown };
      if (typeof body.sha === 'string') return { status: 'success', sha: body.sha };
    } catch {
      // falls through to the generic server-error below
    }
    return { status: 'server-error', message: 'The server did not confirm what was published.' };
  }
  if (response.status === 401) return { status: 'unauthenticated' };
  // 409 covers BOTH conflict sources -- Task 3's per-file baseSha mismatch
  // (`json(409, { problems })`) and worker/github.ts's PublishConflictError
  // (`json(409, { message })`, Task 10 Step 2) -- deliberately branched on
  // STATUS alone, never on either body's message text (the brief's own "409,
  // not a parsed error string" requirement).
  if (response.status === 409) return { status: 'conflict' };
  if (response.status === 422) {
    try {
      const body = (await response.json()) as { problems?: unknown };
      const problems = Array.isArray(body.problems) ? (body.problems as ValidationProblem[]) : [];
      return { status: 'validation', problems };
    } catch {
      return { status: 'validation', problems: [] };
    }
  }
  const message = await readMessage(response);
  return { status: 'server-error', message: message ?? `Publish failed (status ${response.status}).` };
}

// ---------------------------------------------------------------------------
// Step 3: polling GET /api/build-status, backed off, with a 10-minute
// ceiling, then confirming against build-info.json before ever saying "your
// changes are live."

export type BuildState = 'queued' | 'building' | 'live' | 'failed';

export interface BuildStatusResponse {
  state: BuildState;
  deploymentUrl: string | null;
  commitUrl: string;
}

export type BuildStatusOutcome = { kind: 'ok'; result: BuildStatusResponse } | { kind: 'unauthenticated' } | { kind: 'error' };

const BUILD_STATES: readonly BuildState[] = ['queued', 'building', 'live', 'failed'];

export async function fetchBuildStatus(sha: string, fetchImpl: typeof fetch = fetch): Promise<BuildStatusOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/build-status?sha=${encodeURIComponent(sha)}`, { credentials: 'same-origin' });
  } catch {
    return { kind: 'error' };
  }
  // Step 3's own explicit instruction: a 401 mid-poll (the 7-day session
  // expiring while she waits) is not "still building" -- it needs the same
  // translation a 401 on the publish itself gets, not a silent stall.
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (!response.ok) return { kind: 'error' };
  try {
    const body = (await response.json()) as { state?: unknown; deploymentUrl?: unknown; commitUrl?: unknown };
    if (typeof body.state !== 'string' || !BUILD_STATES.includes(body.state as BuildState) || typeof body.commitUrl !== 'string') {
      return { kind: 'error' };
    }
    return {
      kind: 'ok',
      result: {
        state: body.state as BuildState,
        deploymentUrl: typeof body.deploymentUrl === 'string' ? body.deploymentUrl : null,
        commitUrl: body.commitUrl,
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

export interface BuildInfo {
  sha: string;
  builtAt: string;
}

export type BuildInfoOutcome = { kind: 'ok'; info: BuildInfo } | { kind: 'error' };

// /build-info.json, not a Worker route -- it's a plain static file Vite
// stamps into dist/ on every successful build (plugins/build-info.ts),
// served `no-store` specifically so a poll here always sees the CDN's
// actual current file, never a cached stale one (see hosting.test.ts's own
// "marks /build-info.json no-store" test).
export async function fetchBuildInfo(fetchImpl: typeof fetch = fetch): Promise<BuildInfoOutcome> {
  let response: Response;
  try {
    response = await fetchImpl('/build-info.json', { cache: 'no-store' });
  } catch {
    return { kind: 'error' };
  }
  if (!response.ok) return { kind: 'error' };
  try {
    const body = (await response.json()) as { sha?: unknown; builtAt?: unknown };
    if (typeof body.sha !== 'string' || typeof body.builtAt !== 'string') return { kind: 'error' };
    return { kind: 'ok', info: { sha: body.sha, builtAt: body.builtAt } };
  } catch {
    return { kind: 'error' };
  }
}

export const POLL_MIN_INTERVAL_MS = 5_000;
export const POLL_MAX_INTERVAL_MS = 30_000;
// 10 minutes -- Step 3's own number. GET /api/build-status answers `queued`
// when no Cloudflare deployment matches the sha yet, which is honest for the
// first few seconds but indistinguishable from "GitHub never notified
// Cloudflare" or "Pages is wired to the wrong branch" forever after --
// Plan 3's own build-status limbo, in a new shape, without a ceiling.
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const CONFIRM_INTERVAL_MS = 5_000;
// 60 seconds -- `deploy: success` means the CDN edge has the new build, not
// that a poll landing in the same second will see it; a brief propagation
// window is normal, not itself evidence of a problem.
export const CONFIRM_TIMEOUT_MS = 60_000;

// Exponential-ish backoff, capped: 5s, 7.5s, 11.25s, ... up to 30s. Never
// resets mid-poll -- a single trackPublish call only ever grows the delay,
// matching "back off", not "poll faster after a slow response".
export function nextPollDelay(previousMs: number): number {
  return Math.min(POLL_MAX_INTERVAL_MS, Math.round(previousMs * 1.5));
}

export type PublishProgress =
  | { phase: 'polling'; state: BuildState }
  | { phase: 'confirming' }
  | { phase: 'live' }
  | { phase: 'build-failed'; commitUrl: string | null }
  | { phase: 'stalled'; commitUrl: string | null }
  | { phase: 'mismatch' }
  | { phase: 'unauthenticated' };

// Every external effect this function needs, injected -- `now`/`sleep` so
// the ENTIRE 10-minute-timeout, backed-off, two-phase state machine below
// can be driven by a test with a fake clock and an instantly-resolving
// `sleep`, with no real timers and no component to render at all (see
// publish.test.ts). `signal` lets a caller (PublishBar, on unmount) stop a
// poll already in flight from ever calling `onProgress` again.
export interface PollDeps {
  fetchBuildStatus: (sha: string) => Promise<BuildStatusOutcome>;
  fetchBuildInfo: () => Promise<BuildInfoOutcome>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

async function confirmLive(sha: string, deps: PollDeps): Promise<PublishProgress> {
  const startedAt = deps.now();
  for (;;) {
    if (deps.signal?.aborted) return { phase: 'mismatch' };
    const outcome = await deps.fetchBuildInfo();
    if (outcome.kind === 'ok' && outcome.info.sha === sha) return { phase: 'live' };
    if (deps.now() - startedAt >= CONFIRM_TIMEOUT_MS) return { phase: 'mismatch' };
    await deps.sleep(CONFIRM_INTERVAL_MS);
  }
}

// The terminal result is both returned AND the last thing passed to
// `onProgress` -- a caller that only cares about the end state can await the
// return value; PublishBar also wants every INTERMEDIATE state (each
// `polling`/`confirming` tick) to update what she sees while she waits.
export async function trackPublish(sha: string, deps: PollDeps, onProgress: (progress: PublishProgress) => void): Promise<PublishProgress> {
  const finish = (result: PublishProgress): PublishProgress => {
    onProgress(result);
    return result;
  };

  let lastCommitUrl: string | null = null;
  const startedAt = deps.now();
  let delay = POLL_MIN_INTERVAL_MS;

  for (;;) {
    if (deps.signal?.aborted) return finish({ phase: 'stalled', commitUrl: lastCommitUrl });

    const outcome = await deps.fetchBuildStatus(sha);
    if (outcome.kind === 'unauthenticated') return finish({ phase: 'unauthenticated' });
    if (outcome.kind === 'ok') {
      lastCommitUrl = outcome.result.commitUrl;
      if (outcome.result.state === 'failed') return finish({ phase: 'build-failed', commitUrl: lastCommitUrl });
      if (outcome.result.state === 'live') {
        onProgress({ phase: 'confirming' });
        return finish(await confirmLive(sha, deps));
      }
      onProgress({ phase: 'polling', state: outcome.result.state });
    }
    // outcome.kind === 'error': a single dropped/failed poll is not itself
    // reported -- it falls through to the same backoff-and-retry every
    // other in-flight state gets, relying on the 10-minute ceiling below as
    // the real backstop, per this task's own "back off" instruction rather
    // than surfacing a scary error for one hiccuping request.

    if (deps.now() - startedAt >= POLL_TIMEOUT_MS) return finish({ phase: 'stalled', commitUrl: lastCommitUrl });
    await deps.sleep(delay);
    delay = nextPollDelay(delay);
  }
}
