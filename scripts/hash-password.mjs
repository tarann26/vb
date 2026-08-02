#!/usr/bin/env node
// Produces the `pbkdf2$<iterations>$<saltB64>$<hashB64>` string that
// `wrangler secret put ADMIN_PASSWORD_HASH` needs. Without this script
// there is no way to produce that value at all, and the owner's password
// can never be set -- worker/auth.ts's verifyPassword() only ever checks a
// hash against a supplied plaintext, it never has a reason to print one.
//
// Same algorithm and iteration count as worker/auth.ts's hashPassword()
// (PBKDF2-SHA256, 25,000 iterations, random 16-byte salt -- see that file's
// comment for the measured numbers behind 25,000). Reimplemented here
// rather than imported: this is a plain Node ESM script, and worker/auth.ts
// is TypeScript compiled for the Workers runtime, so there is no shared
// module boundary that both sides can load at their own runtime without a
// build step. What keeps the two from silently drifting apart is the
// format itself: verifyPassword() reads the iteration count back out of the
// stored string (`pbkdf2$<iterations>$...`) rather than trusting a
// constant, so a hash produced here always verifies correctly regardless of
// which iteration count worker/auth.ts's own hashPassword() currently
// defaults to. scripts/__tests__/hash-password.test.mjs proves that round
// trip against the real, imported verifyPassword -- not a copy of it -- and
// separately asserts the iteration counts still match, so drift here would
// fail a test rather than silently make every future login slower or
// (past 100,000) impossible.
//
// Reads the password from stdin, not argv: a command-line argument would
// sit in plain text in shell history and in `ps` output for the duration of
// the process. Pipe it in instead, e.g.:
//   node scripts/hash-password.mjs <<< 'the new password'
// or run it with no input piped and type it at the prompt (echoed to the
// terminal on a non-interactive stdin, hidden on an interactive one).

import { webcrypto } from 'node:crypto';
import { createInterface } from 'node:readline';

const PBKDF2_ITERATIONS = 25_000; // must match worker/auth.ts -- see comment above
const SALT_BYTES = 16;

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain) {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${Buffer.from(salt).toString('base64')}$${Buffer.from(hash).toString('base64')}`;
}

// Prompts and errors go to stderr, and only stderr, so stdout stays clean
// enough to pipe straight into `wrangler secret put ADMIN_PASSWORD_HASH`:
//   node scripts/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
function readPassword() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: process.stdin.isTTY === true,
    });
    if (process.stdin.isTTY) {
      // Suppress local echo so the password isn't visible on an
      // interactive terminal. No effect (and not attempted) when stdin is
      // piped -- there is no terminal to echo onto in that case.
      rl._writeToOutput = () => {};
    }
    rl.question('Password: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

if (import.meta.filename === process.argv[1]) {
  const password = await readPassword();
  if (!password) {
    console.error('No password supplied.');
    process.exitCode = 1;
  } else {
    console.log(await hashPassword(password));
  }
}
