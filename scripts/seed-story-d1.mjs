// One-off. Writes the committed src/content/story.json into D1 so that
// Phase 4 Task 6's flip -- adding that path to D1_ONLY_PATHS -- never has a
// moment where the dashboard's About panel 404s against an empty table.
//
// Through the real D1Store, not raw SQL, and that is the point: the row it
// writes has to carry the same sha (SHA-256 of the exact body text) and the
// same version the Worker's own write path would produce, or the very first
// publish after the flip gets a 409 it can never clear. Phase 2's awards
// seed used the same D1Store/validateContent path against the live database
// (commit 2761915) though not as a committed script; this one is committed
// so the exact seeding step is reproducible and reviewable.
//
//   npx tsx scripts/seed-story-d1.mjs
//
// Run through tsx, not plain node: worker/d1.ts's D1Store constructor uses a
// TypeScript parameter property (`constructor(private readonly db: ...)`),
// which is real codegen (it assigns a class field), not erasable syntax --
// Node's built-in --experimental-strip-types refuses it with "TypeScript
// parameter property is not supported in strip-only mode". Verified on Node
// v25.4.0 in this repo before writing this comment.
//
// TWO THINGS THE BRIEF'S OWN SKETCH GOT WRONG, both confirmed against the
// installed wrangler (4.119.0) before writing this file rather than trusted:
//
// 1. `getPlatformProxy({ experimental: { remoteBindings: true } })` is not
//    this version's option shape -- `remoteBindings` is a TOP-LEVEL boolean
//    (defaults to true already), not nested under `experimental`. Passing
//    the nested shape is silently ignored (getPlatformProxy does not reject
//    unknown keys), which is worse than an error: the call quietly falls
//    back to a LOCAL, empty, unmigrated D1 simulation and fails with
//    "no such table: content" -- reproduced live before this rewrite.
// 2. Even with `remoteBindings: true` at the top level, wrangler only binds
//    a specific D1 database remotely if THAT BINDING's own config carries
//    `remote = true` -- confirmed by reading wrangler-dist/cli.d.ts's own
//    d1_databases type ("Whether the D1 database should be remote or not in
//    local development") and the built isSimulatedLocally logic in
//    wrangler-dist/cli.js. wrangler.toml's [[d1_databases]] block does not
//    set it, deliberately: that flag also changes what plain `wrangler dev`
//    talks to, and leaving it on in the committed file would mean every
//    future local dev session reads and writes the LIVE production
//    database by default. This script does not touch the tracked
//    wrangler.toml at all. It reads it, writes a PATCHED COPY to a file in
//    the OS temp directory (never inside this repo, so there is nothing to
//    gitignore or accidentally `git add`) with `remote = true` added to the
//    DB binding only, points getPlatformProxy at that copy, and deletes it
//    in a `finally` -- so this one-off script gets the live database and
//    nothing else about local dev's default behaviour changes.
//
// Idempotent in the sense that matters: the script reads the row before
// writing and REFUSES to run again once one exists, rather than blindly
// overwriting or duplicating it. Running it twice is a no-op the second
// time (exit code 1, nothing touched) -- proved live against the real
// database as part of this task, the same way Phase 2's migration proved
// 12-rows-then-0.
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { D1Store } from '../worker/d1.ts';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTENT_PATH = 'src/content/story.json';
const body = readFileSync(path.join(REPO_ROOT, CONTENT_PATH), 'utf8');

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
const patchedToml = wranglerToml.replace(marker, `${marker}\nremote = true # seed-story-d1.mjs: live database, this line never lands on main`);
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'seed-story-d1-'));
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
    await store.write([{ path: CONTENT_PATH, content: body, encoding: 'utf-8' }], 'seed story.json', `seed-${Date.now()}`);
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
