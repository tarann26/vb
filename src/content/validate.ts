// The Worker's pre-commit gate. The owner edits JSON through a dashboard,
// the Worker calls `validateContent(file, data)` on her proposed content
// before it ever becomes a commit, and shows her whatever comes back. So
// every message here is written for her, not for a developer: "this dish
// needs a name", not "expected string, received undefined".
//
// Deliberately built on top of, not a duplicate of, src/content/guards.ts
// (Task 1): assertHours/assertSections/assertCopy/assertDrinkCategory are
// the same runtime checks that already gate `npm run build` at import time
// in index.ts. Re-running them here means a rule can only ever go stale in
// one direction -- guards.ts changes and this file doesn't notice -- never
// the other way around (this file inventing a second, competing definition
// of "valid" that quietly drifts from what the build actually enforces).
import { assertCopy, assertDrinkCategory, assertHours, assertSections } from './guards';
// Whole-branch review, Important 3: validateContent had no rule for
// `publishAt` at all, so a malformed one (the DD-MM date-format habit,
// "01-09-2026" instead of "2026-09-01") reached POST /api/publish, sailed
// through 200, and committed straight to `main` -- where the build's own
// guard (plugins/filter-unpublished.ts, via isPublished) then fails it, and
// every SUBSEQUENT publish of any file fails too, because the bad date is
// already on `main`. Reusing isPublished's own format check here, rather
// than duplicating it, is what keeps this rule from ever silently drifting
// from what the build actually enforces (the same reasoning this file's own
// header comment gives for building on guards.ts instead of a second
// definition). src/content/publish.ts imports no JSON content of its own, so
// pulling it in here does not attach this validator to any particular
// content file's shape.
import { isPublished } from './publish';

export type ValidationProblem = { field: string; message: string };

function problem(field: string, message: string): ValidationProblem {
  return { field, message };
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Stricter than `asRecord`, which maps anything that isn't a plain object
// (including `null` -- `typeof null === 'object'` in JS) to `{}` so every
// *field-level* check above can stay a simple property read. That silent
// fallback is wrong for validateContent's `current` parameter specifically:
// `asRecord(null)` returning `{}` would make the site rule below compare
// every developer-owned field against an empty object, i.e. read every one
// of them as "changed," and refuse all eight -- even when nothing actually
// differs. `isPlainObject` is what lets the call site tell "a real,
// well-formed committed record was supplied" apart from "something else was
// passed where `current` goes," and treat the second the same as `current`
// being omitted entirely, not as license to blame every field.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Names retired from the printed drinks menu (see Drinks.test.tsx's git
// history: `describes only drinks that exist`, moved here by this task). A
// dashboard write that reintroduces one of these -- even under a brand new
// `id` -- must not silently go live just because the id looks unfamiliar.
const RETIRED_DRINK_NAMES = ['Bicerin', 'Espresso Tonic', 'Signor Bianca', 'Sambuco'];

// Three more entries from that same retired list were never drink names at
// all -- they were prose in the old drinks-section intro, which now lives
// in copy.json's `drinks.intro`. A drinks.json rule alone can't catch them
// coming back, because they'd never appear there; they can only resurface
// in copy.json's prose, so that is where this checks.
const RETIRED_DRINK_PHRASES = ['basil-lime spritz', 'rosemary-grapefruit fizz', 'espresso-orange tonic'];

// `publishAt` is optional and, when present, must be a real `YYYY-MM-DD`
// calendar date -- the same shape `isPublished` (src/content/publish.ts) and
// the build's own `plugins/filter-unpublished.ts` already require. `today`
// is irrelevant to what this checks: `isPublished` only ever THROWS on a
// malformed `publishAt`, and it does that before it ever compares to
// `today`, so any well-formed placeholder date reaches the same verdict. A
// fixed placeholder (rather than the real clock) keeps this validator's
// result independent of when it happens to run, like every other rule in
// this file.
const INERT_TODAY = '1970-01-01';

function validatePublishAt(publishAt: unknown, index: number): ValidationProblem[] {
  if (publishAt === undefined) return [];
  try {
    isPublished({ publishAt: publishAt as string }, INERT_TODAY);
    return [];
  } catch (error) {
    return [problem(`[${index}].publishAt`, error instanceof Error ? error.message : String(error))];
  }
}

// ---------------------------------------------------------------------------
// dishes.json

// Task 6: the dashboard's own FoodGallery.test.tsx already refused these two
// shapes -- a placeholder name a template or a rushed first pass leaves
// behind ("Idk3", "Pizza7"), and a filename typed into the name field
// instead of a real one -- but only there, client-side, in a test that
// exercises the PUBLIC page, not the write path. `validateContent` itself
// had no rule for either, so nothing stopped either shape reaching a commit
// through any OTHER caller of the write path (a future admin tool, a
// scripted import) that never renders through FoodGallery at all. Checked
// against the TRIMMED name, matching every other pattern check in this
// file (validateFollowLabelSpacing's own NBSP check is deliberately the one
// exception, for the reason stated there).
const PLACEHOLDER_DISH_NAME_PATTERN = /^(Idk|Pizza)\d+$/;
const FILENAME_DISH_NAME_PATTERN = /\.(jpg|JPG|png)$/i;

function validateDish(raw: unknown, index: number): ValidationProblem[] {
  const dish = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(dish.id)) problems.push(problem(`[${index}].id`, `dish at position ${index} needs an id`));
  if (isBlank(dish.name)) {
    problems.push(problem(`[${index}].name`, 'this dish needs a name'));
  } else {
    const name = (dish.name as string).trim();
    if (PLACEHOLDER_DISH_NAME_PATTERN.test(name)) {
      problems.push(problem(`[${index}].name`, `"${dish.name}" looks like a placeholder name -- give this dish its real name`));
    }
    if (FILENAME_DISH_NAME_PATTERN.test(name)) {
      problems.push(problem(`[${index}].name`, `"${dish.name}" looks like a filename, not a dish name`));
    }
  }
  if (isBlank(dish.description)) {
    problems.push(problem(`[${index}].description`, `"${String(dish.name ?? 'this dish')}" needs a description`));
  }
  if (isBlank(dish.image)) {
    problems.push(problem(`[${index}].image`, `"${String(dish.name ?? 'this dish')}" needs an image`));
  }
  if (!Array.isArray(dish.tags)) {
    problems.push(problem(`[${index}].tags`, `"${String(dish.name ?? 'this dish')}" needs a tags list`));
  }
  problems.push(...validatePublishAt(dish.publishAt, index));
  return problems;
}

// Minor review finding: this and the three sibling whole-file messages
// below (validateDrinks, validatePress) used to lead with the raw JSON
// filename ("dishes.json: the menu needs at least one dish") -- a detail
// meaningful to a developer reading a diff, not to the owner looking at the
// Dishes section of her own dashboard, which already tells her what she's
// editing. Every OTHER validator's own file-level message (galleries.json's
// "atmosphere needs at least one image", site.json's developer-owned-field
// refusal) never had this prefix; these four were the odd ones out.
function validateDishes(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of dishes')];
  if (data.length === 0) return [problem('', 'the menu needs at least one dish')];
  return data.flatMap((dish, i) => validateDish(dish, i));
}

// ---------------------------------------------------------------------------
// drinks.json

function validateDrink(raw: unknown, index: number): ValidationProblem[] {
  const drink = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(drink.id)) problems.push(problem(`[${index}].id`, `drink at position ${index} needs an id`));
  if (isBlank(drink.name)) {
    problems.push(problem(`[${index}].name`, 'this drink needs a name'));
  } else if (RETIRED_DRINK_NAMES.some((retired) => retired.toLowerCase() === (drink.name as string).trim().toLowerCase())) {
    problems.push(problem(`[${index}].name`, `"${String(drink.name)}" is retired and cannot be added back to the drinks menu`));
  }
  if (isBlank(drink.description)) {
    problems.push(problem(`[${index}].description`, `"${String(drink.name ?? 'this drink')}" needs a description`));
  }
  if (drink.image !== null && isBlank(drink.image)) {
    problems.push(problem(`[${index}].image`, `"${String(drink.name ?? 'this drink')}" needs an image, or null`));
  }
  try {
    assertDrinkCategory(drink, index);
  } catch (error) {
    problems.push(problem(`[${index}].category`, error instanceof Error ? error.message : String(error)));
  }
  problems.push(...validatePublishAt(drink.publishAt, index));
  return problems;
}

function validateDrinks(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of drinks')];
  if (data.length === 0) return [problem('', 'the bar list needs at least one drink')];
  return data.flatMap((drink, i) => validateDrink(drink, i));
}

// ---------------------------------------------------------------------------
// press.json

function validateArticle(raw: unknown, index: number): ValidationProblem[] {
  const article = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(article.id)) problems.push(problem(`[${index}].id`, `article at position ${index} needs an id`));
  if (isBlank(article.title)) problems.push(problem(`[${index}].title`, 'this article needs a title'));
  if (isBlank(article.publication)) {
    problems.push(problem(`[${index}].publication`, `"${String(article.title ?? 'this article')}" needs a publication`));
  }
  if (isBlank(article.excerpt)) {
    problems.push(problem(`[${index}].excerpt`, `"${String(article.title ?? 'this article')}" needs an excerpt`));
  }
  if (isBlank(article.image)) {
    problems.push(problem(`[${index}].image`, `"${String(article.title ?? 'this article')}" needs an image`));
  }
  if (isBlank(article.date) || Number.isNaN(new Date(article.date as string).getTime())) {
    problems.push(problem(`[${index}].date`, `"${String(article.title ?? 'this article')}" needs a real date`));
  }
  // Minor review finding: ARTICLE_FIELDS.url's own help text (fields.ts)
  // promises "leave empty if it has none" -- but Field.tsx's generic `text`
  // case (shared by every plain text field, nullable or not) always writes
  // an emptied input back as `''`, never `null`; this rule used to refuse
  // that, so the one action the field's own help text told her she could
  // take was the one thing it then rejected. `''` (or all-whitespace) is
  // now treated exactly like `null` here -- both mean "no link" -- matching
  // every real consumer already (BlogsPage/BlogTeaser/NewsPress all gate on
  // `article.url && ...`, where `''` and `null` are equally falsy).
  const hasNoUrl = article.url === null || (typeof article.url === 'string' && article.url.trim() === '');
  if (!hasNoUrl && (typeof article.url !== 'string' || !/^https?:\/\//.test(article.url))) {
    problems.push(problem(`[${index}].url`, `"${String(article.title ?? 'this article')}" needs a real destination, or null`));
  }
  problems.push(...validatePublishAt(article.publishAt, index));
  return problems;
}

function validatePress(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of articles')];
  if (data.length === 0) return [problem('', 'the press list needs at least one article')];
  const problems = data.flatMap((article, i) => validateArticle(article, i));
  // Only check ordering once every date has already been confirmed real --
  // an unparseable date would otherwise also read as "out of order",
  // burying the actual problem (a bad date) under a second, confusing one.
  if (problems.length === 0) {
    const dates = (data as { date: string }[]).map((a) => new Date(a.date).getTime());
    const inOrder = dates.every((date, i) => i === 0 || dates[i - 1] >= date);
    if (!inOrder) {
      problems.push(problem('', 'articles must be sorted newest first — reorder before publishing'));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// story.json

function validateStory(data: unknown): ValidationProblem[] {
  const story = asRecord(data);
  const problems: ValidationProblem[] = [];
  if (isBlank(story.heading)) problems.push(problem('heading', 'the story needs a heading'));
  if (!Array.isArray(story.paragraphs) || story.paragraphs.length === 0) {
    problems.push(problem('paragraphs', 'the story needs at least one paragraph'));
    return problems;
  }
  story.paragraphs.forEach((raw: unknown, i: number) => {
    if (isBlank(raw)) {
      problems.push(problem(`paragraphs[${i}]`, `paragraph ${i + 1} is blank`));
      return;
    }
    const trimmed = (raw as string).trim();
    if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
      problems.push(problem(`paragraphs[${i}]`, `paragraph ${i + 1} trails off with an ellipsis — finish the thought before publishing`));
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// site.json

function validateSite(data: unknown): ValidationProblem[] {
  const site = asRecord(data);
  const problems: ValidationProblem[] = [];
  if (isBlank(site.name)) problems.push(problem('name', 'the site needs a name'));
  if (isBlank(site.tagline)) problems.push(problem('tagline', 'the site needs a tagline'));
  if (isBlank(site.strapline)) problems.push(problem('strapline', 'the site needs a strapline'));

  const address = asRecord(site.address);
  if ([address.street, address.locality, address.postalCode, address.country].some(isBlank)) {
    problems.push(problem('address', 'the address is incomplete'));
  }

  if (!Array.isArray(site.phones) || site.phones.length === 0 || site.phones.some(isBlank)) {
    problems.push(problem('phones', 'the site needs at least one phone number'));
  }

  const whatsapp = asRecord(site.whatsapp);
  if (isBlank(whatsapp.number) || isBlank(whatsapp.prefilledMessage)) {
    problems.push(problem('whatsapp', 'WhatsApp needs both a number and a prefilled message'));
  }

  const socials = asRecord(site.socials);
  if (isBlank(socials.instagram)) problems.push(problem('socials.instagram', 'the site needs an Instagram link'));

  if (!Array.isArray(site.hours) || site.hours.length === 0) {
    problems.push(problem('hours', 'the site needs at least one opening-hours entry'));
  } else {
    site.hours.forEach((raw, i) => {
      try {
        assertHours(raw as { days: string[]; opens: string; closes: string });
      } catch (error) {
        problems.push(problem(`hours[${i}]`, error instanceof Error ? error.message : String(error)));
      }
    });
  }

  const seo = asRecord(site.seo);
  if (isBlank(seo.title) || isBlank(seo.description)) {
    problems.push(problem('seo', 'the site needs an SEO title and description'));
  }

  if (typeof site.copyrightYear !== 'number') {
    problems.push(problem('copyrightYear', 'the site needs a copyright year'));
  }

  return problems;
}

// ---------------------------------------------------------------------------
// galleries.json

// Task 6: PlaceGallery.test.tsx and OurStory.test.tsx already refuse a
// positional placeholder alt text ("Place 3", "Slide 2") client-side, in a
// test against the PUBLIC page -- not in validateContent, so nothing stopped
// either shape reaching a commit through any write path that doesn't render
// through those two components. One pattern per LIST, not one shared
// pattern: "Place" names atmosphere's own placeholder, "Slide" names
// ourStory's, and the two lists' real, committed alt text never share a
// word with either, so a caller passes the pattern that matches the field
// it's validating rather than this function guessing from the field name.
function validateGalleryImages(raw: unknown, field: string, placeholderPattern: RegExp): ValidationProblem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [problem(field, `${field} needs at least one image`)];
  }
  return raw.flatMap((entry, i) => {
    const image = asRecord(entry);
    const problems: ValidationProblem[] = [];
    if (isBlank(image.src)) problems.push(problem(`${field}[${i}].src`, `${field}[${i}] needs an image source`));
    if (isBlank(image.alt)) {
      problems.push(problem(`${field}[${i}].alt`, `${field}[${i}] needs alt text`));
    } else if (placeholderPattern.test((image.alt as string).trim())) {
      problems.push(
        problem(`${field}[${i}].alt`, `"${image.alt}" is a placeholder -- ${field}[${i}] needs real, descriptive alt text`),
      );
    }
    return problems;
  });
}

function validateGalleries(data: unknown): ValidationProblem[] {
  const galleries = asRecord(data);
  const problems: ValidationProblem[] = [
    ...validateGalleryImages(galleries.atmosphere, 'atmosphere', /^Place \d+$/),
    ...validateGalleryImages(galleries.ourStory, 'ourStory', /^Slide \d+$/),
  ];
  if (!Array.isArray(galleries.heroCollage) || galleries.heroCollage.length === 0) {
    problems.push(problem('heroCollage', 'heroCollage needs at least one image'));
  } else {
    galleries.heroCollage.forEach((entry, i) => {
      const image = asRecord(entry);
      if (isBlank(image.src)) problems.push(problem(`heroCollage[${i}].src`, `heroCollage[${i}] needs an image source`));
      if (isBlank(image.className)) {
        problems.push(problem(`heroCollage[${i}].className`, `heroCollage[${i}] needs a layout class`));
      }
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// menus.json

function validateMenus(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data) || data.length === 0) {
    return [problem('', 'the site needs at least one downloadable menu')];
  }
  return data.flatMap((raw, i) => {
    const menu = asRecord(raw);
    const problems: ValidationProblem[] = [];
    if (isBlank(menu.id)) problems.push(problem(`[${i}].id`, `menu at position ${i} needs an id`));
    if (isBlank(menu.label)) problems.push(problem(`[${i}].label`, `menu at position ${i} needs a label`));
    if (isBlank(menu.file)) problems.push(problem(`[${i}].file`, `"${String(menu.label ?? 'this menu')}" needs a file`));
    return problems;
  });
}

// ---------------------------------------------------------------------------
// sections.json / copy.json — thin wraps of the Task 1 guards, which already
// carry the section-completeness and hero-required rules a dashboard write
// must not be able to bypass.

function validateSections(data: unknown): ValidationProblem[] {
  try {
    assertSections(data);
    return [];
  } catch (error) {
    return [problem('', error instanceof Error ? error.message : String(error))];
  }
}

// copy.footer.followLabel must keep a non-breaking space (U+00A0), not an
// ordinary one, between its two words -- confirmed against the committed
// copy.json directly (see src/content/__tests__/copy.test.ts). Wording is
// the owner's to change; this constrains only the separator, so the message
// below is written to still be true after any legitimate reword of the
// label's text, not tied to "Follow"/"Us" specifically. Deliberately NOT
// added to assertCopy (src/content/guards.ts): a throwing guard runs at
// every `npm run build`, live site included, so a bad edit that reached
// `main` would white-page the whole homepage instead of failing only the
// dashboard write that introduced it (Plan 2's I4).
function validateFollowLabelSpacing(data: unknown): ValidationProblem[] {
  const followLabel = asRecord(asRecord(data).footer).followLabel;
  // Written as the explicit \u00a0 escape, not a literal non-breaking-space
  // character sitting invisibly in this source file, so the character this
  // check depends on stays legible in a diff instead of looking like an
  // ordinary space.
  const NBSP = '\u00a0';
  if (typeof followLabel === 'string' && !followLabel.includes(NBSP)) {
    return [
      problem(
        'footer.followLabel',
        'footer.followLabel needs a non-breaking space, not a regular space, between its two words',
      ),
    ];
  }
  return [];
}

function validateCopy(data: unknown): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  try {
    assertCopy(data);
  } catch (error) {
    problems.push(problem('', error instanceof Error ? error.message : String(error)));
  }
  // assertCopy checks every string is non-blank; it has no idea a
  // particular blank-adjacent value is a *retired* drink name, since it
  // validates copy.json in isolation from drinks.json's own history. That
  // check belongs here instead.
  const intro = asRecord(asRecord(data).drinks).intro;
  if (typeof intro === 'string') {
    RETIRED_DRINK_PHRASES.forEach((phrase) => {
      if (intro.toLowerCase().includes(phrase)) {
        problems.push(problem('drinks.intro', `"${phrase}" is retired and cannot appear in the drinks intro`));
      }
    });
  }
  problems.push(...validateFollowLabelSpacing(data));
  return problems;
}

// ---------------------------------------------------------------------------
// site.json's developer-owned fields: name, tagline, and every seo.* key.
//
// src/test/head.test.ts pins nine strings in index.html against these exact
// fields, because index.html has no server rendering of its own to read
// site.json at request time. If any of them changes here, the deploy fails
// -- and because the bad value is already on `main` by the time that gate
// runs, every SUBSEQUENT publish of anything else fails too, until a
// developer hand-edits index.html to match. Same poisoned-`main` shape as
// the `publishAt` finding this file's header comment describes. Refusing
// the write here, before it commits, is cheaper than recovering from that.
//
// validateContent only ever receives the *proposed* content, not what's
// currently committed, so this rule is a no-op unless a caller supplies
// `current` (the third, optional parameter below) -- Task 3 wires the
// Worker's GET /api/content into that parameter. Comparing against the
// caller-supplied committed value, rather than a hardcoded expected string,
// is deliberate: hardcoding "Via Bianca" (or any real value) here would
// duplicate site.json's content into the validator, and a developer
// legitimately renaming the restaurant would then have to edit this file
// too, not just site.json and index.html.
const SITE_DEVELOPER_OWNED_MESSAGE =
  "Changing this needs your developer — it's written into a file the site is built from.";

// `current` is typed as an already-narrowed `Record<string, unknown>`, not
// `unknown` -- its only caller (validateContent) gates on `isPlainObject`
// first, and that narrowing is what keeps a malformed `current` (e.g.
// `null`) from ever reaching this function and reading as "every field
// changed." See isPlainObject's own comment above for why that distinction
// matters.
function validateSiteDeveloperOwnedFields(data: unknown, current: Record<string, unknown>): ValidationProblem[] {
  const proposed = asRecord(data);
  const committed = current;
  const problems: ValidationProblem[] = [];
  if (proposed.name !== committed.name) problems.push(problem('name', SITE_DEVELOPER_OWNED_MESSAGE));
  if (proposed.tagline !== committed.tagline) problems.push(problem('tagline', SITE_DEVELOPER_OWNED_MESSAGE));

  const proposedSeo = asRecord(proposed.seo);
  const committedSeo = asRecord(committed.seo);
  // The union of both key sets, not just the proposed side's: a write that
  // DROPS a seo.* key entirely (e.g. `seo.locale` simply absent from the
  // payload) must be refused exactly like one that changes its value --
  // dropping it silently reads as the key becoming `undefined`, which the
  // strict !== comparison below already catches, but only because the key
  // is still enumerated here.
  const seoKeys = new Set([...Object.keys(proposedSeo), ...Object.keys(committedSeo)]);
  seoKeys.forEach((key) => {
    if (proposedSeo[key] !== committedSeo[key]) {
      problems.push(problem(`seo.${key}`, SITE_DEVELOPER_OWNED_MESSAGE));
    }
  });

  return problems;
}

// ---------------------------------------------------------------------------

const RULES: Record<string, (data: unknown) => ValidationProblem[]> = {
  'copy.json': validateCopy,
  'sections.json': validateSections,
  'dishes.json': validateDishes,
  'drinks.json': validateDrinks,
  'press.json': validatePress,
  'story.json': validateStory,
  'site.json': validateSite,
  'galleries.json': validateGalleries,
  'menus.json': validateMenus,
};

// The single entry point a Worker's publish route calls before it ever
// commits anything. **Never throws**: every caller is an HTTP handler, and
// a throw here becomes a 500 reading "something went wrong" instead of a
// sentence the owner can act on. The outer try/catch is what keeps that
// true even if a rule above has a bug -- not just when the input is bad.
//
// Default-deny: a file with no entry in RULES is refused, not waved
// through. copy.json and sections.json are two of the four files whose
// guards (Task 1) are the only thing standing between a bad write and a
// build that still succeeds but ships a deployable white page -- a
// validator that accepts what it doesn't recognise defeats the reason it
// exists.
//
// `current`, the committed content this write would replace, is optional
// and used by exactly one rule today: site.json's developer-owned-fields
// check above. Every existing caller passes only `file` and `data` and must
// keep working unchanged -- this file deliberately imports no JSON of its
// own (see the header comment), so it has no other way to know what's
// currently committed, and Task 3 is what gives the Worker a value to pass.
//
// Gated on `isPlainObject(current)`, not `current !== undefined`: Task 3's
// GET /api/content could plausibly represent "the fetch failed" as
// `current: null` rather than never passing the argument at all. Read note
// for whoever wires that up -- treat a failed fetch as omitting `current`
// (call with two arguments, or pass `undefined` explicitly), not as
// `null`. `isPlainObject` makes that the same case either way: a `current`
// that isn't a well-formed record is treated exactly like no `current` was
// supplied, so a transient fetch problem can never manufacture eight
// developer-owned-field complaints against content that hasn't changed.
export function validateContent(file: string, data: unknown, current?: unknown): ValidationProblem[] {
  const rule = RULES[file];
  if (!rule) return [problem('', `This file cannot be edited here (${file}).`)];
  try {
    const problems = rule(data);
    if (file === 'site.json' && isPlainObject(current)) {
      problems.push(...validateSiteDeveloperOwnedFields(data, current));
    }
    return problems;
  } catch (error) {
    return [problem('', error instanceof Error ? error.message : String(error))];
  }
}
