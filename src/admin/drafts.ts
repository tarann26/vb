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

export const DRAFT_STORAGE_KEY = 'vb:draft:v1';

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
// needing to delete or monkey-patch the real global.
export function loadDraft(storage: Storage = window.localStorage): DraftMap | null {
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
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
export function saveDraft(map: DraftMap, storage: Storage = window.localStorage): void {
  try {
    if (Object.keys(map).length === 0) {
      storage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Best effort -- see this function's own comment above.
  }
}

// Called on a 200 from POST /api/publish (Step 4's own instruction) and
// when she chooses Discard on the restore banner. Same best-effort posture
// as saveDraft: a failed removeItem leaves a stale draft sitting in
// localStorage, which is merely a spurious "you have unsaved changes" banner
// on her NEXT visit -- annoying, not destructive -- rather than something
// worth crashing this call site over.
export function clearDraft(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
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
