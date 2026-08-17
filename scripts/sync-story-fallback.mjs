// Writes the LIVE D1 copy of the About document back into the committed
// src/content/story.json.
//
// Why that file still exists at all after Phase 4 moved this document to
// D1, and why it must not be allowed to rot:
//   - it is what OurStory.tsx paints at first paint, before its runtime
//     fetch resolves, and what a crawler or a reader with JS off sees;
//   - it is the only thing that keeps the chef portrait's path inside
//     src/content/__tests__/assets.test.ts's walk, which cannot see D1 --
//     the same accepted hole awards.json sits in, closed here instead;
//   - src/content/__tests__/sections.test.tsx derives its About marker from
//     the compiled-in heading.
//
// Run by a human before a deploy that matters, alongside
// scripts/build-snapshot.mjs:
//   node scripts/sync-story-fallback.mjs
//
// NOT a build step, for the same reason build-snapshot.mjs is not: an
// authenticated network call on Cloudflare Pages' build path means a
// transient failure fails a deploy of unrelated code, and Pages builds in
// this project are already intermittently flaky enough that three
// consecutive builds once failed on unchanged, working source.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'via-bianca-content';
const PATH = 'src/content/story.json';

// Exported so scripts/__tests__/sync-story-fallback.test.mjs can exercise
// the part that can actually go wrong without a network call. Throws rather
// than writing anything it is unsure about: an unparseable or wrong-shaped
// body written into src/content/story.json breaks `tsc -b` at import time
// and blocks every subsequent deploy -- including the one that would fix
// it.
export function storyFileFromRow(row) {
  if (!row || typeof row.body !== 'string') {
    throw new Error(`no row for ${PATH} in D1 -- refusing to write an empty fallback`);
  }
  const parsed = JSON.parse(row.body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the stored body is not a JSON object -- refusing to write it');
  }
  if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
    throw new Error('the stored body has no paragraphs -- refusing to write it');
  }
  if (!parsed.chef || typeof parsed.chef !== 'object') {
    throw new Error('the stored body has no chef block -- refusing to write it');
  }
  // Not just "has a chef block": src/content/__tests__/assets.test.ts finds
  // the portrait only by walking this file for an asset-shaped string --
  // there is no server-side schema check on the D1 write path (worker/ has
  // no isStoryContent/validateStory import; that check lives only in
  // src/admin/StoryForm.tsx, client-side). A row with `chef: {}` would pass
  // every guard above and, once written here, silently stop assets.test.ts
  // from ever checking the portrait again -- no red test, just one fewer
  // path in the walk. Refusing here keeps that failure loud.
  if (typeof parsed.chef.portrait !== 'string' || parsed.chef.portrait.trim() === '') {
    throw new Error('the stored body has no chef.portrait -- refusing to write it, which would silently drop the portrait path from assets.test.ts\'s walk');
  }
  // Reformatted rather than written verbatim: the stored body is exactly
  // what the dashboard sent, which is minified, and a minified
  // src/content/story.json would produce an unreadable diff on every sync.
  // The D1 row keeps the byte-exact text; this file is the human-readable
  // mirror of it.
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

// import.meta.filename, not import.meta.url: import.meta.url is
// percent-encoded (spaces become %20) and would silently never match
// process.argv[1] on a checkout path containing a space. scripts/images.mjs
// documents this at length; this copies the working form.
if (import.meta.filename === process.argv[1]) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB, '--remote', '--json',
    '--command', `SELECT body FROM content WHERE path='${PATH}'`,
  ], { encoding: 'utf8' });
  const row = JSON.parse(raw)[0]?.results?.[0];
  writeFileSync(PATH, storyFileFromRow(row));
  console.log(`${PATH} synced from live D1`);
}
