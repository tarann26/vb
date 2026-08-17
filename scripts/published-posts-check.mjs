// The seed/deploy ordering hazard, turned from a paragraph nobody has to read
// into a check that fails loudly. Used by scripts/verify-deploy.mjs; see
// docs/cloudflare-cutover.md's "Before a deploy that matters" for the sequence
// this defends.
//
// THE HAZARD, in one sentence: until the Worker carrying Phase 5B ships,
// `src/content/posts.json` still routes to GitHub (worker/store.ts's
// D1_ONLY_PATHS is read from the DEPLOYED Worker, not from this repository),
// so a publish landing between `seed-posts-d1.mjs` and `wrangler deploy`
// commits a post to the repository and leaves the seeded D1 row stale -- and
// the deploy then makes that stale row the live copy and hides the post.
//
// It is undetectable BEFORE the deploy and trivial to detect after it: the
// live read path and the committed file are both right here.
//
// A SEPARATE MODULE, and the reason is a runner rather than tidiness.
// scripts/sync-posts-fallback.mjs -- the other file that compares these same
// two artefacts -- imports src/content/guards.ts, so it only runs under `npx
// tsx`. `npm run verify:deploy` is plain `node scripts/verify-deploy.mjs`.
// This module therefore imports NOTHING at all: no TypeScript, no node
// builtins, no network. Keep it that way, or verify:deploy stops running.
//
// Pure and exported so scripts/__tests__/published-posts-check.test.mjs can
// exercise every branch without a deploy, a network call or a browser.

function slugsOf(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} is not a list of posts`);
  return value.map((post, i) => {
    const slug = post && typeof post === 'object' ? post.slug : undefined;
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new Error(`${label} has an entry at [${i}] with no slug`);
    }
    return slug;
  });
}

// `servedText` is the body of GET /api/published?path=posts.json.
// `committedText` is the repository's src/content/posts.json.
//
// Returns { failures, notes }. `failures` are what should exit 1; `notes` are
// what should be printed and not failed on. The split is the whole design, and
// it is what keeps this from crying wolf on every ordinary push:
//
//   FAIL  a slug the repository has that the live copy does not.
//         This is the hazard's exact signature -- the live copy is BEHIND the
//         repository, which after a correct seed-then-deploy is impossible.
//         It is also the state in which sitemap.xml advertises a /blog/<slug>
//         that resolves to the not-found screen once the swap lands, and in
//         which a reader sees a card at first paint that then disappears.
//
//   NOTE  a slug the live copy has that the repository does not.
//         Entirely normal: she published after the last sync. The committed
//         file is a mirror that lags on purpose (D1 is the live copy), so this
//         is a reminder to run sync-posts-fallback.mjs before the NEXT deploy,
//         not a failure of this one.
//
// Deliberately compares SLUGS, not bytes. The stored body is exactly what the
// dashboard sent, which is minified, while the committed file is the
// reformatted human-readable mirror -- a byte comparison would fail on
// whitespace every single time and would be switched off within a week.
export function postsDriftProblems(servedText, committedText) {
  const failures = [];
  const notes = [];

  let served;
  let committed;
  try {
    served = slugsOf(JSON.parse(servedText), 'the live posts.json');
  } catch (error) {
    // A body the live read path cannot even be parsed out of is a failure on
    // its own: use-posts.ts would refuse it and every visitor would silently
    // fall back to the compiled-in copy, with a healthy 200 all the way.
    failures.push(`the live posts.json could not be read: ${error.message}`);
    return { failures, notes };
  }
  try {
    committed = slugsOf(JSON.parse(committedText), 'the committed posts.json');
  } catch (error) {
    failures.push(`src/content/posts.json could not be read: ${error.message}`);
    return { failures, notes };
  }

  const live = new Set(served);
  const missing = committed.filter((slug) => !live.has(slug));
  if (missing.length > 0) {
    failures.push(
      `the live blog is missing ${missing.length} post(s) the repository has (${missing.join(', ')}) -- ` +
        'the D1 row is behind src/content/posts.json. If a publish landed between ' +
        '`npx tsx scripts/seed-posts-d1.mjs` and `npx wrangler deploy`, the deploy just hid it.',
    );
  }

  const inRepo = new Set(committed);
  const extra = served.filter((slug) => !inRepo.has(slug));
  if (extra.length > 0) {
    notes.push(
      `the live blog has ${extra.length} post(s) the repository does not (${extra.join(', ')}) -- ` +
        'normal after a publish; run `npx tsx scripts/sync-posts-fallback.mjs` before the next deploy ' +
        'so the first-paint copy, sitemap.xml and the asset walk catch up.',
    );
  }

  return { failures, notes };
}
