import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEDULABLE_FILES } from '../types';

// Plan 7, Gap B: `plugins/filter-unpublished.ts`'s TARGET_SUFFIXES and
// worker/index.ts's SCHEDULABLE_CONTENT_FILES both now derive from this one
// list (src/content/types.ts's SCHEDULABLE_FILES) instead of independently
// hand-maintaining their own copy -- see that constant's own comment. That
// removes ONE form of drift (the two lists disagreeing with each other).
// This file is the OTHER half: does the list itself still name every real
// content file that actually carries a `publishAt`? TypeScript's structural
// typing cannot answer that at compile time (Schedulable's field is
// optional, so every object type trivially "extends" it -- there is no
// `T extends Schedulable` conditional a fifth type could fail), so this is
// a runtime sweep instead, the option src/content/types.ts's own comment
// names as the real backstop.
const CONTENT_DIR = join(process.cwd(), 'src/content');

// True when `value` -- or anything nested inside it, at any depth, through
// arrays and objects -- is an object literally carrying a `publishAt` key.
// Deliberately keyed on the exact property name, not a fuzzy match: a
// sibling field like `publishedAt` (past tense, a plausible authoring typo)
// must NOT trip this, or a developer chasing this test down would "fix" the
// wrong thing.
export function hasPublishAtSomewhere(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasPublishAtSomewhere);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'publishAt')) return true;
    return Object.values(record).some(hasPublishAtSomewhere);
  }
  return false;
}

// Every file whose (possibly nested) content carries at least one
// `publishAt` key, out of the `files` map handed in -- the same detector
// both describe blocks below share, so a bug in the scan itself can't
// silently make one block's finding disagree with the other's.
function filesNeedingSchedule(files: Record<string, unknown>): string[] {
  return Object.entries(files)
    .filter(([, data]) => hasPublishAtSomewhere(data))
    .map(([name]) => name);
}

describe('hasPublishAtSomewhere / filesNeedingSchedule -- the detector itself', () => {
  it('finds a publishAt buried inside nested arrays and objects, not only at the top level', () => {
    expect(hasPublishAtSomewhere([{ nested: { deeper: [{ publishAt: '2099-01-01' }] } }])).toBe(true);
  });

  it('does not false-positive on a similarly-named field', () => {
    expect(hasPublishAtSomewhere([{ publishedAt: '2099-01-01', published_at: '2099-01-01' }])).toBe(false);
  });

  it('does not false-positive on a plain value with no objects at all', () => {
    expect(hasPublishAtSomewhere('publishAt')).toBe(false);
    expect(hasPublishAtSomewhere(42)).toBe(false);
    expect(hasPublishAtSomewhere(null)).toBe(false);
  });

  // Mutation-tested: this is the property the whole gap-closure rests on.
  // Mutating `filesNeedingSchedule`'s filter to always return `[]` (the
  // shape a "forgot to update the list" regression would actually look
  // like) makes this go red -- confirmed directly, reverted.
  it('flags a file whose synthetic content carries publishAt and is not in the given registered set', () => {
    const files = {
      'a-registered-file.json': [{ id: '1', publishAt: '2099-01-01' }],
      'an-unregistered-file.json': [{ id: '1', name: 'no schedule' }],
    };
    const flagged = filesNeedingSchedule(files);
    expect(flagged).toEqual(['a-registered-file.json']);
  });

  // The actual divergence scenario Gap B describes: a fifth (here,
  // simulated fourth-in-the-test) Schedulable type starts being authored in
  // a file nobody added to SCHEDULABLE_FILES. Simulated with a fixture, not
  // real committed content -- see the describe block below for why the real
  // sweep is vacuous today, and why that is not the same as this scenario
  // being untested.
  it('a file with real publishAt content that is missing from the registered set is caught by the caller', () => {
    const files = { 'site.json': [{ publishAt: '2099-01-01' }] };
    const flagged = filesNeedingSchedule(files);
    const registered: readonly string[] = SCHEDULABLE_FILES;
    const missing = flagged.filter((file) => !registered.includes(file));
    expect(missing).toEqual(['site.json']);
  });
});

describe('the real, committed content under src/content/ agrees with SCHEDULABLE_FILES', () => {
  const realFiles = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));

  // Non-vacuous by construction (not by luck): every real *.json file under
  // src/content/ is enumerated from disk, not from a hand-typed list that
  // could quietly stop matching reality.
  it('is checking a non-empty, real file list', () => {
    expect(realFiles.length).toBeGreaterThan(0);
  });

  // Honest as of today: no real committed content anywhere under
  // src/content/ has ever authored a `publishAt` on dishes/drinks/press,
  // let alone on a template section (Plan 8, which would be the first to,
  // is blocked on the founder -- see this plan's own "Handed to Plan 8").
  // So this assertion passes VACUOUSLY right now (`needsSchedule` is
  // `[]`) -- recorded here rather than hidden, and NOT the test that
  // proves this mechanism works (the describe block above is, using
  // synthetic content, precisely because real content can't exercise it
  // yet). What this test DOES catch, the moment it stops being vacuous: the
  // first real dish/drink/article/section `publishAt` ever authored in a
  // file this list doesn't already name.
  // Plan 7, Task 3: pages.json is a DELIBERATE exception, not an oversight.
  // `Page` (types.ts) has no `publishAt` of its own -- the field only ever
  // appears nested, inside a page's own `sections[]` -- so it is excluded
  // from SCHEDULABLE_FILES on purpose and given its OWN dedicated filtering
  // path instead (plugins/filter-unpublished.ts's `isPagesFile`/
  // `filterPages`, which rewrites each page's own sections array rather
  // than filtering the array of pages itself; see that module's own
  // comment for why the generic top-level-array filter can't do this). This
  // sweep would otherwise demand pages.json be added to SCHEDULABLE_FILES
  // the moment any page's section ever carries a real publishAt, which
  // would be the WRONG fix (adding it there feeds it through the generic
  // filter, which is a silent no-op on pages.json -- see isPagesFile's own
  // comment) -- so it is named here as a known exception, not silently
  // excluded.
  const HANDLED_OUTSIDE_SCHEDULABLE_FILES = new Set(['pages.json']);

  it('every real content file that carries a publishAt is listed in SCHEDULABLE_FILES, or is a named, separately-handled exception', () => {
    const files = Object.fromEntries(
      realFiles.map((file) => [file, JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'))]),
    );
    const needsSchedule = filesNeedingSchedule(files);
    const registered: readonly string[] = SCHEDULABLE_FILES;
    needsSchedule.forEach((file) => {
      if (HANDLED_OUTSIDE_SCHEDULABLE_FILES.has(file)) return;
      expect(registered).toContain(file);
    });
  });

  // The exception set itself must name a real file, or it silently swallows
  // whatever THAT typo would otherwise have caught -- mutating
  // HANDLED_OUTSIDE_SCHEDULABLE_FILES to contain a made-up name instead of
  // 'pages.json' would leave the test above green for the wrong reason.
  it('the named exception is a real content file, not a typo that would silently swallow a finding', () => {
    HANDLED_OUTSIDE_SCHEDULABLE_FILES.forEach((file) => {
      expect(realFiles).toContain(file);
    });
  });
});
