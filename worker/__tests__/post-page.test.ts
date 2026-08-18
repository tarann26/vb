import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POSTS_FILE, POSTS_PATH, lookupPost } from '../post-lookup';
import { BLOG_POST_PREFIX, SHELL_PATH, handlePostPage, slugFromPath } from '../post-page';
import worker, { servesSiteHtml } from '../index';
import { snapshotFor } from '../snapshot';
import { asD1, FakeD1 } from './fakeD1';
import { D1Store } from '../d1';
import { PUBLIC_FILES } from '../published';
import { D1_ONLY_PATHS } from '../store';

// The snapshot's own posts, read from the compiled module rather than
// hardcoded here -- the same posture worker/__tests__/published.test.ts takes
// for awards.json and story.json, and for the same reason: a hardcoded copy
// pins content that has already moved.
const SNAPSHOT_POSTS = JSON.parse(snapshotFor('posts.json')!) as { slug: string; title: string }[];
const SNAPSHOT_SLUG = SNAPSHOT_POSTS[0].slug;
const SNAPSHOT_TITLE = SNAPSHOT_POSTS[0].title;

const D1_POSTS = JSON.stringify([
  {
    id: 'post-live',
    slug: 'live-only',
    type: 'story',
    title: 'A post that exists only in the database',
    date: '2026-08-12',
    excerpt: 'Published after the last deploy.',
    image: '/press/royale.webp',
    blocks: [],
  },
]);

// Review fix (F3). This used to be FakeD1.seed(), a direct row insert with a
// literal 'test-sha' and a version frozen at 1 -- a row shape D1Store.write
// can never actually produce (write always derives sha from sha256Hex(body)
// and advances version through its own ON CONFLICT guard). lookupPost only
// ever reads `.content`, so the divergence never falsified a test here, but
// it was a second definition of "what a content row is" sitting next to the
// real one, and the two would drift the moment a later task read `sha` or
// `version` off this path (an ETag, say). published.test.ts's own
// `publishPosts` already proves a real `D1Store.write` is enough to serve
// every shape this file needs, malformed and blank-image bodies included --
// `write` validates only encoding and `baseSha`, never content shape.
async function dbWith(body: string): Promise<D1Database> {
  const fake = new FakeD1();
  await new D1Store(asD1(fake)).write(
    [{ path: POSTS_PATH, content: body, encoding: 'utf-8' as const }],
    'seed',
    'p1',
  );
  return asD1(fake);
}

describe('looking a post up', () => {
  // Review fix (F1). Every other test in this file seeds at POSTS_PATH and
  // reads at POSTS_PATH, so they move together and none of them can catch
  // POSTS_PATH drifting from the path the rest of the Worker actually uses
  // for posts.json. Pinned here against two sources neither dbWith nor
  // lookupPost touches: PUBLIC_FILES (worker/published.ts -- what
  // /api/published maps the public "posts.json" name to) and D1_ONLY_PATHS
  // (worker/store.ts -- what the publish route treats as D1-backed).
  // Measured: setting POSTS_PATH to a typo'd path leaves every other test in
  // this file green (they all move with the constant) and reddens only this
  // one.
  it('POSTS_PATH is the same path PUBLIC_FILES and D1_ONLY_PATHS already use for posts.json', () => {
    expect(POSTS_PATH).toBe(PUBLIC_FILES.get(POSTS_FILE));
    expect(D1_ONLY_PATHS.has(POSTS_PATH)).toBe(true);
  });

  it('finds a post that exists only in D1, and says where it came from', async () => {
    const found = await lookupPost(await dbWith(D1_POSTS), 'live-only');
    expect(found?.post.title).toBe('A post that exists only in the database');
    expect(found?.source).toBe('d1');
  });

  it('returns null for a slug in neither store', async () => {
    expect(await lookupPost(await dbWith(D1_POSTS), 'no-such-post')).toBeNull();
  });

  // Decision D4. A database problem must cost freshness, never availability
  // -- the same sentence worker/published.ts already lives by. A 500 or a
  // manufactured 404 on a post URL is a de-indexing event.
  it('falls back to the compiled-in snapshot when the read throws', async () => {
    const throwing = asD1({
      prepare() {
        throw new Error('D1_ERROR: no such table');
      },
    } as unknown as FakeD1);
    const found = await lookupPost(throwing, SNAPSHOT_SLUG);
    expect(found?.post.slug).toBe(SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // Review fix (F6). This used to assert only `source`, unlike the throwing
  // case just above -- a fallback that answered with the WRONG post would
  // still have passed. Now asserts the same two fields its sibling does.
  it('falls back to the snapshot when the row is missing entirely', async () => {
    const found = await lookupPost(asD1(new FakeD1()), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
    expect(found?.post.slug).toBe(SNAPSHOT_SLUG);
  });

  // The guard is the boundary. A D1 body that assertPosts refuses is BAD
  // DATA arriving healthy, not an outage -- so it is treated exactly like a
  // failed read, and the snapshot answers.
  it('refuses a malformed D1 body and uses the snapshot instead', async () => {
    const found = await lookupPost(await dbWith('[{"slug":"live-only"}]'), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // Review fix (F4). The old version of this test asked for `null` on a slug
  // ('live-only') that is ALSO absent from the snapshot, so it passed for
  // two independent reasons at once -- the guard refusing the blank-image
  // body, AND the snapshot never having that slug -- and would have kept
  // passing, for the wrong reason, even with the guard removed, the moment
  // the snapshot happened to gain a 'live-only' post. This version asks for
  // a slug the snapshot DOES hold, so the only way to pass is for the guard
  // to have actually refused the blank-image D1 body and fallen back:
  // `source` proves the D1 row was rejected rather than served, and
  // `post.title` proves what came back is the real snapshot post, not the
  // blank-image one leaking through under a borrowed slug.
  it('refuses a D1 post with a blank image, and serves the snapshot post at that same slug instead', async () => {
    const blankImage = JSON.stringify([
      { ...JSON.parse(D1_POSTS)[0], slug: SNAPSHOT_SLUG, image: '' },
    ]);
    const found = await lookupPost(await dbWith(blankImage), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
    expect(found?.post.title).toBe(SNAPSHOT_TITLE);
  });

  // Review fix (F2). assertPosts([]) succeeds -- an emptied blog is a legal
  // state (guards.ts's own comment says so) -- so a D1 body of "[]" reaches
  // `posts = []` through a HEALTHY read, never touches the fallback branch,
  // and every slug then resolves to null: this is the one shape in this
  // module that answers null for a reason that has nothing to do with D1
  // being unreachable. See post-lookup.ts's own comment on this branch for
  // why that is deliberate (Decision D5: the caller serves the Pages shell
  // unmodified at 200, not a 404) rather than a gap.
  it('an emptied posts.json resolves no slug, and does not resurrect one from the snapshot', async () => {
    const found = await lookupPost(await dbWith('[]'), SNAPSHOT_SLUG);
    expect(found).toBeNull();
  });
});

// The committed shell. The BUILT one (dist/index.html) is what the Worker
// really fetches, and it is pinned separately by
// worker/__tests__/post-shell.dist.test.ts -- which runs against the real
// artifact on every build. This file uses the source shell because it must run
// with no dist/ on disk.
const SHELL = readFileSync('index.html', 'utf8');

// A stand-in for Pages. Records what was asked for, so the test can prove the
// Worker fetches a path its OWN route cannot match -- which is what keeps
// this from being an infinite loop. NO TEST IN THIS FILE TOUCHES THE NETWORK:
// every handler call is handed this stub, and the one case that goes through
// worker.fetch swaps globalThis.fetch and puts it back in a finally.
function fakePages(body: string = SHELL, status = 200) {
  const asked: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    asked.push(typeof input === 'string' ? input : input.toString());
    return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
  }) as unknown as typeof fetch;
  return { asked, impl };
}

function get(path: string): Request {
  return new Request(`https://vb.aionxxxi.uk${path}`);
}

describe('slugFromPath', () => {
  it('reads the slug out of a post path', () => {
    expect(slugFromPath('/blog/assassina')).toBe('assassina');
  });

  // Decision D3. `/blog/*` does not match bare `/blog`, and this function
  // must agree with the route pattern rather than quietly widening it.
  it('does not claim the index', () => {
    expect(slugFromPath('/blog')).toBeNull();
    expect(slugFromPath('/blog/')).toBeNull();
  });

  it('does not claim a deeper path', () => {
    expect(slugFromPath('/blog/a/b')).toBeNull();
  });

  it('does not claim the admin route', () => {
    expect(slugFromPath('/edit')).toBeNull();
    expect(slugFromPath('/edit/manage')).toBeNull();
  });
});

describe('serving a post page', () => {
  it('asks Pages for the shell at a path its own route cannot match', async () => {
    const pages = fakePages();
    await handlePostPage(
      get(`${BLOG_POST_PREFIX}${SNAPSHOT_SLUG}`),
      { DB: await dbWith(D1_POSTS) },
      pages.impl,
    );
    expect(pages.asked).toEqual([`https://vb.aionxxxi.uk${SHELL_PATH}`]);
    expect(SHELL_PATH.startsWith(BLOG_POST_PREFIX)).toBe(false);
  });

  // THE ASSERTION THAT MATTERS. The raw body of the HTTP response, with no
  // DOM, no jsdom, and no JavaScript executing. This is what a crawler gets.
  it('puts the post title and Article data in the raw response body', async () => {
    const response = await handlePostPage(
      get('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      fakePages().impl,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<title>A post that exists only in the database</title>');
    expect(html).toContain('content="https://vb.aionxxxi.uk/press/royale.webp"');
    expect(html).toContain('<link rel="canonical" href="https://vb.aionxxxi.uk/blog/live-only">');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"headline":"A post that exists only in the database"');
  });

  // Decision D5.
  it('passes the shell through untouched for a slug that resolves to nothing', async () => {
    const response = await handlePostPage(
      get('/blog/no-such-post'),
      { DB: await dbWith(D1_POSTS) },
      fakePages().impl,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SHELL);
  });

  // Decision D4, end to end: an outage costs freshness, not the page.
  it('still serves per-post metadata from the snapshot when D1 throws', async () => {
    const throwing = asD1({
      prepare() {
        throw new Error('D1_ERROR: no such table');
      },
    } as unknown as FakeD1);
    const html = await (
      await handlePostPage(get(`/blog/${SNAPSHOT_SLUG}`), { DB: throwing }, fakePages().impl)
    ).text();
    expect(html).toContain(`<link rel="canonical" href="https://vb.aionxxxi.uk/blog/${SNAPSHOT_SLUG}">`);
    expect(html).toContain('"@type":"Article"');
  });

  // A Pages problem stays a Pages problem: handed straight back, status and
  // body, rather than turned into a 500 of this Worker's own making.
  //
  // The body is deliberately the SHELL rather than some arbitrary error text,
  // and that is the whole strength of this case. Pages serves the SPA shell as
  // the body of its own error pages, so an error response CAN carry every
  // anchor rewriteShellHead looks for. Asserting only the status passes even
  // with the `!shell.ok` guard deleted (the rewritten response keeps the
  // shell's 503) -- measured directly. Asserting the body proves the handler
  // never rewrote it, which is what stops this Worker from stamping a real
  // post's title and Article data onto a page that is telling the visitor the
  // site is down.
  it('hands a failed shell fetch straight back, unread and unrewritten, rather than inventing a 500', async () => {
    const response = await handlePostPage(
      get('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      fakePages(SHELL, 503).impl,
    );
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toBe(SHELL);
    expect(html).not.toContain('"@type":"Article"');
  });

  // Decision D9. What the VISITOR gets when the rewriter refuses: the shell
  // exactly as Pages sent it, at 200 -- never a half-rewritten head, and never
  // an error. The site's own generic metadata is a degradation; a head whose
  // title and og:image describe different documents is a wrong answer.
  it('serves the shell untouched when it no longer carries the anchors', async () => {
    const broken = SHELL.replace(/<meta property="og:url"[^>]*>/, '');
    const response = await handlePostPage(
      get('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      fakePages(broken).impl,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(broken);
  });
});

// THE TRAP. worker/index.ts sets `Content-Security-Policy: default-src 'none'`
// on every response it returns -- correct for a JSON API, and fatal for HTML:
// it forbids script, style, font and image, so the SPA shell renders as a
// blank white page at a 200, with no error in any log. public/_headers already
// carries the right policy for this site's HTML, and Pages puts it on the
// /index.html response this Worker fetched. The fix is to leave that response's
// headers alone rather than to write a second copy of the policy here that
// could drift from _headers.
//
// The exemption is written over the REQUEST, not over a path list, so this
// describe block enumerates the exact boundary of it: which requests are
// exempt, and which -- one character or one verb away -- are not.
describe('site HTML keeps the headers Pages gave it', () => {
  function post(path: string): Request {
    return new Request(`https://vb.aionxxxi.uk${path}`, { method: 'POST', body: '{}' });
  }

  it("exempts a GET of a post path from this Worker's API-shaped header set", () => {
    expect(servesSiteHtml(get('/blog/assassina'))).toBe(true);
  });

  it('does not exempt the API, which must keep them', () => {
    expect(servesSiteHtml(get('/api/published'))).toBe(false);
    expect(servesSiteHtml(post('/api/publish'))).toBe(false);
  });

  it('does not exempt the admin route', () => {
    expect(servesSiteHtml(get('/edit'))).toBe(false);
    expect(servesSiteHtml(get('/edit/manage'))).toBe(false);
  });

  // The catastrophic widening, asserted directly: an exemption that matched
  // the root would strip the security headers off every response this Worker
  // makes, while the three cases above still passed -- none of '/api/...',
  // '/edit' or '/blog/assassina' would change answer.
  it('exempts nothing at the root, and nothing at the blog index', () => {
    expect(servesSiteHtml(get('/'))).toBe(false);
    expect(servesSiteHtml(get('/blog'))).toBe(false);
    expect(servesSiteHtml(get('/blog/'))).toBe(false);
    expect(servesSiteHtml(get('/blog/a/b'))).toBe(false);
  });

  // The method half. `POST /blog/x` is answered by the router's own plain-text
  // 404 -- a response this Worker authored, that is not HTML, and that must
  // keep every header. A pathname-only exemption would hand it back bare.
  it('does not exempt a non-GET on a post path', () => {
    expect(servesSiteHtml(post('/blog/live-only'))).toBe(false);
  });
});

// Swaps globalThis.fetch for a Pages stub and always puts it back. Nothing
// here reaches the network: worker.fetch calls handlePostPage with no
// fetchImpl, so the global is the only seam.
async function throughWorker(request: Request, db: D1Database, pagesResponse: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => pagesResponse()) as unknown as typeof fetch;
  try {
    return await worker.fetch(request, { DB: db } as unknown as Parameters<typeof worker.fetch>[1]);
  } finally {
    globalThis.fetch = original;
  }
}

describe('the Worker entry point, end to end', () => {
  const PAGES_CSP = "default-src 'self'; script-src 'self' 'unsafe-eval'";

  it('leaves the CSP Pages set on the post page, rather than replacing it with default-src none', async () => {
    const response = await throughWorker(
      get('/blog/live-only'),
      await dbWith(D1_POSTS),
      () =>
        new Response(SHELL, {
          status: 200,
          headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': PAGES_CSP },
        }),
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(PAGES_CSP);
    expect(response.headers.get('Content-Security-Policy')).not.toContain("default-src 'none'");
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(await response.text()).toContain(
      '<title>A post that exists only in the database</title>',
    );
  });

  // THE OTHER HALF, and the one that matters most: the exemption must apply to
  // the post page and to NOTHING else. worker/__tests__/hardening.test.ts
  // already asserts this header set across three cases; it is restated here,
  // in the file that introduces the exemption, so that widening servesSiteHtml
  // reddens a test sitting next to the code that did it.
  //
  // Measured. Widening servesSiteHtml to `pathname.startsWith('/')` reddens
  // both cases below, the POST case after them, and all four unit cases above
  // -- 16 tests across three files. Widening it only by dropping the method
  // check (a pathname-only exemption, the smaller mistake and the easier one
  // to make) reddens exactly two: the POST case below and its unit sibling.
  const FULL_SET: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  };

  it('still puts the full header set on an /api/* JSON response', async () => {
    const response = await throughWorker(
      get('/api/health'),
      await dbWith(D1_POSTS),
      () => new Response('unused', { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    for (const [header, value] of Object.entries(FULL_SET)) {
      expect(response.headers.get(header), header).toBe(value);
    }
  });

  it('still puts the full header set on an error response', async () => {
    const response = await throughWorker(
      get('/api/nope'),
      await dbWith(D1_POSTS),
      () => new Response('unused', { status: 200 }),
    );
    expect(response.status).toBe(404);
    for (const [header, value] of Object.entries(FULL_SET)) {
      expect(response.headers.get(header), header).toBe(value);
    }
  });

  // The route is gated on GET. Without that guard a POST to a post URL would
  // be answered with the shell -- and, worse, would take the HTML header
  // exemption with it. Nothing else in this repo asserts the method gate.
  it('does not answer a POST to a post URL, and keeps the full header set on that refusal', async () => {
    const response = await throughWorker(
      new Request('https://vb.aionxxxi.uk/blog/live-only', { method: 'POST', body: '{}' }),
      await dbWith(D1_POSTS),
      () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    expect(response.status).toBe(404);
    for (const [header, value] of Object.entries(FULL_SET)) {
      expect(response.headers.get(header), header).toBe(value);
    }
    expect(await response.text()).toBe('Not found');
  });
});
