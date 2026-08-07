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

// Cloudflare API tokens. Added because this scanner covered the GitHub token
// the Worker uses and not the CLOUDFLARE_API_TOKEN it also uses -- an
// asymmetry with no reason behind it. This project actively mints these:
// docs/cloudflare-cutover.md instructs creating one for build-status, and a
// second is still outstanding for cache purging. A leaked one can purge
// caches, read deployments, and depending on scope rewrite DNS.
//
// Matched by PREFIX only, and the omission is deliberate. Cloudflare's older
// tokens are a bare 40-character `[A-Za-z0-9_-]` run with no marker at all,
// and a pattern for that shape would flag base64 fixtures, content hashes and
// half the binary files in this repository. A scanner that cries wolf gets
// switched off, which is strictly worse than one with a known blind spot
// written down. The bare-40 form is that blind spot; prefixed tokens, which
// is what Cloudflare issues now, are caught.
//
// Assembled by fragment for the same reason as the two patterns above: a
// literal prefix here would make this file match itself.
const CF_TOKEN_PREFIXES = [
  ['cf', 'ut_'].join(''),
  ['v1.0-', ''].join(''),
];
const CF_TOKEN_PATTERN = new RegExp(`(${CF_TOKEN_PREFIXES.join('|')})[A-Za-z0-9_-]{20,}`);

function findSecret(content: string): string | null {
  if (GH_TOKEN_PATTERN.test(content)) return 'a GitHub token';
  if (CF_TOKEN_PATTERN.test(content)) return 'a Cloudflare API token';
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

  it('contains no GitHub token, Cloudflare token or password hash in any tracked file', () => {
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
