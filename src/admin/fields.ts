// Per-field descriptors the dashboard's forms are generated from.
//
// The spec asks for forms "generated from the existing TypeScript types" --
// but types are erased at runtime, so nothing can literally read Dish or
// Copy to build a form. What CAN happen instead: declare each descriptor as
// a directly-annotated object literal against a type derived from
// src/content/types.ts, so `tsc -b` enforces its completeness and shape the
// same way it already enforces DISH_KEYS (src/content/__tests__/shape.test.ts:226)
// and SECTION_ID_SET (src/content/guards.ts:85). No codegen, no runtime
// schema library -- see task-2-brief.md for why Zod was rejected: the
// content layer's five guards and validateContent's nine rules are already
// the authority on what's valid, and every message they produce is written
// for the owner, not for a developer reading a schema library's output.
//
// Every descriptor below MUST stay a literal assigned directly to its
// annotated type (never built by spread, and never routed through an
// intermediate `let`/`const` of a wider type first) -- excess-property
// checking, which is what catches a field being REMOVED from a type without
// the descriptor being updated, only fires on a fresh literal in an
// annotated position.
import type {
  Dish,
  Drink,
  Article,
  Section,
  MenuFile,
  GalleryImage,
  Hours,
} from '../content/types';

// `kind` is a function of the field's *value type*, not a fixed union
// attached to the field's name. That is what makes a value-type change
// (not just a field being added or removed) a compile error: with a plain
// `Record<keyof T, FieldSpec>` (FieldSpec's `kind` a static union),
// `Dish.tags` going `string[]` -> `string` leaves `kind: 'tags'`
// syntactically legal on a field that is no longer a tag list -- confirmed
// directly (see task-2-report.md's Verify section) that Kind<V> is what
// turns that same edit into a compile error naming this file.
type Kind<V> =
  [V] extends [string] ? 'text' | 'textarea' | 'image' | 'select' | 'date' | 'readonly' :
  [V] extends [string | null] ? 'text' | 'image' | 'readonly' :
  [V] extends [string[]] ? 'tags' :
  [V] extends [boolean] ? 'toggle' :
  [V] extends [number] ? 'number' : never;

// A plain `options?: readonly string[]` on a single object type would let
// `kind: 'select'` compile with no `options` at all, or with a value that
// isn't even a member of `V` (e.g. `Drink['category']`'s
// `'mocktail' | 'cocktail' | 'wine'`) -- `options` was never parameterized
// by `V`, so nothing tied it to what `assertDrinkCategory`
// (src/content/guards.ts) actually accepts. Splitting into a discriminated
// union on `kind` fixes both: the 'select' branch requires `options:
// readonly V[]`, so a bogus entry or a missing `options` is a compile error,
// and the non-'select' branch has no `options` property to accidentally
// attach one to.
export type FieldSpec<V = unknown> =
  | { label: string; kind: Exclude<Kind<V>, 'select'>; help?: string }
  | { label: string; kind: Extract<Kind<V>, 'select'>; options: readonly V[]; help?: string };

// `Required<T>` makes an optional content field (e.g. `publishAt`) required
// *in the descriptor* -- the dashboard still needs a label and a kind for a
// field even though a particular dish is allowed to omit it.
export type FieldsOf<T> = { [K in keyof Required<T>]: FieldSpec<Required<T>[K]> };

// ---------------------------------------------------------------------------
// Dish, Drink, Article -- the three Schedulable content types.

export const DISH_FIELDS: FieldsOf<Dish> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell dishes apart -- changing it does not rename or relink anything else.',
  },
  name: { label: 'Name', kind: 'text' },
  description: { label: 'Description', kind: 'textarea' },
  image: { label: 'Photo', kind: 'image' },
  // types.ts is explicit that `tags` is authored on every dish but not
  // rendered by any component today. Say the same thing here: an editing
  // tool that doesn't must not let the owner assume this field is visible
  // to a diner, because it is not.
  tags: {
    label: 'Dietary tags',
    kind: 'tags',
    help: 'Recorded for later use but not shown anywhere on the site today -- no page renders these yet, so editing this list changes nothing a diner sees.',
  },
  publishAt: {
    label: 'Publish on',
    kind: 'date',
    help: 'Leave blank to publish immediately. Must be a real calendar date (YYYY-MM-DD).',
  },
};

export const DRINK_FIELDS: FieldsOf<Drink> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell drinks apart -- changing it does not rename or relink anything else.',
  },
  name: { label: 'Name', kind: 'text' },
  description: { label: 'Description', kind: 'textarea' },
  category: { label: 'Category', kind: 'select', options: ['mocktail', 'cocktail', 'wine'] },
  image: { label: 'Photo', kind: 'image', help: 'Optional -- leave empty for no photo.' },
  publishAt: {
    label: 'Publish on',
    kind: 'date',
    help: 'Leave blank to publish immediately. Must be a real calendar date (YYYY-MM-DD).',
  },
};

export const ARTICLE_FIELDS: FieldsOf<Article> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell articles apart -- changing it does not rename or relink anything else.',
  },
  title: { label: 'Title', kind: 'text' },
  publication: { label: 'Publication', kind: 'text' },
  date: { label: 'Published on', kind: 'date' },
  excerpt: { label: 'Excerpt', kind: 'textarea' },
  url: { label: 'Link', kind: 'text', help: "The article's full web address, or leave empty if it has none." },
  image: { label: 'Photo', kind: 'image' },
  publishAt: {
    label: 'Publish on',
    kind: 'date',
    help: 'Leave blank to publish immediately. Must be a real calendar date (YYYY-MM-DD).',
  },
};

// ---------------------------------------------------------------------------
// sections.json, menus.json, galleries.json, and site.json's hours[] rows.

export const SECTION_FIELDS: FieldsOf<Section> = {
  // `id` names WHICH homepage section this entry is. Editing it does not
  // rename a section -- it repoints this entry at a different one entirely,
  // which assertSections (src/content/guards.ts) rejects the moment the
  // result has a duplicate id or a missing one. Read-only here so a
  // dashboard write can't reach that state at all.
  id: { label: 'Section', kind: 'readonly' },
  enabled: {
    label: 'Shown on homepage',
    kind: 'toggle',
    help: '"hero" cannot be turned off -- the homepage always needs one, and the server refuses a write that disables it.',
  },
};

export const MENU_FIELDS: FieldsOf<MenuFile> = {
  id: { label: 'ID', kind: 'text', help: 'A short identifier used only to tell downloadable menus apart.' },
  label: { label: 'Label', kind: 'text' },
  file: { label: 'PDF file', kind: 'text' },
};

export const GALLERY_IMAGE_FIELDS: FieldsOf<GalleryImage> = {
  src: { label: 'Photo', kind: 'image' },
  alt: { label: 'Alt text', kind: 'text', help: 'Describes the photo for screen readers and search engines.' },
};

export const HOURS_FIELDS: FieldsOf<Hours> = {
  days: { label: 'Days', kind: 'tags', help: 'Two-letter day codes, e.g. Mo, Tu, We.' },
  opens: { label: 'Opens', kind: 'text', help: '24-hour time, e.g. 12:00.' },
  closes: { label: 'Closes', kind: 'text', help: '24-hour time, e.g. 23:30.' },
};

// ---------------------------------------------------------------------------
// A test the compiler actually enforces, not `expect(Object.keys(DISH_FIELDS)
// .sort()).toEqual([...])`: that assertion cannot fail on the defect it
// would claim to guard against -- mutate FieldsOf<Dish> above to
// `Record<string, FieldSpec>` and the guarantee is gone while an assertion
// like that stays green. It is also redundant with
// src/content/__tests__/shape.test.ts:226, which already makes "adding a
// field to Dish fails tsc" true today.
//
// This directive instead depends on the FieldsOf<Dish> annotation existing
// at all: right now, `{ id: DISH_FIELDS.id }` is missing five required
// keys, so the assignment is a real type error and @ts-expect-error
// suppresses it. If the FieldsOf<Dish> annotation is ever weakened or
// removed, the assignment stops erroring, @ts-expect-error becomes an
// unused directive, and `tsc -b` fails on THAT -- which is the point.
// @ts-expect-error a descriptor missing a key of Dish must not compile. If the
// FieldsOf<Dish> annotation is ever removed, this directive becomes unused and
// `tsc -b` fails -- which is the point.
const _incomplete: FieldsOf<Dish> = { id: DISH_FIELDS.id }; // eslint-disable-line @typescript-eslint/no-unused-vars -- existing only to be a compile-time assertion; see comment above.

// ---------------------------------------------------------------------------
// copy.json and site.json: `keyof Copy` is ten *objects* (nav, hero, ...,
// notFound), not leaf strings, and `keyof SiteContent` has the same problem
// (address, seo, hours are objects too). FieldsOf is meaningless applied to
// either directly. What both types actually need is a flat map keyed by
// dotted path -- which is also exactly where press.readArticle and
// footer.followLabel live.
//
// CopyLeafShape/SiteLeafShape are a hand-maintained flat *projection* of
// Copy/SiteContent's leaf strings, not something derived from those types by
// the compiler. A recursive template-literal type gated by the same Kind<V>
// test above (only descend into a nested object; stop and exclude a field
// whose value produces no Kind<V> at all, which is exactly what happens for
// Copy.nav.links and SiteContent.hours) could derive the dotted-path union
// generically instead of naming every leaf by hand. That route was
// considered and not pursued -- not because it's unsafe, but because a
// recursive template-literal type's compiler errors quote the whole
// expanded union at whatever recursion depth failed, which reads far worse
// than the one-line error a flat, hand-named type gives (`Property
// 'seo.locale' is missing in type '{...}'`). This codebase already prefers
// that trade in a structurally similar spot: SECTION_ID_SET
// (src/content/guards.ts) is a hand-written `Record<SectionId, true>`, not a
// derivation, for the same legible-errors-over-cleverness reason. Either
// way, what actually keeps this list honest is `fields.test.ts`, which
// walks the real, committed
// copy.json/site.json and asserts every leaf it finds has a matching entry
// here, and that no entry here is orphaned -- a runtime check a type-level
// derivation would still need, since Copy.nav.links being excluded from the
// *type* says nothing about whether copy.json's *values* still match every
// leaf this map claims to cover. That coupling to real content is
// deliberate: copy.json's and site.json's *shape* (which fields exist) is
// developer-owned even though their *values* are the owner's -- the same
// reasoning src/content/__tests__/shape.test.ts already applies to
// dishes/drinks/press.

interface CopyLeafShape {
  'nav.wordmark': string;
  'nav.instagramLabel': string;
  'nav.menuLabel': string;
  'hero.logoName': string;
  'hero.logoTagline': string;
  'hero.reservationsLabel': string;
  'hero.reserveButton': string;
  'atmosphere.heading': string;
  'food.heading': string;
  'drinks.heading': string;
  'drinks.intro': string;
  'drinks.mocktails': string;
  'drinks.cocktails': string;
  'drinks.wine': string;
  'press.heading': string;
  'press.intro': string;
  'press.readArticle': string;
  'press.viewAll': string;
  'visit.heading': string;
  'visit.navigateButton': string;
  'visit.mapTitle': string;
  'footer.hoursHeading': string;
  'footer.followLabel': string;
  'footer.reservationsLabel': string;
  'footer.rightsSuffix': string;
  'footer.instagramLabel': string;
  'footer.linkedinLabel': string;
  'blogsPage.title': string;
  'blogsPage.subtitle': string;
  'blogsPage.heading': string;
  'blogsPage.intro': string;
  'blogsPage.back': string;
  'blogsPage.previous': string;
  'blogsPage.next': string;
  'notFound.heading': string;
  'notFound.back': string;
}

export const COPY_FIELDS: FieldsOf<CopyLeafShape> = {
  'nav.wordmark': { label: 'Wordmark', kind: 'text' },
  'nav.instagramLabel': { label: 'Instagram link label', kind: 'text' },
  'nav.menuLabel': { label: 'Menu button label', kind: 'text' },
  'hero.logoName': { label: 'Hero logo name', kind: 'text' },
  'hero.logoTagline': { label: 'Hero logo tagline', kind: 'text' },
  'hero.reservationsLabel': { label: 'Reservations label', kind: 'text' },
  'hero.reserveButton': { label: 'Reserve button', kind: 'text' },
  'atmosphere.heading': { label: 'Gallery heading', kind: 'text' },
  'food.heading': { label: 'Menu heading', kind: 'text' },
  'drinks.heading': { label: 'Drinks heading', kind: 'text' },
  'drinks.intro': { label: 'Drinks intro', kind: 'textarea' },
  'drinks.mocktails': { label: 'Mocktails label', kind: 'text' },
  'drinks.cocktails': { label: 'Cocktails label', kind: 'text' },
  'drinks.wine': { label: 'Wine label', kind: 'text' },
  'press.heading': { label: 'Stories heading', kind: 'text' },
  'press.intro': { label: 'Stories intro', kind: 'textarea' },
  // Drives both the homepage teaser (BlogTeaser) and the /blogs page --
  // one field, two surfaces. Say so, or an edit meant for one page silently
  // also changes the other.
  'press.readArticle': {
    label: 'Read-article button',
    kind: 'text',
    help: 'This one button label is used on both the homepage teaser and the /blogs page -- editing it changes both.',
  },
  'press.viewAll': { label: 'View-all button', kind: 'text' },
  'visit.heading': { label: 'Visit heading', kind: 'text' },
  'visit.navigateButton': { label: 'Navigate button', kind: 'text' },
  'visit.mapTitle': { label: 'Map title', kind: 'text' },
  'footer.hoursHeading': { label: 'Footer hours heading', kind: 'text' },
  'footer.followLabel': {
    label: 'Follow-us label',
    kind: 'text',
    help: 'Keep the space between the two words a non-breaking space, the same as it is today -- publishing refuses an ordinary space there.',
  },
  'footer.reservationsLabel': { label: 'Footer reservations label', kind: 'text' },
  'footer.rightsSuffix': { label: 'Copyright suffix', kind: 'text' },
  'footer.instagramLabel': { label: 'Footer Instagram label', kind: 'text' },
  'footer.linkedinLabel': { label: 'Footer LinkedIn label', kind: 'text' },
  'blogsPage.title': { label: 'Stories page title', kind: 'text' },
  'blogsPage.subtitle': { label: 'Stories page subtitle', kind: 'text' },
  'blogsPage.heading': { label: 'Stories page heading', kind: 'text' },
  'blogsPage.intro': { label: 'Stories page intro', kind: 'textarea' },
  'blogsPage.back': { label: 'Back link', kind: 'text' },
  'blogsPage.previous': { label: 'Previous button', kind: 'text' },
  'blogsPage.next': { label: 'Next button', kind: 'text' },
  'notFound.heading': { label: '404 heading', kind: 'text' },
  'notFound.back': { label: '404 back link', kind: 'text' },
};

// SiteContent's `hours` field (Hours[]) is deliberately absent below -- it's
// an array of objects, not a single value any FieldSpec kind can describe;
// each row is edited through HOURS_FIELDS instead, the same split
// CopyLeafShape makes for Copy.nav.links.
interface SiteLeafShape {
  name: string;
  tagline: string;
  strapline: string;
  'address.street': string;
  'address.locality': string;
  'address.postalCode': string;
  'address.country': string;
  phones: string[];
  'whatsapp.number': string;
  'whatsapp.prefilledMessage': string;
  'socials.instagram': string;
  'socials.linkedin': string | null;
  'seo.title': string;
  'seo.description': string;
  'seo.keywords': string;
  'seo.ogImage': string;
  'seo.url': string;
  'seo.locale': string;
  copyrightYear: number;
}

// `name`, `tagline` and every `seo.*` field are `kind: 'readonly'`:
// src/test/head.test.ts pins nine strings in index.html (the static
// <title>, meta description/keywords/author, and the og:/twitter: tags)
// against these exact fields, because index.html has no server rendering of
// its own. Edit one here without also hand-editing index.html and the
// deploy fails -- and because a published change lands on `main` before the
// gate runs again, it stays failed for every subsequent publish of anything
// else until a developer fixes index.html. validateContent's own site rule
// (src/content/validate.ts) refuses the same fields server-side for the
// identical reason; `readonly` here is the UI half of that, not a
// substitute for it.
const SITE_READONLY_HELP =
  "Built into index.html's <title> and meta tags before the page ever loads, so changing this here fails the deploy until a developer also edits index.html by hand. Ask your developer.";

export const SITE_FIELDS: FieldsOf<SiteLeafShape> = {
  name: { label: 'Restaurant name', kind: 'readonly', help: SITE_READONLY_HELP },
  tagline: { label: 'Tagline', kind: 'readonly', help: SITE_READONLY_HELP },
  strapline: { label: 'Strapline', kind: 'text' },
  'address.street': { label: 'Street', kind: 'text' },
  'address.locality': { label: 'City', kind: 'text' },
  'address.postalCode': { label: 'Postal code', kind: 'text' },
  'address.country': { label: 'Country', kind: 'text' },
  phones: { label: 'Phone numbers', kind: 'tags' },
  'whatsapp.number': { label: 'WhatsApp number', kind: 'text' },
  'whatsapp.prefilledMessage': { label: 'WhatsApp prefilled message', kind: 'text' },
  'socials.instagram': { label: 'Instagram URL', kind: 'text' },
  'socials.linkedin': { label: 'LinkedIn URL', kind: 'text', help: 'Leave empty to hide the LinkedIn link entirely.' },
  'seo.title': { label: 'SEO title', kind: 'readonly', help: SITE_READONLY_HELP },
  'seo.description': { label: 'SEO description', kind: 'readonly', help: SITE_READONLY_HELP },
  'seo.keywords': { label: 'SEO keywords', kind: 'readonly', help: SITE_READONLY_HELP },
  'seo.ogImage': { label: 'Share image', kind: 'readonly', help: SITE_READONLY_HELP },
  'seo.url': { label: 'Canonical URL', kind: 'readonly', help: SITE_READONLY_HELP },
  'seo.locale': { label: 'Locale', kind: 'readonly', help: SITE_READONLY_HELP },
  copyrightYear: { label: 'Copyright year', kind: 'number' },
};
