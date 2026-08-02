import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Enumerated with `git ls-files`, not a filesystem walk. node_modules,
// dist and every other build artifact sit on disk but are never tracked --
// walking them would make this unbearably slow and noisy, and (worse) a
// hit inside a third-party dependency would read as a leak in *this*
// repository when it is not one.
const TRACKED_FILES = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

// This file's own path. Excluded below, not because its content is
// trusted, but because it necessarily spells out the shapes it is looking
// for -- a scanner that flags itself for defining what a token or a hash
// looks like is a false positive, not a real leak. Every other tracked
// file, including this file's sibling tests, is still scanned.
const SELF_PATH = 'src/test/secrets.test.ts';

// GitHub token prefixes (classic PATs, OAuth, installation, refresh, and
// fine-grained PATs), split into fragments and rejoined at runtime so the
// literal prefix string never appears whole in this file's source -- if it
// did, this test would match itself even with SELF_PATH excluded, since
// the exclusion is a filename check, not a content check.
const GH_TOKEN_PREFIXES = [
  ['g', 'hp_'].join(''),
  ['g', 'ho_'].join(''),
  ['g', 'hu_'].join(''),
  ['g', 'hs_'].join(''),
  ['g', 'hr_'].join(''),
  ['github', '_pat_'].join(''),
];
const GH_TOKEN_PATTERN = new RegExp(`(${GH_TOKEN_PREFIXES.join('|')})[A-Za-z0-9_]{20,}`);

// Password-hash shapes this codebase could plausibly ship:
//  - pbkdf2$<iterations>$<saltB64>$<hashB64>, the exact stored format
//    worker/auth.ts's hashPassword() produces (see the worker plan, Task 4).
//  - bcrypt's $2a$/$2b$/$2y$ prefix, in case anything ever hand-rolls one
//    of those instead.
// Assembled the same way, by fragment, for the same reason as the GitHub
// prefixes above.
const PBKDF2_MARKER = ['pbk', 'df2'].join('');
const HASH_PATTERN = new RegExp(
  `${PBKDF2_MARKER}\\$\\d+\\$[A-Za-z0-9+/=]{10,}\\$[A-Za-z0-9+/=]{10,}` +
    '|\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}',
);

function findSecret(content: string): string | null {
  if (GH_TOKEN_PATTERN.test(content)) return 'a GitHub token';
  if (HASH_PATTERN.test(content)) return 'a password hash';
  return null;
}

describe('no secrets committed to the repository', () => {
  // A floor so a `git` failure (e.g. run outside a repo, empty stdout)
  // can't silently turn every check below into a vacuous pass over zero
  // files -- this repository tracks well over a hundred.
  it('actually enumerated the tracked files', () => {
    expect(TRACKED_FILES.length).toBeGreaterThan(50);
  });

  it('contains no GitHub token or password hash in any tracked file', () => {
    const offenders: string[] = [];
    for (const file of TRACKED_FILES) {
      if (file === SELF_PATH) continue;
      // latin1, not utf8: several tracked files are binary (JPEGs, a PDF).
      // utf8 decoding of invalid byte sequences elsewhere in a binary file
      // does not corrupt a run of plain-ASCII bytes (a real token or hash
      // would be plain ASCII), so this is about avoiding decode overhead
      // and surprises, not about correctness either way.
      const content = readFileSync(file, 'latin1');
      const found = findSecret(content);
      if (found) offenders.push(`${file}: ${found}`);
    }
    expect(offenders).toEqual([]);
  });
});
