import {
  MAX_COLLAGE_DEPTH,
  MAX_COLLAGE_PHOTOS,
  MIN_SPLIT_CHILDREN,
  collageDepth,
  collageNodeIds,
  countCollagePhotos,
  isCollageNodeKind,
  isNormalizedSizes,
  isSplitDirection,
} from './collage';
import type {
  CollageNode,
  Hours,
  Copy,
  Section,
  BespokeSection,
  TemplateSection,
  TemplateType,
  TemplateContent,
  TemplateWhatsAppButton,
  TextTemplateContent,
  ItemListTemplateContent,
  GalleryTemplateContent,
  DetailBlockTemplateContent,
  Page,
  SectionId,
  Dish,
  Drink,
  Article,
  Award,
  Experience,
} from './types';

// ---------------------------------------------------------------------------
// The key each record type is allowed to carry, one set per type.
//
// `Record<keyof T, true>` rather than a hand-maintained `string[]`: if `Dish`
// gains a field, this object stops compiling until the field is listed here
// too, so a set can never quietly fall behind the type it describes. That is
// the same compile-time completeness `SECTION_ID_SET` below already relies
// on.
//
// They live in this module, exported, because TWO places need the identical
// answer and had already given different ones. `shape.test.ts` uses them to
// fail the BUILD when a committed content file carries a key its type does
// not have; `validate.ts` uses them to refuse that same key at the WRITE
// boundary, before the Worker can commit it. Removing the scheduling
// subsystem is what exposed the gap: it made `publishAt` unknown to the
// build gate while leaving it silently accepted by the validator, so a
// dashboard tab still running the old code could publish a `publishAt`, be
// told the commit landed, and leave `main` failing its own deploy gate --
// after which every later publish of anything else failed too, with no
// control anywhere in the dashboard able to clear the field. One definition
// consulted by both ends is what makes that divergence unreachable rather
// than merely fixed once.
export const DISH_KEYS: Record<keyof Dish, true> = {
  id: true,
  name: true,
  description: true,
  image: true,
  tags: true,
};

export const DRINK_KEYS: Record<keyof Drink, true> = {
  id: true,
  name: true,
  description: true,
  category: true,
  image: true,
};

export const ARTICLE_KEYS: Record<keyof Article, true> = {
  id: true,
  title: true,
  publication: true,
  date: true,
  excerpt: true,
  url: true,
  image: true,
};

// Phase 2, Task 9: the Awards pilot's own key set, same idiom, same two
// consumers (a build-time shape test and validate.ts's write-boundary
// check) -- except there is no build-time shape test for this one file:
// awards.json is never compiled into a bundle (it is D1_ONLY_PATHS,
// worker/store.ts), so validate.ts's own validateAwards is the only place
// this set is ever consulted at all.
export const AWARD_KEYS: Record<keyof Award, true> = {
  id: true,
  title: true,
  awardedBy: true,
  year: true,
  image: true,
};

// Phase 3's own key set, same idiom, same two consumers (this module's
// import-time assertExperiences and validate.ts's write-boundary
// validateExperiences) as AWARD_KEYS above -- except experiences.json IS a
// build-time shape test's concern (unlike awards.json), because it is
// committed JSON on the GitHub store rather than D1: see Experience's own
// comment (types.ts) for why.
export const EXPERIENCE_KEYS: Record<keyof Experience, true> = {
  id: true,
  title: true,
  description: true,
  image: true,
  link: true,
  comingSoon: true,
};

export const BESPOKE_SECTION_KEYS: Record<keyof BespokeSection, true> = {
  kind: true,
  id: true,
  enabled: true,
};

// `keyof` a union is the INTERSECTION of its members' keys, and
// `TemplateSection` is a mapped type distributed over `TemplateType` whose
// four members all carry exactly these five -- so this stays complete
// however many templates exist, and a template variant that ever gained a
// key of its own would make this stop compiling rather than silently start
// accepting nothing new.
export const TEMPLATE_SECTION_KEYS: Record<keyof TemplateSection, true> = {
  kind: true,
  id: true,
  enabled: true,
  template: true,
  content: true,
};

export const PAGE_KEYS: Record<keyof Page, true> = {
  slug: true,
  name: true,
  inNav: true,
  enabled: true,
  seo: true,
  sections: true,
};

// `hasOwnProperty.call`, not `key in knownKeys`: every one of the sets above
// is an object literal, so `'toString' in DISH_KEYS` is true through the
// prototype chain and an `in` check would wave a `toString` key through as
// known. An earlier copy of this helper (in shape.test.ts, before it moved
// here) used `in` for exactly that reason -- it read as equivalent.
export function unknownKeys(item: object, knownKeys: Record<string, true>): string[] {
  return Object.keys(item).filter((key) => !Object.prototype.hasOwnProperty.call(knownKeys, key));
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // 24-hour "HH:MM"

// site.json's `hours[].days` field is a plain string[] in the JSON module's
// inferred type, wider than Hours['days'] (DayCode[]). As with drinks.category
// below, an annotation alone can't narrow it and a blind `as` would silently
// accept a typo'd day code (e.g. "Xx", which hours.ts's WEEK_ORDER.indexOf
// would read as -1 and misreport as contiguous with Monday), an empty `days`
// array, or a malformed opens/closes string. This guard narrows via runtime
// checks instead, so any of those throw at import time rather than rendering
// "undefined" text or bad JSON-LD to a customer.
export function assertHours(raw: { days: string[]; opens: string; closes: string }): Hours {
  if (raw.days.length === 0) {
    throw new Error('content/site.json: an hours entry has an empty "days" array');
  }
  const days = raw.days.map((day) => {
    if (
      day !== 'Mo' &&
      day !== 'Tu' &&
      day !== 'We' &&
      day !== 'Th' &&
      day !== 'Fr' &&
      day !== 'Sa' &&
      day !== 'Su'
    ) {
      throw new Error(`content/site.json: invalid day code "${day}" in hours entry`);
    }
    return day;
  });
  if (!TIME_PATTERN.test(raw.opens)) {
    throw new Error(`content/site.json: invalid "opens" time "${raw.opens}", expected 24-hour HH:MM`);
  }
  if (!TIME_PATTERN.test(raw.closes)) {
    throw new Error(`content/site.json: invalid "closes" time "${raw.closes}", expected 24-hour HH:MM`);
  }
  return { days, opens: raw.opens, closes: raw.closes };
}

type DrinkCategory = Drink['category'];

// drinks.json's `category` field is a plain string in the JSON module's inferred
// type, wider than Drink['category']. A type annotation alone can't narrow it and
// a blind `as Drink[]` would silently accept a typo'd category. This guard
// narrows via runtime equality checks instead, so an invalid category throws.
//
// Extracted from an inline arrow inside `drinksRaw.map(...)` in index.ts so it
// can be unit-tested and reused on its own -- `index` is the position in
// drinksRaw, folded into the error message alongside the offending drink's
// `id` so either is enough to find the bad entry in drinks.json.
export function assertDrinkCategory(raw: unknown, index: number): DrinkCategory {
  const { category, id } = raw as { category?: unknown; id?: unknown };
  if (category !== 'mocktail' && category !== 'cocktail' && category !== 'wine') {
    throw new Error(
      `content/drinks.json: invalid category "${category}" for drink "${id}" at [${index}]`,
    );
  }
  return category;
}

// The single runtime source of truth for the SectionId union -- TS erases
// the type at runtime, so isSectionId/assertSections/narrowSectionId below
// all check membership and completeness against this rather than each
// re-deriving their own copy of the eight literals.
//
// Deliberately a `Record<SectionId, true>`, not a plain `SectionId[]`
// literal: an array literal only gets each *element* checked against
// SectionId, never that every member of the union is present, so it would
// silently stop enforcing completeness the moment SectionId grows (e.g. in
// Plan 7) without this file being touched -- confirmed by adding a member
// to SectionId and fixing only what `tsc -b` flagged (App.tsx's
// SECTION_COMPONENTS and the test file's MARKER/SECTION_SELECTOR): the
// array-literal version left `tsc -b` clean and the suite green with the
// new section entirely unenforced by assertSections. A record literal
// missing a key fails to compile, matching the guarantee
// SECTION_COMPONENTS/MARKER/SECTION_SELECTOR already have.
//
// `Object.keys` is typed `string[]` regardless of the object it's called
// on -- a known TS limitation -- so recovering a `SectionId[]` needs one
// narrowing assertion here. This is not a laundering cast the way
// `link.section as SectionId` was: that cast hid a real gap (a value that
// was never checked against SectionId at all), where here the object
// literal above has already been fully checked against SectionId by the
// time this line runs -- there's nothing left for the assertion to hide.
const SECTION_ID_SET: Record<SectionId, true> = {
  hero: true,
  ourStory: true,
  atmosphere: true,
  food: true,
  drinks: true,
  press: true,
  awards: true,
  visit: true,
};
const SECTION_IDS = Object.keys(SECTION_ID_SET) as SectionId[];

// Shared by assertSections (validating sections.json's `id`) and assertCopy
// (validating copy.json's `nav.links[].section`) -- both need to know
// whether an arbitrary value is one of the eight real SectionIds.
export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value);
}

// Plan 7, Task 1: the same `Record<TemplateType, true>` idiom as
// SECTION_ID_SET above, and for the identical reason -- an array literal
// only gets each element checked against TemplateType, never that every
// member of the union is present, so it would silently stop enforcing
// completeness the moment TemplateType grows a fifth member. A record
// literal missing a key fails to compile.
const TEMPLATE_TYPE_SET: Record<TemplateType, true> = {
  text: true,
  itemList: true,
  gallery: true,
  detailBlock: true,
};
const TEMPLATE_TYPES = Object.keys(TEMPLATE_TYPE_SET) as TemplateType[];

export function isTemplateType(value: unknown): value is TemplateType {
  return typeof value === 'string' && (TEMPLATE_TYPES as readonly string[]).includes(value);
}

function assertWhatsAppButton(raw: unknown, context: string): TemplateWhatsAppButton | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`content: ${context} whatsapp button must be an object`);
  }
  const { label, message } = raw as { label?: unknown; message?: unknown };
  if (typeof label !== 'string' || typeof message !== 'string') {
    throw new Error(`content: ${context} whatsapp button needs a "label" and a "message"`);
  }
  return { label, message };
}

// Structural, build-safety checks only -- enough that a malformed
// TemplateContent can never crash a template component mid-render (every
// field a template reads is guaranteed to exist, at the right primitive
// type). The rich, named, owner-facing messages ("this text section needs a
// heading") live in src/content/validate.ts's own per-template validators,
// built ON TOP of this the same way validateDish/validateDrink already
// build on assertHours/assertDrinkCategory -- see validate.ts's own header
// comment for why that split, not a second competing definition, is the
// rule in this codebase.
function assertTemplateContent(template: TemplateType, raw: unknown, context: string): TemplateContent {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`content: ${context} needs content`);
  }
  const content = raw as Record<string, unknown>;
  const whatsapp = assertWhatsAppButton(content.whatsapp, context);
  if (template === 'text') {
    if (typeof content.heading !== 'string') throw new Error(`content: ${context} needs a "heading"`);
    if (!Array.isArray(content.paragraphs) || content.paragraphs.some((p) => typeof p !== 'string')) {
      throw new Error(`content: ${context} needs a "paragraphs" list of strings`);
    }
    return { heading: content.heading, paragraphs: content.paragraphs as string[], whatsapp };
  }
  if (template === 'itemList') {
    if (typeof content.heading !== 'string') throw new Error(`content: ${context} needs a "heading"`);
    if (!Array.isArray(content.items)) throw new Error(`content: ${context} needs an "items" list`);
    const items = content.items.map((item, i) => {
      if (!item || typeof item !== 'object') throw new Error(`content: ${context} items[${i}] is not an object`);
      const { image, name, description } = item as { image?: unknown; name?: unknown; description?: unknown };
      if (typeof image !== 'string' || typeof name !== 'string' || typeof description !== 'string') {
        throw new Error(`content: ${context} items[${i}] needs an "image", a "name" and a "description"`);
      }
      return { image, name, description };
    });
    return { heading: content.heading, items, whatsapp };
  }
  if (template === 'gallery') {
    if (typeof content.heading !== 'string') throw new Error(`content: ${context} needs a "heading"`);
    if (content.layout !== 'scroll' && content.layout !== 'grid') {
      throw new Error(`content: ${context} "layout" must be "scroll" or "grid"`);
    }
    if (!Array.isArray(content.images)) throw new Error(`content: ${context} needs an "images" list`);
    const images = content.images.map((image, i) => {
      if (!image || typeof image !== 'object') throw new Error(`content: ${context} images[${i}] is not an object`);
      const { src, alt } = image as { src?: unknown; alt?: unknown };
      if (typeof src !== 'string' || typeof alt !== 'string') {
        throw new Error(`content: ${context} images[${i}] needs a "src" and "alt"`);
      }
      return { src, alt };
    });
    return { heading: content.heading, layout: content.layout, images, whatsapp };
  }
  // template === 'detailBlock' -- the last TEMPLATE_TYPES member. Written as
  // a final `if`, not an `else`, so a fifth TemplateType added without a
  // branch here falls through to the `never` assignment just below and
  // fails to compile, the same exhaustiveness TEMPLATE_TYPE_SET's own
  // comment documents for the record literal above.
  if (template === 'detailBlock') {
    if (typeof content.heading !== 'string') throw new Error(`content: ${context} needs a "heading"`);
    if (typeof content.body !== 'string') throw new Error(`content: ${context} needs a "body"`);
    if (!Array.isArray(content.facts)) throw new Error(`content: ${context} needs a "facts" list`);
    const facts = content.facts.map((fact, i) => {
      if (!fact || typeof fact !== 'object') throw new Error(`content: ${context} facts[${i}] is not an object`);
      const { label, value } = fact as { label?: unknown; value?: unknown };
      if (typeof label !== 'string' || typeof value !== 'string') {
        throw new Error(`content: ${context} facts[${i}] needs a "label" and a "value"`);
      }
      return { label, value };
    });
    return { heading: content.heading, body: content.body, facts, whatsapp };
  }
  const _exhaustive: never = template;
  throw new Error(`content: ${context} has an unknown template "${String(_exhaustive)}"`);
}

// The one function both assertSections (sections.json, the homepage) and
// assertPages (pages.json) parse each entry of their own `Section[]`
// through -- everything a single entry needs checked (kind, id shape and
// collision, enabled, and -- for a template entry -- template type and
// content shape) lives here exactly once. `seenIds` is caller-owned
// (sections.json tracks one Set across the whole homepage; assertPages
// starts a fresh one per page) so id collision is scoped correctly in each
// caller without this function knowing which caller it is.
function assertSectionEntry(raw: unknown, index: number, seenIds: Set<string>, fileLabel: string): Section {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`content/${fileLabel}: entry [${index}] is not an object`);
  }
  const entry = raw as Record<string, unknown>;
  const { kind, id, enabled } = entry;

  if (kind === 'bespoke') {
    if (!isSectionId(id)) {
      throw new Error(`content/${fileLabel}: invalid section id "${String(id)}" at [${index}]`);
    }
    if (seenIds.has(id)) {
      throw new Error(`content/${fileLabel}: duplicate section id "${id}"`);
    }
    seenIds.add(id);
    if (typeof enabled !== 'boolean') {
      throw new Error(`content/${fileLabel}: "enabled" must be a boolean for section "${id}"`);
    }
    const result: BespokeSection = { kind: 'bespoke', id, enabled };
    return result;
  }

  if (kind === 'template') {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`content/${fileLabel}: a template section at [${index}] needs an id`);
    }
    // C1 review fix: her own free-text section name is the one thing this
    // guard lets her author that later becomes part of a machine-parsed
    // PATH -- template-section-paths.ts's own SECTION_CONTENT_PATH splits
    // `sections.<id>.content.<rest>` on the FIRST dot after "sections.", so
    // an id containing a dot (e.g. "Menu v2.0") makes that split ambiguous.
    // Widening that regex is not the fix (`^sections\.(.+)\.content\.(.+)$`
    // is itself ambiguous the moment an id contains the literal substring
    // ".content."); refusing the id here, before it can ever reach
    // sections.json, is. Confirmed directly: with this check removed, a
    // section named "Menu v2.0" passes both this guard and validateContent,
    // renders contentEditable at /edit (EditMode.tsx's own `sectionsLoaded`
    // gate can't tell the difference), and every edit to it is silently
    // discarded -- setCopyText's own malformed-namespace guard resolves
    // `copy['sections']` (undefined) and returns `copy` unchanged, with no
    // error and nothing on screen to say so.
    //
    // Reusing isUrlSafeSlug -- the exact rule a page's own `slug` already
    // enforces (below) -- rather than a new, narrower "just block dots"
    // check: a slug is already proven safe to embed in a dotted path (its
    // own [a-z0-9-] alphabet excludes "." along with everything else), and
    // sharing the rule is what keeps it from going stale in only one
    // direction, the same reasoning this file's own header comment gives
    // for building validate.ts on top of this module rather than
    // duplicating it.
    if (!isUrlSafeSlug(id)) {
      throw new Error(
        `content/${fileLabel}: template section id "${id}" -- use letters a-z, numbers and hyphens only, e.g. "our-menu"`,
      );
    }
    // A template id colliding with one of the eight closed SectionIds is
    // refused here, not merely discouraged -- App.tsx's/EditMode.tsx's own
    // dispatch keys every REACT list `key` on `section.id` regardless of
    // `kind`, so two sections sharing one id (a bespoke `visit` and a
    // template she happened to name `visit`) would silently collide there.
    if (isSectionId(id)) {
      throw new Error(`content/${fileLabel}: template section id "${id}" collides with a built-in section`);
    }
    if (seenIds.has(id)) {
      throw new Error(`content/${fileLabel}: duplicate section id "${id}"`);
    }
    seenIds.add(id);
    if (typeof enabled !== 'boolean') {
      throw new Error(`content/${fileLabel}: "enabled" must be a boolean for section "${id}"`);
    }
    const { template } = entry;
    if (!isTemplateType(template)) {
      throw new Error(`content/${fileLabel}: unknown template "${String(template)}" for section "${id}"`);
    }
    const content = assertTemplateContent(template, entry.content, `section "${id}"`);
    // The five-member discriminated union (TemplateSection) is reconstructed
    // through a per-branch literal rather than one shared object spread, so
    // `content`'s already-narrowed shape (assertTemplateContent's own return
    // type is a plain union, not yet tied to `template`) lines back up with
    // its sibling `template` literal the same way TemplateSection's own
    // declaration (types.ts) pairs them.
    switch (template) {
      case 'text':
        return { kind: 'template', id, enabled, template, content: content as TextTemplateContent };
      case 'itemList':
        return { kind: 'template', id, enabled, template, content: content as ItemListTemplateContent };
      case 'gallery':
        return { kind: 'template', id, enabled, template, content: content as GalleryTemplateContent };
      case 'detailBlock':
        return { kind: 'template', id, enabled, template, content: content as DetailBlockTemplateContent };
    }
  }

  throw new Error(`content/${fileLabel}: entry [${index}] needs a "kind" of "bespoke" or "template"`);
}

// sections.json's `id` field is a plain string in the JSON module's inferred
// type, wider than Section['id'] -- same widening problem as drinks.category
// above. A blind cast would silently accept a typo'd id, permanently
// orphaning that section's component (App.tsx's dispatch map would never be
// reached for it) or, worse, colliding with a real one. This guard narrows
// and validates via `assertSectionEntry` above instead.
//
// Two rules apply on top of what assertSectionEntry itself already checks
// per entry (valid/unique id, valid enabled, and -- Plan 7 -- a valid
// template and content shape): every SectionId must appear exactly once
// among the BESPOKE entries (a dashboard write that drops one silently
// deletes that section from the homepage -- this used to only be checked
// for `hero`, which meant a partial write losing e.g. `visit` type-checked
// and passed the old guard), and `hero` specifically must be enabled. A
// homepage with no hero is not a state this plan supports, and the founder
// disabling it by a single accidental toggle is worse than her being unable
// to.
export function assertSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) {
    throw new Error('content/sections.json: expected an array of sections');
  }
  const seen = new Set<string>();
  const result = raw.map((entry, i) => assertSectionEntry(entry, i, seen, 'sections.json'));
  const bespokeIds = new Set(result.filter((s): s is BespokeSection => s.kind === 'bespoke').map((s) => s.id));
  const missing = SECTION_IDS.filter((id) => !bespokeIds.has(id));
  if (missing.length > 0) {
    throw new Error(`content/sections.json: missing required section(s) "${missing.join('", "')}"`);
  }
  const hero = result.find((section) => section.kind === 'bespoke' && section.id === 'hero') as
    | BespokeSection
    | undefined;
  if (!hero?.enabled) {
    throw new Error('content/sections.json: "hero" cannot be disabled');
  }
  return result;
}

// Plan 7, Task 1, Step 2: pages.json's own guard. Deliberately NOT the
// "every SectionId present, hero enabled" completeness rule assertSections
// enforces above -- that rule is about the HOMEPAGE's identity, not about
// what a page may contain; a page's own `sections` list may be empty, may
// contain only template sections, or may reuse a bespoke one, freely (see
// Page's own comment, types.ts). What IS still enforced, per page: a
// well-formed, URL-safe, unique `slug`; a name; the two booleans; and every
// one of that page's own sections passing `assertSectionEntry` with a FRESH
// `seenIds` Set per page (an id may repeat across two different pages, or
// between a page and the homepage, without conflict -- each page, and the
// homepage, is its own namespace).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The routes that already exist and must never be shadowed by `/:slug`
// (Task 3) -- `blogs` and `edit` are the two single-segment ones a page
// slug could actually collide with; `/edit/manage` is a second path
// segment, structurally unreachable from a single `/:slug` route, but
// `edit` alone already blocks a page from being named "edit" in the first
// place, which is what would be confusing regardless of routing mechanics.
export const RESERVED_PAGE_SLUGS = new Set(['blogs', 'edit']);

export function isUrlSafeSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}

export function assertPages(raw: unknown): Page[] {
  if (!Array.isArray(raw)) {
    throw new Error('content/pages.json: expected an array of pages');
  }
  const seenSlugs = new Set<string>();
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`content/pages.json: entry [${i}] is not an object`);
    }
    const { slug, name, inNav, enabled, seo, sections } = entry as Record<string, unknown>;
    if (!isUrlSafeSlug(slug)) {
      throw new Error(`content/pages.json: "${String(slug)}" is not a URL-safe slug at [${i}]`);
    }
    if (RESERVED_PAGE_SLUGS.has(slug)) {
      throw new Error(`content/pages.json: slug "${slug}" collides with an existing route`);
    }
    if (seenSlugs.has(slug)) {
      throw new Error(`content/pages.json: duplicate slug "${slug}"`);
    }
    seenSlugs.add(slug);
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`content/pages.json: page "${slug}" needs a name`);
    }
    if (typeof inNav !== 'boolean') {
      throw new Error(`content/pages.json: "inNav" must be a boolean for page "${slug}"`);
    }
    if (typeof enabled !== 'boolean') {
      throw new Error(`content/pages.json: "enabled" must be a boolean for page "${slug}"`);
    }
    // Plan 7, Task 3, Step 3: required, not optional -- see PageSeo's own
    // comment (types.ts) for why a page with no title/description is a
    // state this guard refuses to produce rather than merely discourages.
    const seoRecord = (seo ?? {}) as Record<string, unknown>;
    if (typeof seoRecord.title !== 'string' || seoRecord.title.trim().length === 0) {
      throw new Error(`content/pages.json: page "${slug}" needs an SEO title`);
    }
    if (typeof seoRecord.description !== 'string' || seoRecord.description.trim().length === 0) {
      throw new Error(`content/pages.json: page "${slug}" needs an SEO description`);
    }
    if (!Array.isArray(sections)) {
      throw new Error(`content/pages.json: page "${slug}" needs a "sections" list`);
    }
    const pageSeenIds = new Set<string>();
    const parsedSections = sections.map((section, si) =>
      assertSectionEntry(section, si, pageSeenIds, `pages.json page "${slug}"`),
    );
    return {
      slug,
      name,
      inNav,
      enabled,
      seo: { title: seoRecord.title, description: seoRecord.description },
      sections: parsedSections,
    };
  });
}

// Phase 3's own import-time guard, same idiom as assertPages above -- it
// rebuilds each entry from named keys (EXPERIENCE_KEYS, guards.ts) so a stray
// key in a hand-edited experiences.json can never reach runtime, and throws
// with a "content/experiences.json: ..." prefixed message naming the
// offending index.
//
// Deliberately does NOT cross-check `link` against pages.json, even though
// this function runs from index.ts, which imports every content file and
// could reach `pages` easily. See validateExperiences (validate.ts) for the
// full argument -- the short form is that a page toggled off in the
// dashboard would then make an experiences.json that was valid yesterday
// throw at import time today, failing the build and blocking every
// subsequent publish of every other file, with no control the owner can
// reach to recover. The resolution happens at render time instead (Task 3).
export function assertExperiences(raw: unknown): Experience[] {
  if (!Array.isArray(raw)) {
    throw new Error('content/experiences.json: expected an array of experiences');
  }
  const seenIds = new Set<string>();
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`content/experiences.json: entry [${i}] is not an object`);
    }
    const { id, title, description, image, link, comingSoon } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`content/experiences.json: entry [${i}] needs an id`);
    }
    if (seenIds.has(id)) {
      throw new Error(`content/experiences.json: duplicate id "${id}" at [${i}]`);
    }
    seenIds.add(id);
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new Error(`content/experiences.json: "${id}" needs a title`);
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new Error(`content/experiences.json: "${id}" needs a description`);
    }
    if (typeof image !== 'string' || image.trim().length === 0) {
      throw new Error(`content/experiences.json: "${id}" needs an image`);
    }
    if (typeof comingSoon !== 'boolean') {
      throw new Error(`content/experiences.json: "${id}" at [${i}] needs "comingSoon" to be a boolean`);
    }
    if (link !== undefined && (typeof link !== 'string' || link.trim().length === 0)) {
      throw new Error(`content/experiences.json: "${id}" has an invalid "link"`);
    }
    const result: Experience = { id, title, description, image, comingSoon };
    if (link !== undefined) result.link = link;
    return result;
  });
}

// galleries.json's `heroCollage` is a tree of splits and photos, and the JSON
// module's inferred type for it is useless in exactly the way `drinks.json`'s
// `category` already is, only worse: `kind` and `direction` widen to plain
// `string`, and a recursive `children` array does not infer as `CollageNode[]`
// at all. A blind `as CollageNode` would accept a split with one child, a
// `sizes` array of the wrong length, a zero size, a duplicate id or a photo
// with no `src` -- every one of which either renders wrong or makes an
// editing gesture (Tasks 4-6) address the wrong box. This guard narrows via
// real runtime checks instead, so any of them throws at import time (and,
// through validate.ts, is refused at the write boundary before it can ever
// become a commit).
//
// `path` is a human-readable trail to the offending node ("root",
// "root.children[2].children[0]") so a bad tree names WHERE it is bad, not
// just that it is.
function assertCollageNode(raw: unknown, path: string): CollageNode {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`content/galleries.json: heroCollage ${path} is not an object`);
  }
  const node = raw as Record<string, unknown>;
  if (!isCollageNodeKind(node.kind)) {
    throw new Error(`content/galleries.json: heroCollage ${path} has an unknown kind "${String(node.kind)}"`);
  }
  if (typeof node.id !== 'string' || node.id.trim().length === 0) {
    throw new Error(`content/galleries.json: heroCollage ${path} needs an id`);
  }

  if (node.kind === 'photo') {
    if (typeof node.src !== 'string' || node.src.trim().length === 0) {
      throw new Error(`content/galleries.json: heroCollage ${path} needs an image source`);
    }
    // `alt` must be PRESENT and a string, but may be empty -- see
    // CollagePhoto's own comment (types.ts) for why every committed photo
    // here has an empty one.
    if (typeof node.alt !== 'string') {
      throw new Error(`content/galleries.json: heroCollage ${path} needs alt text (an empty string is allowed)`);
    }
    return { kind: 'photo', id: node.id, src: node.src, alt: node.alt };
  }

  if (!isSplitDirection(node.direction)) {
    throw new Error(
      `content/galleries.json: heroCollage ${path} has an unknown direction "${String(node.direction)}"`,
    );
  }
  if (!Array.isArray(node.children) || node.children.length < MIN_SPLIT_CHILDREN) {
    throw new Error(
      `content/galleries.json: heroCollage ${path} needs at least ${MIN_SPLIT_CHILDREN} children`,
    );
  }
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) {
    throw new Error(
      `content/galleries.json: heroCollage ${path} needs one size per child (${node.children.length})`,
    );
  }
  const sizes = node.sizes.map((size, i) => {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Error(`content/galleries.json: heroCollage ${path} size[${i}] must be a positive number`);
    }
    return size;
  });
  // Normalisation is not cosmetic here: `validateContent` refuses an
  // un-normalised write, so accepting one at build time would let the
  // committed file and the write boundary disagree about what a valid tree
  // is -- the exact divergence this module's own header comment exists to
  // prevent.
  if (!isNormalizedSizes(sizes)) {
    throw new Error(
      `content/galleries.json: heroCollage ${path} sizes must add up to ${node.children.length}`,
    );
  }
  const children = node.children.map((child, i) => assertCollageNode(child, `${path}.children[${i}]`));
  return { kind: 'split', id: node.id, direction: node.direction, children, sizes };
}

export function assertCollageTree(raw: unknown): CollageNode {
  const tree = assertCollageNode(raw, 'root');
  // Whole-tree rules, checked once at the top rather than re-derived at every
  // level: an id that is unique among siblings can still collide with a
  // cousin, and depth/photo counts are properties of the tree, not of a node.
  const ids = collageNodeIds(tree);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate !== undefined) {
    throw new Error(`content/galleries.json: heroCollage has two nodes with the id "${duplicate}"`);
  }
  // Upper bound only. A tree with zero photos is unrepresentable: every
  // branch bottoms out at a photo, because a split needs at least
  // MIN_SPLIT_CHILDREN children and every node is a photo or a split. The
  // reachable "no photos" state is having no `heroCollage` at all, which is
  // validate.ts's own check on the field, not this function's -- see
  // `collageTreeProblems` there for the same reasoning written out in full.
  const photos = countCollagePhotos(tree);
  if (photos > MAX_COLLAGE_PHOTOS) {
    throw new Error(`content/galleries.json: heroCollage has ${photos} photos, more than the ${MAX_COLLAGE_PHOTOS} allowed`);
  }
  const depth = collageDepth(tree);
  if (depth > MAX_COLLAGE_DEPTH) {
    throw new Error(`content/galleries.json: heroCollage is ${depth} levels deep, more than the ${MAX_COLLAGE_DEPTH} allowed`);
  }
  return tree;
}

// Recurses through the raw copy.json shape checking every string leaf for
// blank content, building a dotted/bracketed path (e.g. "footer.followLabel"
// or "nav.links[0].label") for the error message.
function assertNonBlank(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error(`content/copy.json: "${path}" must not be blank`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNonBlank(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) =>
      assertNonBlank(v, path ? `${path}.${key}` : key),
    );
  }
}

// Every field in Copy is `string` (or an array of a string-only record)
// except `nav.links[].section`, which is a SectionId -- narrower than the
// plain `string` JSON gives it, the same widening problem as drinks.category
// above. A plain type annotation can't narrow that one field, so a typo'd
// section id there is checked here instead. What a type annotation also
// can't catch is a field left blank, or the nav link list emptied out
// entirely (still a valid `NavLink[]`, just one with no links to render).
// This guard rejects all three, naming the offending path so a bad edit to
// copy.json fails loudly at import time instead of rendering invisible
// text, a menu with nothing in it, or a nav link that never highlights as
// enabled/disabled.
export function assertCopy(raw: unknown): Copy {
  const navLinks = (raw as { nav?: { links?: unknown[] } }).nav?.links;
  if (!Array.isArray(navLinks) || navLinks.length === 0) {
    throw new Error('content/copy.json: "nav.links" must not be empty');
  }
  navLinks.forEach((link, i) => {
    const { section, label, href } = link as { section?: unknown; label?: unknown; href?: unknown };
    if (!isSectionId(section)) {
      throw new Error(`content/copy.json: invalid "section" "${String(section)}" at nav.links[${i}]`);
    }
    // `label` and `href` decide whether the link is legible and whether it
    // actually goes anywhere. Neither is caught by assertNonBlank: a number
    // (e.g. `"label": 42`, a JSON authoring mistake) falls through every
    // branch of assertNonBlank (it only recurses into strings, arrays and
    // objects), so it renders as literal "42" text with the empty-string
    // guard never tripping. `href` is checked for the "#"-fragment shape
    // only here -- whether it names a real, currently-rendered anchor is a
    // DOM-level question the "every visible nav link points at a real
    // anchor" test in sections.test.tsx covers instead.
    if (typeof label !== 'string') {
      throw new Error(`content/copy.json: "label" must be a string at nav.links[${i}]`);
    }
    if (typeof href !== 'string' || !href.startsWith('#')) {
      throw new Error(`content/copy.json: "href" must be a "#"-prefixed fragment at nav.links[${i}]`);
    }
  });
  assertNonBlank(raw, '');
  return raw as Copy;
}

// copyRaw's `nav.links[].section` is typed `string` by the JSON module (see
// assertCopy's comment above), which does not structurally satisfy `Copy`'s
// `SectionId`-typed field. A cast (`as SectionId`) would "fix" the type
// error but accepts `string | undefined` and `string | number` just as
// happily as a real SectionId, silently defeating the `satisfies Copy`
// check in index.ts. `narrowSectionId`'s parameter is typed `string` (not
// `unknown`), so passing it a value that isn't definitely a string -- e.g.
// `link.section` when one array element is missing that key, which widens
// the field to `string | undefined` across the whole array -- is itself a
// compile error, not just a runtime one.
//
// Its own runtime throw is belt and braces, not the sole guard against a
// bad value: this function runs first, while index.ts builds assertCopy's
// input, but assertCopy's own `navLinks.forEach` independently re-checks
// `isSectionId` on this exact same `section` field immediately afterwards
// (see above). So an invalid section still throws even with this check
// disabled -- confirmed directly: mutating this function's throw to a
// no-op leaves the suite green, because assertCopy's check is what's
// actually catching it, not this one.
export function narrowSectionId(section: string, path: string): SectionId {
  if (!isSectionId(section)) {
    throw new Error(`content/copy.json: invalid "section" "${section}" at ${path}`);
  }
  return section;
}
