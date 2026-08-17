import { describe, it, expect } from 'vitest';
// Direct JSON imports, not `../../content` (index.ts): that file is the
// stale build-time snapshot Task 3 replaces, and importing it here would
// drag all nine content JSON files into whatever imports this test's
// helpers. copy.json and site.json are imported directly instead -- the
// same thing fields.ts itself would need to avoid, if it ever needed real
// content (it doesn't; every descriptor there is a hand-written literal).
import copyRaw from '../../content/copy.json';
import siteRaw from '../../content/site.json';
import {
  DISH_FIELDS,
  DRINK_FIELDS,
  ARTICLE_FIELDS,
  SECTION_FIELDS,
  MENU_FIELDS,
  GALLERY_IMAGE_FIELDS,
  HOURS_FIELDS,
  COPY_FIELDS,
  SITE_FIELDS,
  STORY_HEADING_FIELD,
  TEXT_TEMPLATE_FIELDS,
  ITEM_LIST_TEMPLATE_FIELDS,
  GALLERY_TEMPLATE_FIELDS,
  GALLERY_LAYOUT_FIELD,
  DETAIL_BLOCK_TEMPLATE_FIELDS,
  TEMPLATE_LIST_ITEM_FIELDS,
  TEMPLATE_FACT_FIELDS,
  WHATSAPP_BUTTON_FIELDS,
  TEMPLATE_SECTION_ID_FIELD,
  PAGE_FIELDS,
  PAGE_SEO_FIELDS,
  POST_FIELDS,
} from '../fields';
import { UPLOAD_CATEGORIES } from '../../shared/upload-categories';

// Every FieldsOf<T> descriptor already gets its completeness and shape
// checked by tsc -b at every build -- that is this whole task's point, and
// re-asserting `Object.keys(...).sort()` here would be the exact test
// task-2-brief.md warns against: it cannot fail on the defect it would
// claim to catch (mutate FieldsOf<Dish> to Record<string, FieldSpec> and an
// assertion like that stays green). This file instead checks the one thing
// tsc cannot: that each descriptor actually renders something -- a label
// worth reading and a `kind` the dashboard knows how to draw.
const ALL_KNOWN_KINDS = ['text', 'textarea', 'image', 'select', 'date', 'readonly', 'tags', 'toggle', 'number'];

function checkSpecs(specs: Record<string, { label: string; kind: string }>) {
  Object.entries(specs).forEach(([key, spec]) => {
    expect(spec.label.trim().length, `${key}.label`).toBeGreaterThan(0);
    expect(ALL_KNOWN_KINDS, `${key}.kind`).toContain(spec.kind);
  });
}

describe('every descriptor has a non-empty label and a real kind', () => {
  it('DISH_FIELDS', () => checkSpecs(DISH_FIELDS));
  it('DRINK_FIELDS', () => checkSpecs(DRINK_FIELDS));
  it('ARTICLE_FIELDS', () => checkSpecs(ARTICLE_FIELDS));
  it('SECTION_FIELDS', () => checkSpecs(SECTION_FIELDS));
  it('MENU_FIELDS', () => checkSpecs(MENU_FIELDS));
  it('GALLERY_IMAGE_FIELDS', () => checkSpecs(GALLERY_IMAGE_FIELDS));
  it('HOURS_FIELDS', () => checkSpecs(HOURS_FIELDS));
  it('COPY_FIELDS', () => checkSpecs(COPY_FIELDS));
  it('SITE_FIELDS', () => checkSpecs(SITE_FIELDS));
  // Plan 7, Task 4, Step 2/3.
  it('TEXT_TEMPLATE_FIELDS', () => checkSpecs(TEXT_TEMPLATE_FIELDS));
  it('ITEM_LIST_TEMPLATE_FIELDS', () => checkSpecs(ITEM_LIST_TEMPLATE_FIELDS));
  it('GALLERY_TEMPLATE_FIELDS', () => checkSpecs(GALLERY_TEMPLATE_FIELDS));
  it('DETAIL_BLOCK_TEMPLATE_FIELDS', () => checkSpecs(DETAIL_BLOCK_TEMPLATE_FIELDS));
  it('TEMPLATE_LIST_ITEM_FIELDS', () => checkSpecs(TEMPLATE_LIST_ITEM_FIELDS));
  it('TEMPLATE_FACT_FIELDS', () => checkSpecs(TEMPLATE_FACT_FIELDS));
  it('WHATSAPP_BUTTON_FIELDS', () => checkSpecs(WHATSAPP_BUTTON_FIELDS));
  it('PAGE_FIELDS', () => checkSpecs(PAGE_FIELDS));
  it('PAGE_SEO_FIELDS', () => checkSpecs(PAGE_SEO_FIELDS));
  // Phase 5B, Task 4. Added by hand, and the sweeps in this file are the
  // reason: every describe block here names its descriptors explicitly, so a
  // new one is picked up by NOTHING until it is listed -- the task brief said
  // this file's checks would find POST_FIELDS on their own, and they do not.
  it('POST_FIELDS', () => checkSpecs(POST_FIELDS));
  it('GALLERY_LAYOUT_FIELD / TEMPLATE_SECTION_ID_FIELD (bare FieldSpecs, not FieldsOf)', () => {
    checkSpecs({ layout: GALLERY_LAYOUT_FIELD, sectionId: TEMPLATE_SECTION_ID_FIELD });
  });
});

// Plan 7, Task 4: GALLERY_LAYOUT_FIELD is the one 'select' descriptor this
// task adds -- the same "options actually match what the runtime guard
// accepts" proof DRINK_FIELDS.category already gets below, for the
// identical reason (a select whose options drift from what
// assertTemplateContent/validateTemplateContentFields actually accept
// would offer her a choice the server then refuses).
describe('GALLERY_LAYOUT_FIELD lists the same three layouts guards.ts/validate.ts accept', () => {
  it('options are exactly ["scroll", "grid", "hero"]', () => {
    expect(GALLERY_LAYOUT_FIELD.kind).toBe('select');
    if (GALLERY_LAYOUT_FIELD.kind === 'select') {
      expect([...GALLERY_LAYOUT_FIELD.options].sort()).toEqual(['grid', 'hero', 'scroll']);
    }
  });

  // The help text is what tells her which one to pick, and picking wrong is
  // exactly how the catering gallery and the cooking-class pamphlet shipped
  // as grey 96px thumbnails: the old text called the grid "usable for any
  // small photo set", which it is not -- it renders logos, in black and
  // white, 96px tall. A select whose options are right and whose
  // description is misleading is the same defect one layer up, so the
  // grid's two defining, surprising properties are asserted present here.
  it('the help text warns that the grid is a small black-and-white logo row', () => {
    const help = GALLERY_LAYOUT_FIELD.help ?? '';
    expect(help.toLowerCase()).toContain('black and white');
    expect(help.toLowerCase()).toContain('logo');
    expect(help.toLowerCase()).not.toContain('usable for any small photo set');
  });
});

describe('DISH_FIELDS.category-equivalent controlled vocabularies carry their options', () => {
  it('DRINK_FIELDS.category lists the same three categories assertDrinkCategory accepts', () => {
    // FieldSpec<V>'s discriminated union means a select field's declared
    // type only exposes `options` once `kind === 'select'` is proven --
    // `.options` isn't reachable off the union directly, the same narrowing
    // any renderer consuming this descriptor would need. That union already
    // makes a typo'd or bogus category a compile-time error in fields.ts
    // itself (options: readonly V[], V being Drink['category']'s literal
    // union). What tsc cannot catch is the reverse -- Drink['category']
    // gaining a fourth member that this options list never mentions --
    // since `readonly V[]` only requires every listed option be a real V,
    // not that every V be listed. This runtime check is what closes that
    // gap, hand-checked against assertDrinkCategory (src/content/guards.ts)
    // rather than imported from it, so it does not silently pass by
    // comparing the same list to itself if that function's own list ever
    // drifted.
    const categorySpec = DRINK_FIELDS.category;
    expect(categorySpec.kind).toBe('select');
    if (categorySpec.kind !== 'select') throw new Error('unreachable -- asserted above');
    expect(categorySpec.options).toEqual(['mocktail', 'cocktail', 'wine']);
  });
});

// `Dish.tags` is authored but not rendered anywhere on the site today
// (src/content/types.ts's comment on the field). An editing tool that
// doesn't say so risks the owner assuming her edit changed something a
// diner sees. This is the one field.help string this suite pins by
// content, not just presence -- everything else only needs a label and a
// known kind (checked generically above).
// Task 9: every real, dashboard-rendered `image`-kind field must carry a
// `category` that is actually a member of UPLOAD_CATEGORIES (the same list
// worker/upload.ts enforces server-side) -- checkSpecs above only proves
// `kind` is a KNOWN kind, never that an 'image' field's `category` is a REAL
// one. Confirmed directly: `checkSpecs` alone stays green if
// `DISH_FIELDS.image.category` were quietly changed to `'nonexistent'`
// (still a string, still compiles as a literal type error only tsc -b would
// catch -- but this runtime check is what catches the SAME mistake made
// through an `as UploadCategory` cast, which tsc cannot).
function imageCategory(spec: { kind: string; category?: string }): string {
  if (spec.kind !== 'image' || spec.category === undefined) throw new Error('not an image-kind spec');
  return spec.category;
}

describe("every real 'image'-kind descriptor carries a category the Worker actually accepts, and the RIGHT one", () => {
  it('DISH_FIELDS.image is category "food" -- matches every real dishes.json image path', () => {
    expect(DISH_FIELDS.image.kind).toBe('image');
    expect(imageCategory(DISH_FIELDS.image)).toBe('food');
  });

  it('DRINK_FIELDS.image is category "mocktails" -- the one bar-drink folder that exists', () => {
    expect(DRINK_FIELDS.image.kind).toBe('image');
    expect(imageCategory(DRINK_FIELDS.image)).toBe('mocktails');
  });

  it('ARTICLE_FIELDS.image is category "press"', () => {
    expect(ARTICLE_FIELDS.image.kind).toBe('image');
    expect(imageCategory(ARTICLE_FIELDS.image)).toBe('press');
  });

  // 'posts', not 'press': a post's card photo is a full-width figure and a
  // press logo is a small badge, so sharing a directory would mean sharing a
  // max width neither wants (scripts/paths.mjs's DIR_MAX_WIDTH).
  it('POST_FIELDS.image is category "posts" -- its own directory, not press\'s', () => {
    expect(POST_FIELDS.image.kind).toBe('image');
    expect(imageCategory(POST_FIELDS.image)).toBe('posts');
  });

  it.each([DISH_FIELDS.image, DRINK_FIELDS.image, ARTICLE_FIELDS.image, POST_FIELDS.image])(
    'category is a real, known upload category',
    (spec) => {
      expect(UPLOAD_CATEGORIES).toContain(imageCategory(spec));
    },
  );
});

describe("STORY_HEADING_FIELD: story.json's one FieldSpec (paragraphs is bespoke, in StoryForm.tsx)", () => {
  it('is a plain, non-blank-labelled text field', () => {
    expect(STORY_HEADING_FIELD.kind).toBe('text');
    expect(STORY_HEADING_FIELD.label.trim().length).toBeGreaterThan(0);
  });
});

describe('the two field.help strings task-2-brief.md calls out by name', () => {
  it('DISH_FIELDS.tags warns that tags are not rendered on the site yet', () => {
    expect(DISH_FIELDS.tags.help).toMatch(/not (yet )?(shown|rendered|visible)/i);
  });

  it("COPY_FIELDS['press.readArticle'] says it drives both the homepage teaser and /blogs", () => {
    expect(COPY_FIELDS['press.readArticle'].help).toMatch(/homepage/i);
    expect(COPY_FIELDS['press.readArticle'].help).toMatch(/blogs/i);
  });
});

// `checkSpecs` above only proves `kind` is SOME known kind, never the RIGHT
// one -- it would stay green if `DISH_FIELDS.name.kind` were quietly
// changed from 'text' to 'readonly' (both are legal members of
// Kind<string>), silently locking a field the owner needs to be able to
// edit. tsc -b can't catch this either: `Kind<V>` describes which kinds a
// VALUE TYPE permits, not which kind a given field is supposed to have --
// editing semantics aren't part of the type. Confirmed directly: that exact
// mutation (DISH_FIELDS.name.kind -> 'readonly') passes `tsc -b --noEmit`
// clean and left every test in this file green before the checks below
// existed.
//
// The fix is an explicit allowlist per descriptor, naming exactly which
// keys may be 'readonly' or 'select' -- so any OTHER field silently
// acquiring either kind fails here, and any of the named ones silently
// losing it does too.
function keysWithKind(specs: Record<string, { kind: string }>, kind: string): string[] {
  return Object.entries(specs)
    .filter(([, spec]) => spec.kind === kind)
    .map(([key]) => key)
    .sort();
}

describe('exactly the expected fields are kind: readonly or kind: select -- nothing else silently became uneditable or turned into a picker', () => {
  it('DISH_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(DISH_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(DISH_FIELDS, 'select')).toEqual([]);
  });

  it('DRINK_FIELDS: category is the only select field, nothing is readonly', () => {
    expect(keysWithKind(DRINK_FIELDS, 'select')).toEqual(['category']);
    expect(keysWithKind(DRINK_FIELDS, 'readonly')).toEqual([]);
  });

  it('ARTICLE_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(ARTICLE_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(ARTICLE_FIELDS, 'select')).toEqual([]);
  });

  // Plan 7, Task 1: SECTION_FIELDS is now FieldsOf<BespokeSection>, which
  // adds the `kind` discriminant (see that descriptor's own comment,
  // fields.ts) -- `kind` is readonly too, for the identical "described but
  // never actually rendered" reason MENU_FIELDS.file already documents.
  it('SECTION_FIELDS: id and kind are the only readonly fields, nothing is select', () => {
    expect(keysWithKind(SECTION_FIELDS, 'readonly')).toEqual(['id', 'kind']);
    expect(keysWithKind(SECTION_FIELDS, 'select')).toEqual([]);
  });

  it('MENU_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(MENU_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(MENU_FIELDS, 'select')).toEqual([]);
  });

  it('GALLERY_IMAGE_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(GALLERY_IMAGE_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(GALLERY_IMAGE_FIELDS, 'select')).toEqual([]);
  });

  // Review finding: GALLERY_IMAGE_FIELDS used to also declare `src`, an
  // `image`-kind FieldSpec with a category that is only ever right for
  // HALF of what shares this descriptor (GalleryList.tsx's atmosphere and
  // ourStory lists) -- a landmine for any future caller that rendered it
  // through Field.tsx's ordinary dispatch instead of GalleryList's own
  // per-list category. `alt` is the only key this descriptor is meant to
  // have; this is the runtime half of the compile-time guarantee (`Pick<
  // GalleryImage, 'alt'>` in fields.ts, not the full `GalleryImage`) --
  // `Object.keys` is what actually observes the object has no OTHER own
  // key at runtime, not just that `src` fails to type-check if read.
  it('GALLERY_IMAGE_FIELDS declares ONLY alt -- no image-kind `src` landmine', () => {
    expect(Object.keys(GALLERY_IMAGE_FIELDS)).toEqual(['alt']);
  });

  it('HOURS_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(HOURS_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(HOURS_FIELDS, 'select')).toEqual([]);
  });

  it('COPY_FIELDS has no readonly or select fields', () => {
    expect(keysWithKind(COPY_FIELDS, 'readonly')).toEqual([]);
    expect(keysWithKind(COPY_FIELDS, 'select')).toEqual([]);
  });

  // The one descriptor where 'readonly' is not just permitted but required:
  // name, tagline, and every seo.* key are duplicated by hand into
  // index.html (src/test/head.test.ts), so editing them here without also
  // hand-editing index.html fails the deploy. strapline is deliberately
  // absent from this list -- head.test.ts does not pin it -- so its
  // exclusion from the expected array below is itself the regression test
  // for "strapline must stay editable."
  it('SITE_FIELDS: name, tagline, and every seo.* are readonly; nothing is select', () => {
    expect(keysWithKind(SITE_FIELDS, 'readonly')).toEqual(
      ['name', 'seo.description', 'seo.keywords', 'seo.locale', 'seo.ogImage', 'seo.title', 'seo.url', 'tagline'].sort(),
    );
    expect(keysWithKind(SITE_FIELDS, 'select')).toEqual([]);
  });

  it('POST_FIELDS: type is the only select field, nothing is readonly', () => {
    expect(keysWithKind(POST_FIELDS, 'select')).toEqual(['type']);
    expect(keysWithKind(POST_FIELDS, 'readonly')).toEqual([]);
  });
});

// Phase 5B, Task 4. POST_FIELDS describes `Omit<Post, 'blocks'>` rather than
// Post, and it is not a style choice: FieldsOf<Post> is uninhabitable because
// Kind<Block[]> resolves to `never` (see that descriptor's own comment in
// fields.ts). The compile-time half of that is the `Omit` itself; this is the
// runtime half, the same shape GALLERY_IMAGE_FIELDS' own "declares ONLY alt"
// check takes -- Object.keys is what actually observes there is no `blocks`
// entry, not merely that reading one would fail to type-check.
describe('POST_FIELDS covers every scalar field of a post and nothing else', () => {
  it('declares no entry for blocks -- BlockList edits those, not RecordForm', () => {
    expect(Object.keys(POST_FIELDS)).not.toContain('blocks');
  });

  it('declares every other key of Post', () => {
    expect(Object.keys(POST_FIELDS).sort()).toEqual(['date', 'excerpt', 'id', 'image', 'slug', 'title', 'type']);
  });

  // Hand-written, never imported from guards.ts: POST_FIELDS.type.options IS
  // POST_TYPES, so comparing the two would compare a list to itself and stay
  // green if that array ever drifted from what isPostType accepts. Same
  // reasoning as DRINK_FIELDS.category above.
  it('the type select offers exactly the three kinds isPostType accepts', () => {
    const spec = POST_FIELDS.type;
    expect(spec.kind).toBe('select');
    if (spec.kind !== 'select') throw new Error('unreachable -- asserted above');
    expect([...spec.options].sort()).toEqual(['mention', 'recipe', 'story']);
  });
});

// The leaf-coverage check below is deliberately content-coupled: copy.json's
// and site.json's *shape* -- which fields exist -- is developer-owned even
// though their *values* are the owner's, the same reasoning
// src/content/__tests__/shape.test.ts already applies to dishes/drinks/press
// via DISH_KEYS. `keyof Copy`/`keyof SiteContent` can't drive this
// completeness check at the type level (see fields.ts's own comment on
// CopyLeafShape/SiteLeafShape for why), so it runs here instead, against the
// real, committed JSON.
//
// Any array-of-objects field (Copy.nav.links, SiteContent.hours) is not a
// leaf any FieldSpec kind can describe (Kind<V> in fields.ts has no branch
// that produces one for an array of objects) and is skipped entirely, not
// recursed into. An array of strings (SiteContent.phones) IS a leaf -- kind
// 'tags' describes the whole array as one field -- so it is collected as
// one path, not expanded per element.
function collectLeafPaths(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) out.push(prefix);
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) => collectLeafPaths(v, prefix ? `${prefix}.${key}` : key, out));
  }
  // `value === null` (e.g. Drink.image, SiteContent.socials.linkedin) is
  // deliberately not collected as a leaf: this walk only ever runs over
  // copy.json and site.json, and site.json's `socials.linkedin` is a
  // non-null URL today, so this branch does not currently fire -- it exists
  // only so a future null value here fails loudly by omission (missing from
  // `paths`, so the "no orphaned entry" direction below stays meaningful)
  // rather than by silently miscounting.
}

// The five leaves copy.json still carries and the dashboard deliberately
// does not offer. Phase 5 Task 8 took BlogsPage.tsx off every route (/blogs
// redirects to /blog, and BlogIndex.tsx renders there with no page header
// and numbered pages rather than Previous/Next). A review of that task found
// these five still rendering as labelled controls on /edit/manage that
// changed nothing anywhere -- "Stories page title", "Back link", "Previous
// button" and the rest -- so their COPY_FIELDS descriptors were removed.
//
// The VALUES stay in copy.json on purpose: BlogsPage.tsx stays on disk under
// the owner's never-delete constraint (src/test/no-dead-backend.test.ts
// fails if it goes), it still reads all seven, and the dashboard's own write
// path spreads the fetched object (`withLeaf`, src/admin/sections/copy-fields.ts)
// rather than rebuilding it from this map, so an unlisted leaf survives a
// publish untouched instead of being dropped into a build failure.
//
// Written out here rather than filtered by prefix, so a SIXTH orphan --
// including a future blogsPage leaf -- still fails the walk below by name.
const NOT_ON_THE_DASHBOARD = [
  'blogsPage.title',
  'blogsPage.subtitle',
  'blogsPage.back',
  'blogsPage.previous',
  'blogsPage.next',
];

describe('COPY_FIELDS covers every editable leaf in the real, committed copy.json', () => {
  const paths: string[] = [];
  collectLeafPaths(copyRaw, '', paths);

  it('the walk actually found leaves (a regression in the walker itself would make every check below vacuous)', () => {
    expect(paths.length).toBeGreaterThan(20);
  });

  it.each(paths.filter((path) => !NOT_ON_THE_DASHBOARD.includes(path)))(
    'copy.json leaf "%s" has a COPY_FIELDS entry',
    (path) => {
      expect(Object.prototype.hasOwnProperty.call(COPY_FIELDS, path), path).toBe(true);
    },
  );

  // Both halves of the exemption, so it cannot go stale in either direction:
  // the leaf is really still in copy.json (otherwise this list is excusing
  // something that no longer exists, and the walk above lost a real check
  // for nothing), and it really has no descriptor (otherwise the control is
  // back on /edit/manage and nothing here would have said so).
  it.each(NOT_ON_THE_DASHBOARD)('retired leaf "%s" is still in copy.json but has no COPY_FIELDS entry', (path) => {
    expect(paths, path).toContain(path);
    expect(Object.prototype.hasOwnProperty.call(COPY_FIELDS, path), path).toBe(false);
  });

  // What she would actually see. The five labels below were real controls on
  // /edit/manage under the "Stories page" group at the reviewed commit, and
  // the two above them are the ones that must NOT go with them -- BlogIndex
  // paints both on the live /blog page.
  it.each(['Stories page title', 'Stories page subtitle', 'Back link', 'Previous button', 'Next button'])(
    'no field on /edit/manage is still labelled "%s"',
    (label) => {
      expect(Object.values(COPY_FIELDS).map((spec) => spec.label)).not.toContain(label);
    },
  );

  it('keeps the two Stories-page fields the live /blog page really renders', () => {
    expect(Object.keys(COPY_FIELDS)).toContain('blogsPage.heading');
    expect(Object.keys(COPY_FIELDS)).toContain('blogsPage.intro');
  });

  it('has no COPY_FIELDS entry that does not correspond to a real leaf in copy.json', () => {
    const orphaned = Object.keys(COPY_FIELDS).filter((key) => !paths.includes(key));
    expect(orphaned).toEqual([]);
  });
});

describe('SITE_FIELDS covers every editable leaf in the real, committed site.json (hours[] excluded, edited via HOURS_FIELDS)', () => {
  const paths: string[] = [];
  collectLeafPaths(siteRaw, '', paths);

  it('the walk actually found leaves', () => {
    expect(paths.length).toBeGreaterThan(10);
  });

  it.each(paths)('site.json leaf "%s" has a SITE_FIELDS entry', (path) => {
    expect(Object.prototype.hasOwnProperty.call(SITE_FIELDS, path), path).toBe(true);
  });

  it('has no SITE_FIELDS entry that does not correspond to a real leaf in site.json', () => {
    const orphaned = Object.keys(SITE_FIELDS).filter((key) => !paths.includes(key));
    expect(orphaned).toEqual([]);
  });

  it('excludes hours[] from the walk entirely (array of objects, not a leaf)', () => {
    expect(paths).not.toContain('hours');
    expect(paths.some((p) => p.startsWith('hours'))).toBe(false);
  });
});
