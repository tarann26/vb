// Writes the LIVE D1 copy of the About document back into the committed
// src/content/story.json.
//
// Why that file still exists at all after Phase 4 moved this document to
// D1, and why it must not be allowed to rot:
//   - it is what OurStory.tsx paints at first paint, before its runtime
//     fetch resolves, and what a crawler or a reader with JS off sees;
//   - it is ONE OF THREE places that keep the chef portrait's path inside
//     src/content/__tests__/assets.test.ts's walk, which cannot see D1 --
//     src/content/press.json and src/components/ChefGallery.tsx are the
//     other two (assets.test.ts's own comment already says "reached from
//     three places now"). It is not the last one standing, but it is this
//     document's OWN copy of that path, and it is what OurStory.tsx's
//     first-paint byline actually renders -- so it still needs to be a
//     real, working path, not merely present somewhere in the walk;
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

function isBlankString(value) {
  return typeof value !== 'string' || value.trim() === '';
}

// Exported so scripts/__tests__/sync-story-fallback.test.mjs can exercise
// the part that can actually go wrong without a network call. Throws rather
// than writing anything it is unsure about: an unparseable or wrong-shaped
// body written into src/content/story.json breaks `tsc -b` at import time
// and blocks every subsequent deploy -- including the one that would fix
// it. Checks every field the type StoryContent (src/content/types.ts)
// declares required -- heading, each paragraph, and all four chef.* --
// not just the ones a prior pass happened to add guards for.
export function storyFileFromRow(row) {
  if (!row || typeof row.body !== 'string') {
    throw new Error(`no row for ${PATH} in D1 -- refusing to write an empty fallback`);
  }
  const parsed = JSON.parse(row.body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the stored body is not a JSON object -- refusing to write it');
  }
  if (isBlankString(parsed.heading)) {
    throw new Error('the stored body has no heading -- refusing to write it');
  }
  if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
    throw new Error('the stored body has no paragraphs -- refusing to write it');
  }
  if (parsed.paragraphs.some(isBlankString)) {
    throw new Error('the stored body has a blank or non-string paragraph -- refusing to write it');
  }
  if (!parsed.chef || typeof parsed.chef !== 'object') {
    throw new Error('the stored body has no chef block -- refusing to write it');
  }
  if (isBlankString(parsed.chef.name)) {
    throw new Error('the stored body has no chef.name -- refusing to write it');
  }
  if (isBlankString(parsed.chef.role)) {
    throw new Error('the stored body has no chef.role -- refusing to write it');
  }
  // Not just "has a chef block": the Worker DOES check this document on the
  // write path -- worker/index.ts's handlePublish runs validateContent
  // (which dispatches to validateStory for story.json, worker/index.ts:696
  // -> src/content/validate.ts:1240) on every publish, so a publish through
  // /edit carrying `chef: {}` is refused with a 422 before anything reaches
  // D1 at all. That is NOT what this guard is defending against -- it was
  // wrongly justified that way once, and the mistake is worth naming so it
  // is not repeated: this script's own guards are not the last thing
  // standing between a bad row and a broken build. They are the guard for
  // the write paths that never go through handlePublish at all --
  // scripts/seed-story-d1.mjs, which writes straight through D1Store, and
  // a `wrangler d1 execute` UPDATE run by hand -- neither of which comes
  // anywhere near worker/index.ts or validateStory. A malformed row from
  // one of those would otherwise land here unchecked and either break
  // `tsc -b` at import time (see storyFileFromRow's own callers) or write
  // a fallback with a broken photo that OurStory.tsx renders regardless.
  if (isBlankString(parsed.chef.portrait)) {
    throw new Error('the stored body has no chef.portrait -- refusing to write a fallback with a broken photo');
  }
  if (isBlankString(parsed.chef.portraitAlt)) {
    throw new Error('the stored body has no chef.portraitAlt -- refusing to write it');
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
