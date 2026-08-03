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

// What must be flagged: the bare barrel ('../content' / './content'), its
// explicit /index forms (bare, .ts, .js), and any direct *.json subpath --
// every one of these resolves to src/content/index.ts, the build-time
// snapshot a migrated component must never read again, whether reached
// through a static import, a bare side-effect import, `export *`, or a
// dynamic `import()`. A bare trailing slash with nothing after it
// ('../content/') is included in the same group: it resolves to the exact
// same barrel, and an earlier version of this pattern (module-string only,
// no trailing-slash handling) let it through.
//
// What must NOT be flagged: any OTHER named submodule -- '../content/hours'
// and '../content/ContentContext' are real, legitimate imports in this tree
// today (Footer.tsx/SeoHead.tsx and every RENDERED_FILES component,
// respectively), and '../content/guards' is a real submodule the same shape
// even though nothing in RENDERED_FILES happens to import it yet. None of
// these re-export the build-time snapshot, so none may be flagged just for
// living under content/. `import type` is excluded the same way for the
// bare barrel itself (App.tsx:15's `import type { SectionId } from
// './content'` carries no runtime binding a provider could ever need to
// override).
//
// A reviewer of commit cf953d9 proved the ORIGINAL version of this file's
// matcher -- a single regex requiring the specifier to end in exactly
// `/content` -- missed four of these forms outright: `'../content/index'`,
// `'../content/index.js'`, a direct `'../content/copy.json'` subpath, and a
// dynamic `import('../content')`. Replacing a migrated component's read
// with `import { copy } from '../content/index';` -- a component that
// ignores any provider and renders the build-time snapshot regardless --
// left tsc at exit 0 and the entire suite green at the clean-tree number.
// The two real-files tests below (mutation-tested against exactly that
// substitution) and the table-driven test of the matcher itself (mirroring
// src/admin/__tests__/content.test.ts's own `importsContentSnapshot` table,
// the sibling this file is brought up to the standard of) close that gap.
const CONTENT_SNAPSHOT_PATH = /^\.{1,2}\/content(?:\/(?:index(?:\.(?:js|ts))?|[^'"/]+\.json)?)?$/;

// Anchored the same way src/test/bundle.test.ts's IMPORTS_ADMIN is: on the
// import/export/dynamic-import keyword immediately before the quoted
// specifier, not on the substring "/content" appearing anywhere in the file
// (a comment or an unrelated string literal could contain that substring
// without it being an import at all). Four separate patterns, not one
// combined regex, because the forms that need `(?!type\b)` (static named
// imports, which may legitimately be type-only) and the forms that never
// carry a binding at all (a bare side-effect import, a dynamic `import()`)
// don't share the same shape.
function importsContentValue(source: string): boolean {
  const STATIC_IMPORT = /^\s*import\s+(?!type\b)[^;]*from\s*['"]([^'"]+)['"]/gm;
  const EXPORT_FROM = /^\s*export\s+\*\s+from\s*['"]([^'"]+)['"]/gm;
  const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
  const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [STATIC_IMPORT, EXPORT_FROM, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) {
      if (CONTENT_SNAPSHOT_PATH.test(match[1])) return true;
    }
  }
  return false;
}

describe('every rendered component reads content through the context, not a direct import', () => {
  // The byte test (src/test/homepage-bytes.test.tsx) passes with zero
  // components migrated, because the default bundle's output is identical
  // to the direct import either way. The provider-sentinel test
  // (src/content/__tests__/ContentContext.test.tsx) passes with just one
  // component migrated. Neither can catch an eleven-file migration that
  // stalls at file twelve -- this is the only one of the three gates that
  // actually enumerates every file and fails by name.
  it('no rendered component imports a content value directly', () => {
    const offenders = RENDERED_FILES.filter((f) => importsContentValue(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  // The exclusion for `import type` and for named submodules (hours,
  // ContentContext) is not a blanket exemption -- proven directly against
  // real files that use both, rather than left as an assertion in a
  // comment. App.tsx:15 has a genuine type-only barrel import; every
  // RENDERED_FILES component has a genuine ContentContext import;
  // Footer.tsx and SeoHead.tsx have a genuine `../content/hours` import.
  // None of that should trip the matcher, and the test above already
  // proves it doesn't, across all thirteen real files at once.
  it('a rendered file with only legitimate content imports records none of them as offenders', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/import type \{ SectionId \} from '\.\/content';/);
    expect(importsContentValue(app)).toBe(false);

    const footer = readFileSync('src/components/Footer.tsx', 'utf8');
    expect(footer).toMatch(/from '\.\.\/content\/hours';/);
    expect(importsContentValue(footer)).toBe(false);
  });
});

describe('importsContentValue catches every barrel/snapshot import form, and only those', () => {
  const MUST_FLAG: Record<string, string> = {
    'bare barrel, two dots': `import { copy } from '../content';`,
    'bare barrel, one dot': `import { copy } from './content';`,
    'default import of the barrel': `import content from '../content';`,
    'bare side-effect import of the barrel': `import '../content';`,
    'export * from the barrel': `export * from '../content';`,
    'no-space from': `import content from'../content';`,
    'trailing slash, nothing after (resolves to the same barrel)': `import '../content/';`,
    'explicit /index': `import { dishes } from '../content/index';`,
    'explicit /index.ts': `import { dishes } from '../content/index.ts';`,
    'explicit /index.js': `import { dishes } from '../content/index.js';`,
    'direct JSON subpath (the review-found gap)': `import copyRaw from '../content/copy.json';`,
    'a different JSON subpath, one dot': `import site from './content/site.json';`,
    'dynamic import() of the bare barrel (the review-found gap)': `const c = await import('../content');`,
    'dynamic import() of /index': `const c = await import('../content/index');`,
    'prettier-wrapped multi-line': `import {\n  site,\n  dishes,\n} from\n  '../content';`,
    // A mixed import still carries a real value binding (`sections`), so it
    // is not exempt just because one of the imported names is type-only --
    // only a WHOLLY type-only import is (see MUST_NOT_FLAG's own type-only
    // entries, and the dedicated assertion below that checks both sides of
    // this distinction against the identical specifier).
    'mixed value+type import of the barrel is still flagged, not exempt': `import { sections, type SectionId } from '../content';`,
  };

  const MUST_NOT_FLAG: Record<string, string> = {
    'named submodule: hours': `import { formatDayRange } from '../content/hours';`,
    'named submodule: ContentContext': `import { useContent } from '../content/ContentContext';`,
    'named submodule: ContentContext, one dot': `import { useContent } from './content/ContentContext';`,
    'named submodule: guards': `import { assertSections } from '../content/guards';`,
    'import type of the bare barrel': `import type { SectionId } from '../content';`,
    'import type of the bare barrel, one dot': `import type { SectionId } from './content';`,
    'import type of a named submodule': `import type { Drink } from '../content';`,
    'the word "content" in a comment, not an import': `// fetches content from the route, never the snapshot`,
    'a content path inside an ordinary string literal, not an import specifier': `const msg = "see '../content/index' in the docs";`,
  };

  it.each(Object.entries(MUST_FLAG))('flags: %s', (_label, snippet) => {
    expect(importsContentValue(snippet)).toBe(true);
  });

  it.each(Object.entries(MUST_NOT_FLAG))('does not flag: %s', (_label, snippet) => {
    expect(importsContentValue(snippet)).toBe(false);
  });

  // The one case in MUST_NOT_FLAG that looks like it should flag but
  // shouldn't: a mixed import is flagged (proven above), but a WHOLLY
  // type-only import of the barrel is not, even though both contain the
  // exact same specifier text. Spelled out here as its own assertion so
  // the distinction is checked, not just implied by two entries in a table.
  it('distinguishes a value import of the barrel from a type-only import of the same specifier', () => {
    expect(importsContentValue(`import { sections } from '../content';`)).toBe(true);
    expect(importsContentValue(`import type { SectionId } from '../content';`)).toBe(false);
  });
});
