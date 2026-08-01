import React from 'react';
import { site } from '../content';

const SeoHead: React.FC = () => {
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
    openingHours: site.structuredDataHours,
    chef: { '@type': 'Person', name: 'Kamalika Anand' },
  };
  return <script type="application/ld+json">{JSON.stringify(json)}</script>;
};

export default SeoHead;
