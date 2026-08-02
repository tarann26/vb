import React, { useEffect } from 'react';
import { site } from '../content';
import { toSchemaOpeningHours } from '../content/hours';

// Mounted only by HomePage, which is what makes the canonical below correct.
//
// index.html deliberately carries no <link rel="canonical">: vercel.json
// rewrites every route to that one file, so a canonical there would tell
// Google that /blogs is a duplicate of the homepage even as
// public/sitemap.xml asks for /blogs to be indexed. Declaring it from a
// component mounted on / alone gives the homepage a correct self-canonical
// and leaves every other route with none, which is the safe default (a page
// with no canonical is indexed under its own URL).
//
// The link is appended to document.head rather than returned as JSX because
// React 18 renders elements where they sit -- inside the page body -- and
// rel="canonical" is only honoured inside <head>. The JSON-LD below has no
// such restriction and so is returned normally. Both depend on the crawler
// executing JavaScript, which is an accepted tradeoff for this site.
const SeoHead: React.FC = () => {
  const canonical = site.seo.url;

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = canonical;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [canonical]);

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
