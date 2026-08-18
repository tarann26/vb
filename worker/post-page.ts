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
