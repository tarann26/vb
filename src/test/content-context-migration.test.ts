import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Every component HomePage/AppRoutes actually mounts, plus App.tsx itself --
// App.tsx:15 imports `sections`, and HomePage filters on it at :43, so
// missing App.tsx here would let /edit show the build-time on/off section
// list instead of a live one. Twelve components + App.tsx, matching Task 1's
// own file list in the plan.
//
// Six further components exist on disk but render nowhere in the app today
// -- AdminReservations, ReservationForm, ReservationPage, ChefGallery,
// NewsPress, SignatureMocktails. They are left out of this list on purpose:
// migrating dead code to read through a context nobody mounts around it
// proves nothing about edit mode, and src/test/no-dead-backend.test.ts
// already fails the moment any one of the six is deleted, so excluding them
// here does not put them at risk of quietly disappearing.
const RENDERED_FILES = [
  'src/App.tsx',
  'src/components/Hero.tsx',
  'src/components/OurStory.tsx',
  'src/components/PlaceGallery.tsx',
  'src/components/FoodGallery.tsx',
  'src/components/Drinks.tsx',
  'src/components/BlogTeaser.tsx',
  'src/components/VisitUs.tsx',
  'src/components/Footer.tsx',
  'src/components/NavBar.tsx',
  'src/components/BlogsPage.tsx',
  'src/components/NotFound.tsx',
  'src/components/SeoHead.tsx',
];

// Anchored the same way src/test/bundle.test.ts's IMPORTS_ADMIN is: on the
// import/from keyword immediately before the quoted specifier, not on the
// substring "/content" appearing anywhere in the file (a comment or an
// unrelated string literal could contain that substring without it being an
// import at all).
//
// `(?!type\b)` excludes only a genuinely *type-only* import (`import type
// { X } from '../content'`), which carries no runtime binding a provider
// could ever need to override. A mixed import like `import { sections, type
// SectionId } from './content'` still carries a value binding (`sections`)
// and must still be flagged -- and it is, because the lookahead only
// inspects the token immediately after `import `, which here is `{`, not
// `type`.
//
// The specifier must end in exactly `/content`, immediately before the
// closing quote, so `../content/hours` and `../content/ContentContext` --
// both real, legitimate imports in this tree -- are never flagged: neither
// string has a closing quote directly after the literal substring
// `/content`.
const IMPORTS_CONTENT_VALUE = /^\s*import\s+(?!type\b)[^;]*from\s*['"][^'"]*\/content['"]/m;

describe('every rendered component reads content through the context, not a direct import', () => {
  // The byte test (src/test/homepage-bytes.test.tsx) passes with zero
  // components migrated, because the default bundle's output is identical
  // to the direct import either way. The provider-sentinel test
  // (src/content/__tests__/ContentContext.test.tsx) passes with just one
  // component migrated. Neither can catch an eleven-file migration that
  // stalls at file twelve -- this is the only one of the three gates that
  // actually enumerates every file and fails by name.
  it('no rendered component imports a content value directly', () => {
    const offenders = RENDERED_FILES.filter((f) => IMPORTS_CONTENT_VALUE.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
