import type {
  Hours,
  Copy,
  Section,
  BespokeSection,
  TemplateType,
  TemplateContent,
  TemplateWhatsAppButton,
  TextTemplateContent,
  ItemListTemplateContent,
  GalleryTemplateContent,
  DetailBlockTemplateContent,
  Page,
  SectionId,
  Drink,
} from './types';

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
// re-deriving their own copy of the seven literals.
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
  visit: true,
};
const SECTION_IDS = Object.keys(SECTION_ID_SET) as SectionId[];

// Shared by assertSections (validating sections.json's `id`) and assertCopy
// (validating copy.json's `nav.links[].section`) -- both need to know
// whether an arbitrary value is one of the seven real SectionIds.
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
    // A template id colliding with one of the seven closed SectionIds is
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
