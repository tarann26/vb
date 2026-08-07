import { useEffect } from 'react';

// One definition of "declare this route's canonical URL", shared by every
// route that has one. SeoHead.tsx (the homepage) and PageSeoHead.tsx (a
// `/<slug>` page) each carried their own copy of the same six lines, and
// /blogs -- which needs the identical thing -- would have made three.
//
// Appended to document.head rather than returned as JSX because React
// renders elements where they sit, inside the body, and `rel="canonical"` is
// only honoured inside <head>. Removed on unmount so a client-side
// navigation to a route with no canonical of its own does not inherit the
// previous route's.
//
// Passing `null` opts out, and that is deliberately a value rather than a
// conditional call: /edit mounts SeoHead with metadata suppressed, and a hook
// called conditionally would break the rules of hooks the first time someone
// wired that up the obvious way.
//
// WHY EVERY ROUTE NEEDS ONE, which was not true when this pattern was
// written. SeoHead.tsx's own comment reasoned that leaving other routes
// without a canonical was "the safe default (a page with no canonical is
// indexed under its own URL)". That held while the site had one origin. It
// does not now: Cloudflare Pages also serves the whole site from its
// generated preview subdomain, publicly and with `Allow: /` in robots.txt, so
// "indexed under its own URL" means indexed under BOTH hosts' versions of
// that URL, competing with each other. A canonical naming the real domain is
// what tells a crawler which one counts, and site.seo.url is the single place
// that domain is written down.
// Belt to the canonical's braces, for the second host specifically.
//
// Cloudflare Pages publishes every project on a generated `*.pages.dev`
// subdomain in addition to its custom domain. That copy is public, serves
// identical content, and its robots.txt says `Allow: /` -- so without this it
// is a fully indexable duplicate of the whole site, competing with the real
// domain in results the restaurant actually wants to win.
//
// Matched on the `.pages.dev` SUFFIX rather than on "hostname differs from
// site.seo.url", and the distinction is the entire safety argument. The
// inequality version reads better and is a loaded gun: the day the real
// domain is bought and site.seo.url has not been updated yet -- which is
// exactly the state this repository has been in for weeks -- every visitor,
// including Googlebot, would be served `noindex` for the real site. This
// version cannot do that. `viabiancadelhi.com` does not end in `.pages.dev`,
// and no domain anyone would deliberately serve this restaurant from ever
// will.
//
// It only reaches crawlers that execute JavaScript, same as the canonical
// links. The durable fix is a Cloudflare Access policy on the preview
// subdomain, which is a dashboard action rather than anything this repository
// can express -- see docs/cloudflare-cutover.md.
export function useNoindexOnPreviewHost(): void {
  useEffect(() => {
    if (!window.location.hostname.endsWith('.pages.dev')) return undefined;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}

export function useCanonical(href: string | null): void {
  useEffect(() => {
    if (!href) return undefined;
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = href;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [href]);
}
