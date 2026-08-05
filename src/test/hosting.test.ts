import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site } from '../content';


// `_headers` allows `#` comments, and this file has substantial ones. Every
// block check below reads the RULES only -- an earlier version split the raw
// file on blank lines and matched `startsWith('/assets/')`, which silently
// stopped finding the assets block the moment a comment was written directly
// above it (the block then started with `#`), and simultaneously swept that
// block into the "unhashed" list, failing three tests for a reason that had
// nothing to do with caching.
function headerBlocks(): string[] {
  return readFileSync('public/_headers', 'utf8')
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

describe('cloudflare hosting config', () => {
  it('rewrites every unmatched route to the SPA entry point', () => {
    expect(existsSync('public/_redirects')).toBe(true);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  // public/_redirects cannot keep /api/* out of this catch-all: Cloudflare
  // Pages' _redirects only accepts status 200, 301, 302, 303, 307 or 308 --
  // an earlier version of this test pinned a 404 rule there, which Cloudflare
  // silently ignores at build time rather than erroring on, so that rule did
  // nothing and the catch-all was the only thing that ever matched /api/*.
  // (See public/_redirects' own comment for the fuller account, and
  // docs/cloudflare-cutover.md's deploy-time curl check, the only thing that
  // can actually observe this on the real platform.)
  //
  // The thing that genuinely keeps /api/* off the SPA catch-all is the
  // Worker route in wrangler.toml: Cloudflare Routes take precedence over
  // Pages for a matching hostname, so as long as that route exists, covers
  // /api/*, and is scoped to the site's real zone, this catch-all never sees
  // an /api/* request. This test pins *that* -- the route's existence,
  // pattern and zone -- since that's the thing whose absence (or whose zone
  // silently drifting to the wrong domain) is what would actually let
  // navigator.sendBeacon('/api/wa') succeed against HTML.
  it('routes /api/* to the Worker on the site\'s real zone, not just the Pages catch-all', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8');
    const routesBlock = wrangler.match(/routes\s*=\s*\[\s*\{([^}]*)\}\s*\]/);
    expect(routesBlock).not.toBeNull();

    const pattern = routesBlock![1].match(/pattern\s*=\s*"([^"]+)"/);
    const zoneName = routesBlock![1].match(/zone_name\s*=\s*"([^"]+)"/);
    expect(pattern).not.toBeNull();
    expect(zoneName).not.toBeNull();

    // Derived from site.json's own seo.url, not a second hardcoded literal
    // of the domain -- so this test fails if the two ever drift apart,
    // rather than each independently agreeing with a typo.
    const domain = new URL(site.seo.url).host;
    expect(pattern![1]).toBe(`${domain}/api/*`);

    // `zone_name` is the ZONE the route is registered in, which is not always
    // the site's own host: a site served from a subdomain (e.g. the
    // vb.aionxxxi.uk test host used before the real domain was bought) lives
    // inside the aionxxxi.uk zone, and Cloudflare rejects a route whose
    // zone_name is not a real zone on the account. An earlier version of this
    // test asserted `zoneName === domain`, which silently encoded "the site is
    // always at its zone apex" -- true of viabiancadelhi.com, false the moment
    // a subdomain was used, and it failed a correct configuration.
    //
    // The property actually worth pinning is unchanged: the route is scoped to
    // the zone that CONTAINS the site's host, so it cannot drift to some other
    // domain and quietly stop covering /api/*.
    const zone = zoneName![1];
    expect(domain === zone || domain.endsWith(`.${zone}`)).toBe(true);
  });

  // Scoped to the /assets/* block specifically, not matched against the
  // whole file. A whole-file regex passes as long as `max-age=31536000` and
  // `immutable` appear *somewhere*, even if a later edit attaches them to
  // the wrong rule -- e.g. swapping this policy onto the unhashed-photo
  // rules below and vice versa. That exact swap was built and run against
  // the old whole-file version of these two tests, and both passed.
  it('caches hashed bundles immutably', () => {
    const blocks = headerBlocks();
    const assetsBlock = blocks.find((b) => b.startsWith('/assets/'));
    expect(assetsBlock).toBeDefined();
    expect(assetsBlock).toMatch(/max-age=31536000/);
    expect(assetsBlock).toMatch(/immutable/);
    // The edge gets a much shorter TTL than the browser. Without this, a
    // response cached at a content-hashed URL during a deploy's propagation
    // window is held for a year and never revalidated -- which is how this
    // site served a stylesheet as text/html to every browser. See
    // public/_headers' own comment.
    expect(assetsBlock).toMatch(/s-maxage=86400/);
  });

  // Scoped to each unhashed-asset block, for the same reason: a whole-file
  // match for `max-age=604800` and `must-revalidate` is satisfied by any
  // block carrying those strings, including the /assets/* block if a future
  // edit accidentally duplicates them there instead of removing them from
  // it.
  //
  // /build-info.json is deliberately excluded from "unhashed" here: it's
  // served from an unhashed path like the rest of these blocks, but it is
  // not a cacheable asset -- it exists so the admin dashboard can poll the
  // live commit sha, which a week-long cache would silently defeat (see the
  // no-store assertion below). Filtering it out of `unhashed` keeps this
  // test about the general unhashed-asset policy rather than conflating it
  // with build-info.json's deliberately different one.
  it('caches unhashed public assets for a week, revalidating', () => {
    const blocks = headerBlocks();
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/') && !/no-store/.test(b));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => {
      expect(block).toMatch(/max-age=604800/);
      expect(block).toMatch(/must-revalidate/);
    });
  });

  it('never marks unhashed assets immutable', () => {
    const blocks = headerBlocks();
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/') && !/no-store/.test(b));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => expect(block).not.toContain('immutable'));
  });

  // build-info.json is written fresh by every build (plugins/build-info.ts)
  // and polled by the admin dashboard to confirm a change is live. A cached
  // copy would tell the dashboard the previous build is the current one --
  // worse than no stamp at all, since it reports success on a deploy that
  // hasn't actually landed yet.
  it('marks /build-info.json no-store, not cached like the other unhashed assets', () => {
    const blocks = headerBlocks();
    const buildInfoBlock = blocks.find((b) => b.startsWith('/build-info.json'));
    expect(buildInfoBlock).toBeDefined();
    expect(buildInfoBlock).toMatch(/no-store/);
  });
});

describe('documented cloudflare build command', () => {
  // Task 2 made public/ derivatives untracked, so a fresh clone (exactly what
  // Cloudflare builds from) has none until `npm run images` runs. `npm run
  // test:deploy` runs the suite that checks those derivatives exist. Run the
  // test gate before the images step and the gate fails on a machine that did
  // nothing wrong -- it just hasn't generated the files it's checking for
  // yet. This extracts the actual documented command and checks the ordering
  // rather than merely asserting the word "images" appears somewhere in the
  // document, which would pass even if the document only mentioned images in
  // passing without running them first.
  it('runs `npm run images` before `npm run test:deploy`', () => {
    const doc = readFileSync('docs/cloudflare-cutover.md', 'utf8');
    const match = doc.match(/\*\*Build command:\*\*\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const command = match![1];

    const imagesIndex = command.indexOf('npm run images');
    const testDeployIndex = command.indexOf('npm run test:deploy');

    expect(imagesIndex).toBeGreaterThanOrEqual(0);
    expect(testDeployIndex).toBeGreaterThanOrEqual(0);
    expect(imagesIndex).toBeLessThan(testDeployIndex);
  });

  // The other half of the ordering, and the one Task 8 exists to guard:
  // four of the five content guards (Plan 2) produce a *successful*
  // `npm run build` and a deployable `dist/` that white-pages -- `vite
  // build` bundles src/content/index.ts without executing it, so
  // assertCopy/assertSections/narrowSectionId/assertHours never run at
  // build time. `npm run test:deploy` is what actually executes them.
  // If the documented command ever put `npm run build` first, a bad commit
  // would build and deploy successfully, guards and all, and the cron
  // (worker/index.ts's `scheduled` handler) would trigger exactly that
  // command, unattended, on whichever hourly tick a scheduled item next
  // comes due -- as early as 04:00 with nobody watching. This cannot verify
  // the Cloudflare dashboard itself holds this order (see
  // docs/cloudflare-cutover.md's own new step on that, and that step's own
  // comment on why nothing in this repository can check it) -- only that
  // the documented command this repository asks a human to copy in cannot
  // silently drift into describing the unsafe order.
  // Plan 4 Task 1 added `npm run test:bundle` (src/test/bundle.post-build.test.ts,
  // the dist/assets/ admin-code grep) as the LAST step of `npm run build`
  // itself -- package.json's own `build` script, pinned by exact string
  // equality in src/test/smoke.test.ts -- not as a new entry appended to
  // *this* documented outer command. That's why the regex and assertions
  // below are unchanged by that task: this test only ever looked at the
  // three-command outer sequence (`images`, `test:deploy`, `build`), and
  // nothing about that sequence's own ordering moved. What test:bundle
  // actually depends on -- running after `vite build` has produced a real
  // `dist/` for it to grep, not before -- is guaranteed by where it sits
  // inside the `build` script's own literal string, which is what makes it
  // redundant to re-check here too.
  it('runs `npm run test:deploy` before `npm run build`', () => {
    const doc = readFileSync('docs/cloudflare-cutover.md', 'utf8');
    const match = doc.match(/\*\*Build command:\*\*\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const command = match![1];

    const testDeployIndex = command.indexOf('npm run test:deploy');
    const buildIndex = command.indexOf('npm run build');

    expect(testDeployIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(testDeployIndex).toBeLessThan(buildIndex);
  });
});
