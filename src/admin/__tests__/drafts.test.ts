import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAFT_STORAGE_KEY,
  clearDraft,
  formatRelativeTime,
  loadDraft,
  mostRecentSavedAt,
  saveDraft,
  type DraftMap,
} from '../drafts';

// jsdom (this repo's one Vitest environment -- see vitest.config.ts's own
// comment) provides a real, in-memory `localStorage`, so these tests use it
// directly rather than a hand-built fake, EXCEPT for the two tests that
// specifically need a Storage that throws (a real, reachable state -- Safari
// private browsing rejects every write).
afterEach(() => {
  window.localStorage.clear();
});

const DISHES_ENTRY = { data: [{ id: 'a', name: 'Edited' }], savedAt: 1_000 };

describe('loadDraft: nothing saved', () => {
  it('returns null when the key was never written', () => {
    expect(loadDraft()).toBeNull();
  });
});

describe('saveDraft / loadDraft: round-trip', () => {
  it('round-trips a single file', () => {
    saveDraft({ 'dishes.json': DISHES_ENTRY });
    expect(loadDraft()).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('round-trips several files, each with its own savedAt', () => {
    const map: DraftMap = {
      'dishes.json': DISHES_ENTRY,
      'site.json': { data: { hours: [] }, savedAt: 2_000 },
    };
    saveDraft(map);
    expect(loadDraft()).toEqual(map);
  });

  // The actual bug class this whole module exists to prevent: a caller that
  // writes under a DIFFERENT key, or a caller elsewhere in the app that
  // reads the key directly instead of going through loadDraft, would both
  // be invisible to a test that only ever calls saveDraft-then-loadDraft
  // through this module's own functions.
  it('writes under the documented key, verbatim', () => {
    saveDraft({ 'dishes.json': DISHES_ENTRY });
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('saving a second, different map overwrites the first entirely, not merges into it', () => {
    saveDraft({ 'dishes.json': DISHES_ENTRY });
    saveDraft({ 'site.json': { data: {}, savedAt: 5_000 } });
    expect(loadDraft()).toEqual({ 'site.json': { data: {}, savedAt: 5_000 } });
  });
});

describe('saveDraft({}): clears rather than writing an empty object', () => {
  it('removes the key entirely -- loadDraft reads back null, not {}', () => {
    saveDraft({ 'dishes.json': DISHES_ENTRY });
    saveDraft({});
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(loadDraft()).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes an existing draft', () => {
    saveDraft({ 'dishes.json': DISHES_ENTRY });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('is a harmless no-op when nothing was ever saved', () => {
    expect(() => clearDraft()).not.toThrow();
    expect(loadDraft()).toBeNull();
  });
});

describe('loadDraft: malformed or hostile data already stored never throws', () => {
  it('non-JSON text -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, 'not json at all {{{');
    expect(loadDraft()).toBeNull();
  });

  it('valid JSON that is an array, not an object -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '[1,2,3]');
    expect(loadDraft()).toBeNull();
  });

  it('valid JSON that is a bare string -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, '"hello"');
    expect(loadDraft()).toBeNull();
  });

  it('valid JSON that is null -> null', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, 'null');
    expect(loadDraft()).toBeNull();
  });

  // A per-entry defect (one file's own savedAt lost or corrupted) drops
  // ONLY that entry, not the whole draft -- the identical "one bad item
  // doesn't cost every other item" posture worker/index.ts's own
  // isStillPending takes toward a malformed publishAt.
  it('one malformed entry among valid ones is dropped, not the whole draft', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        'dishes.json': DISHES_ENTRY,
        'drinks.json': { data: [], savedAt: 'not a number' },
        'press.json': { data: [] }, // no savedAt at all
      }),
    );
    expect(loadDraft()).toEqual({ 'dishes.json': DISHES_ENTRY });
  });

  it('an object with every entry malformed -> null, not an empty-but-present map', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ 'dishes.json': { nope: true } }));
    expect(loadDraft()).toBeNull();
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
    expect(() => loadDraft(THROWING_STORAGE)).not.toThrow();
    expect(loadDraft(THROWING_STORAGE)).toBeNull();
  });

  it('saveDraft swallows the failure rather than throwing', () => {
    expect(() => saveDraft({ 'dishes.json': DISHES_ENTRY }, THROWING_STORAGE)).not.toThrow();
  });

  it('clearDraft swallows the failure rather than throwing', () => {
    expect(() => clearDraft(THROWING_STORAGE)).not.toThrow();
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
