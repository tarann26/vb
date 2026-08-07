// open-sections.ts: one boolean per dashboard section, in localStorage.
// Small enough that the only things worth pinning are the two that are
// silent when wrong -- which direction it fails in, and that it never
// throws.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AREA_SEEDED_KEY_PREFIX,
  hasSeededArea,
  loadSectionOpen,
  markAreaSeeded,
  saveSectionOpen,
  SECTION_OPEN_KEY_PREFIX,
} from '../open-sections';

// A Storage that rejects every operation -- Safari private browsing's real
// behaviour, and the reason drafts.ts takes `storage` as a parameter too.
const THROWING_STORAGE = {
  get length(): number {
    throw new Error('nope');
  },
  clear: () => {
    throw new Error('nope');
  },
  getItem: () => {
    throw new Error('nope');
  },
  key: () => {
    throw new Error('nope');
  },
  removeItem: () => {
    throw new Error('nope');
  },
  setItem: () => {
    throw new Error('nope');
  },
} as unknown as Storage;

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadSectionOpen', () => {
  it('reads back exactly what saveSectionOpen wrote', () => {
    saveSectionOpen('dishes', true);
    expect(loadSectionOpen('dishes')).toBe(true);
    saveSectionOpen('dishes', false);
    expect(loadSectionOpen('dishes')).toBe(false);
  });

  it('keeps each section on its own key, so one never answers for another', () => {
    saveSectionOpen('dishes', true);
    expect(loadSectionOpen('drinks')).toBe(false);
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}dishes`)).toBe('1');
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}drinks`)).toBeNull();
  });

  // The direction matters and is not arbitrary: the dashboard's own problem
  // was that everything was open at once, so anything unreadable must read
  // as folded, never as open.
  //
  // Mutation this guards: `storage.getItem(...) !== '0'` instead of
  // `=== '1'` -- confirmed red on all three of these.
  it('reads anything it does not understand as folded', () => {
    expect(loadSectionOpen('never-written')).toBe(false);
    window.localStorage.setItem(`${SECTION_OPEN_KEY_PREFIX}odd`, 'yes');
    expect(loadSectionOpen('odd')).toBe(false);
    window.localStorage.setItem(`${SECTION_OPEN_KEY_PREFIX}empty`, '');
    expect(loadSectionOpen('empty')).toBe(false);
  });

  // Mutation this guards: removing the try/catch from loadSectionOpen --
  // confirmed red, it then throws instead of answering.
  it('answers folded rather than throwing when storage itself refuses', () => {
    expect(loadSectionOpen('dishes', THROWING_STORAGE)).toBe(false);
  });
});

describe('saveSectionOpen', () => {
  // Mutation this guards: `storage.setItem(keyFor(id), '0')` in the false
  // branch instead of `removeItem` -- confirmed red. Writing a falsy marker
  // instead of clearing the key would still read back as folded through
  // `loadSectionOpen`, so only the storage itself can tell these apart --
  // which matters because a key left behind for every section she ever
  // opened is exactly the kind of growth nothing here would ever clean up.
  it('removes the key rather than writing a falsy marker', () => {
    saveSectionOpen('dishes', true);
    saveSectionOpen('dishes', false);
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}dishes`)).toBeNull();
  });

  // Mutation this guards: removing the try/catch from saveSectionOpen --
  // confirmed red.
  it('does not throw when storage refuses the write', () => {
    expect(() => saveSectionOpen('dishes', true, THROWING_STORAGE)).not.toThrow();
    expect(() => saveSectionOpen('dishes', false, THROWING_STORAGE)).not.toThrow();
  });
});

// The one-time "open this area's first panel" flag. Additive: every case
// above is unchanged, which is what proves the fold contract itself was left
// alone.
describe('hasSeededArea / markAreaSeeded', () => {
  it('an area never visited has not been seeded', () => {
    expect(hasSeededArea('menu')).toBe(false);
  });

  it('reads back what markAreaSeeded wrote, per area', () => {
    markAreaSeeded('menu');
    expect(hasSeededArea('menu')).toBe(true);
    expect(hasSeededArea('pages')).toBe(false);
  });

  // The key shape is the whole reason this can be reasoned about
  // independently of the ten fold keys: it shares no prefix with them, so
  // nothing here can be mistaken for a section that was left open, and no
  // migration is needed for anything already in her browser.
  it('writes under its own prefix, never the section-open one', () => {
    markAreaSeeded('menu');
    expect(window.localStorage.getItem(`${AREA_SEEDED_KEY_PREFIX}menu`)).toBe('1');
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}menu`)).toBeNull();
    expect(loadSectionOpen('menu')).toBe(false);
  });

  // Falling back to "already seeded" would silently withdraw the one-time
  // open on exactly the device that cannot store the flag.
  it('answers not-seeded rather than throwing when storage refuses', () => {
    expect(hasSeededArea('menu', THROWING_STORAGE)).toBe(false);
  });

  it('does not throw when storage refuses the write', () => {
    expect(() => markAreaSeeded('menu', THROWING_STORAGE)).not.toThrow();
  });
});
