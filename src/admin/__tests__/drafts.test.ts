import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAFT_STAGED_COUNT_KEY,
  DRAFT_STORAGE_KEY,
  EDIT_DRAFT_STORAGE_KEY,
  clearDraft,
  formatRelativeTime,
  loadDraft,
  loadDraftStagedCount,
  mostRecentSavedAt,
  saveDraft,
  type DraftMap,
} from '../drafts';

// Review finding: this comment previously claimed jsdom supplies a working
// `localStorage` -- wrong. Under this exact toolchain (Node 25, Vitest
// 2.1.9, jsdom 25.0.1), `window.localStorage` resolves to NODE's own
// native, unflagged `localStorage` global (backed by a file
// `--localstorage-file` selects), not jsdom's real implementation -- and
// with no valid file configured, every method on Node's version is
// `undefined`. src/test/setup.ts polyfills it with a plain in-memory
// `Storage`, feature-detected the same way that file's other jsdom-gap
// polyfills are; see that file's own comment for the full story. These
// tests use `window.localStorage` directly (that polyfill), EXCEPT for the
// two tests that specifically need a Storage that throws (a real, reachable
// state regardless of which implementation is running -- Safari private
// browsing rejects every write).
afterEach(() => {
  window.localStorage.clear();
});

const DISHES_ENTRY = { data: [{ id: 'a', name: 'Edited' }], savedAt: 1_000 };

describe('loadDraft: nothing saved', () => {
  it('returns null when the key was never written', () => {
    expect(loadDraft('dashboard')).toBeNull();
  });
});

describe('saveDraft / loadDraft: round-trip', () => {
  it('round-trips a single file', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    expect(loadDraft('dashboard')).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('round-trips several files, each with its own savedAt', () => {
    const map: DraftMap = {
      'dishes.json': DISHES_ENTRY,
      'site.json': { data: { hours: [] }, savedAt: 2_000 },
    };
    saveDraft('dashboard', map);
    expect(loadDraft('dashboard')).toEqual(map);
  });

  // The actual bug class this whole module exists to prevent: a caller that
  // writes under a DIFFERENT key, or a caller elsewhere in the app that
  // reads the key directly instead of going through loadDraft, would both
  // be invisible to a test that only ever calls saveDraft-then-loadDraft
  // through this module's own functions.
  it('writes under the documented key, verbatim', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('saving a second, different map overwrites the first entirely, not merges into it', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    saveDraft('dashboard', { 'site.json': { data: {}, savedAt: 5_000 } });
    expect(loadDraft('dashboard')).toEqual({ 'site.json': { data: {}, savedAt: 5_000 } });
  });
});

describe('saveDraft({}): clears rather than writing an empty object', () => {
  it('removes the key entirely -- loadDraft reads back null, not {}', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    saveDraft('dashboard', {});
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(loadDraft('dashboard')).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes an existing draft', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    clearDraft('dashboard');
    expect(loadDraft('dashboard')).toBeNull();
  });

  it('is a harmless no-op when nothing was ever saved', () => {
    expect(() => clearDraft('dashboard')).not.toThrow();
    expect(loadDraft('dashboard')).toBeNull();
  });

  it('also clears the sibling staged-count key', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 3);
    expect(loadDraftStagedCount('dashboard')).toBe(3);
    clearDraft('dashboard');
    expect(loadDraftStagedCount('dashboard')).toBe(0);
    expect(window.localStorage.getItem(DRAFT_STAGED_COUNT_KEY)).toBeNull();
  });
});

describe('saveDraft / loadDraftStagedCount: the staged-file-loss note', () => {
  it('round-trips a positive count', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 5);
    expect(loadDraftStagedCount('dashboard')).toBe(5);
  });

  it('defaults to 0 when saveDraft is called with no count at all', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    expect(loadDraftStagedCount('dashboard')).toBe(0);
  });

  it('a count of 0 removes the key rather than writing "0"', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 3);
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 0);
    expect(window.localStorage.getItem(DRAFT_STAGED_COUNT_KEY)).toBeNull();
    expect(loadDraftStagedCount('dashboard')).toBe(0);
  });

  it('nothing ever saved -> 0', () => {
    expect(loadDraftStagedCount('dashboard')).toBe(0);
  });

  it('a corrupted value (non-numeric, negative) never throws and reads as 0', () => {
    window.localStorage.setItem(DRAFT_STAGED_COUNT_KEY, 'not a number');
    expect(loadDraftStagedCount('dashboard')).toBe(0);
    window.localStorage.setItem(DRAFT_STAGED_COUNT_KEY, '-4');
    expect(loadDraftStagedCount('dashboard')).toBe(0);
  });

  it('is written under its OWN key, not inside DRAFT_STORAGE_KEY\'s JSON', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 2);
    const rawDraft = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!);
    expect(rawDraft).toEqual({ 'dishes.json': DISHES_ENTRY });
    expect(rawDraft.stagedCount).toBeUndefined();
    expect(window.localStorage.getItem(DRAFT_STAGED_COUNT_KEY)).toBe('2');
  });
});

describe('loadDraft: malformed or hostile data already stored never throws', () => {
  it('non-JSON text -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, 'not json at all {{{');
    expect(loadDraft('dashboard')).toBeNull();
  });

  it('valid JSON that is an array, not an object -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '[1,2,3]');
    expect(loadDraft('dashboard')).toBeNull();
  });

  it('valid JSON that is a bare string -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '"hello"');
    expect(loadDraft('dashboard')).toBeNull();
  });

  it('valid JSON that is null -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, 'null');
    expect(loadDraft('dashboard')).toBeNull();
  });

  // A per-entry defect (one file's own savedAt lost or corrupted) drops
  // ONLY that entry, not the whole draft -- one unreadable file's draft is
  // not a reason to throw away every other file's readable one.
  it('one malformed entry among valid ones is dropped, not the whole draft', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        'dishes.json': DISHES_ENTRY,
        'drinks.json': { data: [], savedAt: 'not a number' },
        'press.json': { data: [] }, // no savedAt at all
      }),
    );
    expect(loadDraft('dashboard')).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('an object with every entry malformed -> null, not an empty-but-present map', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ 'dishes.json': { nope: true } }));
    expect(loadDraft('dashboard')).toBeNull();
  });
});

describe('loadDraft / saveDraft: a Storage that throws never crashes the caller', () => {
  const THROWING_STORAGE: Storage = {
    getItem() {
      throw new Error('quota / disabled storage');
    },
    setItem() {
      throw new Error('quota / disabled storage');
    },
    removeItem() {
      throw new Error('quota / disabled storage');
    },
    clear() {},
    key() {
      return null;
    },
    length: 0,
  };

  it('loadDraft returns null rather than throwing', () => {
    expect(() => loadDraft('dashboard', THROWING_STORAGE)).not.toThrow();
    expect(loadDraft('dashboard', THROWING_STORAGE)).toBeNull();
  });

  it('saveDraft swallows the failure rather than throwing', () => {
    expect(() => saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 0, THROWING_STORAGE)).not.toThrow();
  });

  it('loadDraftStagedCount returns 0 rather than throwing', () => {
    expect(() => loadDraftStagedCount('dashboard', THROWING_STORAGE)).not.toThrow();
    expect(loadDraftStagedCount('dashboard', THROWING_STORAGE)).toBe(0);
  });

  it('clearDraft swallows the failure rather than throwing', () => {
    expect(() => clearDraft('dashboard', THROWING_STORAGE)).not.toThrow();
  });
});

// Plan 5 Task 5, Step 2: the decision, not a deferral. Both AdminApp
// (/edit/manage) and EditMode (/edit) can be open at once, each holding its
// own PublishBar, each independently deciding when to save. Before this,
// both called saveDraft/loadDraft/clearDraft against the SAME key with no
// coordination, so the second surface's next edit silently discarded the
// first's entire draft -- not just the file it touched, since saveDraft
// always writes the WHOLE current map. Separate keys per surface (this
// test) is the fix that was chosen; see drafts.ts's own DraftSurface
// comment for why the alternative (one key, a per-file merge, a `storage`
// listener) was not.
describe("Plan 5 Task 5, Step 2: 'dashboard' and 'edit' persist to separate keys and never clobber each other", () => {
  // The plan's own named test: tab A (the dashboard) edits dishes, tab B
  // (edit mode) edits copy, both drafts survive -- proven here as two
  // independent saveDraft calls, one per surface, exactly what each
  // PublishBar instance's own persistence effect does in the real app.
  it('tab A edits dishes (dashboard), tab B edits copy (edit) -- both drafts survive, neither overwrites the other', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    saveDraft('edit', { 'copy.json': { data: { hero: { reserveButton: 'Book Now' } }, savedAt: 2_000 } });

    expect(loadDraft('dashboard')).toEqual({ 'dishes.json': DISHES_ENTRY });
    expect(loadDraft('edit')).toEqual({ 'copy.json': { data: { hero: { reserveButton: 'Book Now' } }, savedAt: 2_000 } });
  });

  // Mutation this guards: draftStorageKey always returning DRAFT_STORAGE_KEY
  // regardless of `surface` -- confirmed red: the 'edit' surface's own save
  // would land under the SAME key as 'dashboard', and loadDraft('dashboard')
  // would read back copy.json's draft instead of dishes.json's.
  it("a LATER save on one surface does not overwrite what the OTHER surface already saved", () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    saveDraft('edit', { 'copy.json': { data: {}, savedAt: 1_000 } });
    // A second, later edit-mode save, of a DIFFERENT file -- the exact
    // "next keystroke" the review finding names.
    saveDraft('edit', { 'story.json': { data: {}, savedAt: 3_000 } });

    expect(loadDraft('dashboard')).toEqual({ 'dishes.json': DISHES_ENTRY });
    expect(loadDraft('edit')).toEqual({ 'story.json': { data: {}, savedAt: 3_000 } });
  });

  it('each surface has its own staged-count key too', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 2);
    saveDraft('edit', { 'copy.json': { data: {}, savedAt: 1_000 } }, 5);
    expect(loadDraftStagedCount('dashboard')).toBe(2);
    expect(loadDraftStagedCount('edit')).toBe(5);
  });

  it('clearing one surface leaves the other completely untouched', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY }, 1);
    saveDraft('edit', { 'copy.json': { data: {}, savedAt: 1_000 } }, 1);

    clearDraft('dashboard');

    expect(loadDraft('dashboard')).toBeNull();
    expect(loadDraftStagedCount('dashboard')).toBe(0);
    expect(loadDraft('edit')).toEqual({ 'copy.json': { data: {}, savedAt: 1_000 } });
    expect(loadDraftStagedCount('edit')).toBe(1);
  });

  it('the two surfaces really do use two different, real localStorage keys', () => {
    saveDraft('dashboard', { 'dishes.json': DISHES_ENTRY });
    saveDraft('edit', { 'copy.json': { data: {}, savedAt: 1_000 } });
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(EDIT_DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBe(window.localStorage.getItem(EDIT_DRAFT_STORAGE_KEY));
  });
});

describe('mostRecentSavedAt', () => {
  it('null for an empty map', () => {
    expect(mostRecentSavedAt({})).toBeNull();
  });

  it('the one savedAt for a single-file map', () => {
    expect(mostRecentSavedAt({ 'dishes.json': DISHES_ENTRY })).toBe(1_000);
  });

  it('the MAXIMUM savedAt across several files, not the first or last key', () => {
    const map: DraftMap = {
      'dishes.json': { data: [], savedAt: 1_000 },
      'drinks.json': { data: [], savedAt: 9_000 },
      'press.json': { data: [], savedAt: 5_000 },
    };
    expect(mostRecentSavedAt(map)).toBe(9_000);
  });
});

describe('formatRelativeTime', () => {
  const NOW = 10_000_000;

  it('just now, at zero elapsed', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
  });

  it('just now, under one minute', () => {
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('just now');
  });

  it('a savedAt fractionally in the future (clock skew) reads as just now, not negative', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('just now');
  });

  it('exactly one minute -- singular', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1 minute ago');
  });

  it('a few minutes -- plural', () => {
    expect(formatRelativeTime(NOW - 3 * 60_000, NOW)).toBe('3 minutes ago');
  });

  it('just under an hour', () => {
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago');
  });

  it('exactly one hour -- singular', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
  });

  it('a few hours -- plural', () => {
    expect(formatRelativeTime(NOW - 5 * 60 * 60_000, NOW)).toBe('5 hours ago');
  });

  it('just under a day', () => {
    expect(formatRelativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe('23 hours ago');
  });

  it('exactly one day -- singular', () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('1 day ago');
  });

  it('several days -- plural', () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe('3 days ago');
  });
});
