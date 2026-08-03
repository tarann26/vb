// localStorage-backed draft store for unsaved dashboard edits (Task 10, Step
// 4). Site CONTENT, not a secret -- deliberately separate from the session,
// which is still never stored client-side at all (Task 1, Step 5;
// session.ts's own comment on why localStorage was rejected for THAT
// purpose specifically). Exists because in-memory React state does not
// survive a reload, a crashed tab, or iOS evicting a backgrounded tab --
// without this, the exact failure mode Steps 4/5 exist to prevent ("her
// work silently evaporates") happens the instant she loses the tab, with
// nothing telling her it happened.
//
// Scoped to CONTENT FILE edits only (the JSON src/content/*.json files a
// ContentRegistry tracks, see publish.ts) -- deliberately NOT the staged
// photo/menu-PDF bytes PhotoField/PdfField/staged.ts hold in memory. A
// single staged photo can be up to PhotoField's own MAX_STAGED_PHOTO_BYTES
// (5MB) as a raw file, which is roughly 6.7MB once base64-encoded (base64
// inflates by 4/3, RFC 4648) -- and up to MAX_STAGED_PHOTOS_PER_PUBLISH (8)
// of those at once is on the order of 53MB, comfortably over every
// browser's practical per-origin localStorage quota (5-10MB is typical, and
// exceeding it throws QuotaExceededError). Content JSON, by contrast, is
// plain text and small -- the entire real site/dishes/drinks/press/etc.
// corpus today is well under 50KB combined. A lost staged photo on reload
// is a real, known, and separately-scoped gap (she has to re-pick it) --
// recorded here deliberately rather than "solved" by silently truncating or
// dropping a draft the moment it stops fitting the quota, which would be a
// second, quieter version of the exact failure this file exists to prevent.
import type { ContentFileName } from './content';

// Plan 5 Task 5, Step 2: which of the two surfaces that can each hold their
// own unpublished edits -- the dashboard (AdminApp, /edit/manage) or the
// real-page editor (EditMode, /edit) -- a draft belongs to. Both read
// content through the identical nine `ContentFileName`s and both persist
// through this same module, but they are NOT the same session: she can
// have both open at once (a laptop tab on /edit/manage, a phone on /edit),
// each with its own in-memory ContentRegistry, each independently deciding
// what its own `registry.version` changing means. Before this type existed,
// both surfaces wrote the identical key with no coordination and nothing
// listening for a `storage` event, so the SECOND surface's next keystroke
// silently overwrote the FIRST's entire draft -- not just the one file it
// touched, because saveDraft's own contract (below) always writes the
// WHOLE current DraftMap, replacing whatever was there. `surface` is
// REQUIRED on every function below, not defaulted to one value -- the
// point of this change is that nothing may call these functions without
// deciding which draft it means.
export type DraftSurface = 'dashboard' | 'edit';

export const DRAFT_STORAGE_KEY = 'vb:draft:v1';
export const DRAFT_STAGED_COUNT_KEY = 'vb:draft:v1:staged-count';
// A second, independent key pair for /edit -- not a variant of the same
// key, and not a sub-field inside it: `loadDraft`'s own per-entry filter
// (below) has no notion of "which surface" a `DraftEntry` came from, so
// keeping the two surfaces' maps in physically separate localStorage
// entries is what makes "tab A edits dishes, tab B edits copy, both drafts
// survive" true without either surface's own save ever needing to know the
// other's current content.
export const EDIT_DRAFT_STORAGE_KEY = 'vb:draft:v1:edit';
export const EDIT_DRAFT_STAGED_COUNT_KEY = 'vb:draft:v1:edit:staged-count';

function draftStorageKey(surface: DraftSurface): string {
  return surface === 'dashboard' ? DRAFT_STORAGE_KEY : EDIT_DRAFT_STORAGE_KEY;
}

function draftStagedCountKey(surface: DraftSurface): string {
  return surface === 'dashboard' ? DRAFT_STAGED_COUNT_KEY : EDIT_DRAFT_STAGED_COUNT_KEY;
}

// A SEPARATE key, not a field inside DRAFT_STORAGE_KEY's own JSON -- see
// saveDraft/loadDraftStagedCount below for why. Review finding: a restored
// draft can reference a photo/PDF `contentPath` that was staged (uploaded,
// validated, and handed a real path by `?stage=1` -- worker/upload.ts) but
// never actually committed, because the tab was lost before Publish ran.
// The BYTES for that upload lived only in staged.ts's in-memory map, never
// in localStorage (drafts.ts's own header comment already explains why:
// base64 photo bytes routinely exceed a browser's practical localStorage
// quota) -- so after a reload, Restore can bring the REFERENCE back
// (dishes.json's `image` field, say) with no way to bring the referenced
// FILE back. Publishing that restored reference commits JSON pointing at a
// blob that was never written -- a broken image on the live site, reported
// as a success, exactly the silent failure Task 10's own carried
// requirement 3 exists to prevent, reached through the draft door instead
// of a missing `stage()` call. This key does not attempt to reconcile which
// SPECIFIC field is dangling (the draft's own JSON is indistinguishable
// from a path that published successfully in an earlier session); it
// records only a COUNT, so the restore banner can at least say honestly
// that some number of picked files were lost and need re-picking.
// (DRAFT_STAGED_COUNT_KEY itself is declared above, alongside
// DRAFT_STORAGE_KEY, now that both surfaces each need their own pair.)

export interface DraftEntry {
  data: unknown;
  // Date.now() at the moment this file was last written into the draft --
  // what formatRelativeTime below reads, and what a restore decides "from
  // <relative time>" against.
  savedAt: number;
}

export type DraftMap = Partial<Record<ContentFileName, DraftEntry>>;

function isDraftEntry(value: unknown): value is DraftEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    'data' in value &&
    typeof (value as { savedAt?: unknown }).savedAt === 'number'
  );
}

// Never throws. `localStorage.getItem`/`JSON.parse` can fail for reasons
// entirely outside this app's control (Safari private browsing's own quota
// quirks, a corrupted value left by an old schema version, a browser
// extension writing garbage under the same key) -- and a draft-restoration
// feature that itself crashes the dashboard on load would be strictly worse
// than the reload it exists to soften. Returns null for "no draft to
// offer", the same as "nothing was ever saved" -- a caller (AdminApp's own
// banner-or-not decision) has no reason to tell those two apart. A single
// malformed entry among otherwise-valid ones is dropped on its own, not
// treated as a reason to discard the whole map -- the identical
// per-item-not-whole-file posture worker/index.ts's `isStillPending`
// already takes toward one bad `publishAt` among many.
//
// `storage` is a parameter, not a bare `window.localStorage` reference in
// the body, so a test can inject a `Storage` that throws (a real, reachable
// state -- Safari private browsing rejects every localStorage write) without
// needing to delete or monkey-patch the real global. `surface` is REQUIRED,
// not defaulted -- see this module's own header comment on DraftSurface for
// why every call site must say which draft it means.
export function loadDraft(surface: DraftSurface, storage: Storage = window.localStorage): DraftMap | null {
  let raw: string | null;
  try {
    raw = storage.getItem(draftStorageKey(surface));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const entries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => isDraftEntry(value));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as DraftMap;
}

// Never throws -- see loadDraft's own comment above; a quota-exceeded write
// (real, reachable on some browsers/private-mode configurations) must not
// crash the dashboard she is actively using. Worst case, that one write is
// silently lost and the next change tries again -- the same "best effort,
// never load-bearing for the publish itself" posture worker/index.ts's own
// recordScheduledDates already takes toward its KV bookkeeping.
//
// An empty map REMOVES the key rather than writing `"{}"` -- so a caller
// that clears every dirty file (an undo back to nothing changed, or the
// last file included in a successful publish) leaves loadDraft() reading
// back null next time, not a technically-non-null-but-empty map a caller
// would have to special-case anyway.
// `stagedCount` -- how many photo/PDF uploads were staged (picked,
// uploaded, validated, NOT yet published) at the moment this save happened
// -- is written to DRAFT_STAGED_COUNT_KEY, a key of its own, not folded
// into the same JSON value as `map`. Deliberate: `map`'s own shape is
// parsed by iterating its entries and keeping only the ones that pass
// isDraftEntry (loadDraft's own per-entry defensive filter, so one
// malformed file never costs every other file) -- a sibling `stagedCount`
// field living inside that SAME object would either have to be excluded
// from that iteration by name (a growing list of "reserved" keys
// loadDraft's parser has to know about) or would itself need to look
// enough like a DraftEntry to survive the filter, neither of which is
// worth the coupling for one integer that has nothing to do with per-file
// parsing at all.
export function saveDraft(surface: DraftSurface, map: DraftMap, stagedCount: number = 0, storage: Storage = window.localStorage): void {
  try {
    if (Object.keys(map).length === 0) {
      storage.removeItem(draftStorageKey(surface));
    } else {
      storage.setItem(draftStorageKey(surface), JSON.stringify(map));
    }
  } catch {
    // Best effort -- see this function's own comment above.
  }
  try {
    if (stagedCount > 0) {
      storage.setItem(draftStagedCountKey(surface), String(Math.floor(stagedCount)));
    } else {
      storage.removeItem(draftStagedCountKey(surface));
    }
  } catch {
    // Best effort, same as above -- worst case the banner's own "N files
    // were lost" note is simply absent, never a crash.
  }
}

// Never throws -- same posture as loadDraft. Malformed or missing data
// (never written, corrupted by hand, a negative or non-numeric string) all
// read as 0 -- "nothing to warn about" is the safe default for a value that
// only ever adds one extra sentence to a banner, never gates anything.
export function loadDraftStagedCount(surface: DraftSurface, storage: Storage = window.localStorage): number {
  try {
    const raw = storage.getItem(draftStagedCountKey(surface));
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

// Called on a 200 from POST /api/publish (Step 4's own instruction) and
// when she chooses Discard on the restore banner. Clears BOTH keys for the
// GIVEN surface only -- never the other surface's draft, which is exactly
// the point of Step 2's separation: a successful publish (or an explicit
// Discard) from ONE surface says nothing about whether the OTHER surface
// still has real, unpublished work of its own. Same best-effort posture as
// saveDraft: a failed removeItem leaves a stale draft (or a stale
// staged-count note) sitting in localStorage, which is merely a spurious
// banner on her NEXT visit -- annoying, not destructive -- rather than
// something worth crashing this call site over.
export function clearDraft(surface: DraftSurface, storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(draftStorageKey(surface));
  } catch {
    // Best effort, same as saveDraft.
  }
  try {
    storage.removeItem(draftStagedCountKey(surface));
  } catch {
    // Best effort, same as saveDraft.
  }
}

// The single most recent savedAt across every file in the draft -- what the
// banner's own "unsaved changes from <relative time>" line is relative to,
// since a draft can carry edits to several files, each saved at a slightly
// different moment.
export function mostRecentSavedAt(map: DraftMap): number | null {
  const savedAts = Object.values(map)
    .filter((entry): entry is DraftEntry => entry !== undefined)
    .map((entry) => entry.savedAt);
  return savedAts.length === 0 ? null : Math.max(...savedAts);
}

// A short, human relative-time phrase -- "just now", "3 minutes ago", "2
// hours ago" -- never a raw timestamp or ISO string, which is not what a
// non-technical owner reads at a glance mid-workday. `now` is a parameter
// (not a bare `Date.now()` call in the body), the same reason
// `todayInKolkata`'s callers pass `today` in (src/content/publish.ts) and
// `resolveCommitSha`'s callers pass `gitRevParse` in (plugins/build-info.ts):
// it lets this be tested deterministically, without faking the system
// clock. Clamped at zero so clock skew (a `savedAt` fractionally in the
// future, e.g. a device whose clock is a few seconds fast) reads as "just
// now" rather than a nonsensical negative duration.
export function formatRelativeTime(savedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - savedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
