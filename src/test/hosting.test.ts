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

// The path pattern a block applies to -- its first non-comment line.
//
// Needed because the security-header block's pattern is `/*`, and every
// unhashed-asset block's pattern (`/*.webp`, `/*.jpg`, ...) also begins with
// those two characters. A `startsWith('/*')` test cannot tell them apart, so
// the caching tests below match on the WHOLE pattern instead. Getting that
// wrong in the other direction is what would silently drop every image rule
// out of the "unhashed" list and leave those three tests asserting nothing.
function blockPath(block: string): string {
  return block.split('\n')[0].trim();
}

// The block that applies to every response: security headers, no caching
// policy of its own.
const SECURITY_BLOCK = '/*';

// The unhashed-asset caching rules, identified by the SHAPE of their pattern
// -- `/*.<ext>`, one per file type -- rather than by subtracting the blocks
// that happen not to be them.
//
// The subtractive version ("everything that isn't /assets/ or /*") was one
// exclusion behind the file at all times: every new non-caching block (the
// security headers, and now a per-path policy block) landed in the "unhashed
// assets" list and failed three caching tests for a reason that had nothing
// to do with caching. Worse, the obvious fix -- filtering to blocks that
// declare a Cache-Control at all -- would have made those tests silently
// stop covering any future `/*.gif` rule that forgot one, which is the exact
// thing they exist to catch.
//
// Matching the pattern shape has neither problem: a new `/*.gif` block IS in
// this list and must carry the week-long policy like its siblings, and a new
// block for a route rather than a file type simply is not an asset rule.
function unhashedAssetBlocks(blocks: string[]): string[] {
  return blocks.filter((b) => /^\/\*\.[a-z0-9]+$/.test(blockPath(b)));
}

describe('cloudflare hosting config', () => {
  it('rewrites every unmatched route to the SPA entry point', () => {
    expect(existsSync('public/_redirects')).toBe(true);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  // Review fix (Important #3, Task 8): App.tsx's client-side
  // <Navigate to="/blog" replace /> keeps /blogs working for a visitor, but
  // it is not an HTTP redirect -- without a real 301, /blogs answers 200 and
  // only JS moves the visitor. That leaves a non-rendering crawler following
  // the sitemap's own /blogs entry (plugins/sitemap.ts) learning nothing,
  // and an inbound press link to /blogs passing no redirect signal to
  // /blog. Pinned as its own line AND as sitting above the SPA catch-all --
  // Cloudflare Pages processes _redirects top-to-bottom and stops at the
  // first match, so a rule below the catch-all would never fire.
  it('redirects /blogs to /blog with a real 301, above the SPA catch-all', () => {
    const redirects = readFileSync('public/_redirects', 'utf8');
    const blogsRule = redirects.match(/^\/blogs\s+\/blog\s+301$/m);
    expect(blogsRule).not.toBeNull();
    const catchAll = redirects.match(/^\/\*\s+\/index\.html\s+200$/m);
    expect(catchAll).not.toBeNull();
    expect(redirects.indexOf(blogsRule![0])).toBeLessThan(redirects.indexOf(catchAll![0]));
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
    // site served a stylesheet as text/html to every browser, and later how
    // it served its ENTRY BUNDLE as text/html and rendered a blank white page
    // on every route. See public/_headers' own comment.
    //
    // Asserted as an upper bound rather than an exact value, and the
    // difference matters: this number is a recovery time for a total outage,
    // so a future edit is free to make it shorter and must not be able to
    // make it longer by quietly restoring the old 86400. An equality check
    // would have to be edited in lockstep with every tightening, which is
    // how a limit ends up being loosened to make a test pass.
    const sMaxAge = assetsBlock!.match(/s-maxage=(\d+)/);
    expect(sMaxAge).not.toBeNull();
    expect(Number(sMaxAge![1])).toBeLessThanOrEqual(3600);
    expect(Number(sMaxAge![1])).toBeGreaterThan(0);
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
    const unhashed = unhashedAssetBlocks(headerBlocks());
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => {
      expect(block).toMatch(/max-age=604800/);
      expect(block).toMatch(/must-revalidate/);
    });
  });

  it('never marks unhashed assets immutable', () => {
    const unhashed = unhashedAssetBlocks(headerBlocks());
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => expect(block).not.toContain('immutable'));
  });

  // build-info.json is written fresh by every build (plugins/build-info.ts)
  // and polled by the admin dashboard to confirm a change is live. A cached
  // copy would tell the dashboard the previous build is the current one --
  // worse than no stamp at all, since it reports success on a deploy that
  // hasn't actually landed yet.
  // The security headers, pinned to the `/*` block specifically rather than
  // matched against the whole file, for the same reason the caching tests
  // above are scoped: a whole-file regex passes as long as the string appears
  // SOMEWHERE, including attached to a rule that covers only .webp files --
  // which would leave every HTML response, the one that actually matters for
  // sniffing and framing, with none of them.
  describe('security headers', () => {
    const EXPECTED: Record<string, RegExp> = {
      'X-Content-Type-Options': /^nosniff$/,
      'X-Frame-Options': /^DENY$/,
      'Referrer-Policy': /^strict-origin-when-cross-origin$/,
      'Permissions-Policy': /geolocation=\(\)/,
      'Strict-Transport-Security': /^max-age=31536000; includeSubDomains$/,
    };

    function securityBlock(): string {
      const block = headerBlocks().find((b) => blockPath(b) === SECURITY_BLOCK);
      expect(block, `no \`${SECURITY_BLOCK}\` block in public/_headers`).toBeDefined();
      return block!;
    }

    // Reads each header's VALUE off its own line rather than regex-matching
    // the block as one string. `expect(block).toMatch(/nosniff/)` passes on a
    // block that says `X-Frame-Options: nosniff`, which is not the same
    // claim and not a working header.
    function headerValue(block: string, name: string): string | undefined {
      const line = block
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
      return line?.slice(name.length + 1).trim();
    }

    for (const [name, pattern] of Object.entries(EXPECTED)) {
      it(`sets ${name} on every response`, () => {
        expect(headerValue(securityBlock(), name) ?? '').toMatch(pattern);
      });
    }

    // The CSP gets its own assertions because the browser check that really
    // proves it (scripts/check-csp.mjs, a real Chromium on the production
    // bundle) is not part of `npm test` -- it needs a browser binary and a
    // built dist/. These are the properties worth holding even in the suite
    // that runs on every commit.
    describe('content-security-policy', () => {
      const directive = (name: string): string => {
        const csp = headerValue(securityBlock(), 'Content-Security-Policy') ?? '';
        const found = csp
          .split(';')
          .map((d) => d.trim())
          .find((d) => d === name || d.startsWith(`${name} `));
        return found ?? '';
      };

      // The three that cost nothing and close whole attack classes:
      // object-src kills plugin-based script execution, base-uri stops an
      // injected <base> silently re-pointing every relative script URL, and
      // frame-ancestors is the modern spelling of the X-Frame-Options above.
      it.each([
        ["object-src 'none'", 'object-src'],
        ["base-uri 'none'", 'base-uri'],
        ["frame-ancestors 'none'", 'frame-ancestors'],
      ])('sets %s', (expected, name) => {
        expect(directive(name)).toBe(expected);
      });

      // `'unsafe-eval'` IS present, deliberately -- the admin's HEIC decoder
      // generates code at runtime and a blob worker inherits this policy, so
      // removing it breaks iPhone uploads (public/_headers explains the whole
      // decision, including why a per-path policy cannot express it).
      //
      // `'unsafe-inline'` in script-src is a completely different thing and
      // must never appear: it is what makes an injected <script> or a
      // `javascript:` URL execute, which is the entire class this policy
      // exists to stop. The two get conflated precisely because they look
      // alike in a diff, so the distinction is pinned rather than trusted.
      it("permits runtime code generation but never inline script", () => {
        const scriptSrc = directive('script-src');
        expect(scriptSrc).toContain("'unsafe-eval'");
        expect(scriptSrc).not.toContain("'unsafe-inline'");
      });

      // style-src is the opposite trade and worth stating: 17 components set
      // React style props, which become element style attributes, so inline
      // styles are unavoidable here. Styles cannot execute script, so this
      // costs far less than the script-src equivalent would.
      it('allows inline style, which React style props require', () => {
        expect(directive('style-src')).toContain("'unsafe-inline'");
      });

      // A default-src of 'self' is what makes every directive NOT listed
      // above fail closed rather than fall back to allowing anything.
      it("falls back to 'self' for anything not named", () => {
        expect(directive('default-src')).toBe("default-src 'self'");
      });
    });

    // Not a style note. `preload` is a submission into a list compiled into
    // browsers; removing it later does not undo it for anyone who already
    // has it, and this site is still on a test host whose hostname is going
    // to be thrown away. See public/_headers' own comment.
    it('does not ask to be added to the HSTS preload list', () => {
      expect(headerValue(securityBlock(), 'Strict-Transport-Security')).not.toContain('preload');
    });

    // The security block matches every path, so a Cache-Control here would
    // apply to hashed bundles and unhashed photos alike -- quietly competing
    // with the three per-asset-type policies this file exists to express.
    it('sets no caching policy of its own', () => {
      expect(headerValue(securityBlock(), 'Cache-Control')).toBeUndefined();
    });
  });

  it('marks /build-info.json no-store, not cached like the other unhashed assets', () => {
    const blocks = headerBlocks();
    const buildInfoBlock = blocks.find((b) => b.startsWith('/build-info.json'));
    expect(buildInfoBlock).toBeDefined();
    expect(buildInfoBlock).toMatch(/no-store/);
  });
});

// ---------------------------------------------------------------------------
// What the Cloudflare build gate must NOT contain.
//
// `npm run test:deploy` is the second command in the Pages build, so anything
// it runs can refuse a deploy. That is the point for content guards. It is a
// bug for a test that a legitimate content publish is expected to move.
//
// Found by publishing for real: a fifteen-character edit to one dish
// description failed src/test/homepage-bytes.test.tsx's byte-exact assertion,
// the build was refused, and because the commit had already landed on `main`
// every subsequent publish failed the same way. The owner could not fix it --
// `isContentPath` (worker/github.ts) restricts publishing to
// `src/content/*.json`, so the dashboard cannot reach the test file blocking
// it.
//
// The exclusion is what keeps publishing usable, and losing it would restore
// that outage silently, so it is asserted rather than trusted to a comment.
// ---------------------------------------------------------------------------
describe('the deploy gate excludes tests a content publish is meant to move', () => {
  function testDeployScript(): string {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    return pkg.scripts['test:deploy'];
  }

  it('exists at all', () => {
    expect(testDeployScript()).toBeTruthy();
  });

  it('excludes the byte-exact homepage snapshot', () => {
    expect(testDeployScript()).toContain('--exclude src/test/homepage-bytes.test.tsx');
  });

  // The other half, and the half that makes this a split rather than a
  // deletion: `npm test` must still run it, so a developer who changes the
  // homepage without meaning to is caught before merge. An exclusion that
  // leaked into the plain test script would turn this fix into a silent loss
  // of coverage.
  it('leaves the plain test script running it', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).not.toContain('homepage-bytes');
  });
});

// ---------------------------------------------------------------------------
// What the DEVELOPER gate must contain: the production build itself.
//
// Phase 3's final branch review found `npm run build` exiting 1 on a clean
// checkout, eleven commits deep, on a branch about to deploy. The assertion
// that failed -- src/test/bundle.post-build.test.ts's CSS byte ceiling --
// had been present and correct the whole time. It is `it.skipIf(!existsSync(
// 'dist/assets'))`, so with no dist/ on a developer machine it did not fail,
// it SKIPPED, and it was the "1 skipped" in every green vitest line of the
// phase. Eight tasks and five per-task reviews ran tsc + eslint + vitest +
// playwright and not one ran the build.
//
// Both gates that a human actually invokes now end with it: `npm run gate`
// here, and .githooks/pre-push as its own unconditional step. Asserted, not
// left to the comment, because the whole failure was a gate that had gone
// quiet without anyone noticing.
// ---------------------------------------------------------------------------
describe('the developer gate runs the production build', () => {
  function scripts(): Record<string, string> {
    return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
  }

  it('`npm run gate` runs `npm run build`', () => {
    expect(scripts().gate).toContain('npm run build');
  });

  // Ordering matters as much as presence. The build is the slowest step and
  // the one whose failure is most expensive to discover, so the cheap checks
  // run first -- but it must be IN the chain, not appended after something
  // that would swallow its exit code.
  it('runs the cheap checks before it, and chains on success', () => {
    const gate = scripts().gate;
    expect(gate.indexOf('tsc -b')).toBeLessThan(gate.indexOf('npm run build'));
    expect(gate.indexOf('eslint')).toBeLessThan(gate.indexOf('npm run build'));
    expect(gate).not.toMatch(/;\s*npm run build/);
  });

  // The build must run for EVERY code push, not only the ones that happen to
  // touch the paths the browser suite watches and only on a machine with
  // Playwright browsers installed. Before this, the hook's only path to a
  // build was `npm run test:csp` inside that conditional block.
  it('.githooks/pre-push runs it outside the conditional browser block', () => {
    const hook = readFileSync('.githooks/pre-push', 'utf8');
    const build = hook.indexOf('\nnpm run build');
    expect(build).toBeGreaterThan(-1);
    // `if echo "$CHANGED" | grep ...` opens the block that may be skipped.
    expect(build).toBeLessThan(hook.indexOf('\nif echo "$CHANGED"'));
  });
});

// ---------------------------------------------------------------------------
// What the DEVELOPER gate must contain: EVERY command the deploy runs.
//
// The block above fixed one instance of this (the build). This block fixes
// the class, because a second instance shipped anyway.
//
// The local gate ran `npm test -- --run`. Cloudflare runs `npm run
// test:deploy`. Those are two different commands: `test:deploy` is the same
// `vitest run` minus two files, and dropping two files repacks every
// REMAINING file across Vitest's workers, so the same test runs against
// different concurrency. src/admin/__tests__/AdminApp.test.tsx's "Add a
// coming-soon item" case passed `npm test` on every run and timed out at 5s
// under `test:deploy`, deterministically. The gate was green, the push was
// allowed, and the production build was refused. Nothing a developer could
// type locally would have shown it, because nothing local ran that command.
//
// Rather than pin `test:deploy` by name and wait for the third instance,
// this reads the documented Cloudflare build command out of
// docs/cloudflare-cutover.md -- the same source the ordering tests below
// already trust -- splits it on `&&`, and requires BOTH human-invoked gates
// to run every piece of it. A future step added to the deploy command turns
// this red until the local gates catch up, which is the property that was
// missing both times.
//
// What this deliberately does NOT assert: that the local gate runs ONLY
// those commands. `npm test -- --run` is a superset of `test:deploy` (it
// alone runs homepage-bytes and the image derivatives, excluded from the
// deploy gate for the reason the block further up records) and dropping it
// would be a real loss of coverage. Superset good, subset fatal.
// ---------------------------------------------------------------------------
describe('the developer gate runs every command the deploy runs', () => {
  // The three commands Cloudflare's build is documented to run, in order.
  function deployCommands(): string[] {
    const doc = readFileSync('docs/cloudflare-cutover.md', 'utf8');
    const match = doc.match(/\*\*Build command:\*\*\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    return match![1].split('&&').map((part) => part.trim());
  }

  function gateScript(): string {
    return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts.gate;
  }

  // Guards the guard: if the regex above ever stopped matching, or the
  // documented command lost its steps, every assertion below would pass
  // vacuously against an empty list.
  it('finds the real, multi-step deploy command to compare against', () => {
    const commands = deployCommands();
    expect(commands.length).toBeGreaterThanOrEqual(3);
    expect(commands).toContain('npm run test:deploy');
  });

  it('`npm run gate` runs every one of them', () => {
    const gate = gateScript();
    for (const command of deployCommands()) {
      expect(gate).toContain(command);
    }
  });

  // Chained with `&&`, not `;`: a `;` would run the next step regardless and
  // hand back only the LAST exit code, which is a gate that cannot fail --
  // the same defect as not running the command at all.
  it('chains them on success, cheap checks first', () => {
    const gate = gateScript();
    expect(gate).not.toMatch(/;/);
    expect(gate.indexOf('npx tsc -b')).toBeLessThan(gate.indexOf('npm run test:deploy'));
    expect(gate.indexOf('npm run test:deploy')).toBeLessThan(gate.indexOf('npm run build'));
  });

  // The hook is the gate that actually runs unattended, so it carries the
  // same requirement -- and, as with the build, outside the conditional
  // browser block, which is skipped for any push that does not touch the
  // paths it watches.
  it('.githooks/pre-push runs every one of them, outside the conditional browser block', () => {
    const hook = readFileSync('.githooks/pre-push', 'utf8');
    const conditional = hook.indexOf('\nif echo "$CHANGED"');
    expect(conditional).toBeGreaterThan(-1);
    for (const command of deployCommands()) {
      // Anchored to the start of a line so a mention inside one of this
      // hook's own long comments cannot satisfy it.
      const at = hook.indexOf(`\n${command}`);
      expect(at, `pre-push never runs "${command}"`).toBeGreaterThan(-1);
      expect(at, `pre-push runs "${command}" only inside the skippable block`).toBeLessThan(conditional);
    }
  });

  // And it must abort on failure rather than logging and carrying on -- the
  // hook's own convention for every other step.
  it('.githooks/pre-push aborts when the deploy suite fails', () => {
    const hook = readFileSync('.githooks/pre-push', 'utf8');
    expect(hook).toMatch(/\nnpm run test:deploy \|\| fail /);
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
  // would build and deploy successfully, guards and all -- and because
  // Cloudflare builds on every push to `main`, that happens unattended, on
  // whatever commit lands next, with nobody watching. This cannot verify
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
