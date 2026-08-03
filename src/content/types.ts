import type { ImgHTMLAttributes, ReactNode } from 'react';

// Two-letter schema.org day codes, in week order. A plain `string` here would
// let a typo (e.g. "Xx") through both the type checker and the JSON import
// widening; see the runtime guard around `assertHours` in src/content/guards.ts
// for why a plain type annotation alone cannot catch that.
export type DayCode = 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';

export interface Hours {
  days: DayCode[]; // in week order, e.g. ['Mo', 'Tu', 'We']
  opens: string; // 24-hour "HH:MM"
  closes: string; // 24-hour "HH:MM"
}

export interface SiteContent {
  name: string;
  tagline: string;
  strapline: string;
  address: { street: string; locality: string; postalCode: string; country: string };
  phones: string[];
  whatsapp: { number: string; prefilledMessage: string };
  socials: { instagram: string; linkedin: string | null };
  hours: Hours[];
  seo: {
    title: string;
    description: string;
    keywords: string;
    ogImage: string;
    url: string;
    // Open Graph locale, e.g. "en_IN" -- underscore-separated language and
    // region, not the hyphenated BCP 47 form used by <html lang>.
    locale: string;
  };
  copyrightYear: number;
}

// Shared by Dish, Drink and Article -- an ISO `YYYY-MM-DD` date after which
// the item is live. Absent means "always published". Deliberately not on
// `Section`: see the comment on `assertSections` in src/content/guards.ts for
// why a future-dated section is rejected outright rather than supported.
// Filtering on this field happens in the Vite build (plugins/filter-unpublished.ts),
// never in the browser -- see that file for why.
//
// If a fourth type ever needs `publishAt` (`extends Schedulable`), it is
// NOT automatically filtered: `plugins/filter-unpublished.ts`'s
// `TARGET_SUFFIXES` is a separate, hand-maintained list of the three
// content files (dishes/drinks/press) this applies to today, with no
// compiler link back to this type. Adding `Schedulable` to a new type
// compiles clean and `tsc -b` stays silent while that type's build-time
// filtering silently never happens -- update `TARGET_SUFFIXES` too.
type Schedulable = {
  publishAt?: string;
};

export interface Dish extends Schedulable {
  id: string;
  name: string;
  description: string;
  image: string;
  // Transcribed from the menu's dietary legend (e.g. "nuts", "dairy", "gluten
  // free", "seafood"). Authored on every dish but deliberately not yet
  // rendered by any component -- whether/how to surface dietary tags on the
  // page is a design decision the owner has not made. Do not start rendering
  // this field, and do not assume it is live: any editing tool built against
  // this type must not treat `tags` as visible to a diner today.
  tags: string[];
}

export interface Drink extends Schedulable {
  id: string;
  name: string;
  description: string;
  category: 'mocktail' | 'cocktail' | 'wine';
  image: string | null;
}

export interface Article extends Schedulable {
  id: string;
  title: string;
  publication: string;
  date: string;
  excerpt: string;
  url: string | null;
  image: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface Galleries {
  atmosphere: GalleryImage[];
  ourStory: GalleryImage[];
  heroCollage: { src: string; className: string }[];
}

export interface StoryContent {
  heading: string;
  paragraphs: string[];
}

export interface MenuFile {
  id: string;
  label: string;
  file: string;
}

// Deliberately does not match the DOM anchor slugs used by `href` (e.g.
// 'atmosphere' vs '#gallery', 'press' vs '#blogs') -- both the SectionId and
// the anchor are independently load-bearing (the anchor is a live, possibly
// bookmarked URL) and neither may be renamed to line up with the other.
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'press' | 'visit';

export interface Section {
  id: SectionId;
  enabled: boolean;
}

export interface NavLink {
  href: string;
  label: string;
  // The SectionId this link scrolls to, so the nav can hide a link whose
  // section has been switched off. Not every section has one (hero and
  // drinks have no nav entry) -- this field is what a link points at, not
  // what every section has.
  section: SectionId;
}

export interface Copy {
  nav: { wordmark: string; links: NavLink[]; instagramLabel: string; menuLabel: string };
  hero: { logoName: string; logoTagline: string; reservationsLabel: string; reserveButton: string };
  atmosphere: { heading: string };
  food: { heading: string };
  drinks: { heading: string; intro: string; mocktails: string; cocktails: string; wine: string };
  press: { heading: string; intro: string; readArticle: string; viewAll: string };
  visit: { heading: string; navigateButton: string; mapTitle: string };
  footer: {
    hoursHeading: string; followLabel: string; reservationsLabel: string;
    rightsSuffix: string; instagramLabel: string; linkedinLabel: string;
  };
  blogsPage: { title: string; subtitle: string; heading: string; intro: string; back: string; previous: string; next: string };
  notFound: { heading: string; back: string };
}

// Plan 5 Task 2: ContentBundle lives here, not in src/content/ContentContext.ts
// (where Task 1 originally put it), because src/admin/__tests__/content.test.ts's
// SAFE_CONTENT_SUBMODULES whitelists only `types`, `validate`, `guards`,
// `publish` and `context` as imports src/admin/ may reach into src/content/
// for -- the modules that, unlike ContentContext.ts, import no JSON.
// EditMode.tsx (src/admin/) needs this type, with no transitive path to the
// build-time snapshot (src/content/index.ts) -- confirmed directly: an
// import of '../content/ContentContext' from src/admin/EditMode.tsx trips
// that guard, while '../content/types' does not.
//
// The raw React Context object and ContentProvider themselves live in
// ./context, NOT here (post-review Fix 5; see that module's own header
// comment for why) -- this module holds only types, and every reference to
// `react` below (`ReactNode`, `ImgHTMLAttributes`) is `import type`, which
// erases entirely at compile time. That is what makes this module safe for
// src/admin/ to import without dragging any runtime react (let alone the
// build-time content snapshot) into the lazy-loaded admin chunk -- or, via
// worker/index.ts -> ../src/content/validate -> ./guards -> ./types, into
// the Cloudflare Worker, which must never bundle react at all (see
// worker/__tests__/bundle.test.ts). ContentContext.ts re-exports
// ContentBundle unchanged below, so every existing caller (12 public
// components, three test files) is unaffected.
export type EditableTextPath = string;
export type EditableImagePath = string;

export interface ContentBundle {
  site: SiteContent;
  galleries: Galleries;
  dishes: Dish[];
  drinks: Drink[];
  press: Article[];
  story: StoryContent;
  menus: MenuFile[];
  copy: Copy;
  sections: Section[];
  // default: (_, v) => v -- see ContentContext.ts's defaultBundle.
  renderText(path: EditableTextPath, value: string): ReactNode;
  // default: (_, p) => createElement('img', p) -- see ContentContext.ts's defaultBundle.
  renderImage(path: EditableImagePath, props: ImgHTMLAttributes<HTMLImageElement>): ReactNode;
}
