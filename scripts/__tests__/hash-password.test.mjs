import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword as scriptHashPassword } from '../hash-password.mjs';
// The REAL implementation, not a copy: worker/auth.ts is what the deployed
// Worker actually checks a login attempt against, so the round trip below
// proves this script produces a value that Worker actually accepts, not
// just a value that looks the right shape.
import { hashPassword as workerHashPassword, verifyPassword } from '../../worker/auth.ts';

// Not `new URL('../hash-password.mjs', import.meta.url)`: Vite's
// import-analysis plugin statically rewrites that exact literal pattern
// into a build-time asset URL, which throws `TypeError: The URL must be of
// scheme file` under Vitest -- the same trap Task 1 of this plan hit and
// documented for `guards.ts`. Deriving the path from `fileURLToPath`
// directly, with no `new URL(literal, import.meta.url)` in the source,
// avoids the rewrite entirely.
const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../hash-password.mjs');

describe('scripts/hash-password.mjs', () => {
  it('prints a pbkdf2$<iterations>$<saltB64>$<hashB64> line on stdout, nothing else', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH], {
      input: 'correct horse battery staple\n',
      encoding: 'utf8',
    });
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('round-trips through the real worker/auth.ts verifyPassword, not a test-only copy', () => {
    const password = 'the actual restaurant password';
    const stdout = execFileSync('node', [SCRIPT_PATH], {
      input: `${password}\n`,
      encoding: 'utf8',
    }).trim();

    return verifyPassword(password, stdout).then((ok) => {
      expect(ok).toBe(true);
    });
  });

  it('a wrong password does not verify against the printed hash', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH], {
      input: 'the real password\n',
      encoding: 'utf8',
    }).trim();

    return verifyPassword('a guessed password', stdout).then((ok) => {
      expect(ok).toBe(false);
    });
  });

  it('prints nothing on stdout and exits non-zero when no password is given', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', [SCRIPT_PATH], { input: '\n', encoding: 'utf8' });
    } catch (err) {
      stdout = err.stdout ?? '';
      status = err.status ?? 1;
    }
    expect(stdout.trim()).toBe('');
    expect(status).not.toBe(0);
  });

  // Guards against the script and worker/auth.ts silently drifting apart on
  // iteration count. They can't share a module (see hash-password.mjs's own
  // comment on why), and verifyPassword doesn't care -- it reads the count
  // back out of the stored string -- but a mismatch would still mean this
  // script's real-world output logs in at a different cost than
  // worker/auth.ts's own hashPassword(), which is exactly the kind of thing
  // that stays invisible until it either times out in production or an
  // audit compares the two by hand.
  it('uses the same iteration count as worker/auth.ts', async () => {
    const [, scriptIterations] = (await scriptHashPassword('x')).split('$');
    const [, workerIterations] = (await workerHashPassword('x')).split('$');
    expect(scriptIterations).toBe(workerIterations);
  });
});
