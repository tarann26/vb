// Writes the LIVE D1 copy of the blog back into the committed
// src/content/posts.json.
//
// Why that file still exists after this phase moved the document to D1, and
// why it must not be allowed to rot:
//   - it is what BlogIndex.tsx and PostPage.tsx paint at first paint, before
//     their runtime fetch resolves, and what a crawler or a reader with JS
//     off sees;
//   - it is the ONLY thing keeping every post's card image and every image
//     and gallery block's src inside src/content/__tests__/assets.test.ts's
//     walk, which cannot see D1;
//   - plugins/sitemap.ts reads it at build time, so a post published between
//     deploys is absent from sitemap.xml until this runs and the site is
//     rebuilt;
//   - src/content/__tests__/shape.test.ts pins the three migrated mentions
//     against it, which is what makes a fourth post appearing without the
//     owner's decision on the nine unmigrated press entries fail the build.
//
// Run by a human before a deploy that matters, alongside
// scripts/build-snapshot.mjs:
//   npx tsx scripts/sync-posts-fallback.mjs
//
// Through tsx rather than plain node, and this is one place the sibling
// sync-story-fallback.mjs genuinely differs: this script imports the REAL
// guard (see postsFileFromRow below), and src/content/guards.ts imports its
// own siblings with extensionless specifiers ('./collage', './markdown'),
// which Node's ESM resolver refuses however its TypeScript handling is
// configured. Checked by running it both ways before writing this line, not
// assumed.
//
// NOT a build step, for the reason build-snapshot.mjs is not: an
// authenticated network call on Cloudflare Pages' build path means a
// transient failure fails a deploy of unrelated code.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'via-bianca-content';
const PATH = 'src/content/posts.json';

// Exported so scripts/__tests__/sync-posts-fallback.test.mjs can exercise the
// part that can actually go wrong without a network call.
//
// It refuses rather than writing anything it is unsure about, and the guard it
// delegates to is the REAL one: assertPosts (src/content/guards.ts) is what
// src/content/index.ts already applies to this exact file at import time, so
// anything it refuses would break `tsc -b` and block every subsequent deploy
// -- including the one that would fix it. sync-story-fallback.mjs hand-rolled
// its checks because validateStory lives in the Worker's module and is not
// exported; there is no such obstacle here, and one implementation cannot
// drift from itself.
//
// What this is actually defending against, stated precisely because the story
// script's own comment records getting this wrong once: NOT a publish through
// /edit, which handlePublish already validates with validateContent before
// anything reaches D1. It is the write paths that never reach handlePublish --
// scripts/seed-posts-d1.mjs, and a `wrangler d1 execute UPDATE` run by hand.
export async function postsFileFromRow(row) {
  if (!row || typeof row.body !== 'string') {
    throw new Error(`no row for ${PATH} in D1 -- refusing to write an empty fallback`);
  }
  const parsed = JSON.parse(row.body);
  const { assertPosts } = await import('../src/content/guards.ts');
  // Throws with the guard's own message, which names the post and the field.
  assertPosts(parsed);
  // Reformatted rather than written verbatim: the stored body is exactly what
  // the dashboard sent, which is minified, and a minified
  // src/content/posts.json would produce an unreadable diff on every sync. The
  // D1 row keeps the byte-exact text; this file is the human-readable mirror.
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

// import.meta.filename, not import.meta.url: the latter is percent-encoded
// (spaces become %20) and would silently never match process.argv[1] on a
// checkout path containing a space. scripts/images.mjs documents this at
// length; this copies the working form.
if (import.meta.filename === process.argv[1]) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB, '--remote', '--json',
    '--command', `SELECT body FROM content WHERE path='${PATH}'`,
  ], { encoding: 'utf8' });
  const row = JSON.parse(raw)[0]?.results?.[0];
  writeFileSync(PATH, await postsFileFromRow(row));
  console.log(`${PATH} synced from live D1`);
}
