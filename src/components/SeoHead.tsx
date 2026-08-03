import React, { useEffect } from 'react';
import { useContent } from '../content/ContentContext';
import { toSchemaOpeningHours } from '../content/hours';

interface SeoHeadProps {
  // Post-review Fix 6: EditMode.tsx (src/admin/) now ALSO mounts this exact
  // component -- Task 2's whole premise is that /edit renders the real
  // public components, this one included -- which made the comment this
  // prop replaces ("Mounted only by HomePage, which is what makes the
  // canonical below correct") false the moment that happened. /edit is not
  // a page anyone should find via search, share, or index: robots.txt (Fix
  // 6) now disallows the whole route, but a crawler or scraper that reaches
  // it anyway (ignoring robots.txt, or a developer with the page open)
  // gains nothing from a canonical link or Restaurant JSON-LD emitted
  // there, and stands to see something actively wrong -- logged out, an
  // empty `site.seo.url` resolves an empty `href` to /edit ITSELF (a
  // self-canonical for a page that must never be indexed), alongside a
  // Restaurant block naming a blank restaurant; logged in, it would just be
  // a second, pointless copy of exactly what HomePage already declares.
  // Decision: /edit emits neither, ever, regardless of session state --
  // the real homepage is the one and only page that should own this
  // component's canonical/structured-data output. Defaults to `true` so
  // HomePage's own bare `<SeoHead />` (src/App.tsx) is completely
  // unaffected -- confirmed against src/test/homepage-bytes.test.tsx's
  // byte-identical pin, which does not move.
  emitMetadata?: boolean;
}

// index.html deliberately carries no <link rel="canonical">: public/_redirects
// rewrites every route to that one file, so a canonical there would tell
// Google that /blogs is a duplicate of the homepage even as
// public/sitemap.xml asks for /blogs to be indexed. Declaring it from a
// component mounted on / alone gives the homepage a correct self-canonical
// and leaves every other route with none, which is the safe default (a page
// with no canonical is indexed under its own URL). See `emitMetadata` above
// for why /edit, the one other route that mounts this component, opts out
// of both outputs entirely rather than emitting its own version of either.
//
// The link is appended to document.head rather than returned as JSX because
// React 18 renders elements where they sit -- inside the page body -- and
// rel="canonical" is only honoured inside <head>. The JSON-LD below has no
// such restriction and so is returned normally. Both depend on the crawler
// executing JavaScript, which is an accepted tradeoff for this site.
const SeoHead: React.FC<SeoHeadProps> = ({ emitMetadata = true }) => {
  const { site } = useContent();
  // Read unconditionally, before the `emitMetadata` check below: a
  // malformed site.json must still throw here regardless of which route
  // mounted this component, so the SectionErrorBoundary EditMode.tsx wraps
  // it in stays genuinely tested (see that file's own Fix 6 comment).
  const canonical = site.seo.url;

  useEffect(() => {
    if (!emitMetadata) return undefined;
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = canonical;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [canonical, emitMetadata]);

  if (!emitMetadata) return null;

  const json = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: `${site.name} ${site.tagline}`,
    description: site.seo.description,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.locality,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    telephone: site.phones[0],
    servesCuisine: 'Italian',
    priceRange: '$$',
    openingHours: site.hours.map(toSchemaOpeningHours),
    chef: { '@type': 'Person', name: 'Kamalika Anand' },
  };
  return <script type="application/ld+json">{JSON.stringify(json)}</script>;
};

export default SeoHead;
