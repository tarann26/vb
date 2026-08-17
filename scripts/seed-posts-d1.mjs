// One-off. Writes the committed src/content/posts.json into D1 so that Phase
// 5B Task 9's flip -- adding that path to D1_ONLY_PATHS -- never has a moment
// where the dashboard's Posts panel, or the two public blog routes, meet an
// empty table.
//
// Through the real D1Store, not raw SQL, and that is the point: the row it
// writes has to carry the same sha (SHA-256 of the exact body text) and the
// same version the Worker's own write path would produce, or the very first
// publish after the flip gets a 409 it can never clear. This is
// scripts/seed-story-d1.mjs with the path, the body and one extra guard
// changed; the wrangler machinery below is deliberately identical, because it
// was arrived at by reading wrangler's own cli.js and getting two documented
// things wrong first.
//
//   npx tsx scripts/seed-posts-d1.mjs
//
// RUN IT IMMEDIATELY BEFORE `npx wrangler deploy`, not days ahead. Until the
// Worker carrying this task ships, `src/content/posts.json` still routes to
// GitHub, so a publish through /edit in the gap would commit a new post to the
// repository and leave THIS row stale -- and the deploy would then make the
// stale row the live copy and hide her post until the next publish. The whole
// order is written out in docs/cloudflare-cutover.md.
//
// Run through tsx, not plain node: worker/d1.ts's D1Store constructor uses a
// TypeScript parameter property (`constructor(private readonly db: ...)`),
// which is real codegen (it assigns a class field), not erasable syntax --
// Node's built-in --experimental-strip-types refuses it with "TypeScript
// parameter property is not supported in strip-only mode". The guard import
// below needs tsx for a second, independent reason: src/content/guards.ts
// resolves its own siblings with extensionless specifiers, which Node's ESM
// resolver refuses.
//
// TWO THINGS THE STORY SEED'S BRIEF GOT WRONG, both confirmed against the
// installed wrangler before that file was written rather than trusted, and
// both preserved verbatim here:
//
// 1. `getPlatformProxy({ experimental: { remoteBindings: true } })` is not
//    this version's option shape -- `remoteBindings` is a TOP-LEVEL boolean
//    (defaults to true already), not nested under `experimental`. Passing
//    the nested shape is silently ignored (getPlatformProxy does not reject
//    unknown keys), which is worse than an error: the call quietly falls
//    back to a LOCAL, empty, unmigrated D1 simulation and fails with
//    "no such table: content".
// 2. Even with `remoteBindings: true` at the top level, wrangler only binds
//    a specific D1 database remotely if THAT BINDING's own config carries
//    `remote = true`. wrangler.toml's [[d1_databases]] block does not set it,
//    deliberately: that flag also changes what plain `wrangler dev` talks to,
//    and leaving it on in the committed file would mean every future local
//    dev session reads and writes the LIVE production database by default.
//    This script does not touch the tracked wrangler.toml at all. It reads
//    it, writes a PATCHED COPY to a file in the OS temp directory (never
//    inside this repo, so there is nothing to gitignore or accidentally
//    `git add`) with `remote = true` added to the DB binding only, points
//    getPlatformProxy at that copy, and deletes it in a `finally`.
//
// Idempotent in the sense that matters: the script reads the row before
// writing and REFUSES to run again once one exists, rather than blindly
// overwriting or duplicating it. Running it twice is a no-op the second time
// (exit code 1, nothing touched).
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { D1Store } from '../worker/d1.ts';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTENT_PATH = 'src/content/posts.json';
// The committed file, byte for byte, so the very first read after the flip
// returns exactly what the build was already serving.
const body = readFileSync(path.join(REPO_ROOT, CONTENT_PATH), 'utf8');

// Refuses to seed a body the BUILD would reject. assertPosts runs at import
// time, so a bad row that later comes back through
// scripts/sync-posts-fallback.mjs breaks `tsc -b` and blocks every subsequent
// deploy -- including the one that would fix it. Checking here as well as
// there costs nothing and closes the loop at both ends.
//
// Imported from the real guard rather than reimplemented: it is the same
// check src/content/index.ts already applies to this exact file.
const { assertPosts } = await import('../src/content/guards.ts');
assertPosts(JSON.parse(body));

// Patch a throwaway copy of wrangler.toml so the D1 binding named "DB" is
// remote for this one call only. Refuses to guess if the file's shape
// changes -- the marker line must appear exactly once.
const wranglerToml = readFileSync(path.join(REPO_ROOT, 'wrangler.toml'), 'utf8');
const marker = 'binding = "DB"';
const occurrences = wranglerToml.split(marker).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `expected exactly one D1 binding named "DB" in wrangler.toml to patch, found ${occurrences} -- ` +
      'refusing to guess which one to make remote',
  );
}
const patchedToml = wranglerToml.replace(marker, `${marker}\nremote = true # seed-posts-d1.mjs: live database, this line never lands on main`);
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'seed-posts-d1-'));
const tempConfigPath = path.join(tempDir, 'wrangler.toml');
writeFileSync(tempConfigPath, patchedToml);

let env;
let dispose;
try {
  ({ env, dispose } = await getPlatformProxy({
    configPath: tempConfigPath,
    remoteBindings: true,
  }));

  const store = new D1Store(env.DB);
  const existing = await store.read(CONTENT_PATH);
  if (existing) {
    console.log(`${CONTENT_PATH} already has a row (sha ${existing.sha.slice(0, 12)}…) -- refusing to overwrite it.`);
    console.log('Delete the row by hand first if you really mean to reseed.');
    process.exitCode = 1;
  } else {
    await store.write([{ path: CONTENT_PATH, content: body, encoding: 'utf-8' }], 'seed posts.json', `seed-${Date.now()}`);
    const stored = await store.read(CONTENT_PATH);
    if (stored === null) throw new Error('wrote the row and then could not read it back');
    if (stored.content !== body) throw new Error('the row read back does not match the file byte for byte');
    const version = await store.version(CONTENT_PATH);
    console.log(`seeded ${CONTENT_PATH}: ${body.length} bytes, sha ${stored.sha.slice(0, 12)}…, version ${version}`);
  }
} finally {
  if (dispose) await dispose();
  rmSync(tempDir, { recursive: true, force: true });
}
