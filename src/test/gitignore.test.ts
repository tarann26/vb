import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Driven by the real `git check-ignore`, not a hand-copied regex of
// .gitignore's rules -- a test that re-implements the pattern it's checking
// can drift from the real rule and still pass. This exercises the actual
// rule git applies.
//
// `git check-ignore` exits 0 (and prints the matching path) when a path IS
// ignored, and exits 1 -- "not ignored", not an error -- when it is not.
// execFileSync throws on any non-zero exit, so a genuine "not ignored"
// result has to be read out of the thrown error's `status`, not treated as
// this test itself failing to run. Any other exit code (2: a usage error,
// e.g. the path doesn't look like a path git recognizes) is rethrown --
// that really is this test failing to run, not a "not ignored" result.
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', path]);
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err;
  }
}

// Only directories -- assets-source/ also contains a loose file
// (`Menu - Expanded.pdf`), which has no corresponding public/ directory at
// all and would make `join('public', entry.name)` nonsensical to check
// here.
const assetCategories = readdirSync('assets-source', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// Every check below probes a FILE inside the directory in question, never
// the bare directory path itself -- discovered the hard way while writing
// this test: `git check-ignore public/menus` reports "not ignored"
// regardless of what .gitignore says, because git does not treat a
// directory that already contains tracked files (menus/ has two real,
// committed PDFs) as ignorable at all -- the same query against a FILE
// inside it (existing or not; check-ignore doesn't require the path to be
// real) correctly reflects the actual rule. public/<category>/ directories
// happen to hold nothing tracked today, so the bare-directory form would
// have worked for them by coincidence -- but not for menus/, and not
// robustly if a category directory ever gained one tracked file. The probe
// filename is arbitrary and never needs to exist on disk.
function probeFile(dir: string, ext: string): string {
  return join(dir, `__gitignore-probe__${ext}`);
}

describe('.gitignore', () => {
  it('found real category directories under assets-source/ to check against', () => {
    // A guard against this test silently checking nothing: if
    // assets-source/ ever lost every directory (leaving only loose files),
    // the it.each below would run zero cases and report green for the
    // wrong reason.
    expect(assetCategories.length).toBeGreaterThan(0);
  });

  it.each(assetCategories)(
    'ignores files under public/%s, the directory `npm run images` generates from it',
    (category) => {
      expect(isIgnored(probeFile(join('public', category), '.webp'))).toBe(true);
    },
  );

  // The one loose, hand-committed exception `/public/*/` would otherwise
  // swallow: menus/ is not generated from assets-source/ at all.
  it('does not ignore files under public/menus, the loose committed exception', () => {
    expect(isIgnored(probeFile('public/menus', '.pdf'))).toBe(false);
  });

  // The share card is a single generated file at the top level of public/,
  // not inside a category directory -- covered by its own gitignore line,
  // not by `/public/*/`.
  it('ignores public/og-image.jpg', () => {
    expect(isIgnored('public/og-image.jpg')).toBe(true);
  });

  // The other loose, hand-committed files `/public/*/` (a directory-only
  // pattern) never touches in the first place -- pinned here so a future
  // edit that widens the pattern to catch files too doesn't silently start
  // ignoring these.
  it.each(['_headers', '_redirects', 'favicon.svg', 'robots.txt', 'sitemap.xml'])(
    'does not ignore the loose committed file public/%s',
    (file) => {
      expect(isIgnored(join('public', file))).toBe(false);
    },
  );
});
