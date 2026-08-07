import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Every way this codebase could hand a string to the HTML parser instead of
// rendering it as text. React escapes text children, which is what makes all
// of this site's content-driven output safe by default; each sink below opts
// OUT of that, and none of them is currently used anywhere in shipped code.
//
// WHY A STATIC CHECK RATHER THAN A BEHAVIOURAL ONE. The obvious test is to
// feed a `</script><img onerror=...>` payload through a content field and
// assert nothing executes. That test was written, and it passed -- and then
// passed just as happily against a SeoHead.tsx deliberately rewritten to use
// dangerouslySetInnerHTML, which is the exact bug it claimed to catch.
//
// jsdom is the reason. Setting innerHTML on a `<script>` element parses in
// the raw-text state and produces a text node either way, so jsdom cannot
// express this vulnerability class at all: a breakout and a safe render are
// indistinguishable to it. A test that cannot fail is a defect, so that one
// was deleted rather than committed.
//
// What IS checkable, and is what actually protects the JSON-LD block in
// SeoHead.tsx (`<script type="application/ld+json">{JSON.stringify(json)}`,
// whose address and opening-hours fields ARE dashboard-editable), is that no
// shipped module reaches for a parsing sink in the first place. React sets a
// text child via textContent, which never re-parses. That property holds as
// long as this list stays empty.
const SINKS = [
  'dangerouslySetInnerHTML',
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'document.write',
];

// Tests are excluded because they legitimately ASSERT on innerHTML to inspect
// what was rendered -- reading it is not a sink, writing it is -- and because
// this file must not match itself while naming the strings it looks for.
const SHIPPED_FILES = execFileSync('git', ['ls-files', 'src', 'worker'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => !f.includes('__tests__') && !f.startsWith('src/test/'));

describe('no HTML-parsing sinks in shipped code', () => {
  // A floor, so a `git` failure that returns nothing cannot turn the check
  // below into a vacuous pass over zero files.
  it('actually enumerated the shipped modules', () => {
    expect(SHIPPED_FILES.length).toBeGreaterThan(40);
  });

  it.each(SINKS)('no shipped module uses %s', (sink) => {
    const offenders = SHIPPED_FILES.filter((file) => readFileSync(file, 'utf8').includes(sink));
    expect(offenders).toEqual([]);
  });
});
