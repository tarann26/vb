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
  Hours,
  Copy,
  Section,
  SectionId,
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
// a blind `as Drink[]` would silently accept a typo'd category. This guard
// narrows via runtime equality checks instead, so an invalid category throws.
export const drinks: Drink[] = drinksRaw.map((raw) => {
  const { category } = raw;
  if (category !== 'mocktail' && category !== 'cocktail' && category !== 'wine') {
    throw new Error(`content/drinks.json: invalid category "${category}" for drink "${raw.id}"`);
  }
  return { ...raw, category };
});

// The single runtime source of truth for the SectionId union -- TS erases
// the type at runtime, so isSectionId/assertSections/narrowSectionId below
// all check membership and completeness against this array rather than each
// re-deriving their own copy of the seven literals. When Plan 7 extends
// SectionId, this is the one place (plus the type union itself) that needs
// the new member added; assertSections's completeness check then enforces
// it automatically instead of silently accepting an incomplete list.
const SECTION_IDS: readonly SectionId[] = [
  'hero', 'ourStory', 'atmosphere', 'food', 'drinks', 'press', 'visit',
];

// Shared by assertSections (validating sections.json's `id`) and assertCopy
// (validating copy.json's `nav.links[].section`) -- both need to know
// whether an arbitrary value is one of the seven real SectionIds.
function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value);
}

// sections.json's `id` field is a plain string in the JSON module's inferred
// type, wider than Section['id'] (SectionId) -- same widening problem as
// drinks.category above. A blind `as Section[]` would silently accept a
// typo'd id, permanently orphaning that section's component (App.tsx's
// dispatch map would never be reached for it) or, worse, colliding with a
// real one. This guard narrows and validates via runtime checks instead.
//
// Two rules apply on top of "is this array well-formed, with every id valid
// and none repeated": every SectionId must appear exactly once (a dashboard
// write that drops one silently deletes that section from the homepage --
// this used to only be checked for `hero`, which meant a partial write
// losing e.g. `visit` type-checked and passed the old guard), and `hero`
// specifically must be enabled. A homepage with no hero is not a state this
// plan supports, and the founder disabling it by a single accidental toggle
// is worse than her being unable to.
export function assertSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) {
    throw new Error('content/sections.json: expected an array of sections');
  }
  const seen = new Set<SectionId>();
  const result = raw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`content/sections.json: entry [${i}] is not an object`);
    }
    const { id, enabled } = entry as { id?: unknown; enabled?: unknown };
    if (!isSectionId(id)) {
      throw new Error(`content/sections.json: invalid section id "${String(id)}" at [${i}]`);
    }
    if (seen.has(id)) {
      throw new Error(`content/sections.json: duplicate section id "${id}"`);
    }
    seen.add(id);
    if (typeof enabled !== 'boolean') {
      throw new Error(`content/sections.json: "enabled" must be a boolean for section "${id}"`);
    }
    return { id, enabled };
  });
  const missing = SECTION_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`content/sections.json: missing required section(s) "${missing.join('", "')}"`);
  }
  const hero = result.find((section) => section.id === 'hero');
  if (!hero?.enabled) {
    throw new Error('content/sections.json: "hero" cannot be disabled');
  }
  return result;
}

export const sections: Section[] = assertSections(sectionsRaw);

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
    const section = (link as { section?: unknown }).section;
    if (!isSectionId(section)) {
      throw new Error(`content/copy.json: invalid "section" "${String(section)}" at nav.links[${i}]`);
    }
  });
  assertNonBlank(raw, '');
  return raw as Copy;
}

// copyRaw's `nav.links[].section` is typed `string` by the JSON module (see
// assertCopy's comment above), which does not structurally satisfy `Copy`'s
// `SectionId`-typed field. A cast (`as SectionId`) would "fix" the type
// error but accepts `string | undefined` and `string | number` just as
// happily as a real SectionId -- a link that loses its `section` key
// entirely, or has it typo'd to a number, would satisfy the cast and only
// fail later at vitest time, with `tsc -b`/`vite build` both green and a bad
// copy.json shipping as a silently broken nav. `narrowSectionId`'s parameter
// is typed `string` (not `unknown`), so passing it a value that isn't
// definitely a string -- e.g. `link.section` when one array element is
// missing that key, which widens the field to `string | undefined` across
// the whole array -- is itself a compile error, not just a runtime one.
function narrowSectionId(section: string, path: string): SectionId {
  if (!isSectionId(section)) {
    throw new Error(`content/copy.json: invalid "section" "${section}" at ${path}`);
  }
  return section;
}

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
