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

// Shared by Dish, Drink, Article and (Plan 7, Task 1) TemplateSection -- an
// ISO `YYYY-MM-DD` date after which the item is live. Absent means "always
// published". Filtering on this field happens in the Vite build
// (plugins/filter-unpublished.ts), never in the browser -- see that file for
// why.
//
// Plan 7 Contradiction A, resolved: D9 says "items and sections carry an
// optional publishAt date"; the code used to say sections deliberately do
// not, because a future-dated `hero` (or any of the seven bespoke,
// component-backed sections) is ambiguous -- either a hard build failure
// (the filter plugin never ran on sections.json) or a silently heroless
// homepage (if a filter were ever added), and `enabled: false` already
// covers the founder's real scheduling need for those seven. That reasoning
// still holds, unchanged, for `BespokeSection` -- see `assertSections` in
// guards.ts, which still throws on a bespoke entry carrying this field.
//
// It does NOT hold for `TemplateSection`: a template section is her own
// content, created and deleted (well, disabled -- D6) freely, with no
// "homepage has no hero" failure mode possible, so scheduling one (a
// seasonal promotion section, say) is exactly D9's use case with none of the
// original ambiguity. `TemplateSection` below is the one place `Schedulable`
// now reaches beyond Dish/Drink/Article. `Section`'s own two variants
// therefore disagree on purpose: `BespokeSection` still forbids the field,
// `TemplateSection` allows it -- decided once, here, not per call site.
//
// Gap B, closed: every file whose committed shape can carry a
// `Schedulable`-typed value is named ONCE, in `SCHEDULABLE_FILES` below, not
// independently re-listed in `plugins/filter-unpublished.ts` and
// `worker/index.ts` the way the two used to drift. TypeScript's structural
// typing cannot itself detect "this interface extends Schedulable" as a
// compile-time discriminant (the field is optional, so every object type
// trivially "extends" `{ publishAt?: string }`) -- there is no `T extends
// Schedulable` conditional that a fifth type could fail. The real backstop
// is `src/content/__tests__/schedulable.test.ts`, which scans the REAL,
// committed content of every recognised content file for an object
// carrying a `publishAt` key and fails if that file is not listed here --
// so a developer who starts actually using `publishAt` on a new type
// without registering its file here gets a red test, not silence. What it
// cannot catch is a `Schedulable` type declared but never yet authored with
// a real `publishAt` value anywhere -- recorded here, not hidden.
export type Schedulable = {
  publishAt?: string;
};

// The single source both `plugins/filter-unpublished.ts` (build-time
// filtering) and `worker/index.ts` (the scheduled-rebuild cron's own
// bookkeeping) import from -- see `Schedulable`'s own comment above for why
// this collapsing of two previously-independent lists is what actually
// closes Plan 7's Gap B, and what a fifth Schedulable file needs updated.
export const SCHEDULABLE_FILES = ['dishes.json', 'drinks.json', 'press.json', 'sections.json'] as const;
export type SchedulableFile = (typeof SCHEDULABLE_FILES)[number];

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

// Plan 7, Task 1: the homepage's section list stops being seven fixed ids
// and becomes a list of two kinds -- bespoke sections rendered by name (the
// same seven above, unchanged) and template sections rendered by TYPE, with
// her own authored content. `kind` is the discriminant both variants below
// carry, which is what makes a `switch (section.kind)` (App.tsx,
// EditMode.tsx) exhaustive and a missing case a compile error, the same
// closure guarantee `SectionId` already gets from `SECTION_ID_SET`
// (guards.ts).
//
// `SectionId` itself stays closed at seven, on purpose (see this file's own
// comment on it, above) -- nothing she does can add an eighth. A template
// section's `id`, by contrast, is a free string SHE creates, so it carries
// no such closure and needs its own uniqueness rule instead (assertSections/
// assertPages in guards.ts: a template id must be unique among every
// section's id, bespoke and template alike, in the same list).
export interface BespokeSection {
  kind: 'bespoke';
  id: SectionId;
  enabled: boolean;
  // No `publishAt` here -- see `Schedulable`'s own comment (above) for why
  // that stays true for exactly the seven component-backed sections.
}

// The five templates named in the Plan 7 spec collapsed to four during
// implementation (Task 2, Step 1): "Logo grid" turned out to be "Gallery"
// with a different `layout`, not a structurally different content shape --
// B2B client/press logos are the same `{ heading, images }` list Atmosfera's
// horizontal scroller already is, just arranged in a grid instead of
// scrolled. Recorded here, not silently: the plan's own Step 1 says two of
// the five may merge and calls that expected.
export type TemplateType = 'text' | 'itemList' | 'gallery' | 'detailBlock';

// Every template's optional call-to-action -- D8: "every call to action is a
// WhatsApp deep link." `label` is the button's own visible text; `message`
// is pre-filled into the chat exactly the way `site.whatsapp.prefilledMessage`
// already is for Hero's own reservation button (Hero.tsx's
// `openReservationWhatsApp`) -- the phone NUMBER is never repeated here,
// deliberately: it always comes from `site.whatsapp.number`, the one place
// that number is authored, so a template button can never point at a
// different WhatsApp number than the rest of the site by a stray edit.
export interface TemplateWhatsAppButton {
  label: string;
  message: string;
}

// Text -- membership, catering intro, or any prose block. The same shape
// StoryContent already uses (`heading` + `paragraphs`), reused rather than
// reinvented.
export interface TextTemplateContent {
  heading: string;
  paragraphs: string[];
  whatsapp?: TemplateWhatsAppButton;
}

// Item list -- breads and dips, cheeseboards: photo + name + description,
// the same three fields FoodGallery already renders per dish.
export interface TemplateListItem {
  image: string;
  name: string;
  description: string;
}

export interface ItemListTemplateContent {
  heading: string;
  items: TemplateListItem[];
  whatsapp?: TemplateWhatsAppButton;
}

// Gallery -- product or venue photos (a horizontal scroller, PlaceGallery's
// own layout) OR the merged-in Logo grid use (B2B clients, press logos,
// partners), told apart by `layout` alone; both are the same
// `GalleryImage[]` list underneath. `GalleryImage` (declared above,
// `{ src, alt }`) is reused rather than a second, identical shape invented
// for this one field.
export interface GalleryTemplateContent {
  heading: string;
  layout: 'scroll' | 'grid';
  images: GalleryImage[];
  whatsapp?: TemplateWhatsAppButton;
}

// Detail block -- kids' classes: a few short facts (day/time/price, say)
// plus a button, distinct from Text's free-form paragraphs.
export interface TemplateFact {
  label: string;
  value: string;
}

export interface DetailBlockTemplateContent {
  heading: string;
  body: string;
  facts: TemplateFact[];
  whatsapp?: TemplateWhatsAppButton;
}

// The one place TemplateType's four members are paired with their own
// content shape -- `TemplateSection` below is DERIVED from this map (a
// mapped type distributed over `TemplateType`, not four hand-written union
// members), which is what makes growing `TemplateType` alone enough to
// force every downstream switch to notice. An earlier version of this file
// wrote `TemplateSection` as four separate literal union members instead,
// each spelling out its own `template: 'text'` / `template: 'itemList'` /
// etc -- confirmed directly this was NOT the same guarantee: adding a fifth
// member to `TemplateType` alone left that hand-written union at four
// members, unchanged, so `TEMPLATE_TYPE_SET` (guards.ts) and
// `assertTemplateContent`'s own exhaustiveness check correctly failed to
// compile, but `src/App.tsx`'s `renderSection` and
// `src/admin/EditMode.tsx`'s `renderDynamicSection` -- the switches this
// plan's own "prove it" instruction is actually about -- did not, because
// `section.template` was still typed over the OLD four-member union there,
// not the new five. Adding `TemplateContentMap[K]` here is what fixes it:
// a fifth `TemplateType` member with no matching `TemplateContentMap` entry
// is a compile error at THIS line, and once that's fixed, `TemplateSection`
// itself grows a fifth variant, which is what makes `section.template`'s
// type widen everywhere and turn every non-exhaustive switch over it red.
interface TemplateContentMap {
  text: TextTemplateContent;
  itemList: ItemListTemplateContent;
  gallery: GalleryTemplateContent;
  detailBlock: DetailBlockTemplateContent;
}

export type TemplateContent = TemplateContentMap[TemplateType];

// A discriminated union keyed on BOTH `kind` ('template', shared with
// BespokeSection above) and `template` (TemplateType) -- the second
// discriminant is what lets `content`'s type narrow automatically from a
// `switch (section.template)`, so a template component reading
// `section.content.paragraphs` (say) needs no cast: TypeScript already
// knows `section.template === 'text'` implies `section.content` is
// `TextTemplateContent`. Guards.ts keeps a `Record<TemplateType, true>` for
// the identical completeness guarantee at RUNTIME, the same `SECTION_ID_SET`
// idiom this file's own `SectionId` comment documents -- see that module
// for why an array literal would not give the same guarantee there either.
export type TemplateSection = {
  [K in TemplateType]: { kind: 'template'; id: string; enabled: boolean; publishAt?: string; template: K; content: TemplateContentMap[K] };
}[TemplateType];

export type Section = BespokeSection | TemplateSection;

// Plan 7, Task 1, Step 2: a whole new page, addressed by `slug` (validated
// server-side -- guards.ts's `assertPages`/validate.ts's `validatePage` --
// for URL-safety, uniqueness, and collision with a live route: `/`, `/blogs`,
// `/edit` and `/edit/manage` are all real routes a page slug must not be
// able to shadow). `sections` is the identical `Section[]` the homepage
// uses -- a page can freely include a template section, or even a bespoke
// one (reusing, say, `visit`'s map-and-hours block on a new page renders
// the same live content again, harmlessly) -- but a page's own list is NOT
// subject to sections.json's "all seven bespoke ids, hero enabled" homepage
// completeness rule; that rule is specific to the homepage's identity, not
// to an arbitrary page. See guards.ts's `assertPages` for exactly what IS
// still enforced per page (no duplicate id within that page's own list, the
// same per-template content/publishAt checks sections.json gets).
// Plan 7, Task 3, Step 3: a page's own metadata -- required, not optional.
// D9's own reasoning ("a homepage with no hero is worse than her being
// unable to produce one") applies here too: a page with no title or
// description is a page Google will not rank, and a required field is what
// keeps that state unreachable rather than merely discouraged. See
// PageSeoHead.tsx's own comment for exactly where these two strings end up
// (document.title, and the existing <meta name="description"> tag's
// content) and why neither is templated with the restaurant's own name --
// fully author-controlled, the same convention SiteContent.seo.title
// already uses.
export interface PageSeo {
  title: string;
  description: string;
}

export interface Page {
  slug: string;
  name: string;
  inNav: boolean;
  enabled: boolean;
  seo: PageSeo;
  sections: Section[];
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
  // Plan 7, Task 1: every page she has created, in `pages.json` order --
  // rendered by `/:slug` (Task 3), edited from the dashboard's own Pages
  // screen (Task 4). Empty today (see pages.json's own comment on why it
  // starts that way); present on ContentBundle from Task 1 onward so a
  // rendering surface added later needs no further plumbing here.
  pages: Page[];
  // default: (_, v) => v -- see ContentContext.ts's defaultBundle.
  renderText(path: EditableTextPath, value: string): ReactNode;
  // default: (_, p) => createElement('img', p) -- see ContentContext.ts's defaultBundle.
  renderImage(path: EditableImagePath, props: ImgHTMLAttributes<HTMLImageElement>): ReactNode;
  // Plan 6, Task 3: the ONE seam that lets `/edit` make a hero collage tile
  // selectable, movable and resizable while Hero.tsx (the public page)
  // keeps rendering `className` verbatim and stays entirely unaware
  // anything is editable -- the same "default is the identity, /edit
  // overrides it" shape `renderText`/`renderImage` already establish, not a
  // new pattern. `index` is the tile's position in `heroCollage` (what
  // `formatPlacement`'s eventual write-back needs to know which entry to
  // replace); `className` is that entry's CURRENT placement string, read
  // fresh on every render so a committed move is reflected immediately;
  // `image` is the already-rendered child (Hero.tsx's own
  // `content.renderImage(...)` call for this same tile), passed through
  // rather than re-derived, so this seam never needs to know how an image
  // is rendered.
  // default: (_, index, className, image) => createElement('div', { key: index, className: `${className} relative overflow-hidden` }, image)
  renderCollageTile(path: EditableImagePath, index: number, className: string, image: ReactNode): ReactNode;
}
