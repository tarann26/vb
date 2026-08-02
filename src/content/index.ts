import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import drinksRaw from './drinks.json';
import pressRaw from './press.json';
import storyRaw from './story.json';
import menusRaw from './menus.json';
import copyRaw from './copy.json';
import sectionsRaw from './sections.json';
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
} from './types';
import { assertHours, assertSections, assertCopy, assertDrinkCategory, narrowSectionId } from './guards';

// Re-exported so existing importers (site.test.ts, copy.test.ts,
// sections.test.tsx) that import these three guards from `./index` keep
// working -- they were index.ts's own exports before their bodies moved to
// guards.ts. assertDrinkCategory, isSectionId and narrowSectionId were never
// part of index.ts's public surface and aren't re-exported here; a Worker
// (or any other future consumer) reaches them directly via `./guards`.
export { assertHours, assertSections, assertCopy };

export const site: SiteContent = {
  ...siteRaw,
  hours: siteRaw.hours.map(assertHours),
};
export const galleries: Galleries = galleriesRaw;
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
