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
import {
  ARTICLE_KEYS,
  AWARD_KEYS,
  BESPOKE_SECTION_KEYS,
  DISH_KEYS,
  DRINK_KEYS,
  PAGE_KEYS,
  TEMPLATE_SECTION_KEYS,
  assertCopy,
  assertDrinkCategory,
  assertHours,
  assertSections,
  isSectionId,
  isTemplateType,
  isUrlSafeSlug,
  unknownKeys,
} from './guards';
// The hero collage's own data structure. The rules below are the same ones
// `assertCollageTree` (./guards) fails the BUILD on, written for her instead
// of for a developer -- see `collageTreeProblems` for the split, and this
// file's own header comment for why the two ends read one definition rather
// than each inventing a second.
import {
  MAX_COLLAGE_DEPTH,
  MAX_COLLAGE_PHOTOS,
  MIN_COLLAGE_PHOTOS,
  MIN_SPLIT_CHILDREN,
  isCollageNodeKind,
  isNormalizedSizes,
  isSplitDirection,
} from './collage';

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

// ---------------------------------------------------------------------------
// The two shapes a value is allowed to have when the site renders it straight
// into an `href` or a `src`.
//
// A security pass found every one of those fields checked with `isBlank`
// alone -- present, non-empty, and otherwise anything at all -- with the
// single exception of `article.url`, which had carried an `^https?://` test
// since it was written. So the control already existed and had simply never
// been applied to its siblings: `socials.instagram` and `socials.linkedin`
// render as `<a href>` in Footer.tsx and NavBar.tsx, `menus[].file` renders
// as `<a href download>` in Drinks.tsx, and a `javascript:` string in any of
// them is script that runs on click, published through the dashboard and
// stored in the repository.
//
// This is defence in depth, not a hole anyone can reach from outside:
// writing content requires a session, and a session can already publish
// anything. The realistic path is not an attacker, it is the owner pasting a
// link somebody sent her. Both are closed by the same three lines, and the
// asymmetry -- one field guarded, seven not -- is the kind that reads as
// deliberate long after nobody remembers it wasn't.
//
// Both patterns reject the protocol-relative `//evil.example/x` as well as
// the scheme-bearing ones, which is the case that looks like a path at a
// glance and is not one.

// A link off this site: press articles, Instagram, LinkedIn. `https?` rather
// than `https` only because that is the rule `article.url` already used and
// this is the injection boundary, not the transport one -- a press archive
// still on http is a real thing, and downgrading it to a validation failure
// she cannot fix would be a different bug.
function isUnsafeExternalUrl(value: unknown): boolean {
  return typeof value !== 'string' || !/^https?:\/\/[^/]/.test(value.trim());
}

// An asset this site serves itself: every image, and the menu PDFs. All 59
// of them are root-relative today and nothing about this site wants them
// otherwise -- an absolute URL here would silently move an asset off-origin,
// leaking every visitor's IP and referrer to whoever owns it, and would slip
// past the guardrail that checks each of these files exists under public/.
function isUnsafeAssetPath(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  return !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('..');
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

// Review finding (Important): a record carrying a key its own type does not
// have used to sail through here and then fail `main`'s deploy gate forever.
//
// The two ends had drifted. `shape.test.ts` fails the BUILD on any key
// outside `Dish`/`Drink`/`Article`; this file, the WRITE boundary, checked
// only that the fields it knew about were well-formed and said nothing at
// all about the ones it did not. So a publish carrying an extra key returned
// 200, committed, and only then failed `npm run test:deploy` -- on `main`,
// where the bad key now lives, so every SUBSEQUENT publish of any other file
// failed the same gate too, and no control in the dashboard could clear it.
// Exactly the poisoned-`main` shape the site.json rule at the bottom of this
// file describes, reached through a different door.
//
// Reachable, not hypothetical. Removing the scheduling subsystem turned
// `publishAt` into precisely such a key while the deployed dashboard was
// still rendering a "Publish on" date input for every dish, drink and press
// row; RecordForm's set path is `{ ...value, [key]: next }` and drafts are
// stored as opaque `unknown`, so an open tab or a restored draft carries the
// field straight into the next publish, after the code that could have
// removed it is gone.
//
// The key sets come from guards.ts, the same ones shape.test.ts asserts
// with, for the reason this file's header comment gives for building on
// guards.ts generally: a second, local list of "the fields a dish has" is
// how these two ends drifted apart in the first place.
function validateKnownKeys(
  raw: unknown,
  knownKeys: Record<string, true>,
  path: string,
  subject: string,
): ValidationProblem[] {
  return unknownKeys(asRecord(raw), knownKeys).map((key) =>
    problem(
      `${path}.${key}`,
      // Written for her, like every other message here. She cannot edit this
      // key -- no control renders it -- so the only recoveries are a reload
      // (which drops a stale tab's in-memory copy) and declining the draft
      // that would put it straight back.
      `"${subject}" carries "${key}", which this site does not use -- reload this page, decline any draft it offers to restore, and make the edit again`,
    ),
  );
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
  } else if (isUnsafeAssetPath(dish.image)) {
    problems.push(problem(`[${index}].image`, `"${String(dish.name ?? 'this dish')}" needs an image on this site, starting with /`));
  }
  if (!Array.isArray(dish.tags)) {
    problems.push(problem(`[${index}].tags`, `"${String(dish.name ?? 'this dish')}" needs a tags list`));
  }
  problems.push(...validateKnownKeys(dish, DISH_KEYS, `[${index}]`, String(dish.name ?? 'this dish')));
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
  } else if (drink.image !== null && isUnsafeAssetPath(drink.image)) {
    problems.push(problem(`[${index}].image`, `"${String(drink.name ?? 'this drink')}" needs an image on this site, starting with /`));
  }
  try {
    assertDrinkCategory(drink, index);
  } catch (error) {
    problems.push(problem(`[${index}].category`, error instanceof Error ? error.message : String(error)));
  }
  problems.push(...validateKnownKeys(drink, DRINK_KEYS, `[${index}]`, String(drink.name ?? 'this drink')));
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
  } else if (isUnsafeAssetPath(article.image)) {
    problems.push(problem(`[${index}].image`, `"${String(article.title ?? 'this article')}" needs an image on this site, starting with /`));
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
  if (!hasNoUrl && isUnsafeExternalUrl(article.url)) {
    problems.push(problem(`[${index}].url`, `"${String(article.title ?? 'this article')}" needs a real destination, or null`));
  }
  problems.push(...validateKnownKeys(article, ARTICLE_KEYS, `[${index}]`, String(article.title ?? 'this article')));
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
  if (isBlank(socials.instagram)) {
    problems.push(problem('socials.instagram', 'the site needs an Instagram link'));
  } else if (isUnsafeExternalUrl(socials.instagram)) {
    problems.push(problem('socials.instagram', 'the Instagram link needs to start with https://'));
  }
  // LinkedIn is optional -- Footer.tsx renders it only when it is there --
  // so this checks the shape of a value that exists rather than demanding
  // one. Absent entirely and empty are both fine; a `javascript:` string is
  // not.
  if (socials.linkedin !== undefined && socials.linkedin !== null && !isBlank(socials.linkedin)
      && isUnsafeExternalUrl(socials.linkedin)) {
    problems.push(problem('socials.linkedin', 'the LinkedIn link needs to start with https://'));
  }

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
    if (isBlank(image.src)) {
      problems.push(problem(`${field}[${i}].src`, `${field}[${i}] needs an image source`));
    } else if (isUnsafeAssetPath(image.src)) {
      problems.push(problem(`${field}[${i}].src`, `${field}[${i}] needs an image on this site, starting with /`));
    }
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
  // The MIN_COLLAGE_PHOTOS floor, enforced on the FIELD rather than inside
  // the tree walk -- see `collageTreeProblems` above for why a count check
  // inside the walk would be a check that cannot fail. `null` is /edit's
  // pre-load fallback (types.ts), legitimate in memory and never publishable,
  // which is exactly what refusing it here means.
  if (galleries.heroCollage === undefined || galleries.heroCollage === null) {
    problems.push(problem('heroCollage', `the collage needs at least ${MIN_COLLAGE_PHOTOS} photo`));
  } else {
    problems.push(...collageTreeProblems(galleries.heroCollage));
  }
  return problems;
}

// ---------------------------------------------------------------------------
// galleries.json's heroCollage: the split tree.
//
// Named, owner-facing messages for exactly the rules `assertCollageTree`
// (src/content/guards.ts) throws on -- built on that module rather than
// re-deriving them, the same posture this file's own header comment sets out
// for every other validator here. The difference is only in the audience and
// the shape of the answer: the guard fails `npm run build` with one throw,
// this refuses the WRITE with one problem per thing wrong, addressed to a
// field.
//
// Field addressing, and why the two kinds differ: a problem about ONE PHOTO
// is reported as `heroCollage[n].src`, where `n` is that photo's position in
// document order -- the same order the dashboard's own hero-collage list
// renders its rows in, so src/admin/problems.ts's existing `key[i].sub`
// routing puts the message on the right row with no change at all. A problem
// about the tree's STRUCTURE has no row to sit on (nothing in the dashboard
// renders a split), so it is reported against the bare `heroCollage` field
// and surfaces in that list's own banner.
//
// Not yet called by `validateGalleries` below -- deliberately. Switching the
// galleries rule over to tree shapes and re-authoring `galleries.json` into a
// tree are one atomic change with the renderer (Task 2), and a validator that
// refused the committed content would fail every test in this repo in the
// meantime. This function, its guard and its tests land first so that change
// has something already proven to switch ONTO.
export function collageTreeProblems(raw: unknown): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  // Document-order photo counter, shared across the whole recursion, so
  // `heroCollage[n]` here means the same `n` `collagePhotos` (collage.ts)
  // produces and the dashboard's own list renders.
  let photoIndex = 0;
  // Reported once, however many branches run past the ceiling -- a tree
  // divided fifteen levels deep would otherwise produce one identical
  // sentence per node down there, which is noise, not information.
  let reportedTooDeep = false;

  function walk(node: unknown, depth: number, ids: string[]): void {
    // Checked FIRST, for every node rather than only for splits: the node
    // that actually sits at the forbidden depth is usually a photo (a split
    // one level above it is still legal), and checking only splits let a
    // tree exactly one level over the limit through. Returning here is also
    // what bounds this recursion on hostile input -- `validateContent` is
    // called straight from an HTTP handler, so "walk whatever arrives" has
    // to terminate on a tree built to be pathological.
    if (depth > MAX_COLLAGE_DEPTH) {
      if (!reportedTooDeep) {
        reportedTooDeep = true;
        problems.push(
          problem('heroCollage', `this collage is divided more than ${MAX_COLLAGE_DEPTH} levels deep — some boxes are too small to see`),
        );
      }
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      problems.push(problem('heroCollage', 'part of this collage is not a photo or a split'));
      return;
    }
    const record = node as Record<string, unknown>;
    if (!isCollageNodeKind(record.kind)) {
      problems.push(problem('heroCollage', 'part of this collage is neither a photo nor a split'));
      return;
    }
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      problems.push(problem('heroCollage', 'every photo and every split in this collage needs its own name'));
    } else if (ids.includes(record.id)) {
      problems.push(problem('heroCollage', `two parts of this collage share the name "${record.id}"`));
    } else {
      ids.push(record.id);
    }

    if (record.kind === 'photo') {
      const index = photoIndex++;
      if (isBlank(record.src)) {
        problems.push(problem(`heroCollage[${index}].src`, `collage photo ${index + 1} needs an image`));
      } else if (isUnsafeAssetPath(record.src)) {
        problems.push(
          problem(`heroCollage[${index}].src`, `collage photo ${index + 1} needs an image on this site, starting with /`),
        );
      }
      if (typeof record.alt !== 'string') {
        problems.push(problem(`heroCollage[${index}].alt`, `collage photo ${index + 1} needs alt text, or an empty one`));
      }
      return;
    }

    if (!isSplitDirection(record.direction)) {
      problems.push(problem('heroCollage', 'a split in this collage must divide it either across or down'));
    }
    const children = Array.isArray(record.children) ? record.children : null;
    if (!children || children.length < MIN_SPLIT_CHILDREN) {
      problems.push(problem('heroCollage', `a split in this collage needs at least ${MIN_SPLIT_CHILDREN} boxes in it`));
      return;
    }
    const sizes = Array.isArray(record.sizes) ? record.sizes : null;
    if (!sizes || sizes.length !== children.length) {
      problems.push(problem('heroCollage', 'a split in this collage has a different number of sizes than boxes'));
    } else if (!sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)) {
      problems.push(problem('heroCollage', 'every box in this collage needs a size greater than zero'));
    } else if (!isNormalizedSizes(sizes as number[])) {
      problems.push(
        problem('heroCollage', `the sizes of a split in this collage must add up to ${children.length}`),
      );
    }
    children.forEach((child) => walk(child, depth + 1, ids));
  }

  walk(raw, 1, []);

  // Counted from what the walk actually reached.
  //
  // Reported whatever ELSE is wrong with the tree. It used to be gated behind
  // `problems.length === 0`, on the reasoning that a malformed subtree stops
  // the walk early and would produce a confusing count -- but a Plan 9 gate
  // review pointed out what that gate actually costs: a 25-photo collage that
  // also has one photo with a non-string `alt` reported only the alt, so she
  // fixed it, published again, and only THEN learned she was over the cap.
  // Two round trips to be told two things. And the gate never made the count
  // wrong-proof anyway: an early return can only make `photoIndex` an
  // UNDERcount, so `photoIndex > MAX_COLLAGE_PHOTOS` is still true of a tree
  // that really is over, and a tree that is under can never trip it. The
  // build-time guard (guards.ts's assertCollageTree) has never had this
  // condition, so removing it also stops the two ends disagreeing about WHEN
  // the cap is reported.
  //
  // Only the UPPER bound is checked here, and that is not an oversight: a
  // tree with ZERO photos is unrepresentable by construction. Every node is
  // either a photo or a split, every split carries at least
  // MIN_SPLIT_CHILDREN children, and every branch therefore bottoms out at a
  // photo -- so any tree that gets this far already has at least one. The
  // reachable "no photos" state is having no tree at all, which is
  // `validateGalleries`'s own MIN_COLLAGE_PHOTOS check on the `heroCollage`
  // field itself, not this function's. A check here would be one that cannot
  // fail, which this project counts as a defect rather than as caution.
  if (photoIndex > MAX_COLLAGE_PHOTOS) {
    problems.push(
      problem('heroCollage', `the collage has ${photoIndex} photos — ${MAX_COLLAGE_PHOTOS} is the most it can hold`),
    );
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
    if (isBlank(menu.file)) {
      problems.push(problem(`[${i}].file`, `"${String(menu.label ?? 'this menu')}" needs a file`));
    } else if (isUnsafeAssetPath(menu.file)) {
      problems.push(problem(`[${i}].file`, `"${String(menu.label ?? 'this menu')}" needs a file on this site, starting with /`));
    }
    return problems;
  });
}

// ---------------------------------------------------------------------------
// sections.json / pages.json (Plan 7, Task 1) — named, per-field messages
// for the discriminated Section union, alongside a thin wrap of
// assertSections/assertPages (src/content/guards.ts) for the two whole-file
// rules those two carry (sections.json's homepage completeness and
// hero-required checks; pages.json has neither). Task 4 Step 1's own
// requirement -- "make assertSections and validateContent carry" the id
// collision this plan's Add breaks D6's old invariant for -- is what
// `validateSectionEntry` below is for: a per-entry, owner-facing message,
// not just the one whole-file sentence guards.ts's own throw gives.

function validateWhatsAppButton(raw: unknown, path: string): ValidationProblem[] {
  if (raw === undefined) return [];
  const button = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(button.label)) problems.push(problem(`${path}.whatsapp.label`, 'the WhatsApp button needs a label'));
  if (isBlank(button.message)) problems.push(problem(`${path}.whatsapp.message`, 'the WhatsApp button needs a pre-filled message'));
  return problems;
}

// Named, per-field messages for one TemplateSection's own `content` --
// structurally the same shape assertTemplateContent (guards.ts) already
// throws on, but a named ValidationProblem per missing/blank field instead
// of one whole-section throw, matching every other per-record validator in
// this file (validateDish, validateDrink, ...).
function validateTemplateContentFields(template: string, raw: unknown, path: string): ValidationProblem[] {
  const content = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(content.heading)) problems.push(problem(`${path}.heading`, 'this section needs a heading'));
  problems.push(...validateWhatsAppButton(content.whatsapp, path));

  if (template === 'text') {
    if (!Array.isArray(content.paragraphs) || content.paragraphs.length === 0) {
      problems.push(problem(`${path}.paragraphs`, 'this section needs at least one paragraph'));
    } else {
      content.paragraphs.forEach((p, i) => {
        if (isBlank(p)) problems.push(problem(`${path}.paragraphs[${i}]`, `paragraph ${i + 1} is blank`));
      });
    }
  } else if (template === 'itemList') {
    if (!Array.isArray(content.items) || content.items.length === 0) {
      problems.push(problem(`${path}.items`, 'this section needs at least one item'));
    } else {
      content.items.forEach((raw, i) => {
        const item = asRecord(raw);
        if (isBlank(item.name)) problems.push(problem(`${path}.items[${i}].name`, `item ${i + 1} needs a name`));
        if (isBlank(item.description)) problems.push(problem(`${path}.items[${i}].description`, `item ${i + 1} needs a description`));
        if (isBlank(item.image)) {
          problems.push(problem(`${path}.items[${i}].image`, `item ${i + 1} needs an image`));
        } else if (isUnsafeAssetPath(item.image)) {
          problems.push(problem(`${path}.items[${i}].image`, `item ${i + 1} needs an image on this site, starting with /`));
        }
      });
    }
  } else if (template === 'gallery') {
    if (content.layout !== 'scroll' && content.layout !== 'grid') {
      problems.push(problem(`${path}.layout`, 'this section needs a layout of either "scroll" or "grid"'));
    }
    if (!Array.isArray(content.images) || content.images.length === 0) {
      problems.push(problem(`${path}.images`, 'this section needs at least one image'));
    } else {
      content.images.forEach((raw, i) => {
        const image = asRecord(raw);
        if (isBlank(image.src)) {
          problems.push(problem(`${path}.images[${i}].src`, `image ${i + 1} needs a source`));
        } else if (isUnsafeAssetPath(image.src)) {
          problems.push(problem(`${path}.images[${i}].src`, `image ${i + 1} needs an image on this site, starting with /`));
        }
        if (isBlank(image.alt)) problems.push(problem(`${path}.images[${i}].alt`, `image ${i + 1} needs alt text`));
      });
    }
  } else if (template === 'detailBlock') {
    if (isBlank(content.body)) problems.push(problem(`${path}.body`, 'this section needs a body'));
    if (!Array.isArray(content.facts)) {
      problems.push(problem(`${path}.facts`, 'this section needs a facts list'));
    } else {
      content.facts.forEach((raw, i) => {
        const fact = asRecord(raw);
        if (isBlank(fact.label)) problems.push(problem(`${path}.facts[${i}].label`, `fact ${i + 1} needs a label`));
        if (isBlank(fact.value)) problems.push(problem(`${path}.facts[${i}].value`, `fact ${i + 1} needs a value`));
      });
    }
  }
  // An unrecognised template has already been reported by the caller
  // (validateSectionEntry, below) before this function is ever called --
  // there is no content shape to validate for a template this codebase
  // doesn't know.
  return problems;
}

// One entry of a Section[] array (sections.json's own top level, or one
// page's own `sections` list) -- everything a single entry needs checked,
// named per field. `path` is the caller's own prefix (`[${i}]` for
// sections.json, `[${pageIndex}].sections[${i}]` for a page) so the same
// function produces a correctly-addressed message either way; `seenIds` is
// caller-owned for the identical scoping reason guards.ts's own
// `assertSectionEntry` documents (sections.json tracks one Set across the
// whole homepage; each page starts a fresh one).
function validateSectionEntry(raw: unknown, path: string, seenIds: Set<string>): ValidationProblem[] {
  const entry = asRecord(raw);
  const problems: ValidationProblem[] = [];
  const { kind, id, enabled } = entry;

  if (kind !== 'bespoke' && kind !== 'template') {
    return [problem(`${path}.kind`, 'this section needs a "kind" of "bespoke" or "template"')];
  }

  if (kind === 'bespoke') {
    if (!isSectionId(id)) {
      problems.push(problem(`${path}.id`, `"${String(id)}" is not a section this site knows`));
    } else if (seenIds.has(id)) {
      problems.push(problem(`${path}.id`, `"${id}" is already used by another section`));
    } else {
      seenIds.add(id);
    }
    if (typeof enabled !== 'boolean') {
      problems.push(problem(`${path}.enabled`, 'this section needs to say whether it is shown'));
    }
    // Review finding (Minor): the descheduling commit deleted this branch's
    // one-line "a built-in section cannot be scheduled" rule and the bespoke
    // branch's `publishAt` format check, and replaced neither -- so
    // sections.json and pages.json were the half of the old guard's reach
    // that nothing picked up (`assertSectionEntry` in guards.ts rebuilds
    // each entry from named keys, so a stray key never reaches runtime, and
    // shape.test.ts's own unknown-key sweep covered dish/drink/article
    // only). The generic rule on the next line covers `publishAt` and
    // everything else in the same breath, so this cannot need a fresh
    // one-off rule the next time a field is retired.
    problems.push(...validateKnownKeys(entry, BESPOKE_SECTION_KEYS, path, String(id ?? 'this section')));
    return problems;
  }

  // kind === 'template'
  if (isBlank(id)) {
    problems.push(problem(`${path}.id`, 'this section needs a name'));
  } else if (!isUrlSafeSlug(id)) {
    // C1 review fix: named per-field (unlike guards.ts's own throw, this is
    // the message she actually sees, before Publish) -- see
    // assertSectionEntry's own comment (guards.ts) for the full mechanism
    // this closes: an id containing a "." makes
    // template-section-paths.ts's own path parsing ambiguous, which used to
    // let a section named "Menu v2.0" reach sections.json and silently
    // discard every edit made to it at /edit.
    problems.push(
      problem(`${path}.id`, `"${id}" can only use letters a-z, numbers and hyphens -- try something like "our-menu"`),
    );
  } else if (isSectionId(id)) {
    problems.push(problem(`${path}.id`, `"${id}" collides with a built-in section -- choose a different name`));
  } else if (seenIds.has(id as string)) {
    problems.push(problem(`${path}.id`, `"${id}" is already used by another section`));
  } else {
    seenIds.add(id as string);
  }
  if (typeof enabled !== 'boolean') {
    problems.push(problem(`${path}.enabled`, 'this section needs to say whether it is shown'));
  }
  if (!isTemplateType(entry.template)) {
    problems.push(problem(`${path}.template`, `"${String(entry.template)}" is not a template this site knows`));
  } else {
    problems.push(...validateTemplateContentFields(entry.template, entry.content, `${path}.content`));
  }
  problems.push(...validateKnownKeys(entry, TEMPLATE_SECTION_KEYS, path, String(id ?? 'this section')));
  return problems;
}

function validateSections(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of sections')];
  const seenIds = new Set<string>();
  const problems = data.flatMap((entry, i) => validateSectionEntry(entry, `[${i}]`, seenIds));
  // The two whole-homepage rules (every bespoke id present, hero enabled)
  // are assertSections' own, and are only worth re-checking once every
  // per-entry problem above is already clean -- otherwise a homepage
  // missing `visit` entirely would show BOTH "missing required section
  // visit" and, confusingly, nothing per-entry about it (there is no entry
  // to attach a per-field message to for a section that isn't there at
  // all), which is exactly what this ordering avoids: the per-entry sweep
  // runs first and would have already flagged anything wrong with what IS
  // present, so a residual assertSections failure at this point is always
  // the whole-list shape itself, not a field within one entry.
  if (problems.length === 0) {
    try {
      assertSections(data);
    } catch (error) {
      problems.push(problem('', error instanceof Error ? error.message : String(error)));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// pages.json (Plan 7, Task 1)

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_PAGE_SLUGS = new Set(['blogs', 'edit']);

function validatePage(raw: unknown, index: number, seenSlugs: Set<string>): ValidationProblem[] {
  const page = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(page.slug)) {
    problems.push(problem(`[${index}].slug`, `page at position ${index} needs an address`));
  } else {
    const slug = (page.slug as string).trim();
    if (!SLUG_PATTERN.test(slug)) {
      problems.push(
        // The plain-English word for "a-z, no capitals" is deliberately
        // avoided in this message (and in this very comment) -- it is also
        // a real, bare, no-argument Tailwind utility with no numeric suffix
        // to distinguish it from ordinary prose, and this repo's content
        // scanner has no JS parser to tell a class name from a string
        // literal (see tailwind.config.js's own blocklist comment for the
        // general pattern). Confirmed directly, the hard way, twice over:
        // an earlier draft of the OWNER-FACING message below used that
        // word and shipped one unused rule; the FIRST draft of this very
        // explanatory comment then used the word again, in prose, and
        // shipped the identical rule a second time.
        problem(`[${index}].slug`, `"${page.slug}" is not a web-safe address -- use letters a-z, numbers and hyphens only, e.g. "our-menu"`),
      );
    } else if (RESERVED_PAGE_SLUGS.has(slug)) {
      problems.push(problem(`[${index}].slug`, `"${slug}" is already used by the site itself -- choose a different address`));
    } else if (seenSlugs.has(slug)) {
      problems.push(problem(`[${index}].slug`, `"${slug}" is already used by another page`));
    } else {
      seenSlugs.add(slug);
    }
  }
  if (isBlank(page.name)) {
    problems.push(problem(`[${index}].name`, `"${String(page.slug ?? 'this page')}" needs a name`));
  }
  if (typeof page.inNav !== 'boolean') {
    problems.push(problem(`[${index}].inNav`, `"${String(page.name ?? 'this page')}" needs to say whether it's shown in the navigation menu`));
  }
  if (typeof page.enabled !== 'boolean') {
    problems.push(problem(`[${index}].enabled`, `"${String(page.name ?? 'this page')}" needs to say whether it's shown on the site`));
  }
  const seo = asRecord(page.seo);
  if (isBlank(seo.title)) {
    problems.push(problem(`[${index}].seo.title`, `"${String(page.name ?? 'this page')}" needs an SEO title`));
  }
  if (isBlank(seo.description)) {
    problems.push(problem(`[${index}].seo.description`, `"${String(page.name ?? 'this page')}" needs an SEO description`));
  }
  if (!Array.isArray(page.sections)) {
    problems.push(problem(`[${index}].sections`, `"${String(page.name ?? 'this page')}" needs a list of sections`));
  } else {
    const seenSectionIds = new Set<string>();
    page.sections.forEach((entry, si) => {
      problems.push(...validateSectionEntry(entry, `[${index}].sections[${si}]`, seenSectionIds));
    });
  }
  problems.push(...validateKnownKeys(page, PAGE_KEYS, `[${index}]`, String(page.name ?? 'this page')));
  return problems;
}

function validatePages(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of pages')];
  const seenSlugs = new Set<string>();
  return data.flatMap((page, i) => validatePage(page, i, seenSlugs));
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
// developer hand-edits index.html to match. Refusing the write here, before
// it commits, is cheaper than recovering from that.
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
// awards.json (Phase 2's D1 pilot file -- worker/store.ts's D1_ONLY_PATHS).
//
// Task 5 left this as a deliberate no-op: without a RULES entry at all, the
// default-deny below refuses every awards.json publish outright, regardless
// of content, which would have made the D1 write path that task existed to
// prove permanently unreachable through POST /api/publish, and awards' real
// shape was not designed yet. Task 9 designs it (title, an awarding body, a
// year, an optional badge image -- Award, src/content/types.ts) and this is
// the write-boundary check for it, same posture and same idiom as every
// sibling validator in this file: built on AWARD_KEYS (guards.ts) for the
// unknown-key sweep the same way validateDish/validateArticle are built on
// DISH_KEYS/ARTICLE_KEYS, and following validatePress most closely -- a list
// of id-carrying records with a date-shaped field (year here, date there)
// and an optional image.
//
// Unlike validateDishes/validateDrinks/validatePress, an EMPTY list is not
// refused here: a brand new restaurant genuinely has zero awards on day one,
// and nothing in the spec requires at least one before the section may be
// published -- Awards.tsx's own chrome-only-when-empty rendering already
// treats a zero-length list as a normal, expected state, not an error one.
//
// Also unlike its siblings, awards.json needs a duplicate-id check of its
// own: dishes/drinks/press never gained one (nothing in this file threads a
// `seenIds` Set through validateDish/validateDrink/validateArticle), but two
// award records sharing an id would collide as React list keys in Awards.tsx
// exactly the way two sections sharing an id would in App.tsx's own dispatch
// -- so this reuses the seenIds-threaded-through-the-list shape
// validateSectionEntry/validateSections already establish below, rather than
// inventing a second one.
const YEAR_PATTERN = /^\d{4}$/;

function validateAward(raw: unknown, index: number, seenIds: Set<string>): ValidationProblem[] {
  const award = asRecord(raw);
  const problems: ValidationProblem[] = [];
  if (isBlank(award.id)) {
    problems.push(problem(`[${index}].id`, `award at position ${index} needs an id`));
  } else if (seenIds.has(award.id as string)) {
    problems.push(problem(`[${index}].id`, `"${award.id}" is already used by another award`));
  } else {
    seenIds.add(award.id as string);
  }
  if (isBlank(award.title)) {
    problems.push(problem(`[${index}].title`, 'this award needs a title'));
  }
  // `isBlank` alone is what catches a non-string awarding body too (its own
  // `typeof value !== 'string'` branch), the same way it already covers a
  // non-string dish/drink/article name above -- no separate `typeof` check
  // needed here.
  if (isBlank(award.awardedBy)) {
    problems.push(problem(`[${index}].awardedBy`, `"${String(award.title ?? 'this award')}" needs who awarded it`));
  }
  // Same reasoning: `isBlank` alone refuses a non-string year (a JSON
  // authoring mistake, `"year": 2026` instead of `"year": "2026"`) before
  // the pattern test ever runs, so a plausible-looking number is refused
  // exactly like an implausible string ("nineteen") is.
  if (isBlank(award.year) || !YEAR_PATTERN.test((award.year as string).trim())) {
    problems.push(problem(`[${index}].year`, `"${String(award.title ?? 'this award')}" needs a four-digit year`));
  }
  // `image` is optional -- absent is fine (Award['image'] is `string |
  // undefined`, never `null`, unlike Drink['image']) -- but a PRESENT value
  // must be a real, safe, on-site asset path, the same `isUnsafeAssetPath`
  // rule as every other image field in this file.
  if (award.image !== undefined) {
    if (isBlank(award.image)) {
      problems.push(problem(`[${index}].image`, `"${String(award.title ?? 'this award')}" needs a badge image, or leave it blank`));
    } else if (isUnsafeAssetPath(award.image)) {
      problems.push(problem(`[${index}].image`, `"${String(award.title ?? 'this award')}" needs a badge image on this site, starting with /`));
    }
  }
  problems.push(...validateKnownKeys(award, AWARD_KEYS, `[${index}]`, String(award.title ?? 'this award')));
  return problems;
}

function validateAwards(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of awards')];
  const seenIds = new Set<string>();
  return data.flatMap((award, i) => validateAward(award, i, seenIds));
}

// Review finding, carried forward from Task 5 rather than closed here: this
// RULES table is keyed by BASENAME (worker/index.ts's handlePublish calls
// `validateContent(basename(f.path), parsed)`), not by the full
// repo-relative path -- so the entry below also waves through any OTHER
// path that happens to end in "awards.json", e.g.
// `assets-source/food/awards.json`, where it previously 422'd with "This
// file cannot be edited here".
//
// Task 5's own mitigation claim here was checked directly (Task 9 review)
// and is FALSE: `ASSET_PATH` (worker/github.ts) is
// `/^assets-source\/[a-z0-9_-]+\/[A-Za-z0-9 ._-]+$/`, which matches
// `assets-source/food/awards.json` -- there is no "requires a real asset
// filename shape, not .json" refusal anywhere in that regex. Combined with
// this entry, such a path now both validates AND commits (worker/index.ts's
// handlePublish parses any `.json` path as UTF-8 and validates it on
// basename regardless of directory), where before this task it 422'd. The
// hole is therefore real, not merely a widened "told valid" with nothing
// to exploit it -- it is a widened "told valid" that a real write can reach.
//
// What actually limits it: this route is authenticated, and a session that
// can reach it can already commit arbitrary bytes to
// `assets-source/<any category>/<any filename>` through the exact same
// request shape -- this entry does not grant a session anything it could
// not already do to that directory; it only lets it *also* spell one such
// write "awards.json" and have it pass content validation instead of being
// refused outright. No worse than what an authenticated session already has.
//
// Not closed by this task: `validateContent`'s own signature
// (`validateContent(file: string, data: unknown, current?: unknown)`) only
// ever receives the basename -- validate.ts has no access to the full path
// at all, because the one caller (worker/index.ts's handlePublish, step 4)
// strips it before calling in. Making this validator path-aware would mean
// changing that call site to pass `f.path` instead of `basename(f.path)`,
// and either widening every RULES key to the full `src/content/*.json`
// shape or adding a second, path-keyed table just for this one file --
// worker/index.ts is not among this task's files, so that change is left
// unmade rather than made unreviewed alongside nine unrelated call sites.
// Recorded here, again, rather than silently carried: the fix, when someone
// takes it, is exactly the one Task 5 already named.

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
  'pages.json': validatePages,
  'awards.json': validateAwards,
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
