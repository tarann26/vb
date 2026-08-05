// One step back from the publish she just made -- the client half. Sibling
// to publish.ts, and deliberately small: there is no history, no stack, no
// named snapshots, and no redo. One step back from the thing she just did,
// or nothing.
//
// The offer is held HERE, in localStorage, written when a publish returns
// 200 and deleted the instant an undo lands. It is never derived from
// whatever happens to be at the branch head. That is the single most
// important decision in this feature, and it is not an optimisation: content
// in this repository has historically arrived by hand commit, so a
// head-inspecting version would cheerfully offer to revert a developer's
// edit and describe it to her as "the change you published". Holding the
// record client-side makes that structurally impossible rather than merely
// unlikely, and it makes "press undo twice" unreachable rather than
// refused -- there is nothing left to press.
import { CONTENT_FILES, CONTENT_FILE_LABELS, type ContentFileName } from './content';

// ONE key, shared by both surfaces -- deliberately unlike drafts.ts, which
// keeps a separate key per surface. The reason they differ: an unpublished
// edit belongs to the tab that made it, but the repository is global. A
// publish from /edit and a publish from /edit/manage move the same branch,
// so there is exactly one "last thing published" at any moment, and two
// per-surface records would let one surface offer to undo a commit the
// other had already superseded.
export const UNDO_STORAGE_KEY = 'vb:undo:v1';

export interface UndoRecord {
  // The commit this publish created -- what the server checks the branch
  // head against before it will put anything back.
  sha: string;
  // Epoch ms, so the offer can say "4 minutes ago" rather than showing her a
  // timestamp.
  at: number;
  // Exactly the repo paths that publish sent. Used only to describe the
  // change in her own words; the server re-derives what to restore from the
  // commit itself and never trusts this.
  paths: string[];
}

// Every function below is never-throw and takes an injectable Storage, the
// same posture drafts.ts documents: Safari's private mode throws on write,
// a corrupted value must not crash a caller, and -- most importantly --
// `rememberPublish` runs in the SUCCESS path of a publish that has already
// landed. A QuotaExceededError there has to degrade to "no undo offered",
// never to an exception in front of a publish that actually worked.
function safeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberPublish(record: UndoRecord, storage?: Storage): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(UNDO_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // No undo offered. Never a thrown error on top of a successful publish.
  }
}

// How long a publish stays undoable. Review finding: there was no bound at
// all, and `rememberPublish` overwrites on every publish, so the very first
// publish from a browser made "Undo my last publish" a permanent fixture of
// both surfaces -- contradicting PublishBar's own description of it as "a
// two-minute safety net, not a time machine" that "vanishes". Left alone,
// she could open the dashboard on Friday and be offered an undo of Monday's
// publish; on a single-owner site nothing else will have moved `main`, so
// the server would accept it and four days of live content would revert on
// one click, described to her as "the change you published".
//
// One hour, not two minutes: a publish takes two to three minutes to go
// live, so a literal two-minute window would expire before she could even
// look at the result. An hour covers "publish, look at the site, notice the
// mistake, put it back" with room for an interruption, and is short enough
// that anything it offers is still something she was doing today.
export const UNDO_MAX_AGE_MS = 60 * 60 * 1000;

export function loadUndoRecord(storage?: Storage, now: number = Date.now()): UndoRecord | null {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(UNDO_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const { sha, at, paths } = parsed as { sha?: unknown; at?: unknown; paths?: unknown };
    if (typeof sha !== 'string' || sha.length === 0) return null;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === 'string')) return null;
    // Read as "no offer", not removed: a clock that is briefly wrong (a
    // laptop waking with a stale time, a timezone-confused device) must not
    // be able to destroy a record another tab is legitimately holding. The
    // key is overwritten by the next publish anyway.
    if (now - at > UNDO_MAX_AGE_MS) return null;
    return { sha, at, paths };
  } catch {
    return null;
  }
}

export function clearUndoRecord(storage?: Storage): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.removeItem(UNDO_STORAGE_KEY);
  } catch {
    // Nothing to do -- the worst case is an offer that lingers, and the
    // server refuses a stale sha with a 409 anyway.
  }
}

// ---------------------------------------------------------------------------
// What she is told she is about to put back. Never a raw path or filename:
// PublishBar already carries a review finding against showing her internal
// validator paths, and 'src/content/dishes.json' is the same mistake in a
// different costume.

const CONTENT_PATH_PREFIX = 'src/content/';

// Every label in CONTENT_FILE_LABELS, plus a menu PDF named as a category
// rather than by filename -- she replaced "a menu PDF", not
// 'public/menus/food-menu.pdf'.
//
// A photo is deliberately NOT listed here, and that is a correctness point
// rather than brevity. Photo paths are content-addressed, so a photo
// publish is always an ADD at a brand-new path, and an undo skips added
// paths entirely -- it puts back the JSON that POINTS at a photo, never the
// photo file. Listing "a photo" alongside "Dishes" would suggest the file
// itself is being rolled back; what actually happens to the photo she can
// SEE is said separately by `describesAddedPhoto` below. A menu PDF is the
// opposite case and must be listed: its path is name-based, so replacing
// one leaves menus.json unchanged and the blob restore is the only thing
// that puts the old PDF back.
export function describePaths(paths: string[]): string {
  const labels: string[] = [];
  let sawMenu = false;

  paths.forEach((path) => {
    if (path.startsWith(CONTENT_PATH_PREFIX)) {
      const name = path.slice(CONTENT_PATH_PREFIX.length);
      if ((CONTENT_FILES as readonly string[]).includes(name)) {
        const label = CONTENT_FILE_LABELS[name as ContentFileName];
        if (!labels.includes(label)) labels.push(label);
      }
      return;
    }
    if (path.startsWith('public/menus/')) sawMenu = true;
  });

  if (sawMenu) labels.push('a menu PDF');
  // A generic fallback rather than the path itself -- the leak this function
  // exists to prevent must not reappear through an unrecognised shape.
  if (labels.length === 0) return 'your last change';
  return labels.join(' and ');
}

// Whether this publish added a photo -- i.e. whether the undo she is about
// to confirm will visibly take a photo off the site.
//
// Review finding (Important): the sentence this drives used to promise the
// opposite of what happens. It said the uploaded photo would not be deleted,
// which is true of the FILE (an added path is absent from the parent tree,
// so the restore skips it and the blob stays in the repository) and false of
// everything she can see: the content JSON that points at it is restored, so
// the dish goes back to its previous photo, or to no photo at all if this
// was the first one. An unreferenced blob in a git repository is not
// something a restaurant owner has a concept of, and "your photo is safe" is
// not a claim worth making about it. PublishBar's confirmation now says what
// she will actually watch happen.
export function describesAddedPhoto(paths: string[]): boolean {
  return paths.some((path) => path.startsWith('assets-source/'));
}

// ---------------------------------------------------------------------------
// POST /api/undo. Same discriminated-union shape requestPublish returns, and
// branched on STATUS alone -- never on message text.

export type UndoRequestResult =
  | { status: 'success'; sha: string }
  | { status: 'conflict' }
  | { status: 'unauthenticated' }
  | { status: 'server-error' }
  | { status: 'network-error' };

export async function requestUndo(sha: string, fetchImpl: typeof fetch = fetch): Promise<UndoRequestResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/undo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha }),
    });
  } catch {
    return { status: 'network-error' };
  }

  if (response.status === 200) {
    try {
      const body = (await response.json()) as { sha?: unknown };
      if (typeof body.sha === 'string') return { status: 'success', sha: body.sha };
    } catch {
      // falls through to server-error
    }
    return { status: 'server-error' };
  }
  if (response.status === 401) return { status: 'unauthenticated' };
  // 409 covers both the stale-sha refusal and "this commit cannot be put
  // back" -- one status, one meaning, no new parsing rule.
  if (response.status === 409) return { status: 'conflict' };
  return { status: 'server-error' };
}
