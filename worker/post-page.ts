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
// THE SHELL IS FETCHED LIVE, NEVER COMPILED IN (decision D2). Asset filenames
// carry the commit sha (vite.config.ts) and Pages serves only the current
// deployment's files, so any copy of the shell held inside this Worker points
// at asset URLs that 404 the moment Pages redeploys -- a blank page at a real
// URL, for every visitor at once, with no signal that anything is wrong.
// Fetching /index.html on the request's own origin is what makes a Worker
// deploy and a Pages deploy independent of each other. The cost is one
// subrequest per hit, and it is accepted rather than cached: a cache here
// would reintroduce exactly the staleness the live fetch exists to remove.
//
// AND IT CANNOT LOOP. wrangler.toml routes this Worker on `/api/*` and (from
// Task 4) `/blog/*` only; `/index.html` matches neither, so the subrequest
// goes to Pages rather than back into this handler. slugFromPath deliberately
// agrees with the route pattern (it refuses bare `/blog` exactly as `/blog/*`
// does) so the two cannot drift into disagreeing about what this Worker owns.
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
// Content-Type -- and the Content-Security-Policy from public/_headers -- that
// Pages set survive. The body is a string rather than a stream because it has
// already been read in full to rewrite it.
//
// The two headers that are DROPPED, and why dropping them is not optional.
// Rewriting the head makes the body longer than the one Pages measured, so a
// Content-Length copied from the shell describes a document that no longer
// exists -- and a Content-Length shorter than the body is a truncated page,
// which is the blank-white-screen-at-200 failure again wearing a different
// hat. Content-Encoding goes for the same reason in reverse: whatever Pages
// compressed, `fetch` handed back decoded, so a surviving `br` or `gzip`
// would tell the browser to inflate plain text. Removing both leaves the
// runtime to frame the response from the body it actually has.
function withBody(shell: Response, html: string): Response {
  const headers = new Headers(shell.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  return new Response(html, {
    status: shell.status,
    statusText: shell.statusText,
    headers,
  });
}

// RFC 9110: HEAD answers exactly what GET would, minus the body. Applied once,
// to whatever the handler decided, rather than by branching early -- so "same
// status, same headers" is true by construction instead of by two code paths
// being kept in step by hand. The shell is still fetched and the head still
// rewritten for a HEAD, because a HEAD that skipped that work would report the
// wrong headers for the document it claims to describe.
function bodylessForHead(request: Request, response: Response): Response {
  if (request.method !== 'HEAD') return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Pages itself unreachable -- a rejected subrequest, not a bad status. There
// is nothing to serve: fetching the shell live (D2) is the whole reason this
// route works across independent deploys, so there is no compiled-in copy to
// fall back to, and the only real choice is WHICH failure the visitor and the
// crawler get.
//
// Decision D4's sentence, applied to Pages instead of D1: an outage must cost
// freshness, never the ability to say something true. Left unhandled, the
// rejection escapes worker.fetch and Cloudflare answers with its own 1101
// "Worker threw exception" page -- which reads as a code fault in this Worker,
// carries none of these headers, and says nothing about coming back. A 503
// with Retry-After is the one answer a crawler is documented to treat as
// temporary. It is emphatically NOT a 404, which is the de-indexing event this
// entire phase is arranged around avoiding, and not a 200, which would tell
// everyone the empty page they got was the real one.
//
// This is the only response in this module the Worker authors itself, so it is
// also the only one that needs its own headers -- worker/index.ts deliberately
// exempts this path from SECURITY_HEADERS. `default-src 'none'` here is not a
// second copy of public/_headers' HTML policy drifting from the original: this
// document has no script, style, image or font of any kind, so the empty
// policy is simply the correct one for it.
function pagesUnreachable(): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Temporarily unavailable</title></head>' +
      '<body><p>This page is temporarily unavailable. Please try again shortly.</p></body></html>',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      },
    },
  );
}

export async function handlePostPage(
  request: Request,
  env: PostPageEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return bodylessForHead(request, await postPageResponse(request, env, fetchImpl));
}

async function postPageResponse(
  request: Request,
  env: PostPageEnv,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const url = new URL(request.url);
  // Deliberately the narrowest catch that can be written: it wraps the
  // subrequest and nothing else. A throw from lookupPost, postMetadata or
  // rewriteShellHead is a bug in this repo's own code, and swallowing one into
  // a tidy 503 would be how it survives to production unnoticed.
  let shell: Response;
  try {
    shell = await fetchImpl(new URL(SHELL_PATH, url.origin).toString(), {
      headers: { Accept: 'text/html' },
    });
  } catch {
    return pagesUnreachable();
  }

  // A Pages problem stays a Pages problem. Turning it into a 500 of this
  // Worker's own making would hide which half is broken at the exact moment
  // somebody needs to know.
  if (!shell.ok) return shell;

  const slug = slugFromPath(url.pathname);
  if (slug === null) return shell;

  // Decision D4 lives inside lookupPost, not here: a D1 outage answers from
  // the compiled snapshot and this function never sees the difference. That
  // is deliberate -- there is exactly one place in this codebase that decides
  // what an unreachable database means for a post, and it is not this one.
  const found = await lookupPost(env.DB, slug);
  // Decision D5: an unresolvable slug is the shell, unmodified, at its own
  // status. That is what /blog/<nonsense> already answers today, and turning
  // it into a real 404 is a behaviour change this phase's spec does not ask
  // for.
  if (found === null) return shell;

  const html = await shell.text();
  const rewritten = rewriteShellHead(html, postMetadata(found.post));
  // Decision D9. `null` means the shell no longer carries an anchor this
  // rewriter depends on. Serving it untouched is the fail-safe: a
  // half-rewritten head -- the post's title beside the site's own og:image --
  // is worse than no rewrite, because the two disagree and nothing downstream
  // can tell which is meant. worker/__tests__/post-shell.dist.test.ts is what
  // makes that state a red build rather than a silent degradation nobody
  // notices for a month.
  return withBody(shell, rewritten ?? html);
}
