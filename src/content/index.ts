import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import drinksRaw from './drinks.json';
import pressRaw from './press.json';
import storyRaw from './story.json';
import menusRaw from './menus.json';
import copyRaw from './copy.json';
import sectionsRaw from './sections.json';
import pagesRaw from './pages.json';
import experiencesRaw from './experiences.json';
import postsRaw from './posts.json';
import type {
  SiteContent,
  Galleries,
  Dish,
  Drink,
  Article,
  StoryContent,
  MenuFile,
  Copy,
  Section,
  Page,
  Experience,
  Post,
} from './types';
import {
  assertHours,
  assertSections,
  assertPages,
  assertCopy,
  assertCollageTree,
  assertDrinkCategory,
  assertExperiences,
  assertPosts,
  narrowSectionId,
} from './guards';

// Re-exported so existing importers (site.test.ts, copy.test.ts,
// sections.test.tsx) that import these three guards from `./index` keep
// working -- they were index.ts's own exports before their bodies moved to
// guards.ts. assertDrinkCategory, isSectionId and narrowSectionId were never
// part of index.ts's public surface and aren't re-exported here; a Worker
// (or any other future consumer) reaches them directly via `./guards`.
// Plan 7, Task 1: assertPages joins them for the identical reason.
export { assertHours, assertSections, assertPages, assertCopy, assertCollageTree, assertExperiences };

export const site: SiteContent = {
  ...siteRaw,
  hours: siteRaw.hours.map(assertHours),
};
// `heroCollage` is a tree of splits, and the JSON module infers `kind` and
// `direction` as plain `string` and `children` as a union it cannot resolve
// recursively -- so a plain annotation cannot narrow it and a blind cast
// would wave through a one-child split, a mismatched `sizes` array, a zero
// size, a duplicate id or a photo with no source. `assertCollageTree`
// (guards.ts) narrows it with real runtime checks, so any of those fails the
// build at import time rather than rendering a broken hero.
export const galleries: Galleries = {
  ...galleriesRaw,
  heroCollage: assertCollageTree(galleriesRaw.heroCollage),
};
export const dishes: Dish[] = dishesRaw;
export const press: Article[] = pressRaw;
export const story: StoryContent = storyRaw;
export const menus: MenuFile[] = menusRaw;

// drinks.json's `category` field is a plain string in the JSON module's inferred
// type, wider than Drink['category']. A type annotation alone can't narrow it and
// a blind `as Drink[]` would silently accept a typo'd category. assertDrinkCategory
// (src/content/guards.ts) narrows via runtime equality checks instead, so an
// invalid category throws.
export const drinks: Drink[] = drinksRaw.map((raw, index) => ({
  ...raw,
  category: assertDrinkCategory(raw, index),
}));

export const sections: Section[] = assertSections(sectionsRaw);
export const pages: Page[] = assertPages(pagesRaw);
// Phase 3. Deliberately parsed with no cross-check against `pages` above,
// even though both are in scope right here -- see assertExperiences's own
// comment (guards.ts) for why a page toggled off must not throw at import
// time and block every subsequent publish.
export const experiences: Experience[] = assertExperiences(experiencesRaw);

// Phase 5. Parsed through assertPosts for the same reason experiences is:
// the JSON module's inferred type widens `type` and every block's `kind` to
// plain `string`, so a type annotation alone cannot narrow it and a blind
// cast would wave through an unknown block kind straight into a renderer
// that has no branch for it.
export const posts: Post[] = assertPosts(postsRaw);

const copyWithNarrowedNavSections = {
  ...copyRaw,
  nav: {
    ...copyRaw.nav,
    links: copyRaw.nav.links.map((link, i) => ({
      ...link,
      section: narrowSectionId(link.section, `nav.links[${i}]`),
    })),
  },
};

// `satisfies Copy` restores the compile-time structural check that
// `assertCopy`'s `unknown` parameter (needed so the test fixtures in
// copy.test.ts, which are deliberately not shaped like Copy, can still be
// passed to it) otherwise erases. Without it, a copy.json missing an entire
// section still type-checks -- `assertNonBlank` only walks keys that are
// present, so a missing section is invisible to the runtime guard too, and
// the failure mode becomes a browser-time crash instead of a build failure.
export const copy: Copy = assertCopy(copyWithNarrowedNavSections satisfies Copy);

export * from './types';
