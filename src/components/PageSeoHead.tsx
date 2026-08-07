import { useEffect } from 'react';
import { useContent } from '../content/ContentContext';
import { useCanonical } from './useCanonical';
import type { Page } from '../content/types';

interface PageSeoHeadProps {
  page: Page;
}

// Plan 7, Task 3, Step 3: a page's own metadata. Decision, recorded: NOT
// SeoHead.tsx reused or extended -- that component's own header comment is
// explicit that the homepage is "the one and only page that should own
// this component's canonical/structured-data output," and its Restaurant
// JSON-LD block is semantically wrong for a page that isn't itself the
// restaurant (a "Breads & Dips" page is not a Restaurant entity). This is
// a small, separate, page-specific component instead.
//
// `page.seo.title`/`page.seo.description` are the WHOLE title/description
// string she authors -- not templated with `${site.name}` appended, the
// same fully-author-controlled convention `site.seo.title` already uses
// (SeoHead.tsx never appends anything to it either).
//
// index.html ships a STATIC `<title>` and `<meta name="description">`
// (head.test.ts pins both against site.json's own seo fields, since
// index.html has no server-side rendering of its own to read live content
// at request time -- see SITE_READONLY_HELP's own comment, fields.ts).
// `public/_redirects` serves that SAME index.html for every route,
// including a page's own `/<slug>` -- so a page's metadata can only ever
// reach a crawler that executes JavaScript, by MUTATING the tags already
// there, never by appending a second, competing one: `document.title` is
// a singleton property (safe to overwrite), but `<meta name="description">`
// is a real DOM node, and appendChild-ing a second one would leave two
// competing description tags on the page with no defined winner. The
// existing tag's own `content` attribute is what this component rewrites
// instead, restoring the original value on unmount so a route change back
// to `/` (or to a route with no page metadata of its own) is not left with
// this page's own description. `<link rel="canonical">` has no such
// collision -- index.html deliberately ships none at all (SeoHead.tsx's
// own comment on why) -- so it is appended/removed exactly the way
// SeoHead.tsx already does for the homepage's own canonical.
const PageSeoHead: React.FC<PageSeoHeadProps> = ({ page }) => {
  const { site } = useContent();
  const canonical = `${site.seo.url}/${page.slug}`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = page.seo.title;

    const descriptionMeta = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionMeta?.getAttribute('content') ?? null;
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', page.seo.description);
    }

    return () => {
      document.title = previousTitle;
      if (descriptionMeta && previousDescription !== null) {
        descriptionMeta.setAttribute('content', previousDescription);
      }
    };
  }, [page.seo.title, page.seo.description]);

  // Split out of the effect above rather than left inside it: the canonical
  // has nothing to do with the title/description restore dance those lines
  // exist for, and it is now the same one definition /blogs and the homepage
  // use.
  useCanonical(canonical);

  return null;
};

export default PageSeoHead;
