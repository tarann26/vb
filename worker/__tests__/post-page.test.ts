import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POSTS_FILE, POSTS_PATH, lookupPost } from '../post-lookup';
import {
  BLOG_POST_PREFIX,
  SHELL_HEADERS_KEPT,
  SHELL_PATH,
  handlePostPage,
  slugFromPath,
} from '../post-page';
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

// Pages itself unreachable: the subrequest REJECTS rather than answering with
// a bad status. Still no network -- the rejection is synthesised here.
function unreachablePages() {
  return (async () => {
    throw new TypeError('Network connection lost.');
  }) as unknown as typeof fetch;
}

function get(path: string): Request {
  return new Request(`https://vb.aionxxxi.uk${path}`);
}

function head(path: string): Request {
  return new Request(`https://vb.aionxxxi.uk${path}`, { method: 'HEAD' });
}

function headerMap(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
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
    expect(html).toContain('content="https://viabiancarestaurant.com/press/royale.webp"');
    expect(html).toContain('<link rel="canonical" href="https://viabiancarestaurant.com/blog/live-only">');
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
    expect(html).toContain(`<link rel="canonical" href="https://viabiancarestaurant.com/blog/${SNAPSHOT_SLUG}">`);
    expect(html).toContain('"@type":"Article"');
  });

  // A Pages problem stays a Pages problem: handed straight back, status and
  // body, rather than turned into a 500 of this Worker's own making.
  //
  // The body is deliberately the SHELL rather than some arbitrary error text,
  // and that is the whole strength of this case: it is the WORST body Pages
  // could hand back on a non-2xx -- the only one that carries every anchor
  // rewriteShellHead looks for, and therefore the only one the guard's absence
  // could actually corrupt. It is not a claim about what Pages really returns.
  // (It does not: public/_redirects is `/* /index.html 200`, there is no
  // 404.html, and a non-2xx from Pages is a Cloudflare edge error page with
  // none of these tags.) Choosing the adversarial body makes the test stronger
  // than reality rather than weaker.
  //
  // Asserting only the status passes even with the `!shell.ok` guard deleted
  // (the rewritten response keeps the shell's 503) -- measured directly, which
  // is why the body assertion is here. It proves the handler never rewrote the
  // body, which is what stops this Worker from stamping a real post's title
  // and Article data onto a page telling the visitor the site is down.
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

  it('rewrites a body longer than the one Pages measured', async () => {
    const response = await handlePostPage(
      get('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      fakePages().impl,
    );
    const html = await response.text();
    expect(html).toContain('"@type":"Article"');
    expect(html.length).toBeGreaterThan(SHELL.length);
  });
});

// THE HEADER POLICY, which is the point rather than any particular header.
//
// This response is a document this Worker invented: the head is not the head
// Pages sent, and the bytes are not the bytes Pages measured. Inheriting the
// shell's headers and pruning the ones somebody thought of shipped the same
// defect twice -- once as Content-Length (a stale length is a truncated page),
// once as ETag (a validator for bytes that no longer exist, and the SAME one
// on every post, so a cache that trusts it can serve one post's body for
// another URL). The list is therefore an allow-list, and the tests below are
// written against the POLICY, so the next header nobody thought of is caught
// before it is named.
describe('what the rewritten response is allowed to carry', () => {
  // A shell response dressed in everything Pages, Cloudflare, or some future
  // deploy might plausibly attach to it.
  function dressedShell(): typeof fetch {
    return (async () =>
      new Response(SHELL, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'self'",
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'geolocation=()',
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
          ETag: 'W/"shell-v1"',
          'Last-Modified': 'Tue, 12 Aug 2026 00:00:00 GMT',
          'Content-Length': String(SHELL.length),
          'Content-Encoding': 'br',
          'Set-Cookie': 'pages_session=abc; Path=/',
          Vary: 'Accept-Encoding',
          Age: '42',
          'CF-Cache-Status': 'HIT',
          'X-Invented-Next-Quarter': 'whatever',
        },
      })) as unknown as typeof fetch;
  }

  async function rewritten(): Promise<Response> {
    return handlePostPage(get('/blog/live-only'), { DB: await dbWith(D1_POSTS) }, dressedShell());
  }

  // THE TEST THAT WOULD HAVE CAUGHT BOTH BUGS, and is written so it catches
  // the third one too: it names no forbidden header. Anything on the shell
  // that is not on the allow-list must be gone, whether or not anyone here
  // has heard of it.
  it('carries nothing the allow-list does not name', async () => {
    const response = await rewritten();
    const allowed = new Set([...SHELL_HEADERS_KEPT, 'Cache-Control'].map((n) => n.toLowerCase()));
    const carried: string[] = [];
    response.headers.forEach((_value, name) => {
      if (!allowed.has(name.toLowerCase())) carried.push(name);
    });
    expect(carried, `these crossed from the shell without being allowed: ${carried.join(', ')}`)
      .toEqual([]);
  });

  // Named individually as well, because these three are the ones with teeth
  // and a failure message saying "ETag" is worth more at 2am than one saying
  // "an unexpected header crossed".
  it('drops the validators, which describe bytes it replaced', async () => {
    const response = await rewritten();
    // The worst of the three: every post inherits the SAME shell ETag, so a
    // cache that trusts it can answer one post's URL with another's body.
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Last-Modified')).toBeNull();
  });

  it('drops the framing, which describes a body that no longer exists', async () => {
    const response = await rewritten();
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  it('does not forward a Set-Cookie onto a rewritten public document', async () => {
    const response = await rewritten();
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  // The other half: an allow-list that dropped the site's security policy
  // would be "safe" and would also undo the entire reason worker/index.ts
  // exempts this path in the first place.
  it('forwards the site policy Pages set, verbatim', async () => {
    const response = await rewritten();
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Permissions-Policy')).toBe('geolocation=()');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  // Authored, not inherited. Decision recorded in post-page.ts: this document
  // is assembled per request from a D1 row and carries no validator, so there
  // is nothing a cache could revalidate against.
  it('says no-store, whatever the shell said', async () => {
    const response = await rewritten();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  // The allow-list is not a place to remember things. If public/_headers grows
  // a security header for `/*`, post pages must either forward it or somebody
  // must decide not to -- and this is what makes that a decision rather than
  // an omission. Reads the file directly; no network, no build artifact.
  it('names every security header public/_headers sets on /*', () => {
    const block = readFileSync('public/_headers', 'utf8')
      .split(/^(?=\S)/m)
      .find((section) => section.startsWith('/*\n'));
    expect(block, 'no `/*` block in public/_headers').toBeDefined();
    const names = block!
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.includes(':'))
      .map((line) => line.slice(0, line.indexOf(':')).trim());
    expect(names.length).toBeGreaterThan(0);
    const allowed = SHELL_HEADERS_KEPT.map((n) => n.toLowerCase());
    for (const name of names) {
      expect(allowed, `public/_headers sets ${name} on /* but post pages drop it`).toContain(
        name.toLowerCase(),
      );
    }
  });

  // The distinction is deliberate and worth pinning. The allow-list governs
  // the response this Worker AUTHORS. The passthrough paths hand back Pages'
  // own Response with Pages' own body, and its validators are truthful there
  // -- stripping them would be cargo cult.
  it('leaves a passed-through shell exactly as Pages sent it, validators included', async () => {
    const response = await handlePostPage(
      get('/blog/no-such-post'),
      { DB: await dbWith(D1_POSTS) },
      dressedShell(),
    );
    expect(response.headers.get('ETag')).toBe('W/"shell-v1"');
    expect(await response.text()).toBe(SHELL);
  });
});

// Finding F1. RFC 9110 requires HEAD to answer what GET would, minus the body.
// The Workers runtime does not convert one into the other, so this is entirely
// on the handler -- and getting it wrong is invisible from a browser and a 404
// for every uptime monitor and link checker on a page that exists.
describe('HEAD on a post page', () => {
  async function bothWays(path: string, pagesBody = SHELL, status = 200) {
    const db = await dbWith(D1_POSTS);
    return {
      got: await handlePostPage(get(path), { DB: db }, fakePages(pagesBody, status).impl),
      headed: await handlePostPage(head(path), { DB: db }, fakePages(pagesBody, status).impl),
    };
  }

  // The invariant, asserted as an invariant rather than as a list of remembered
  // header names: whatever GET answers, HEAD answers the same, with no body.
  // This reddens if HEAD stops matching GET for ANY reason -- a header added on
  // one path, a status that diverges, a body that leaks through.
  it('matches GET exactly, status and headers, and carries no body', async () => {
    const { got, headed } = await bothWays('/blog/live-only');
    expect(headed.status).toBe(got.status);
    expect(headed.status).toBe(200);
    expect(headerMap(headed)).toEqual(headerMap(got));
    expect(headed.body).toBeNull();
    expect(await headed.text()).toBe('');
    // And GET really did have something to say, so the equality above is not
    // two empty things agreeing.
    expect(await got.text()).toContain('"@type":"Article"');
  });

  // The head is still rewritten for a HEAD, not skipped: the headers a HEAD
  // reports must describe the document a GET would send, and a short-circuit
  // that never fetched the shell would report the wrong ones.
  it('still asks Pages for the shell rather than short-circuiting', async () => {
    const pages = fakePages();
    await handlePostPage(head('/blog/live-only'), { DB: await dbWith(D1_POSTS) }, pages.impl);
    expect(pages.asked).toEqual([`https://vb.aionxxxi.uk${SHELL_PATH}`]);
  });

  // D5 and the Pages-error passthrough both have to agree with GET too, since
  // the body is dropped after the decision rather than before it.
  it('matches GET on an unresolvable slug and on a Pages error', async () => {
    const unresolvable = await bothWays('/blog/no-such-post');
    expect(unresolvable.headed.status).toBe(unresolvable.got.status);
    expect(unresolvable.headed.status).toBe(200);
    expect(await unresolvable.headed.text()).toBe('');

    const failing = await bothWays('/blog/live-only', SHELL, 503);
    expect(failing.headed.status).toBe(failing.got.status);
    expect(failing.headed.status).toBe(503);
    expect(await failing.headed.text()).toBe('');
  });
});

// Finding F6. A REJECTED subrequest, not a bad status -- Pages unreachable
// rather than Pages unhappy. Unhandled, this escapes worker.fetch and the
// visitor gets Cloudflare's 1101 "Worker threw exception" page: a failure this
// Worker neither chose nor can see, on the path Task 4 puts real traffic on.
describe('Pages unreachable', () => {
  it('answers a 503 the Worker chose, never a 404 and never a 200', async () => {
    const response = await handlePostPage(
      get('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      unreachablePages(),
    );
    // 503 and not 404 is the whole point: a 404 on a post URL is the
    // de-indexing event this phase is arranged around avoiding, and a 200
    // would tell every crawler the empty page it got was the real one.
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // This response is authored by the Worker, and worker/index.ts exempts
    // this path from SECURITY_HEADERS -- so it has to carry its own. The
    // document has no subresource of any kind, which is what makes the empty
    // policy correct here rather than a stray copy of the HTML one.
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const html = await response.text();
    expect(html).toContain('Temporarily unavailable');
    expect(html).not.toContain('"@type":"Article"');
  });

  it('answers HEAD the same way, with no body', async () => {
    const response = await handlePostPage(
      head('/blog/live-only'),
      { DB: await dbWith(D1_POSTS) },
      unreachablePages(),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  // The catch is deliberately around the subrequest and NOTHING else, and this
  // is what pins that. The subrequest resolves -- a real 200 with real headers
  // -- and the body stream fails afterwards, which is past the catch. The
  // handler must reject rather than laundering it into a tidy 503, because
  // everything downstream of the fetch is this repo's own code and a bug there
  // that always answers 503 is a bug nobody finds for a month.
  //
  // Reddens if the try is ever widened to wrap the whole function.
  it('lets a failure past the subrequest stay loud instead of laundering it into a 503', async () => {
    const brokenStream = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset mid-body'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )) as unknown as typeof fetch;
    await expect(
      handlePostPage(get('/blog/live-only'), { DB: await dbWith(D1_POSTS) }, brokenStream),
    ).rejects.toThrow();
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

  // Finding F1. HEAD is IN, because RFC 9110 makes it the same request as GET
  // minus the body -- it reaches the same handler and gets the same HTML
  // headers. OPTIONS is OUT, decided rather than defaulted: this Worker sets
  // no CORS headers anywhere, so answering a preflight would be inventing a
  // capability nothing asked for, and a 404 is what every other path in this
  // router already gives OPTIONS.
  it('exempts HEAD, which is a GET without a body, and not OPTIONS', () => {
    expect(
      servesSiteHtml(new Request('https://vb.aionxxxi.uk/blog/live-only', { method: 'HEAD' })),
    ).toBe(true);
    expect(
      servesSiteHtml(new Request('https://vb.aionxxxi.uk/blog/live-only', { method: 'OPTIONS' })),
    ).toBe(false);
    expect(
      servesSiteHtml(new Request('https://vb.aionxxxi.uk/blog', { method: 'HEAD' })),
    ).toBe(false);
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
    // Finding F7. This used to sit beside a redundant
    // `.not.toContain("default-src 'none'")`, which the equality already
    // implies and which therefore could never redden on its own. The trap it
    // was documenting is named in the comment above instead.
    expect(response.headers.get('Content-Security-Policy')).toBe(PAGES_CSP);
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
  // Measured against this tree. Widening servesSiteHtml to
  // `pathname.startsWith('/')` reddens 20 tests across four files --
  // post-page, hardening, index and analytics. Widening it only by dropping
  // the method check -- a pathname-only exemption, the smaller mistake and the
  // far easier one to make -- reddens the POST case below and its unit
  // sibling. And `startsWith('/blog')`, the "simplification" a careless hand
  // makes, reddens the /blogroll case below, which is the point of that case
  // existing at all.
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

  // Review finding 2. `startsWith('/blog')` -- the edit a careless hand makes
  // while "simplifying" the predicate -- was caught by a single unit assertion
  // and by nothing that drove a request. Under it, /blogroll, /blog and
  // /blog/a/b all start coming back 200 with the SPA shell instead of this
  // Worker's 404: path hijacking plus a wasted subrequest per hit. No header
  // leaks (the router widens with the exemption, which is the design working),
  // so status is the signal, and this drives it end to end so the net is more
  // than one assertion deep.
  it('does not claim a path that merely starts with the word blog', async () => {
    for (const path of ['/blogroll', '/blog', '/blog/a/b']) {
      const response = await throughWorker(
        get(path),
        await dbWith(D1_POSTS),
        () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
      expect(response.status, path).toBe(404);
      for (const [header, value] of Object.entries(FULL_SET)) {
        expect(response.headers.get(header), `${path} ${header}`).toBe(value);
      }
    }
  });

  // Finding F1, through the real entry point. Pages answers HEAD /blog/<slug>
  // 200 today; the moment Task 4 routes /blog/* here it must keep doing so.
  it('answers HEAD on a post page exactly as it answers GET, with no body', async () => {
    const db = await dbWith(D1_POSTS);
    const pages = () =>
      new Response(SHELL, {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': PAGES_CSP },
      });
    const got = await throughWorker(get('/blog/live-only'), db, pages);
    const headed = await throughWorker(
      new Request('https://vb.aionxxxi.uk/blog/live-only', { method: 'HEAD' }),
      db,
      pages,
    );
    expect(headed.status).toBe(got.status);
    expect(headed.status).toBe(200);
    expect(headerMap(headed)).toEqual(headerMap(got));
    // The exemption reaches HEAD too, or a HEAD would report a policy the
    // matching GET does not have.
    expect(headed.headers.get('Content-Security-Policy')).toBe(PAGES_CSP);
    expect(await headed.text()).toBe('');
  });

  // OPTIONS is the decided non-answer: no CORS anywhere in this Worker, so the
  // router's 404 with the full header set is the right response, not an
  // oversight that HEAD's fix happened to skip.
  it('leaves OPTIONS on a post URL as the router 404 with the full header set', async () => {
    const response = await throughWorker(
      new Request('https://vb.aionxxxi.uk/blog/live-only', { method: 'OPTIONS' }),
      await dbWith(D1_POSTS),
      () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    expect(response.status).toBe(404);
    for (const [header, value] of Object.entries(FULL_SET)) {
      expect(response.headers.get(header), header).toBe(value);
    }
  });

  // Finding F6, through the real entry point: the rejection must not escape
  // worker.fetch. If it does, Cloudflare serves its own 1101 page and nothing
  // in this Worker chose it.
  it('does not let an unreachable Pages throw out of the entry point', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = unreachablePages();
    try {
      const response = await worker.fetch(
        get('/blog/live-only'),
        { DB: await dbWith(D1_POSTS) } as unknown as Parameters<typeof worker.fetch>[1],
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('60');
    } finally {
      globalThis.fetch = original;
    }
  });

  // The route is gated on GET/HEAD. Without that guard a POST to a post URL
  // would be answered with the shell -- and, worse, would take the HTML header
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
