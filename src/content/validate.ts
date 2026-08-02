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

// ---------------------------------------------------------------------------
// dishes.json

function validateDish(raw: unknown, index: number): ValidationProblem[] {
  const dish = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(dish.id)) problems.push(problem(`[${index}].id`, `dish at position ${index} needs an id`));
  if (isBlank(dish.name)) problems.push(problem(`[${index}].name`, 'this dish needs a name'));
  if (isBlank(dish.description)) {
    problems.push(problem(`[${index}].description`, `"${String(dish.name ?? 'this dish')}" needs a description`));
  }
  if (isBlank(dish.image)) {
    problems.push(problem(`[${index}].image`, `"${String(dish.name ?? 'this dish')}" needs an image`));
  }
  if (!Array.isArray(dish.tags)) {
    problems.push(problem(`[${index}].tags`, `"${String(dish.name ?? 'this dish')}" needs a tags list`));
  }
  return problems;
}

function validateDishes(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'dishes.json: expected a list of dishes')];
  if (data.length === 0) return [problem('', 'dishes.json: the menu needs at least one dish')];
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
  return problems;
}

function validateDrinks(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'drinks.json: expected a list of drinks')];
  if (data.length === 0) return [problem('', 'drinks.json: the bar list needs at least one drink')];
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
  if (article.url !== null && (typeof article.url !== 'string' || !/^https?:\/\//.test(article.url))) {
    problems.push(problem(`[${index}].url`, `"${String(article.title ?? 'this article')}" needs a real destination, or null`));
  }
  return problems;
}

function validatePress(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'press.json: expected a list of articles')];
  if (data.length === 0) return [problem('', 'press.json: the press list needs at least one article')];
  const problems = data.flatMap((article, i) => validateArticle(article, i));
  // Only check ordering once every date has already been confirmed real --
  // an unparseable date would otherwise also read as "out of order",
  // burying the actual problem (a bad date) under a second, confusing one.
  if (problems.length === 0) {
    const dates = (data as { date: string }[]).map((a) => new Date(a.date).getTime());
    const inOrder = dates.every((date, i) => i === 0 || dates[i - 1] >= date);
    if (!inOrder) {
      problems.push(problem('', 'press.json: articles must be sorted newest first — reorder before publishing'));
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

function validateGalleryImages(raw: unknown, field: string): ValidationProblem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [problem(field, `${field} needs at least one image`)];
  }
  return raw.flatMap((entry, i) => {
    const image = asRecord(entry);
    const problems: ValidationProblem[] = [];
    if (isBlank(image.src)) problems.push(problem(`${field}[${i}].src`, `${field}[${i}] needs an image source`));
    if (isBlank(image.alt)) problems.push(problem(`${field}[${i}].alt`, `${field}[${i}] needs alt text`));
    return problems;
  });
}

function validateGalleries(data: unknown): ValidationProblem[] {
  const galleries = asRecord(data);
  const problems: ValidationProblem[] = [
    ...validateGalleryImages(galleries.atmosphere, 'atmosphere'),
    ...validateGalleryImages(galleries.ourStory, 'ourStory'),
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
    return [problem('', 'menus.json: the site needs at least one downloadable menu')];
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
export function validateContent(file: string, data: unknown): ValidationProblem[] {
  const rule = RULES[file];
  if (!rule) return [problem('', `This file cannot be edited here (${file}).`)];
  try {
    return rule(data);
  } catch (error) {
    return [problem('', error instanceof Error ? error.message : String(error))];
  }
}
