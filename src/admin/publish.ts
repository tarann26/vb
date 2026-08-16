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
  // Called by a section's own load-effect ONLY -- once with the
  // freshly-fetched value, and again (still load-time) if a restored draft
  // exists for this file (registerLoaded's own two-call contract,
  // AdminApp.tsx). Review finding (Critical): this used to ALSO be what a
  // section's own commit/onChange path called on every edit, passing its
  // own stale, load-time `sha` back in and clobbering whatever
  // `markPublished` had just refreshed it to -- see `updateData` below,
  // which is what a write path calls now. Mutates a ref SYNCHRONOUSLY, not
  // through setState: the Publish button's own click handler un-focuses
  // whatever field is currently focused before reading anything (Step 1's
  // "flush the focused field" requirement, TagsInput's onBlur-commits-the-
  // buffer contract), and that focus-loss's own onChange -> ... ->
  // updateData() chain runs synchronously, in the SAME call stack, as part
  // of dispatching the underlying DOM focus-out notification -- a version
  // of this that only updated REACT STATE would not be visible to
  // getEntries() until the next render, which is too late: the whole point
  // is that Publish reads the flushed value in the SAME synchronous call
  // that triggered the flush, not a value from before it.
  register: (file: ContentFileName, data: unknown, sha: string) => void;
  // Review finding (Critical): every section's own write path (its
  // `commit`/`onChange`) used to call `register` too, passing its OWN
  // local `sha` -- captured once at load time and never refreshed after a
  // publish. `register`'s own contract OVERWRITES the tracked `sha`
  // unconditionally (see its own comment: it exists to re-pin a file on
  // every fresh LOAD, restoreDraft's second call included), so a second
  // publish of the same file later in the same session sent that stale
  // `sha` back as `baseSha` and was refused with a 409 -- as if someone
  // else had published, when the only "someone else" was her own prior,
  // already-successful publish (markPublished's own fresh `sha` was
  // overwritten the instant she typed the next keystroke). `updateData`
  // is the one write path a commit/onChange should call instead: touches
  // `data` only, leaves `sha`/`initial` exactly as `register`/
  // `markPublished` last set them. A no-op if the file has never been
  // registered at all -- every real call site only exists once its own
  // section has already loaded (and therefore already registered), so
  // this guards a state that should be unreachable rather than silently
  // inventing a `sha` this module has no way to know is correct.
  updateData: (file: ContentFileName, data: unknown) => void;
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

  // Touches `data` only -- `sha` and `initial` stay exactly what `register`
  // (the load path) or `markPublished` (a prior success) last set them to.
  // See ContentRegistry's own comment on `updateData` for the Critical this
  // fixes: a write path that instead called `register` re-passed its own
  // stale, load-time `sha`, clobbering a fresh one `markPublished` had just
  // written. No entry for `file` yet is treated as a caller bug, not a
  // reason to invent one -- every real call site is a section's own
  // commit/onChange, reachable only after that section's own load-effect
  // has already registered it at least once.
  const updateData = useCallback((file: ContentFileName, data: unknown) => {
    const existing = ref.current[file];
    if (!existing) return;
    ref.current = { ...ref.current, [file]: { ...existing, data } };
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

  return { register, updateData, getEntries, version, markPublished };
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

// Review finding (Critical): the "same location" a leaf gets restored to
// when it names a staged file is found by matching `id`, not raw array
// index, wherever `initial` is itself an array of id-carrying records
// (dishes/drinks/press/menus) -- every reorderable list in this dashboard
// already treats `id` as a record's true identity independent of its
// position (RecordList's own onReorder, markPublished's own snapshot), and
// pairing `data[3]` against `initial[3]` by bare position would silently
// pull the WRONG record's committed value if she reordered the same list in
// the same session. Arrays with no `id` field to key on (galleries.json's
// three lists) and a brand-new record `initial` has no counterpart for at
// all (added this session, nothing committed to fall back to) both fall
// through to plain index, which `initialCounterpart`'s own `undefined`
// return handles the same way scrubStagedReferences' own default does: a
// blank leaf is always a safe, actionable value (validateContent's own
// "needs an image" rule), never a broken reference.
// Review finding (Important), and the reason the id match above cannot stop at
// the sibling array it is handed.
//
// `galleries.heroCollage` is a TREE, and Plan 9's drag-to-swap moves a photo
// between BRANCHES of it, not merely between positions in one array (see
// src/content/collage.ts's `swapCollagePhotos`: each photo carries its own id,
// src and alt into the other's box). A photo that crossed a branch has no id
// match among its new siblings, so the walk fell through to `initial[key]` --
// the committed photo that used to occupy that POSITION -- and restored a
// staged photo to a DIFFERENT photograph's src: one photograph in the hero
// twice, the one she was replacing gone, and nothing to refuse it, since
// validateContent has a duplicate-ID rule for the collage but no duplicate-SRC
// rule. That is strictly worse than the blank this fallback was reasoned
// about ("a blank leaf is always a safe, actionable value"), because a blank
// IS refused and this is not.
//
// So the id lookup is widened from "these siblings" to "anywhere in this
// file's committed value", built once per file rather than searched per miss.
// Every content file's ids are unique within the file -- validateContent's own
// duplicate-id rules (collage nodes, dishes/drinks/press/menus/pages/sections
// records) are what make that true rather than a coincidence -- so an id names
// at most one committed record and the answer is unambiguous. A record ADDED
// this session is in no index at all and still falls through to blank, which
// is the case the fallback was written for and the one that stays.
function indexInitialById(value: unknown, into: Map<string, unknown>): Map<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((item) => indexInitialById(item, into));
    return into;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // First one wins, in document order -- with ids unique per file there is
    // never a second, and a file that somehow carried one gets a stable answer
    // rather than one that depends on walk order.
    if (typeof record.id === 'string' && !into.has(record.id)) into.set(record.id, value);
    Object.values(record).forEach((child) => indexInitialById(child, into));
  }
  return into;
}

function initialCounterpart(
  initial: unknown,
  key: string | number,
  sibling: unknown,
  byId: Map<string, unknown>,
): unknown {
  if (Array.isArray(initial)) {
    if (typeof key !== 'number') return undefined;
    const siblingId = sibling !== null && typeof sibling === 'object' ? (sibling as Record<string, unknown>).id : undefined;
    if (typeof siblingId === 'string') {
      const match = initial.find(
        (item) => item !== null && typeof item === 'object' && (item as Record<string, unknown>).id === siblingId,
      );
      if (match !== undefined) return match;
      // Not among these siblings: it moved somewhere else in this file (a
      // collage swap across branches) rather than being new. See
      // `indexInitialById` above.
      const moved = byId.get(siblingId);
      if (moved !== undefined) return moved;
    }
    return initial[key];
  }
  if (initial !== null && typeof initial === 'object' && typeof key === 'string') {
    return (initial as Record<string, unknown>)[key];
  }
  return undefined;
}

// Review finding (Critical): reproduced end to end -- she stages a photo
// (drafts.ts's own case for why this exists: iOS evicting a backgrounded
// tab), the tab dies before Publish ever runs, she reloads, is offered the
// draft, clicks Restore, and publishes. The RESTORED record still names the
// staged `contentPath`; the bytes behind it lived only in staged.ts's
// in-memory map and died with the tab. Publish carries `dishes.json` with
// its own `image` field naming a food-category derivative under a hash it
// never committed, and zero staged files -- accepted (the Worker's own
// validateContent has no filesystem to check against), landing
// on `main`, where the deploy gate's own asset-existence check then fails
// FOREVER, for every subsequent publish of anything, until a developer
// hand-edits the JSON. Fixed here, not at Restore time: `dirtyDraftMap` runs
// on every persistence tick (AdminApp's own effect, keyed on
// `registry.version`), long before any tab ever dies, so a reference to a
// currently-staged file's own bytes is scrubbed out of what gets WRITTEN to
// localStorage in the first place -- replaced with whatever `initial`
// (the last committed value) held at the same location. A restored draft
// therefore cannot carry a reference this collector itself has already
// forgotten it ever staged: Restore is safe by construction, not by asking
// her to notice a warning count and act on it (staleStagedCount's own,
// separate, honest "some picked files were lost" note is what THAT is for).
function scrubStagedReferences(
  data: unknown,
  initial: unknown,
  stagedContentPaths: Set<string>,
  byId: Map<string, unknown>,
): unknown {
  if (typeof data === 'string') {
    if (!stagedContentPaths.has(data)) return data;
    return typeof initial === 'string' ? initial : '';
  }
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      scrubStagedReferences(item, initialCounterpart(initial, index, item, byId), stagedContentPaths, byId),
    );
  }
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
      result[key] = scrubStagedReferences(value, initialCounterpart(initial, key, value, byId), stagedContentPaths, byId);
    });
    return result;
  }
  return data;
}

// The draft map (drafts.ts) is scoped to content JSON only -- see that
// file's own comment on why staged photo/PDF bytes are deliberately left
// out (localStorage's practical quota). Every currently dirty file is
// re-stamped with `now` on every call: this only ever runs from AdminApp's
// own persistence effect, which only fires when the registry's `version`
// actually moved (a real edit, or a fresh load) -- so `now` genuinely means
// "as of the last thing she touched", not a fabricated recency. `staged` is
// the collector's own live map (PublishBar.tsx's own call site has it in
// scope already) -- every leaf equal to one of ITS `contentPath` values is
// scrubbed via `scrubStagedReferences` above before this file's `data` is
// written out; skipped entirely (not merely a no-op walk) when nothing is
// currently staged, the overwhelmingly common case, so an ordinary edit
// with no photo involved costs nothing extra.
export function dirtyDraftMap(entries: ContentEntries, staged: Record<string, StagedFile> = {}, now: number = Date.now()): DraftMap {
  const stagedContentPaths = new Set(Object.values(staged).map((file) => file.contentPath));
  const map: DraftMap = {};
  dirtyContentFiles(entries).forEach((file) => {
    const entry = entries[file]!;
    const data =
      stagedContentPaths.size === 0
        ? entry.data
        : scrubStagedReferences(entry.data, entry.initial, stagedContentPaths, indexInitialById(entry.initial, new Map()));
    map[file] = { data, savedAt: now };
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
// Originally reasoned about against Task 10's own carried-forward gap: a
// blind retry of a mixed publish (a D1 file plus a GitHub file in the same
// request) can misattribute a conflict to a third party, because D1's own
// baseSha (a sha256 of the body) moves the instant the D1 leg lands, exactly
// the way a reversed write order would move a GitHub blob sha (see
// worker/index.ts's own comment on handlePublish's write step).
//
// Fix round 1 review found that this function CANNOT reach that case today,
// and this paragraph corrects the claim rather than leaving it standing:
// `contentSnapshots` is keyed by `ContentFileName` (content.ts's
// `CONTENT_FILES`), and `awards.json` -- the only D1-only path
// (worker/store.ts's D1_ONLY_PATHS) -- is not in that list (Awards has no
// editable panel this phase; see fields.ts). It can therefore never appear
// in a snapshot this function is handed, and a single publish request
// touching both a D1 path and a GitHub path is unreachable under either
// CONTENT_STORE setting today regardless. Task 11 (the Awards dashboard
// panel) is what will first make the mixed-publish case reachable.
//
// What this DOES do today, and is kept for: any GitHub-only publish whose
// response reported `conflict` or `server-error` after the commit in fact
// landed -- a redundant retry racing its own prior success, or a failure
// response for a write that otherwise went through. The 409/502 the client
// sees carries no path list and no `partial` flag -- requestPublish branches
// on STATUS alone, never on body text -- so there is no wire signal to say
// WHICH file (if any) already landed. This works around that with no wire
// change at all: it re-reads every file THIS request attempted and compares
// the CURRENT committed content against what was actually sent. A match is
// proof the write took, whatever opaque token the store now carries for it
// -- not merely a coincidence to disbelieve -- so that file is reconciled
// exactly the way a successful publish already reconciles it
// (`markPublished`, preserving any edit made since). A mismatch means
// someone else's content is genuinely different, and is left entirely
// alone: this function never writes a fresh baseSha over a file it cannot
// prove landed, which is what keeps a genuine external conflict refusing on
// the next attempt instead of silently fast-forwarding over it. That safety
// property holds independent of which scenario ends up reaching this
// function, which is why it stays wired in rather than reverted.
//
// Best-effort and silent: called after a failure has already been reported,
// so a re-read that itself fails just leaves that file exactly as stale as
// it already was -- no worse than not attempting this at all.
export async function reconcileAfterConflict(
  registry: Pick<ContentRegistry, 'markPublished'>,
  contentSnapshots: Partial<Record<ContentFileName, unknown>>,
  fetchContentImpl: (file: ContentFileName) => Promise<{ data: unknown; sha: string }> = fetchContent,
): Promise<void> {
  const files = Object.keys(contentSnapshots) as ContentFileName[];
  const updates: Partial<Record<ContentFileName, { data: unknown; sha: string }>> = {};
  await Promise.all(
    files.map(async (file) => {
      try {
        const current = await fetchContentImpl(file);
        if (JSON.stringify(current.data) === JSON.stringify(contentSnapshots[file])) {
          updates[file] = { data: contentSnapshots[file], sha: current.sha };
        }
      } catch {
        // Swallowed -- see this function's own header comment.
      }
    }),
  );
  if (Object.keys(updates).length > 0) registry.markPublished(updates);
}

// ---------------------------------------------------------------------------
// POST /api/publish itself. One outcome per row of Step 5's translation
// table, plus the two this table doesn't need translating (success, and a
// request that never reached the server at all).

export type PublishRequestResult =
  | { status: 'success'; sha: string | null; publishId: string; d1Paths: string[] }
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
      const body = (await response.json()) as { sha?: unknown; publishId?: unknown; d1Paths?: unknown };
      // `sha` is null for a publish that touched only D1 -- no commit, no
      // Pages build, live immediately. Accepted as null rather than coerced
      // to a string: a fabricated sha here would be polled against
      // build-status forever and time out after ten minutes on a publish
      // that was actually finished before the response arrived.
      if (typeof body.publishId === 'string' && (body.sha === null || typeof body.sha === 'string')) {
        return {
          status: 'success',
          sha: body.sha ?? null,
          publishId: body.publishId,
          d1Paths: Array.isArray(body.d1Paths) ? (body.d1Paths as string[]) : [],
        };
      }
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
