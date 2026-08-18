# Phase 5C: Server-Rendered Post SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://<site>/blog/<slug>` answer, in its raw HTTP response body with JavaScript never executing, that post's own title, description, Open Graph image, and Article structured data.

**Architecture:** The Worker takes a new edge route, `/blog/*`, on both served hostnames. For a request under it, the Worker fetches the live Pages shell (`/index.html`, which matches no Worker route and therefore goes straight to Pages), looks the slug up in D1 with the compiled-in snapshot as its outage fallback, and rewrites the shell's `<head>` as a string before returning it. The body of the page is still the SPA's, hydrated client-side exactly as today; only the head is server-authored. Nothing is compiled into the Worker that could go stale against a Pages deploy.

**Tech Stack:** Cloudflare Workers (`worker/`, esbuild via wrangler), Cloudflare D1, Cloudflare Pages, TypeScript (solution-style project references), Vitest + jsdom, Playwright (`e2e/`), plain Node scripts (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md` — the whole of this phase is line 232: *"Posts render server-side in the Worker with per-post title, description, Open Graph image, and Article structured data."*

---

## Global Constraints

Every task's requirements implicitly include this section.

- `npx tsc -b --noEmit` is the only typecheck that works. The repo uses a solution-style `tsconfig.json` (`files: []`, three project references: `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.worker.json`). A bare `tsc --noEmit` typechecks nothing.
- Every test must be able to fail, proven by mutating the code and watching it go red. A test that has never been seen red is not evidence.
- jsdom has no layout engine, so geometry and computed-style claims go in `e2e/`.
- Tailwind's content scanner is a plain text extractor with no JS parser, so never write a bare utility-class-looking token in a comment.
- Playwright runs only when nothing else runs; port 8080 is shared.
- Never mention AI or list any AI as co-author anywhere — not in code, comments, commit messages, docs, or PR text.
- Brand blue `#C8D8E8` is a surface colour only (1.45:1 on white); foreground text on light backgrounds uses accent `#9D4949` (6.03:1).
- No paid Cloudflare resources without asking. R2 is not enabled on this account (billing-gated, code 10042). D1 free tier, verified: 5M rows read/day, 100k written/day, 500 MB/database.
- Entry CSS is 38593 bytes against a 38700 ceiling (`src/test/bundle.post-build.test.ts:715-719`). 107 bytes of headroom. **This phase must add zero CSS bytes** — it introduces no component, no Tailwind class, and no change to `src/index.css`. If a step in this plan makes the CSS number move, that step has strayed outside the plan.
- `worker/__tests__/bundle.test.ts` fails the build if React or `createContext` reaches the Worker bundle. Nothing in this plan may import a `.tsx` file, a React component, or `src/content/context.ts` from `worker/`.
- The `/edit` session cookie is `SameSite=Strict` with no `Domain=`. The Worker must stay same-origin; no separate rendering origin.
- `/blogs` → `/blog` is a real 301 in `public/_redirects` plus an in-app `<Navigate>` fallback in `App.tsx`. Both must survive this phase untouched.
- `wrangler deploy` REPLACES the Worker's route list with exactly what `wrangler.toml` declares. A route added by hand in the dashboard disappears on the next deploy.

---

## Decisions Where the Spec Is Silent

Each of these is a choice this plan makes, with the cost of being wrong. They are restated inside the tasks that implement them; they are collected here so a reviewer can reject one without reading the whole plan.

**D1 — The Worker rewrites the shell's `<head>`; it does not render the post body server-side.**
The spec's sentence enumerates exactly four artefacts — title, description, Open Graph image, Article structured data — and all four live in `<head>`. Rendering the body would mean a second implementation of ten block renderers plus the inline markdown renderer inside the Worker, because `worker/__tests__/bundle.test.ts` fails the build if React lands there (and `worker/published.ts`'s own header already records this). That second renderer would have nothing comparing it to `src/components/blog/blocks.tsx`, and it would be the first place in this codebase that turns author markdown into an HTML string.
*Cost if wrong:* a crawler that does not execute JavaScript gets correct metadata and structured data but no article prose. Googlebot renders JS and sees the full body; a plain-`curl` scraper does not. If per-post body text in the raw HTML turns out to be required, it is a follow-on phase, not a patch to this one.

**D2 — The shell comes from a live fetch of Pages on every request. Nothing about the shell is compiled into the Worker, and the Worker never caches its body.**
Asset filenames are salted with the commit sha (`vite.config.ts:75-77`) and Pages serves only the current deployment's files. Any Worker-held copy of the shell points at asset URLs that 404 the moment Pages redeploys — a blank page at a real URL for every visitor.
*Cost if wrong:* one extra same-datacentre subrequest per post request, and no edge caching of the post HTML. At this site's traffic that is not a constraint; correctness is bought with latency that nobody can measure.

**D3 — The route pattern is `/blog/*`, not `/blog*` and not `/*`.**
Cloudflare route matching means `/blog/*` matches `/blog/anything` and does not match bare `/blog`. The index page therefore stays entirely on Pages and is not touched by this phase. This is the smallest widening that satisfies the spec sentence, which is about posts.
*Cost if wrong:* `/blog` keeps the client-side metadata it has today, which is no regression — it is exactly the current state.

**D4 — When D1 is unreachable, a crawler gets the compiled-in snapshot. Never a 500, never a manufactured 404.**
Ground truth: `worker/snapshot.ts` today has entries for `awards.json` and `story.json` only — **not** `posts.json`. So `snapshotFor('posts.json')` returns `null` right now, and `GET /api/published?path=posts.json` answers **404** during a D1 outage. Task 2 closes that. A 500 or a 404 on a post URL is a de-indexing event; a slightly stale title is not.
*Cost if wrong:* during an outage a post published since the last `node scripts/build-snapshot.mjs` run has no snapshot entry, so the shell passes through unmodified and that post's raw HTML carries the site-wide metadata — the same thing it carries today. Degraded, never broken.

**D5 — An unresolvable slug returns the Pages shell unmodified, with its status untouched (200).**
Today `/blog/does-not-exist` is a 200 shell with client-side `NotFound`. Turning that into a real 404 is scope the spec does not imply, and it would be a behaviour change on a path this phase is otherwise only adding to.
*Cost if wrong:* soft-404s for nonexistent post URLs continue, exactly as today, and exactly as `/catering-typo` does. If Search Console starts reporting them, that is its own change.

**D6 — `site.json`'s `seo.url` does NOT move in this phase, and the Worker reads canonical/`og:url` from that same field rather than from the request's origin.**
Two separate points. First, moving `seo.url` is a five-artefact change — every client canonical (`useCanonical`), `robots.txt`'s `Sitemap:` line, every `<loc>` `plugins/sitemap.ts` emits, `index.html`'s `og:url`/`og:image`, and `src/test/hosting.test.ts:135`, which derives the expected Worker route host *from* `seo.url`. Doing it in the same phase that widens the Worker's route list means two variables moving at once on the highest-risk change in the plan, and the domain is due to move again anyway (`viabiancadelhi.com` is owned and not yet cut over). Second, the Worker must not derive the canonical from the request origin even though `siteOriginOf` and `publicCacheKey` take that posture for their own purposes: a canonical exists precisely to name one winner across the two hosts the site answers on, which is the reasoning `src/components/useCanonical.ts` already records at length.
*Cost if wrong:* every post served on `viabiancarestaurant.com` declares a canonical on `vb.aionxxxi.uk`, which consolidates ranking on the test host. That is already true of every other route on the site, so this phase is consistent with it rather than introducing a second convention — and the day `seo.url` moves, the Worker, the sitemap, `robots.txt` and every client canonical all follow the same one edit, which is only true because this phase reads that field.

**D7 — `/edit` needs no explicit exclusion, because the route pattern structurally cannot reach it.**
Why `SeoHead.tsx` suppresses its own output on `/edit`, verified in its source: logged out, an empty `site.seo.url` resolves an empty `href` to `/edit` itself — a self-canonical for a route `robots.txt` disallows — alongside a `Restaurant` block naming a blank restaurant. Neither condition can arise here: the Worker never sees an `/edit` request (`/blog/*` does not match `/edit`), and it reads `site.seo.url` from the committed JSON compiled into its own bundle, never from a live-edited draft. Task 4 pins this with a test rather than leaving it as a claim.
*Cost if wrong:* if a future route pattern widened to `/*`, `/edit` would start receiving Worker-authored canonicals. The Task 4 test is what makes that a red build instead of a discovery.

**D8 — The per-post Open Graph image is always `${seo.url}${post.image}`. There is no "post with no photo" branch.**
`src/content/guards.ts:785` requires `image` to be a non-blank string and `:801` requires `isSiteRelativePath(image)`. A post whose body passed `assertPosts` cannot have a missing or off-site card image. The Worker runs that same guard on the D1 body (Task 2), so the invariant holds at the Worker's boundary too, not just at build time. The site-wide `/og-image.jpg` remains the image for the case where no post resolved at all — and in that case the shell passes through unmodified, so `index.html`'s own `og:image` already is exactly that.
*Cost if wrong:* if a body ever reached the Worker without the guard, `og:image` would be a bare origin URL. Running `assertPosts` is what prevents it, and it is the same guard the build already trusts for this same document.

**D9 — The head is rewritten with anchored string replacement, not `HTMLRewriter`.**
`HTMLRewriter` has no runtime shape under Vitest's jsdom environment (`vitest.config.ts` documents this class of gap explicitly), so a rewriter built on it could only be tested by deploying it. A pure `string -> string | null` function is testable in the existing suite, and it can express a fail-safe that `HTMLRewriter` cannot: if any expected anchor is missing from the shell, it refuses and returns the shell unmodified rather than emitting a half-rewritten head. The brittleness of matching HTML with regexes is answered by pinning each anchor against the real committed `index.html` **and** against the real built `dist/index.html`, in `src/test/crawlers.test.ts`, which already runs post-build under `VB_REQUIRE_DIST=1`.
*Cost if wrong:* an `index.html` edit that changes a tag's shape silently stops the injection for that tag. The two anchor tests are what turn that into a red build. If they are ever weakened, this decision is no longer safe.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `worker/post-seo.ts` | Pure. A `Post` in, the four metadata strings plus the Article JSON-LD out. Escaping lives here. No fetch, no D1, no I/O. |
| `worker/post-lookup.ts` | Pure-ish. Slug in, `Post` out, over D1 with the snapshot as fallback. Owns decision D4. |
| `worker/post-shell.ts` | Pure. The shell HTML string and a `PostMetadata` in, the rewritten HTML string (or `null`) out. Owns decision D9. |
| `worker/post-page.ts` | The handler. Fetches the shell, wires the three modules above together. The only file here that does I/O. |
| `worker/__tests__/post-seo.test.ts` | Unit tests for `post-seo.ts` and `post-shell.ts`, asserting on raw strings. |
| `worker/__tests__/post-page.test.ts` | Handler tests with a fake `fetch` and `FakeD1`, asserting on `await response.text()`. |
| `scripts/post-seo-check.mjs` | Pure, dependency-free. Raw HTML string in, list of problems out. Imported by `verify-deploy.mjs`. |
| `scripts/__tests__/post-seo-check.test.mjs` | Unit tests for the above, no network. |

**Modified**

| File | Change |
|---|---|
| `tsconfig.worker.json` | Add `"resolveJsonModule": true` so the Worker can import `src/content/site.json`. |
| `worker/snapshot.ts` | Regenerated by `node scripts/build-snapshot.mjs` so it carries `posts.json`. Never hand-edited. |
| `worker/index.ts` | Route `/blog/*` to `handlePostPage`; exempt site-HTML responses from `withSecurityHeaders`' API-shaped header set. |
| `wrangler.toml` | Two new routes, `/blog/*` on each of the two served hostnames. |
| `src/test/hosting.test.ts` | Require a `/blog/*` route per served hostname; assert no route pattern can match `/edit`. |
| `src/test/crawlers.test.ts` | Pin every rewrite anchor against the committed and the built `index.html`. |
| `scripts/verify-deploy.mjs` | A raw-`fetch` post-SEO check, with JS never executing. |
| `docs/cloudflare-cutover.md` | The Worker deploy and rollback runbook for this route change. |

---

## Task 1: The metadata builder

Pure functions only. Nothing here is reachable from a request yet, so **a visitor sees no change whatsoever if this task is wrong** — no route, no handler, no deploy.

**Files:**
- Create: `worker/post-seo.ts`
- Create: `worker/post-shell.ts`
- Create: `worker/__tests__/post-seo.test.ts`
- Modify: `tsconfig.worker.json`

**Interfaces:**
- Consumes: `Post` from `src/content/types.ts` (`{ id, slug, type, title, date, excerpt, image, blocks }`); `site.seo.url`, `site.name`, `site.tagline` from `src/content/site.json`.
- Produces:
  - `SITE_URL: string`
  - `interface PostMetadata { title: string; description: string; canonical: string; imageUrl: string; jsonLdScript: string }`
  - `postMetadata(post: Post, siteUrl?: string): PostMetadata`
  - `articleJsonLd(post: Post, siteUrl?: string): Record<string, unknown>`
  - `escapeHtmlAttribute(value: string): string`
  - `SHELL_ANCHORS: readonly { readonly name: string; readonly pattern: RegExp }[]` (from `post-shell.ts`)
  - `rewriteShellHead(shell: string, meta: PostMetadata): string | null` (from `post-shell.ts`)

- [ ] **Step 1: Let the Worker project import JSON**

`tsconfig.worker.json` has no `resolveJsonModule`, so `import site from '../src/content/site.json'` is a `tsc -b` error today. Add the one line, keeping the existing keys untouched:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "resolveJsonModule": true,
    "strict": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true
  },
  "include": ["worker"]
}
```

- [ ] **Step 2: Write the failing tests for the metadata builder**

Create `worker/__tests__/post-seo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SITE_URL,
  articleJsonLd,
  escapeHtmlAttribute,
  postMetadata,
} from '../post-seo';
import type { Post } from '../../src/content/types';

// A post whose title and excerpt both carry characters that are dangerous in
// an attribute, in a text node, and inside a <script> block -- one fixture
// exercising all three escaping contexts, rather than three clean fixtures
// that would all pass with no escaping at all.
const POST: Post = {
  id: 'post-1',
  slug: 'assassina',
  type: 'recipe',
  title: 'Spaghetti all\'Assassina & "burnt" pasta',
  date: '2026-08-10',
  excerpt: 'A Puglian classic <cooked> in tomato water, not water.',
  image: '/press/hotelier.webp',
  blocks: [],
};

describe('post metadata', () => {
  it('reads the canonical host from site.json rather than a second literal', () => {
    expect(SITE_URL).toBe('https://vb.aionxxxi.uk');
  });

  it('titles the page with the post title alone, appending nothing', () => {
    expect(postMetadata(POST).title).toBe(POST.title);
  });

  it('describes the page with the post excerpt', () => {
    expect(postMetadata(POST).description).toBe(POST.excerpt);
  });

  it('builds the canonical from site.seo.url and the slug, not from any request', () => {
    expect(postMetadata(POST).canonical).toBe('https://vb.aionxxxi.uk/blog/assassina');
  });

  it('makes the open graph image absolute against the same host', () => {
    expect(postMetadata(POST).imageUrl).toBe('https://vb.aionxxxi.uk/press/hotelier.webp');
  });

  it('escapes quotes and angle brackets for an attribute value', () => {
    expect(escapeHtmlAttribute('a "b" <c> & \'d\'')).toBe('a &quot;b&quot; &lt;c&gt; &amp; &#39;d&#39;');
  });

  it('emits Article structured data with the four fields a rich result reads', () => {
    const json = articleJsonLd(POST);
    expect(json['@type']).toBe('Article');
    expect(json.headline).toBe(POST.title);
    expect(json.description).toBe(POST.excerpt);
    expect(json.datePublished).toBe('2026-08-10');
    expect(json.image).toBe('https://vb.aionxxxi.uk/press/hotelier.webp');
    expect(json.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://vb.aionxxxi.uk/blog/assassina',
    });
  });

  // The one escaping rule that is specific to JSON-LD: a `<` inside a
  // <script> block can close it early ("</script>" inside a string value),
  // which turns structured data into injected markup. JSON.stringify does
  // not escape it; this does.
  it('never lets a raw < reach the script block', () => {
    const script = postMetadata(POST).jsonLdScript;
    expect(script).not.toContain('<');
    expect(script).toContain('\\u003c');
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run worker/__tests__/post-seo.test.ts`
Expected: FAIL — `Failed to resolve import "../post-seo"`.

- [ ] **Step 4: Write `worker/post-seo.ts`**

```ts
// Phase 5C. The four things the spec names -- title, description, Open Graph
// image, Article structured data -- as pure strings, with no request, no
// database and no I/O anywhere in this file. Everything that can go wrong
// here is decidable by reading one function.
//
// The canonical host comes from src/content/site.json's own `seo.url`, NOT
// from the request's origin, and that is the opposite of the posture
// siteOriginOf and publicCacheKey take in this Worker. Deliberate: those two
// answer "who is asking", which genuinely varies per host. A canonical
// answers "which of the hosts this site answers on should win", and there
// is exactly one right answer to that at a time. src/components/useCanonical.ts
// already records the reasoning at length; this is the same one field, read
// from the same one file, so the day the domain moves it is still one edit.
import site from '../src/content/site.json';
import type { Post } from '../src/content/types';

export const SITE_URL: string = site.seo.url;

// The author name the homepage's own Restaurant block already hardcodes
// (src/components/SeoHead.tsx). Not read from content because no content
// field holds it -- inventing one for this would be scope this phase's own
// spec sentence does not imply.
const AUTHOR_NAME = 'Kamalika Anand';

export interface PostMetadata {
  title: string;
  description: string;
  canonical: string;
  imageUrl: string;
  // Already escaped for a <script> block. Insert verbatim; do not escape again.
  jsonLdScript: string;
}

// Attribute-context escaping. Both quote characters are escaped, not just
// the double quote, so this stays correct if a value ever lands in a
// single-quoted attribute.
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function canonicalForSlug(slug: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}/blog/${slug}`;
}

// `post.image` is guaranteed non-blank and site-relative by
// src/content/guards.ts (a non-blank string check, then isSiteRelativePath),
// and worker/post-lookup.ts runs that same guard on the D1 body -- so this
// concatenation cannot produce a bare origin or an off-site URL. There is
// deliberately no "post with no photo" branch: the content model does not
// permit one, and a runtime fallback here would be dead code pretending to
// be a safety net.
export function absoluteImageUrl(image: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}${image}`;
}

export function articleJsonLd(post: Post, siteUrl: string = SITE_URL): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    // The authored calendar date, passed through unchanged. schema.org's
    // datePublished accepts a bare ISO date, and src/content/article-date.ts
    // records at length why turning this string into a Date and back is how
    // this site once showed every visitor west of UTC the wrong day.
    datePublished: post.date,
    image: absoluteImageUrl(post.image, siteUrl),
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalForSlug(post.slug, siteUrl) },
    author: { '@type': 'Person', name: AUTHOR_NAME },
    publisher: { '@type': 'Organization', name: `${site.name} ${site.tagline}` },
  };
}

// JSON inside a <script> block, not JSON in a body. `JSON.stringify` leaves
// `<` alone, so a value containing the literal characters that close a script
// element would end the block early and everything after it would be parsed
// as markup. Escaping every `<` as its JSON unicode escape is lossless -- a
// JSON parser reads `<` and `<` identically -- and there is then no
// character sequence in the output that an HTML parser can act on.
export function jsonLdScriptBody(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function postMetadata(post: Post, siteUrl: string = SITE_URL): PostMetadata {
  return {
    title: post.title,
    description: post.excerpt,
    canonical: canonicalForSlug(post.slug, siteUrl),
    imageUrl: absoluteImageUrl(post.image, siteUrl),
    jsonLdScript: jsonLdScriptBody(articleJsonLd(post, siteUrl)),
  };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run worker/__tests__/post-seo.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Prove each test can fail**

Run each mutation, confirm the named test goes red, then revert it before the next one.

| Mutation in `worker/post-seo.ts` | Test that must go red |
|---|---|
| `title: post.title` → `title: `${post.title} \| Via Bianca`` | "titles the page with the post title alone" |
| `canonicalForSlug` → `` `${siteUrl}/blog` `` | "builds the canonical from site.seo.url and the slug" |
| `absoluteImageUrl` → `return image;` | "makes the open graph image absolute" and "emits Article structured data" |
| `'@type': 'Article'` → `'@type': 'BlogPosting'` | "emits Article structured data" |
| `escapeHtmlAttribute`: drop the `"` replacement | "escapes quotes and angle brackets" |
| `jsonLdScriptBody`: drop `.replace(/</g, '\\u003c')` | "never lets a raw < reach the script block" |

- [ ] **Step 7: Write the failing tests for the shell rewriter**

Append to `worker/__tests__/post-seo.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { SHELL_ANCHORS, rewriteShellHead } from '../post-shell';

const SHELL = readFileSync('index.html', 'utf8');

describe('rewriting the shell head', () => {
  const meta = postMetadata(POST);
  const out = rewriteShellHead(SHELL, meta)!;

  it('rewrites rather than refuses, against the real committed shell', () => {
    expect(out).not.toBeNull();
  });

  it('replaces the static title with the post title, leaving exactly one', () => {
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain(`<title>Spaghetti all&#39;Assassina &amp; &quot;burnt&quot; pasta</title>`);
    expect(out).not.toContain('Authentic Italian Dining in Delhi</title>');
  });

  it('rewrites the one description meta in place rather than appending a second', () => {
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain('A Puglian classic &lt;cooked&gt; in tomato water, not water.');
  });

  it('turns og:type from website into article', () => {
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).not.toContain('content="website"');
  });

  it('points og:image and twitter:image at the post image, absolutely', () => {
    const matches = out.match(/content="https:\/\/vb\.aionxxxi\.uk\/press\/hotelier\.webp"/g);
    expect(matches).toHaveLength(2);
    expect(out).not.toContain('/og-image.jpg');
  });

  it('points og:url at the post canonical', () => {
    expect(out).toContain('<meta property="og:url" content="https://vb.aionxxxi.uk/blog/assassina" />');
  });

  it('adds the canonical link the shell deliberately ships without', () => {
    expect(SHELL).not.toContain('rel="canonical"');
    expect(out).toContain('<link rel="canonical" href="https://vb.aionxxxi.uk/blog/assassina">');
  });

  it('adds exactly one Article structured-data block', () => {
    expect(out.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(out).toContain('"@type":"Article"');
  });

  // The fail-safe. A shell this function does not recognise must come back
  // untouched, not half-rewritten: a page with the post's title and the
  // site's own og:image is worse than a page with neither, because the two
  // disagree and nothing downstream can tell.
  it('refuses outright when an anchor is missing', () => {
    const broken = SHELL.replace(/<meta property="og:url"[^>]*>/, '');
    expect(rewriteShellHead(broken, meta)).toBeNull();
  });

  it('names every anchor it depends on, each matching the real shell once', () => {
    expect(SHELL_ANCHORS.length).toBeGreaterThan(0);
    for (const { name, pattern } of SHELL_ANCHORS) {
      const found = SHELL.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
      expect(found, `anchor "${name}" did not match the committed index.html exactly once`).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 8: Run them and watch them fail**

Run: `npx vitest run worker/__tests__/post-seo.test.ts`
Expected: FAIL — `Failed to resolve import "../post-shell"`.

- [ ] **Step 9: Write `worker/post-shell.ts`**

```ts
// Phase 5C. The shell's <head>, rewritten as a string.
//
// STRING REPLACEMENT, NOT HTMLRewriter, and the reason is testability rather
// than preference. HTMLRewriter has no runtime shape under this repo's Vitest
// environment (vitest.config.ts's own header lists the workerd globals that
// are and are not real there), so a rewriter built on it could only ever be
// checked by deploying it -- which is exactly the thing this phase must not
// do, since a mistake here is a wrong <head> on a real post URL.
//
// The brittleness that normally makes this a bad idea is answered two ways.
// First, every pattern below is exported and pinned against the REAL
// committed index.html by this module's own test, and against the REAL BUILT
// dist/index.html by src/test/crawlers.test.ts -- so an index.html edit that
// changes a tag's shape is a red build, not a silent stop. Second, this
// function REFUSES: if any anchor is missing it returns null and the caller
// serves the shell untouched. A half-rewritten head -- the post's title
// beside the site's own og:image -- is worse than no rewrite at all, because
// the two disagree and nothing downstream can tell which is meant.
import { escapeHtmlAttribute, type PostMetadata } from './post-seo';

// Every tag this module replaces. `name` is what a failure message says;
// `pattern` must match the shell exactly once. Non-global on purpose --
// String.replace with a non-global regex replaces the first match, and
// "exactly once" is asserted separately rather than assumed here.
export const SHELL_ANCHORS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'title', pattern: /<title>[\s\S]*?<\/title>/ },
  { name: 'description', pattern: /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:type', pattern: /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:title', pattern: /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:description', pattern: /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:url', pattern: /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:image', pattern: /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:title', pattern: /<meta\s+property="twitter:title"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:description', pattern: /<meta\s+property="twitter:description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:image', pattern: /<meta\s+property="twitter:image"\s+content="[^"]*"\s*\/?>/ },
  { name: 'head-close', pattern: /<\/head>/ },
];

function metaTag(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtmlAttribute(content)}" />`;
}

export function rewriteShellHead(shell: string, meta: PostMetadata): string | null {
  for (const { pattern } of SHELL_ANCHORS) {
    if (!pattern.test(shell)) return null;
  }

  // The title is a TEXT node, and the description is an ATTRIBUTE, but both
  // go through the same attribute-grade escape. Over-escaping a text node is
  // lossless for the characters involved here (a browser renders `&amp;` as
  // `&`); under-escaping either is an injection. One function, no per-context
  // branch to get backwards.
  const title = escapeHtmlAttribute(meta.title);
  const description = escapeHtmlAttribute(meta.description);

  // Built as a list of [anchor, replacement] pairs applied in order, rather
  // than a chain of .replace calls, so a new tag is one line and cannot
  // accidentally be applied to an already-rewritten string.
  const replacements: readonly (readonly [RegExp, string])[] = [
    [SHELL_ANCHORS[0].pattern, `<title>${title}</title>`],
    [SHELL_ANCHORS[1].pattern, `<meta name="description" content="${description}" />`],
    [SHELL_ANCHORS[2].pattern, metaTag('og:type', 'article')],
    [SHELL_ANCHORS[3].pattern, metaTag('og:title', meta.title)],
    [SHELL_ANCHORS[4].pattern, metaTag('og:description', meta.description)],
    [SHELL_ANCHORS[5].pattern, metaTag('og:url', meta.canonical)],
    [SHELL_ANCHORS[6].pattern, metaTag('og:image', meta.imageUrl)],
    [SHELL_ANCHORS[7].pattern, metaTag('twitter:title', meta.title)],
    [SHELL_ANCHORS[8].pattern, metaTag('twitter:description', meta.description)],
    [SHELL_ANCHORS[9].pattern, metaTag('twitter:image', meta.imageUrl)],
  ];

  let out = shell;
  for (const [pattern, replacement] of replacements) {
    // The replacement string is passed through a function so a `$&` or `$1`
    // sequence inside a post title is inserted literally rather than being
    // read by String.replace as a capture reference.
    out = out.replace(pattern, () => replacement);
  }

  // Appended immediately before </head>, not after some other tag: both of
  // these are only honoured inside <head>, and this is the one position that
  // is correct regardless of what else the shell grows later.
  const injected =
    `<link rel="canonical" href="${escapeHtmlAttribute(meta.canonical)}">` +
    `<script type="application/ld+json">${meta.jsonLdScript}</script>` +
    `</head>`;
  return out.replace(SHELL_ANCHORS[10].pattern, () => injected);
}
```

- [ ] **Step 10: Run the tests and watch them pass**

Run: `npx vitest run worker/__tests__/post-seo.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 11: Prove each shell test can fail**

| Mutation in `worker/post-shell.ts` | Test that must go red |
|---|---|
| Delete the `og:image` pair from `replacements` | "points og:image and twitter:image at the post image" |
| Delete the `og:type` pair | "turns og:type from website into article" |
| Change the injected `<link rel="canonical" ...>` to `<link rel="alternate" ...>` | "adds the canonical link the shell deliberately ships without" |
| Delete the `<script type="application/ld+json">` half of `injected` | "adds exactly one Article structured-data block" |
| Replace the anchor loop's `return null` with `continue` | "refuses outright when an anchor is missing" |
| Drop `escapeHtmlAttribute` from `title` | "replaces the static title with the post title" |
| Change the `description` anchor to `/<meta name="keywords"[^>]*>/` | "names every anchor it depends on" (two matches) and "rewrites the one description meta in place" |

- [ ] **Step 12: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint .`
Expected: both clean. If `tsc` complains that `site.json` has no default export, Step 1 was not applied.

- [ ] **Step 13: Confirm React still never reaches the Worker bundle**

`post-seo.ts` is the first file under `worker/` to import a `src/content/` **value** (the JSON). `worker/__tests__/bundle.test.ts` is the check that this did not drag React in behind it.

Run: `npx vitest run worker/__tests__/bundle.test.ts`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add tsconfig.worker.json worker/post-seo.ts worker/post-shell.ts worker/__tests__/post-seo.test.ts
git commit -m "feat(seo): build per-post head metadata and rewrite the shell head"
```

---

## Task 2: Finding the post, and what happens when D1 is down

Still no route and still no handler, so **a visitor sees no change if this task is wrong** — with one exception in the other direction: regenerating the snapshot makes `GET /api/published?path=posts.json` answer with content instead of 404 during a D1 outage, which is strictly better than today for the existing blog surfaces too.

**Files:**
- Create: `worker/post-lookup.ts`
- Create: `worker/__tests__/post-page.test.ts` (the lookup half; the handler half lands in Task 3)
- Modify: `worker/snapshot.ts` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: `D1Store` from `worker/d1.ts` (`read(path): Promise<{ content: string; sha: string } | null>`); `snapshotFor(file): string | null` from `worker/snapshot.ts`; `assertPosts(raw: unknown): Post[]` from `src/content/guards.ts`.
- Produces:
  - `POSTS_FILE = 'posts.json'`, `POSTS_PATH = 'src/content/posts.json'`
  - `type PostSource = 'd1' | 'snapshot'`
  - `interface PostLookup { post: Post; source: PostSource }`
  - `lookupPost(db: D1Database, slug: string): Promise<PostLookup | null>`

- [ ] **Step 1: Confirm the gap this task closes actually exists**

Run: `node -e "const s=require('fs').readFileSync('worker/snapshot.ts','utf8'); console.log(s.includes('posts.json') ? 'PRESENT' : 'ABSENT')"`
Expected: `ABSENT`. That is the current, verified state: `snapshotFor('posts.json')` returns `null`, so `worker/published.ts`'s D1-failure branch answers a **404** for the blog today. If this prints `PRESENT`, someone has already regenerated the snapshot and Step 2 is a no-op — check `SNAPSHOT_BUILT_AT` before continuing.

- [ ] **Step 2: Regenerate the snapshot from the live database**

This is an authenticated network call and it is deliberately not a build step (see `scripts/build-snapshot.mjs`'s own header). Run it by hand:

```bash
node scripts/build-snapshot.mjs
```

Expected output: `snapshot: 3 document(s), built <timestamp>` — three, not two. If it prints two, `posts.json` is not seeded in D1 and `node scripts/seed-posts-d1.mjs` has not been run against the live database; stop and resolve that before continuing, because every fallback in this task rests on that row.

Do not edit `worker/snapshot.ts` by hand. If the command cannot reach Cloudflare, stop — a hand-written snapshot is a fallback nobody can trust.

- [ ] **Step 3: Write the failing tests for the lookup**

Create `worker/__tests__/post-page.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { POSTS_PATH, lookupPost } from '../post-lookup';
import { snapshotFor } from '../snapshot';
import { asD1, FakeD1 } from './fakeD1';

// The snapshot's own posts, read from the compiled module rather than
// hardcoded here -- the same posture worker/__tests__/published.test.ts takes
// for awards.json and story.json, and for the same reason: a hardcoded copy
// pins content that has already moved.
const SNAPSHOT_POSTS = JSON.parse(snapshotFor('posts.json')!) as { slug: string; title: string }[];
const SNAPSHOT_SLUG = SNAPSHOT_POSTS[0].slug;

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

function dbWith(body: string): D1Database {
  const fake = new FakeD1();
  fake.seed(POSTS_PATH, body);
  return asD1(fake);
}

describe('looking a post up', () => {
  it('finds a post that exists only in D1, and says where it came from', async () => {
    const found = await lookupPost(dbWith(D1_POSTS), 'live-only');
    expect(found?.post.title).toBe('A post that exists only in the database');
    expect(found?.source).toBe('d1');
  });

  it('returns null for a slug in neither store', async () => {
    expect(await lookupPost(dbWith(D1_POSTS), 'no-such-post')).toBeNull();
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

  it('falls back to the snapshot when the row is missing entirely', async () => {
    const found = await lookupPost(asD1(new FakeD1()), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // The guard is the boundary. A D1 body that assertPosts refuses is BAD
  // DATA arriving healthy, not an outage -- so it is treated exactly like a
  // failed read, and the snapshot answers.
  it('refuses a malformed D1 body and uses the snapshot instead', async () => {
    const found = await lookupPost(dbWith('[{"slug":"live-only"}]'), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  it('never returns a post whose image is blank, because the guard refuses it', async () => {
    const blank = JSON.stringify([{ ...JSON.parse(D1_POSTS)[0], image: '' }]);
    const found = await lookupPost(dbWith(blank), 'live-only');
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run worker/__tests__/post-page.test.ts`
Expected: FAIL — `Failed to resolve import "../post-lookup"`.

If instead it fails at `snapshotFor('posts.json')!` being null, Step 2 did not run.

- [ ] **Step 5: Write `worker/post-lookup.ts`**

```ts
// Phase 5C. Slug in, post out -- over D1, with the compiled-in snapshot as
// the fallback.
//
// DECISION D4, written down because the wrong answer here looks fine in
// every test that does not simulate an outage. When D1 is unreachable a
// crawler gets the SNAPSHOT, never a 500 and never a manufactured 404. A
// stale title costs one crawl's worth of freshness; a 5xx or a 404 on a post
// URL is a de-indexing event that takes weeks to undo. This is the same
// sentence worker/published.ts already lives by -- "a database problem must
// cost freshness, never availability" -- applied to the same document.
//
// The snapshot did not carry posts.json until this phase regenerated it
// (scripts/build-snapshot.mjs). Before that, snapshotFor('posts.json')
// returned null and the public read path answered 404 during an outage.
import { D1Store } from './d1';
import { snapshotFor } from './snapshot';
import { assertPosts } from '../src/content/guards';
import type { Post } from '../src/content/types';

// The PUBLIC filename (what snapshotFor is keyed on) and the repo-relative
// path (what the `content` table stores) -- the same two names
// worker/published.ts's PUBLIC_FILES maps between.
export const POSTS_FILE = 'posts.json';
export const POSTS_PATH = 'src/content/posts.json';

export type PostSource = 'd1' | 'snapshot';

export interface PostLookup {
  post: Post;
  source: PostSource;
}

// THE GUARD IS THE BOUNDARY, and it is the REAL one rather than a hand-rolled
// copy: assertPosts is exactly what src/content/index.ts applies to this same
// document at build time and what src/components/blog/posts-api.ts applies to
// the same D1 body in the browser. Three readers, one definition of "what is
// a valid post", so they cannot come to different conclusions -- and it is
// what makes worker/post-seo.ts's `${siteUrl}${post.image}` safe without a
// second check of its own (guards.ts requires a non-blank, site-relative
// image).
//
// A body it refuses is BAD DATA arriving with a healthy read, not an outage.
// Treated identically to a failed read here, because the caller's only
// sensible move is the same either way.
function parsePosts(body: string): Post[] | null {
  try {
    return assertPosts(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

export async function lookupPost(db: D1Database, slug: string): Promise<PostLookup | null> {
  let posts: Post[] | null = null;
  try {
    const stored = await new D1Store(db).read(POSTS_PATH);
    posts = stored ? parsePosts(stored.content) : null;
  } catch {
    posts = null;
  }

  const source: PostSource = posts === null ? 'snapshot' : 'd1';
  if (posts === null) {
    const fallback = snapshotFor(POSTS_FILE);
    posts = fallback === null ? null : parsePosts(fallback);
  }
  if (posts === null) return null;

  const post = posts.find((candidate) => candidate.slug === slug);
  return post ? { post, source } : null;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run worker/__tests__/post-page.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Prove each test can fail**

| Mutation | Test that must go red |
|---|---|
| In `lookupPost`, replace the `catch { posts = null }` body with `throw` | "falls back to the compiled-in snapshot when the read throws" |
| Delete the whole `if (posts === null)` snapshot block | both snapshot tests, and "refuses a malformed D1 body" |
| In `parsePosts`, `return JSON.parse(body) as Post[]` (skip `assertPosts`) | "refuses a malformed D1 body" and "never returns a post whose image is blank" |
| `posts.find(c => c.slug === slug)` → `posts[0]` | "returns null for a slug in neither store" |
| In `scripts/build-snapshot.mjs` output, delete the `posts.json` entry from `worker/snapshot.ts` | every test that reads `snapshotFor('posts.json')!` fails at the fixture — which is the point: this suite cannot pass without the snapshot Step 2 wrote |

- [ ] **Step 8: Confirm the public read path improved too**

The snapshot regeneration also changes `GET /api/published?path=posts.json` during an outage from 404 to the snapshot body. `worker/__tests__/published.test.ts` already exercises the outage branch for the other two documents.

Run: `npx vitest run worker/__tests__/published.test.ts worker/__tests__/snapshot.test.ts`
Expected: PASS. If `snapshot.test.ts` pins a document count, update it to three with a comment naming this phase.

- [ ] **Step 9: Full suite, typecheck, lint**

Run: `npx tsc -b --noEmit && npx eslint . && npm test -- --run`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add worker/post-lookup.ts worker/snapshot.ts worker/__tests__/post-page.test.ts worker/__tests__/snapshot.test.ts
git commit -m "feat(seo): look posts up in D1 with the compiled snapshot as the outage fallback"
```

---

## Task 3: The handler, wired into the router but not yet routed at the edge

The handler becomes reachable from `route()` — but `wrangler.toml` is untouched, so Cloudflare still sends no `/blog/*` request to this Worker. **A visitor sees no change if this task is wrong**, because nothing has told the edge to ask.

This task also fixes the trap that makes serving HTML from this Worker dangerous, and it is worth naming before the code: `withSecurityHeaders` sets `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on **every** response this Worker returns (`worker/index.ts:366-372`). That policy is right for a JSON API and fatal for HTML — it forbids scripts, styles, fonts and images, so the SPA shell would render as a completely blank white document. Deploying the route without this fix is the blank-page failure the sequencing of this plan exists to prevent.

**Files:**
- Create: `worker/post-page.ts`
- Modify: `worker/index.ts:366-438` (the `withSecurityHeaders` region) and `worker/index.ts:1286-1400` (the `route` function)
- Modify: `worker/__tests__/post-page.test.ts` (add the handler tests)
- Modify: `src/test/crawlers.test.ts` (pin the anchors against the built shell)

**Interfaces:**
- Consumes: `lookupPost`, `PostLookup` from `worker/post-lookup.ts`; `postMetadata` from `worker/post-seo.ts`; `rewriteShellHead` from `worker/post-shell.ts`; `SHELL_ANCHORS` from `worker/post-shell.ts` (in `crawlers.test.ts`).
- Produces:
  - `BLOG_POST_PREFIX = '/blog/'`
  - `SHELL_PATH = '/index.html'`
  - `slugFromPath(pathname: string): string | null`
  - `interface PostPageEnv { DB: D1Database }`
  - `handlePostPage(request: Request, env: PostPageEnv, fetchImpl?: typeof fetch): Promise<Response>`
  - `HTML_PATH_PREFIXES: readonly string[]` and `servesSiteHtml(pathname: string): boolean` (both from `worker/index.ts`)

- [ ] **Step 1: Write the failing handler tests**

Append to `worker/__tests__/post-page.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { BLOG_POST_PREFIX, SHELL_PATH, handlePostPage, slugFromPath } from '../post-page';

const SHELL = readFileSync('index.html', 'utf8');

// A stand-in for Pages. Records what was asked for, so the test can prove the
// Worker fetches a path its OWN route cannot match -- which is what keeps
// this from being an infinite loop.
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
    await handlePostPage(get(`${BLOG_POST_PREFIX}${SNAPSHOT_SLUG}`), { DB: dbWith(D1_POSTS) }, pages.impl);
    expect(pages.asked).toEqual([`https://vb.aionxxxi.uk${SHELL_PATH}`]);
    expect(SHELL_PATH.startsWith(BLOG_POST_PREFIX)).toBe(false);
  });

  // THE ASSERTION THAT MATTERS. The raw body of the HTTP response, with no
  // DOM, no jsdom, and no JavaScript executing. This is what a crawler gets.
  it('puts the post title and Article data in the raw response body', async () => {
    const response = await handlePostPage(get('/blog/live-only'), { DB: dbWith(D1_POSTS) }, fakePages().impl);
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
    const response = await handlePostPage(get('/blog/no-such-post'), { DB: dbWith(D1_POSTS) }, fakePages().impl);
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
    const html = await (await handlePostPage(get(`/blog/${SNAPSHOT_SLUG}`), { DB: throwing }, fakePages().impl)).text();
    expect(html).toContain(`<link rel="canonical" href="https://vb.aionxxxi.uk/blog/${SNAPSHOT_SLUG}">`);
    expect(html).toContain('"@type":"Article"');
  });

  it('hands a failed shell fetch straight back rather than inventing a 500', async () => {
    const response = await handlePostPage(get('/blog/live-only'), { DB: dbWith(D1_POSTS) }, fakePages('nope', 503).impl);
    expect(response.status).toBe(503);
  });

  it('serves the shell untouched when it no longer carries the anchors', async () => {
    const broken = SHELL.replace(/<meta property="og:url"[^>]*>/, '');
    const html = await (await handlePostPage(get('/blog/live-only'), { DB: dbWith(D1_POSTS) }, fakePages(broken).impl)).text();
    expect(html).toBe(broken);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run worker/__tests__/post-page.test.ts`
Expected: FAIL — `Failed to resolve import "../post-page"`.

- [ ] **Step 3: Write `worker/post-page.ts`**

```ts
// Phase 5C. GET /blog/<slug>, answered by this Worker instead of by Pages.
//
// WHAT THIS FILE DOES NOT DO, first, because it is the more important half.
// It does not render the post. worker/__tests__/bundle.test.ts fails the
// build if React reaches this Worker, so a server-rendered body would mean a
// SECOND implementation of the ten block renderers and the inline markdown
// renderer, with nothing anywhere comparing it to
// src/components/blog/blocks.tsx -- and it would be the first place in this
// codebase that turns author markdown into an HTML string. The spec sentence
// this phase implements enumerates four artefacts (title, description, Open
// Graph image, Article structured data) and all four live in <head>. So the
// head is authored here and the body is still the SPA's, hydrated exactly as
// it is today. The honest cost: a crawler that does not execute JavaScript
// gets correct metadata and no article prose.
//
// THE SHELL IS FETCHED LIVE, NEVER COMPILED IN. Asset filenames carry the
// commit sha (vite.config.ts) and Pages serves only the current deployment's
// files, so any copy of the shell held inside this Worker points at asset
// URLs that 404 the moment Pages redeploys -- a blank page at a real URL, for
// every visitor at once, with no signal that anything is wrong. Fetching
// /index.html on the request's own origin is what makes a Worker deploy and a
// Pages deploy independent of each other.
//
// AND IT CANNOT LOOP. wrangler.toml routes this Worker on `/api/*` and
// `/blog/*` only; `/index.html` matches neither, so the subrequest goes to
// Pages rather than back into this handler. slugFromPath deliberately agrees
// with the route pattern (it refuses bare `/blog` exactly as `/blog/*` does)
// so the two cannot drift into disagreeing about what this Worker owns.
import { lookupPost } from './post-lookup';
import { postMetadata } from './post-seo';
import { rewriteShellHead } from './post-shell';

export const BLOG_POST_PREFIX = '/blog/';
export const SHELL_PATH = '/index.html';

export interface PostPageEnv {
  DB: D1Database;
}

export function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(BLOG_POST_PREFIX)) return null;
  const slug = pathname.slice(BLOG_POST_PREFIX.length);
  // A bare `/blog/`, and anything with a further segment, belong to the SPA's
  // own router (which 404s them) -- not to this handler.
  if (slug.length === 0 || slug.includes('/')) return null;
  return slug;
}

// A rewritten Response, built from the shell's own status and headers so the
// Content-Type Pages set survives. The body is a string rather than a stream
// because it has already been read in full to rewrite it.
function withBody(shell: Response, html: string): Response {
  return new Response(html, {
    status: shell.status,
    statusText: shell.statusText,
    headers: shell.headers,
  });
}

export async function handlePostPage(
  request: Request,
  env: PostPageEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const shell = await fetchImpl(new URL(SHELL_PATH, url.origin).toString(), {
    headers: { Accept: 'text/html' },
  });

  // A Pages problem stays a Pages problem. Turning it into a 500 of this
  // Worker's own making would hide which half is broken at the exact moment
  // somebody needs to know.
  if (!shell.ok) return shell;

  const slug = slugFromPath(url.pathname);
  if (slug === null) return shell;

  const found = await lookupPost(env.DB, slug);
  // Decision D5: an unresolvable slug is the shell, unmodified, at its own
  // status. That is what /blog/<nonsense> already answers today, and turning
  // it into a real 404 is a behaviour change this phase's spec does not ask
  // for.
  if (found === null) return shell;

  const html = await shell.text();
  const rewritten = rewriteShellHead(html, postMetadata(found.post));
  // `null` means the shell no longer carries an anchor this rewriter depends
  // on. Serving it untouched is the fail-safe: a half-rewritten head -- the
  // post's title beside the site's own og:image -- is worse than no rewrite,
  // because the two disagree and nothing downstream can tell which is meant.
  // src/test/crawlers.test.ts is what makes that state a red build rather
  // than a silent degradation nobody notices for a month.
  return withBody(shell, rewritten ?? html);
}
```

- [ ] **Step 4: Run the handler tests and watch them pass**

Run: `npx vitest run worker/__tests__/post-page.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Write the failing test for the security-header trap**

Append to `worker/__tests__/post-page.test.ts`:

```ts
import { servesSiteHtml } from '../index';

// THE TRAP. worker/index.ts sets `Content-Security-Policy: default-src 'none'`
// on every response it returns -- correct for a JSON API, and fatal for HTML:
// it forbids script, style, font and image, so the SPA shell renders as a
// blank white page. public/_headers already carries the right policy for this
// site's HTML, and Pages puts it on the /index.html response this Worker
// fetched. The fix is to leave that response's headers alone rather than to
// write a second copy of the policy here that could drift from _headers.
describe('site HTML keeps the headers Pages gave it', () => {
  it('exempts the post path from this Worker\'s API-shaped header set', () => {
    expect(servesSiteHtml('/blog/assassina')).toBe(true);
  });

  it('does not exempt the API, which must keep them', () => {
    expect(servesSiteHtml('/api/published')).toBe(false);
    expect(servesSiteHtml('/api/publish')).toBe(false);
  });

  it('does not exempt the admin route', () => {
    expect(servesSiteHtml('/edit')).toBe(false);
    expect(servesSiteHtml('/edit/manage')).toBe(false);
  });
});
```

And, in the same file, an end-to-end assertion through the Worker's real entry point:

```ts
import worker from '../index';

it('leaves the CSP Pages set on the post page, rather than replacing it with default-src none', async () => {
  const pagesCsp = "default-src 'self'; script-src 'self' 'unsafe-eval'";
  const pages = (async () =>
    new Response(SHELL, {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': pagesCsp },
    })) as unknown as typeof fetch;
  const original = globalThis.fetch;
  globalThis.fetch = pages;
  try {
    const response = await worker.fetch(get('/blog/live-only'), {
      DB: dbWith(D1_POSTS),
    } as unknown as Parameters<typeof worker.fetch>[1]);
    expect(response.headers.get('Content-Security-Policy')).toBe(pagesCsp);
    expect(response.headers.get('Content-Security-Policy')).not.toContain("default-src 'none'");
    expect(await response.text()).toContain('<title>A post that exists only in the database</title>');
  } finally {
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 6: Run and watch it fail**

Run: `npx vitest run worker/__tests__/post-page.test.ts`
Expected: FAIL — `servesSiteHtml` is not exported from `../index`, and the end-to-end case reports `default-src 'none'`.

- [ ] **Step 7: Exempt site HTML in `worker/index.ts`**

Immediately below the existing `CACHEABLE_PATHS` declaration (`worker/index.ts:425`), add:

```ts
// Paths whose response body is the SITE's own HTML, fetched from Pages, not
// this Worker's JSON. Named as a list somebody has to edit, the same posture
// CACHEABLE_PATHS above takes, so a second HTML route added later is a
// visible decision rather than a condition that quietly grew an `||`.
//
// WHAT THIS PREVENTS, exactly, because the failure is total and silent:
// SECURITY_HEADERS sets `Content-Security-Policy: default-src 'none'` on
// every response this Worker returns. That is the right policy for a JSON
// API and it forbids script, style, font and image -- so the SPA shell
// served under it renders as a completely blank white page for every
// visitor, with a 200 and no error anywhere. public/_headers already carries
// the policy this site's HTML needs, and Pages applies it to the
// /index.html response worker/post-page.ts fetches. Handing that response
// back with its own headers intact is therefore both the correct answer and
// the one that cannot drift: there is no second copy of the policy here to
// fall out of step with public/_headers.
//
// A prefix rather than an exact path, unlike CACHEABLE_PATHS, because the
// slug is part of the path. It is matched with startsWith, so it can never
// widen to `/` by accident -- and src/test/hosting.test.ts pins that no entry
// here can match /edit.
export const HTML_PATH_PREFIXES: readonly string[] = ['/blog/'];

export function servesSiteHtml(pathname: string): boolean {
  return HTML_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
```

Then change `withSecurityHeaders` to return early:

```ts
function withSecurityHeaders(response: Response, pathname: string): Response {
  // See HTML_PATH_PREFIXES above: this Worker's header set is API-shaped and
  // would blank the page.
  if (servesSiteHtml(pathname)) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === 'Cache-Control' && CACHEABLE_PATHS.has(pathname)) continue;
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

- [ ] **Step 8: Wire the route into `route()`**

Add the import at the top of `worker/index.ts`, beside the existing `handlePublished` import:

```ts
import { handlePostPage, slugFromPath } from './post-page';
```

And add the branch immediately before the final `return new Response('Not found', { status: 404 });` in `route`:

```ts
  // Phase 5C. The one route in this Worker whose response is HTML rather than
  // JSON. Placed last, after every /api/* branch, so it can never shadow one
  // -- and gated on GET, so the cross-origin POST check above is unaffected.
  //
  // Unauthenticated by design and deliberately not rate-limited, for the same
  // reasons GET /api/published is neither: it makes one D1 row read, spends no
  // KV write, and the limiter's own bookkeeping IS a KV write against a
  // 1,000/day namespace-wide cap. The volumetric backstop is the same WAF rule
  // in docs/cloudflare-cutover.md.
  if (request.method === 'GET' && slugFromPath(url.pathname) !== null) {
    return handlePostPage(request, env);
  }
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `npx vitest run worker/__tests__/post-page.test.ts worker/__tests__/index.test.ts worker/__tests__/hardening.test.ts`
Expected: PASS. `index.test.ts` asserts `AUTHENTICATED_PATHS` against the router's own list — this route is deliberately unauthenticated, so if that test reds, add `/blog/` to whatever list it keeps of routes that are known-unauthenticated, with a comment naming this phase.

- [ ] **Step 10: Prove each new test can fail**

| Mutation | Test that must go red |
|---|---|
| Delete the `if (servesSiteHtml(pathname)) return response;` line | "leaves the CSP Pages set on the post page" — and this is the blank-page trap, so run it and read the failure carefully |
| `HTML_PATH_PREFIXES = ['/']` | "does not exempt the API" and "does not exempt the admin route" |
| In `handlePostPage`, `if (found === null) return shell;` → `return new Response('Not found', { status: 404 })` | "passes the shell through untouched for a slug that resolves to nothing" |
| In `handlePostPage`, drop the `if (!shell.ok) return shell;` guard | "hands a failed shell fetch straight back" |
| `rewritten ?? html` → `rewritten!` | "serves the shell untouched when it no longer carries the anchors" (throws) |
| `SHELL_PATH = '/blog/index.html'` | "asks Pages for a path its own route cannot match" |
| Remove the `request.method === 'GET' &&` guard, then POST to `/blog/x` | nothing today — so also add a case asserting `POST /blog/x` returns the router's 404, and watch it red under this mutation |

- [ ] **Step 11: Pin the anchors against the built shell, not just the committed one**

`worker/post-shell.ts` matches tags in `index.html`. What the Worker actually fetches at runtime is `dist/index.html`, which Vite has rewritten (the module script becomes a hashed asset, a stylesheet link is injected). Add to `src/test/crawlers.test.ts`, alongside its existing `REQUIRED`/`DIST_SITEMAP` gate:

```ts
import { SHELL_ANCHORS } from '../../worker/post-shell';

const DIST_SHELL = 'dist/index.html';

// Phase 5C. worker/post-shell.ts rewrites the <head> of the shell the Worker
// fetches at runtime -- which is dist/index.html, not the committed
// index.html. Vite rewrites that file on every build (the module script
// becomes a hashed asset, a stylesheet link is injected), so an anchor that
// matches the source and not the output would leave every post page silently
// un-rewritten, with a 200 and correct-looking HTML. This is in crawlers.test.ts
// specifically because it is already listed in `npm run test:bundle`, which is
// the post-build step the real deploy runs.
describe('the shell the Worker rewrites', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_SHELL))('carries every anchor worker/post-shell.ts depends on, exactly once', () => {
    const built = readFileSync(DIST_SHELL, 'utf8');
    for (const { name, pattern } of SHELL_ANCHORS) {
      const found = built.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
      expect(found, `anchor "${name}" is not in dist/index.html exactly once`).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 12: Build and run the post-build suite for real**

Run: `npm run build`
Expected: exit 0, including `npm run test:bundle`. Watch the entry CSS line — it must still be 38593 bytes, because this phase touches no CSS.

Then prove the new check can fail: temporarily delete the `og:url` meta from `index.html`, run `npm run build` again, confirm the anchor test reds, and revert.

- [ ] **Step 13: Full gate**

Run: `npm run gate`
Expected: clean.

- [ ] **Step 14: Commit**

```bash
git add worker/post-page.ts worker/index.ts worker/__tests__/post-page.test.ts src/test/crawlers.test.ts
git commit -m "feat(seo): serve /blog/<slug> from the Worker with a rewritten head"
```

---

## Task 4: Widening the Worker's routes, and deploying

**This is the dangerous task, and it is deliberately last.** Everything it turns on has already been verified against a known-good baseline: Tasks 1-3 are merged, the full gate is green, and the handler has been exercised end-to-end through the Worker's real `fetch` export with a fake Pages. The only thing this task adds is telling Cloudflare to send real traffic at it.

**What a visitor sees if this task is wrong:** every real post URL breaks at once, for everyone, not just for crawlers. The three shapes it can take, and what each looks like: a **blank white page** (the CSP trap of Task 3 was not merged, or the Worker deployed from a tree that lacks it) — the reader gets `index.html`'s own four-second fallback message; a **502/1101** (the Worker threw) — Cloudflare's own error page; or **`/blog/<slug>` answering the site-wide title with no post metadata** (the shell anchors did not match the deployed `dist/index.html`) — visually indistinguishable from a working page, which is why Step 8's raw check exists.

**Rollback, named in advance:** revert `wrangler.toml` to the two `/api/*` routes and run `npx wrangler deploy`. Pages then answers `/blog/*` again immediately, exactly as it does today. That is one command and it does not require the code changes to be reverted — the handler is unreachable without a route.

**Files:**
- Modify: `wrangler.toml` (the `routes` list)
- Modify: `src/test/hosting.test.ts:127-166`
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**
- Consumes: `HTML_PATH_PREFIXES` from `worker/index.ts` (in `hosting.test.ts`); `site.seo.url` from `src/content` (already imported there).
- Produces: no code interface. Produces a deployed Worker whose route list is exactly four patterns.

- [ ] **Step 1: Find out whether the deploy pipeline is even working**

As of writing, **two consecutive commits pushed cleanly to `main` and did not build on Cloudflare Pages.** The pipeline is in an unknown state and nothing below may assume otherwise. Establish the facts first, and do not proceed on a guess.

```bash
git log --oneline -3
curl -sI https://vb.aionxxxi.uk/build-info.json | head -1
curl -s https://vb.aionxxxi.uk/build-info.json
```

The `commit` field in `build-info.json` is what Pages actually has live. Compare it to `git rev-parse HEAD`. Three outcomes:

- **They match** — Pages is current. Continue to Step 2.
- **They differ** — Pages is behind. Open the Cloudflare Pages dashboard for project `vb`, find the most recent deployment, and read why it did not run or did not finish. Fix that first. Deploying a Worker that fetches a stale shell is deploying against an unknown baseline, which is the one thing this task's ordering exists to avoid.
- **`build-info.json` does not answer** — the site is not serving. Stop; this task is not the problem to solve today.

- [ ] **Step 2: Confirm the current live route list before changing it**

```bash
npx wrangler deployments list --name via-bianca-admin | head -20
curl -s https://vb.aionxxxi.uk/api/health
curl -s https://viabiancarestaurant.com/api/health
```

Both `/api/health` calls must return `{"ok":true}` as `application/json`. `text/html` back means the SPA answered instead of the Worker — the route is not live on that host, and that is a pre-existing problem to fix before adding two more routes.

- [ ] **Step 3: Write the failing test for the widened route list**

In `src/test/hosting.test.ts`, extend the existing `SERVED_HOSTNAMES` loop inside the `routes /api/* to the Worker` test, and add a new test beside it:

```ts
    // Phase 5C. Every served hostname needs a /blog/* route as well as its
    // /api/* one, and for the identical reason the /api/* assertion above
    // exists: a hostname with no route is the silent failure -- there, a 405
    // on login; here, a post URL that quietly falls through to Pages and
    // serves the site-wide title, which looks completely normal in a browser.
    for (const host of SERVED_HOSTNAMES) {
      const route = routes.find((r) => r.pattern === `${host}/blog/*`);
      expect(route, `no /blog/* route for hostname "${host}" -- posts there get no per-post metadata`).toBeDefined();
    }
```

```ts
  // Phase 5C, decision D7. /edit suppresses its own SEO output on purpose
  // (src/components/SeoHead.tsx: logged out, an empty site.seo.url resolves an
  // empty href to /edit ITSELF, and the Restaurant block names a blank
  // restaurant). The Worker cannot reproduce either state -- it never sees an
  // /edit request and reads site.seo.url from the committed JSON -- but that
  // is only true while no route pattern and no HTML prefix can reach /edit.
  // Pinned here rather than asserted in prose, because widening a pattern to
  // `/*` is a one-character edit that nothing else in this repo would catch.
  it('routes no part of the admin surface to the Worker', () => {
    const routes = parseRoutes(readFileSync('wrangler.toml', 'utf8'));
    for (const { pattern } of routes) {
      const path = pattern.slice(pattern.indexOf('/'));
      const prefix = path.endsWith('*') ? path.slice(0, -1) : path;
      expect('/edit'.startsWith(prefix), `route "${pattern}" can match /edit`).toBe(false);
      expect('/edit/manage'.startsWith(prefix), `route "${pattern}" can match /edit/manage`).toBe(false);
    }
    for (const prefix of HTML_PATH_PREFIXES) {
      expect('/edit'.startsWith(prefix)).toBe(false);
      expect('/edit/manage'.startsWith(prefix)).toBe(false);
    }
  });
```

Add `import { HTML_PATH_PREFIXES } from '../../worker/index';` to the file's imports.

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/test/hosting.test.ts`
Expected: FAIL — `no /blog/* route for hostname "viabiancarestaurant.com"`.

- [ ] **Step 5: Widen the route list**

Replace the `routes` array in `wrangler.toml`, keeping the existing comment above it intact and adding to it:

```toml
# Same-origin: /api/* must be served by this Worker, not by the SPA catch-all in
# public/_redirects. A cross-origin Worker would drop the SameSite=Strict session
# cookie on every fetch and make sendBeacon('/api/wa') a silent no-op.
# Both hostnames, and the list is the whole truth: `wrangler deploy` REPLACES a
# Worker's routes with exactly what is here, so a route added by hand in the
# dashboard survives until the next deploy and then disappears without a word.
# That is not hypothetical -- it happened to viabiancarestaurant.com on the 5B
# deploy, and /edit login on that host went back to 405 until this line existed.
#
# Phase 5C adds /blog/* on both hostnames: worker/post-page.ts answers a post
# URL with the SPA shell whose <head> it has rewritten for that post. Three
# things about this pattern are load-bearing.
#
#   - `/blog/*` does NOT match bare `/blog`. The index stays entirely on
#     Pages, untouched, which is the smallest widening that satisfies the
#     phase's own requirement (which is about posts).
#   - It does not match `/index.html`, which is exactly why the Worker can
#     fetch the shell from Pages without recursing into itself.
#   - It cannot reach /edit, and src/test/hosting.test.ts pins that. /edit
#     deliberately emits no canonical and no structured data of its own
#     (src/components/SeoHead.tsx's own comment), and a Worker route that
#     widened to `/*` would start emitting one on its behalf.
#
# Deploying THIS list is what makes /blog/<slug> a Worker response. Reverting
# it to the two /api/* entries and re-running `npx wrangler deploy` is the
# whole rollback -- Pages answers /blog/* again immediately, and the handler
# is unreachable without a route.
routes = [
  { pattern = "vb.aionxxxi.uk/api/*", zone_name = "aionxxxi.uk" },
  { pattern = "viabiancarestaurant.com/api/*", zone_name = "viabiancarestaurant.com" },
  { pattern = "vb.aionxxxi.uk/blog/*", zone_name = "aionxxxi.uk" },
  { pattern = "viabiancarestaurant.com/blog/*", zone_name = "viabiancarestaurant.com" },
]
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/test/hosting.test.ts src/test/wrangler-config.test.ts`
Expected: PASS.

Then prove they can fail: delete the `viabiancarestaurant.com/blog/*` line and confirm the named hostname assertion reds; change `vb.aionxxxi.uk/blog/*` to `vb.aionxxxi.uk/*` and confirm the `/edit` test reds. Revert both.

- [ ] **Step 7: Full gate, then commit and push Pages**

```bash
npm run gate
git add wrangler.toml src/test/hosting.test.ts
git commit -m "feat(seo): route /blog/* to the Worker on both served hostnames"
git push
```

Then **wait for the Pages build to finish and go green before Step 8.** Confirm with:

```bash
curl -s https://vb.aionxxxi.uk/build-info.json
```

The `commit` field must equal `git rev-parse HEAD`. Pushing to `main` deploys **Pages only** — the Worker has not moved yet, and `/blog/*` is still answered by Pages at this point, exactly as it is today. That is deliberate: the shell the Worker will fetch must be the current one before the Worker starts fetching it.

- [ ] **Step 8: Deploy the Worker**

```bash
npx wrangler deploy
```

Read the output. It prints the route list it registered — confirm all four patterns are there. `wrangler deploy` **replaces** the whole list, so four printed means four live and anything not printed is gone.

- [ ] **Step 9: Smoke-check the live route immediately, with curl and not a browser**

```bash
SLUG=$(node -e "console.log(require('./src/content/posts.json')[0].slug)")
for HOST in https://vb.aionxxxi.uk https://viabiancarestaurant.com; do
  echo "--- $HOST/blog/$SLUG"
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H "Origin: $HOST" "$HOST/blog/$SLUG"
  curl -sI -H "Origin: $HOST" "$HOST/blog/$SLUG" | grep -i 'content-security-policy'
  curl -s -H "Origin: $HOST" "$HOST/blog/$SLUG" | grep -o '<title>[^<]*</title>'
done
```

Every line must be right before you walk away:
- `200 text/html`
- a `Content-Security-Policy` that is **not** `default-src 'none'` — if it is, the page is blank in a browser and you must roll back now
- a `<title>` that is the post's title, not `Via Bianca - Pastificio & Ristorante | Authentic Italian Dining in Delhi`

Then open one of those URLs in a real browser and confirm the page renders. The curl checks cannot see a blank page; a browser can.

If any check fails: revert `wrangler.toml`'s `routes` to the two `/api/*` entries and run `npx wrangler deploy`. Do that first, diagnose second.

- [ ] **Step 10: Confirm nothing else moved**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://vb.aionxxxi.uk' https://vb.aionxxxi.uk/blogs   # 301
curl -sI https://vb.aionxxxi.uk/blog | grep -i content-type                                                # text/html, from Pages
curl -s https://vb.aionxxxi.uk/api/health                                                                  # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://vb.aionxxxi.uk/edit                                       # 200, the SPA
```

`/blogs` must still be a real 301 to `/blog`, and `/blog` and `/edit` must still be Pages responses.

- [ ] **Step 11: Write the runbook into `docs/cloudflare-cutover.md`**

Add a section recording, in this order: that a push to `main` deploys Pages only and the Worker needs `npx wrangler deploy` separately; that `wrangler deploy` replaces the entire route list with what `wrangler.toml` declares, so a dashboard-added route disappears silently on the next deploy; that Pages must be verified green (via `build-info.json`) **before** the Worker deploy, because the Worker fetches the live shell; the four-pattern route list; the Step 9 curl checks; and the one-command rollback. Do not restate the code — link to `worker/post-page.ts` for the mechanism.

- [ ] **Step 12: Commit**

```bash
git add docs/cloudflare-cutover.md
git commit -m "docs: record the /blog/* worker route deploy and its rollback"
```

---

## Task 5: A check that runs again

The live check from Task 4 Step 9 was typed by a person once. This task turns it into `npm run verify:deploy`, so the next deploy that quietly stops rewriting the head is a failure somebody sees rather than a discovery six weeks later in Search Console.

**What a visitor sees if this task is wrong:** nothing. This task ships no runtime code. Its own failure mode is a check that passes when it should not — which is what Step 5's mutations exist to rule out.

**Files:**
- Create: `scripts/post-seo-check.mjs`
- Create: `scripts/__tests__/post-seo-check.test.mjs`
- Modify: `scripts/verify-deploy.mjs`

**Interfaces:**
- Consumes: nothing. `scripts/post-seo-check.mjs` imports **nothing at all** — no TypeScript, no Node builtins, no network — for the reason `scripts/published-posts-check.mjs` gives in its own header: `npm run verify:deploy` is plain `node`, and an import that needs `tsx` stops the whole check from running.
- Produces: `postSeoProblems(html: string, expected: { siteUrl: string; slug: string; title: string; excerpt: string; image: string }): string[]` — empty array means the raw HTML carries everything the spec's sentence names.

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/post-seo-check.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { postSeoProblems } from '../post-seo-check.mjs';

const EXPECTED = {
  siteUrl: 'https://vb.aionxxxi.uk',
  slug: 'assassina',
  title: 'Spaghetti all\'Assassina',
  excerpt: 'A Puglian classic in tomato water.',
  image: '/press/hotelier.webp',
};

function goodHtml() {
  return [
    '<html><head>',
    '<title>Spaghetti all&#39;Assassina</title>',
    '<meta name="description" content="A Puglian classic in tomato water." />',
    '<meta property="og:type" content="article" />',
    '<meta property="og:image" content="https://vb.aionxxxi.uk/press/hotelier.webp" />',
    '<meta property="og:url" content="https://vb.aionxxxi.uk/blog/assassina" />',
    '<link rel="canonical" href="https://vb.aionxxxi.uk/blog/assassina">',
    '<script type="application/ld+json">{"@type":"Article","headline":"Spaghetti all\\u0027Assassina"}</script>',
    '</head><body></body></html>',
  ].join('');
}

describe('post SEO, checked against a raw response body', () => {
  it('accepts a page that carries all four artefacts', () => {
    expect(postSeoProblems(goodHtml(), EXPECTED)).toEqual([]);
  });

  // The exact failure this whole check exists for: the route is not live, so
  // Pages answered with the untouched shell. It is a 200, it is valid HTML,
  // it renders perfectly in a browser, and it is completely wrong.
  it('rejects the site-wide title', () => {
    const shell = goodHtml().replace(/<title>[^<]*<\/title>/, '<title>Via Bianca - Pastificio &amp; Ristorante</title>');
    expect(postSeoProblems(shell, EXPECTED)).toContain('title is not the post title');
  });

  it('rejects the site-wide open graph image', () => {
    const shell = goodHtml().replace(/press\/hotelier\.webp/, 'og-image.jpg');
    expect(postSeoProblems(shell, EXPECTED)).toContain('og:image is not the post image');
  });

  it('rejects a missing canonical', () => {
    const shell = goodHtml().replace(/<link rel="canonical"[^>]*>/, '');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no canonical for this post');
  });

  it('rejects a missing Article block', () => {
    const shell = goodHtml().replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no Article structured data');
  });

  it('rejects structured data that is not an Article', () => {
    const shell = goodHtml().replace('"@type":"Article"', '"@type":"Restaurant"');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no Article structured data');
  });

  it('rejects a description that is not the excerpt', () => {
    const shell = goodHtml().replace('A Puglian classic in tomato water.', 'Authentic Italian dining in Greater Kailash.');
    expect(postSeoProblems(shell, EXPECTED)).toContain('description is not the post excerpt');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    expect(postSeoProblems('<html><head></head></html>', EXPECTED).length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run scripts/__tests__/post-seo-check.test.mjs`
Expected: FAIL — cannot resolve `../post-seo-check.mjs`.

- [ ] **Step 3: Write `scripts/post-seo-check.mjs`**

```js
// Phase 5C. What a crawler receives, checked against the RAW response body
// with JavaScript never executing.
//
// WHY THIS IS NOT AN e2e SPEC, which is the mistake this file exists to
// avoid. src/components/blog/PostPage.tsx already sets document.title and
// rewrites the description meta on the client. So a Playwright test that
// reads document.title on /blog/<slug> passes with this entire phase
// reverted -- it proves the SPA works, which was never in question. The only
// assertion that says anything about server-rendered SEO is one made against
// the bytes of the HTTP response before any script runs. That is a string,
// so this module takes a string.
//
// IMPORTS NOTHING, deliberately, for the reason scripts/published-posts-check.mjs
// gives at length: `npm run verify:deploy` is plain `node scripts/verify-deploy.mjs`,
// and a single import that needs `tsx` would stop the whole check running.
// Keep it that way.

// The shell's own static title, which is what a post URL answers with when
// the Worker route is not live. Matched as a distinct failure rather than
// folded into "title is not the post title" would be, because it is the ONE
// failure that means "the route is gone" rather than "the rewrite is wrong".
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function postSeoProblems(html, expected) {
  const problems = [];
  const canonical = `${expected.siteUrl}/blog/${expected.slug}`;
  const imageUrl = `${expected.siteUrl}${expected.image}`;

  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!title || decodeEntities(title[1]) !== expected.title) {
    problems.push('title is not the post title');
  }

  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  if (!description || decodeEntities(description[1]) !== expected.excerpt) {
    problems.push('description is not the post excerpt');
  }

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/);
  if (!ogImage || ogImage[1] !== imageUrl) {
    problems.push('og:image is not the post image');
  }

  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/);
  if (!ogUrl || ogUrl[1] !== canonical) {
    problems.push('og:url is not the post canonical');
  }

  if (!html.includes(`<link rel="canonical" href="${canonical}">`)) {
    problems.push('no canonical for this post');
  }

  // Parsed rather than substring-matched, so a page that merely CONTAINS the
  // characters `"@type":"Article"` inside some other block cannot pass.
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let article = null;
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1]);
      if (parsed && parsed['@type'] === 'Article') article = parsed;
    } catch {
      problems.push('structured data is not valid JSON');
    }
  }
  if (!article) {
    problems.push('no Article structured data');
  } else {
    if (article.headline !== expected.title) problems.push('Article headline is not the post title');
    if (article.image !== imageUrl) problems.push('Article image is not the post image');
  }

  return problems;
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run scripts/__tests__/post-seo-check.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove each test can fail**

| Mutation in `scripts/post-seo-check.mjs` | Test that must go red |
|---|---|
| `if (!title \|\| ...)` → `if (!title)` | "rejects the site-wide title" |
| Delete the `og:image` block | "rejects the site-wide open graph image" |
| Delete the canonical `includes` check | "rejects a missing canonical" |
| Replace the JSON.parse block with `if (html.includes('ld+json')) article = {}` | "rejects structured data that is not an Article" |
| `return problems;` → `return problems.slice(0, 1);` | "reports every problem at once" |

- [ ] **Step 6: Wire it into `scripts/verify-deploy.mjs`**

`verify-deploy.mjs` already drives a real Chromium for the asset checks. This check must **not** use it. Add, near the existing `postsDriftProblems` import and its use:

```js
import { postSeoProblems } from './post-seo-check.mjs';
```

and a check that runs with plain `fetch`:

```js
// Phase 5C. DELIBERATELY `fetch`, not the `chromium` page this script already
// has open. A browser executes src/components/blog/PostPage.tsx, which sets
// document.title and rewrites the description meta on the client -- so a
// browser-based assertion here would pass with the Worker route deleted and
// prove nothing at all. What is being checked is what a crawler that runs no
// JavaScript receives, which is the response body and only the response body.
//
// The Origin header is sent for the same reason every asset fetch in this
// script sends one: the poisoned-cache variant this site has hit four times
// is keyed on Origin with no Vary advertising the split, so a request without
// it reads a different cached variant than a visitor gets.
async function checkPostSeo(posts) {
  const post = posts[0];
  if (!post) return ['no committed posts to check'];
  const url = `${SITE}/blog/${post.slug}`;
  const response = await fetch(url, { headers: { Origin: ORIGIN } });
  const problems = [];

  const type = response.headers.get('content-type') ?? '';
  if (!/text\/html/i.test(type)) problems.push(`${url} answered ${response.status} as "${type}", not HTML`);

  // The blank-page trap, checked at the one place it is observable without a
  // browser. worker/index.ts's own SECURITY_HEADERS carry
  // `default-src 'none'`, which is correct for its JSON routes and forbids
  // script, style, font and image -- so a post page carrying it renders
  // completely blank with a perfectly healthy 200.
  const csp = response.headers.get('content-security-policy') ?? '';
  if (csp.includes("default-src 'none'")) {
    problems.push(`${url} carries the Worker's API content-security-policy -- this page is blank in a browser`);
  }

  const html = await response.text();
  return problems.concat(
    postSeoProblems(html, {
      siteUrl: SITE_URL_FROM_CONTENT,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      image: post.image,
    }).map((problem) => `${url}: ${problem}`),
  );
}
```

`SITE_URL_FROM_CONTENT` is `site.seo.url` read from the committed `src/content/site.json` — **not** `SITE`, which is the host being probed and may be `viabiancarestaurant.com`. Decision D6: the canonical names one host regardless of which host served the page, so the expected value comes from the content file. Read it with the `readFileSync` this script already imports:

```js
const SITE_URL_FROM_CONTENT = JSON.parse(readFileSync('src/content/site.json', 'utf8')).seo.url;
```

Call `checkPostSeo` from the script's existing problem-collecting flow, alongside `postsDriftProblems`, and read the committed posts with the same `readFileSync(...)` + `JSON.parse` the drift check already uses.

- [ ] **Step 7: Run it against the live site**

Run: `npm run verify:deploy`
Expected: no post-SEO problems reported.

Then prove it can fail against reality, which is the only proof that counts for a live check: temporarily set `VB_SITE=https://<the pages.dev preview host>` — that host has no Worker route, so Pages answers with the untouched shell — and confirm the check reports `title is not the post title`, `og:image is not the post image`, `no canonical for this post` and `no Article structured data`. This is the exact failure the check exists to catch, reproduced on demand.

- [ ] **Step 8: Check the second hostname too**

Run: `VB_SITE=https://viabiancarestaurant.com npm run verify:deploy`
Expected: clean. The canonical it asserts is still `https://vb.aionxxxi.uk/blog/<slug>` — decision D6, and if that reads wrong to you, D6 is the thing to argue with, not this check.

- [ ] **Step 9: Full gate**

Run: `npm run gate`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add scripts/post-seo-check.mjs scripts/__tests__/post-seo-check.test.mjs scripts/verify-deploy.mjs
git commit -m "test: check post SEO against the raw response body on every deploy"
```

---

## What This Phase Does Not Do

Recorded so the next reader does not have to infer it from silence.

- **The post body is not server-rendered.** Decision D1. A crawler that executes no JavaScript gets correct metadata and no article prose.
- **`/blog` (the index) is untouched.** Decision D3. It keeps the client-side metadata it has today.
- **`site.json`'s `seo.url` does not move.** Decision D6. It still says `https://vb.aionxxxi.uk` while the site also answers on `viabiancarestaurant.com`, and `viabiancadelhi.com` is still not cut over.
- **Nothing is added to `CACHEABLE_PATHS`.** A post page is not edge-cached, so every request costs one Worker invocation, one subrequest to Pages, and one D1 row read. At 5M row reads/day on the free tier this is not a constraint, and a cached post page would be a page whose metadata went stale after a publish with no version in its cache key — the mechanism `worker/published.ts` uses for JSON does not transfer, because the URL a crawler asks for carries no version.
- **`worker/snapshot.ts` still has to be regenerated by hand** before a deploy that matters (`node scripts/build-snapshot.mjs`), exactly as it did before. This phase adds a third document to it and a second consumer, which makes the staleness matter more, not less.

---

## Self-Review

**1. Spec coverage.** The spec's statement of this phase is one sentence with four named artefacts.

| Spec words | Where |
|---|---|
| "Posts render server-side in the Worker" | Task 3 (`worker/post-page.ts`, wired into `route()`), Task 4 (the `/blog/*` route that makes it reachable). Scoped to the `<head>` by decision D1, argued rather than assumed. |
| "per-post title" | Task 1 (`postMetadata().title`, the `title` anchor in `post-shell.ts`), checked raw in Task 3 Step 1 and Task 5. |
| "description" | Task 1 (`postMetadata().description`, the `description`/`og:description`/`twitter:description` anchors), same checks. |
| "Open Graph image" | Task 1 (`absoluteImageUrl`, the `og:image`/`twitter:image` anchors), decision D8 on the no-photo case, same checks. |
| "Article structured data" | Task 1 (`articleJsonLd`, `jsonLdScriptBody`), injected in `rewriteShellHead`, parsed and type-checked in Task 5's `postSeoProblems`. |

No spec requirement is unimplemented. Nothing in the plan implements a requirement the spec does not state — the sitemap, the block editor, the `/blogs` redirect and the image pipeline are all left exactly as they are.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries the real code. The two places that name a value the implementer must read rather than invent are Task 4 Step 1 (the live `build-info.json` commit) and Task 2 Step 2 (the snapshot regeneration output) — both are steps that *check reality*, with the expected answer and the action for each outcome spelled out, not gaps in the plan. Task 3 Step 9's note about `AUTHENTICATED_PATHS` names a conditional edit; it is conditional because whether that test reds depends on a list this plan did not write, and both branches are stated.

**3. Type consistency.** Checked across tasks: `PostMetadata` is defined in Task 1 (`worker/post-seo.ts`) with the five fields `title`, `description`, `canonical`, `imageUrl`, `jsonLdScript`, and every later use — `rewriteShellHead`'s parameter (Task 1), `handlePostPage`'s call to `postMetadata` (Task 3) — uses those exact names. `SHELL_ANCHORS` is `{ name, pattern }[]` in Task 1 and is destructured as `{ name, pattern }` in Task 1's own test and in Task 3 Step 11's `crawlers.test.ts` addition. `lookupPost` returns `PostLookup | null` with fields `post` and `source` (Task 2); Task 3's handler reads `found.post` and never `found.source`, which is consistent (the source is exposed for tests and future logging, and Task 2's tests assert on it). `slugFromPath` returns `string | null` in Task 3 and is used as `!== null` in both `handlePostPage` and `worker/index.ts`'s route branch. `servesSiteHtml`/`HTML_PATH_PREFIXES` are exported from `worker/index.ts` in Task 3 Step 7 and imported in Task 3 Step 5's test and Task 4 Step 3's `hosting.test.ts` — same names, same file. `postSeoProblems(html, expected)` takes `{ siteUrl, slug, title, excerpt, image }` in Task 5 Step 3 and is called with exactly those five keys in Step 6. `POSTS_FILE`/`POSTS_PATH` are defined once in Task 2 and used in Task 2's tests only.
