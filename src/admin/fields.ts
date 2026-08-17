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
  BespokeSection,
  MenuFile,
  GalleryImage,
  Hours,
  TextTemplateContent,
  ItemListTemplateContent,
  GalleryTemplateContent,
  DetailBlockTemplateContent,
  TemplateListItem,
  TemplateFact,
  TemplateWhatsAppButton,
  Page,
  PageSeo,
  Award,
  Experience,
  ChefIntro,
  Post,
} from '../content/types';
// The runtime list of gallery layouts, not a second copy of it. guards.ts
// holds the one array (checked exhaustive against the union at compile
// time) that assertTemplateContent and validateTemplateContentFields both
// test against, so the select below cannot offer her a layout the server
// then refuses -- or miss one it would have accepted.
// POST_TYPES joins it for the identical reason -- the one array checked
// exhaustive against the PostType union at compile time.
import { GALLERY_LAYOUTS, POST_TYPES } from '../content/guards';
import type { UploadCategory } from '../shared/upload-categories';

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
// Task 9's own addition: PhotoField.tsx's `category` prop is required (it
// has no default worth guessing -- an upload with the wrong category commits
// to the wrong assets-source/ subfolder), and nothing before this task ever
// gave Field.tsx a value to hand it. A THIRD branch, not a `category?:
// UploadCategory` bolted onto the plain (non-select) branch above, for the
// identical excess-property-checking reason this file's own header comment
// gives for splitting out the 'select' branch in the first place: a bare
// optional field would let `kind: 'image'` compile with no `category` at
// all, silently reproducing the exact gap this change exists to close.
// `optional: true` marks a field whose KEY may be legitimately absent from
// the record (`link?: string` on Experience, `image?: string` on Award) --
// never a field that is merely allowed to hold an empty-looking value while
// still being required (Article's own `date`, kept present-but-blank by
// RecordForm.test.tsx's own pinned case). RecordForm reads this to decide
// what "she cleared the box" should commit: for an ordinary field it stays
// `{ ...value, [key]: '' }`, matching every kind that has always worked this
// way; for an `optional` one, RecordForm deletes the key instead, so the
// record round-trips to the exact shape a fresh, never-filled-in item would
// have (`blankExperience`'s own `{ ..., comingSoon: true }`, no `link` key
// at all) rather than to a `''` that reads as present-but-invalid. Present on
// all three branches below (not just the plain one) because `image`-kind
// fields can be optional too -- Award's badge is the other real example,
// even though PhotoField itself never emits a blank value for it today (see
// AWARD_FIELDS.image's own comment) -- marking it here keeps the descriptor
// honest about the type it describes rather than only covering the one
// shape that happens to be reachable right now.
export type FieldSpec<V = unknown> =
  | { label: string; kind: Exclude<Kind<V>, 'select' | 'image'>; help?: string; optional?: true }
  | { label: string; kind: Extract<Kind<V>, 'select'>; options: readonly V[]; help?: string; optional?: true }
  | { label: string; kind: Extract<Kind<V>, 'image'>; category: UploadCategory; help?: string; optional?: true };

// `Required<T>` makes an optional content field (e.g. `Drink.image`, which
// is nullable) required *in the descriptor* -- the dashboard still needs a
// label and a kind for a field even though a particular record is allowed to
// leave it empty.
export type FieldsOf<T> = { [K in keyof Required<T>]: FieldSpec<Required<T>[K]> };

// ---------------------------------------------------------------------------
// Dish, Drink, Article -- the three list-shaped content types.

export const DISH_FIELDS: FieldsOf<Dish> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell dishes apart -- changing it does not rename or relink anything else.',
  },
  name: { label: 'Name', kind: 'text' },
  description: { label: 'Description', kind: 'textarea' },
  // 'food', not a dish-specific folder: assets-source/food/ is the one
  // subfolder every real dish photo in this repo already lives under
  // (src/content/dishes.json's own `image` paths), and UPLOAD_CATEGORIES
  // (src/shared/upload-categories.ts) has no finer-grained dish category.
  image: { label: 'Photo', kind: 'image', category: 'food' },
  // types.ts is explicit that `tags` is authored on every dish but not
  // rendered by any component today. Say the same thing here: an editing
  // tool that doesn't must not let the owner assume this field is visible
  // to a diner, because it is not.
  tags: {
    label: 'Dietary tags',
    kind: 'tags',
    help: 'Recorded for later use but not shown anywhere on the site today -- no page renders these yet, so editing this list changes nothing a diner sees.',
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
  // 'mocktails' is the one bar-drink folder UPLOAD_CATEGORIES actually has
  // (src/shared/upload-categories.ts) -- there is no separate 'cocktails' or
  // 'wine' subfolder, so every drink photo (mocktail, cocktail or wine
  // alike) lands here regardless of the `category` field above; confirmed
  // against the real, committed drinks.json, where the one drink with a
  // photo today stores it at /mocktails/piccante.webp.
  image: { label: 'Photo', kind: 'image', category: 'mocktails', help: 'Optional -- leave empty for no photo.' },
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
  // 'press' -- matches where every real press.json `image` value lives on
  // disk today (public/press/*.webp).
  image: { label: 'Photo', kind: 'image', category: 'press' },
};

// Phase 2, Task 11: awards.json's own descriptor -- the closest existing
// shape is ARTICLE_FIELDS just above (an id-carrying record with a
// date-shaped field and an optional photo), and this follows it field for
// field rather than inventing a second convention for what is, to her, the
// same kind of screen.
//
// `image` is `kind: 'image', category: 'press'`, not a new 'awards' upload
// category: UPLOAD_CATEGORIES (src/shared/upload-categories.ts) is a fixed,
// hand-maintained allowlist the Worker also enforces (worker/upload.ts), and
// widening it is a real, separately-reviewable decision this task's own
// brief does not ask for. 'press' is the closest existing fit in meaning, not
// merely the closest available slot: a badge from an awarding body is the
// same kind of third-party recognition a press logo is, and every award
// badge lands in the same folder every press photo already does.
//
// Unlike Dish/Article, `Award['image']` is OPTIONAL (`string | undefined`,
// types.ts), never required and never `null` -- there is no "leave blank to
// remove," because PhotoField has no clear/remove action at all (it only
// ever calls `onChange` when a NEW photo is staged, never with `null` or
// `''`); a freshly added award simply never has the key at all until she
// uploads one. `Required<Award>['image']` is still a plain `string` for
// `Kind<V>`'s purposes, the identical shape DISH_FIELDS.image and
// ARTICLE_FIELDS.image already use.
export const AWARD_FIELDS: FieldsOf<Award> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell awards apart -- changing it does not rename or relink anything else.',
  },
  title: { label: 'Title', kind: 'text' },
  awardedBy: {
    label: 'Awarding body',
    kind: 'text',
    help: 'Who gave you this award -- the publication, organisation or event that recognised you.',
  },
  year: { label: 'Year', kind: 'text', help: 'A four-digit year, e.g. 2026.' },
  // `optional: true` for the same reason EXPERIENCE_FIELDS.link now carries
  // it -- Award['image'] is a genuinely optional key (the comment above this
  // descriptor already establishes that). PhotoField has no clear/remove
  // control today, so nothing in this dashboard can actually commit a blank
  // value here yet and this flag is inert in practice; it is set anyway so
  // the descriptor doesn't silently drift back into the same trap the day a
  // remove action is added to PhotoField.
  image: {
    label: 'Badge photo',
    kind: 'image',
    category: 'press',
    help: 'Optional -- leave it empty if this award has no badge to show.',
    optional: true,
  },
};

// Phase 4. story.json's chef byline, rendered at the TOP of the About panel
// -- above the paragraph list she already knows -- because it is the part
// of that panel a first-time visitor can complete without reading anything.
//
// Labels are second person, unlike every other descriptor in this file.
// That is deliberate and it is the only place it happens: the owner IS the
// chef, so "Awarding body" and "Publication" describe someone else while
// "Your name" describes her. The alternative ("Chef's name") makes her
// dashboard talk about her in the third person.
//
// `category: 'team'` -- already a member of UPLOAD_CATEGORIES
// (src/shared/upload-categories.ts), already the directory
// assets-source/team/ her portrait lives in, and already what
// scripts/images.mjs writes public/team/*.webp from. No widening needed.
export const CHEF_FIELDS: FieldsOf<ChefIntro> = {
  name: { label: 'Your name', kind: 'text' },
  role: {
    label: 'What you are',
    kind: 'text',
    help: 'One short line under your name, e.g. "Chef and owner".',
  },
  portrait: {
    label: 'Your photo',
    kind: 'image',
    category: 'team',
    // The honest cost, in front of her rather than in a ledger she will
    // never read. The words in this panel now publish straight to the
    // database and are live in seconds; a NEW photo still has to be
    // processed by the site build, which takes a couple of minutes. Both
    // halves are true and she has no way to find out otherwise.
    help: 'Changing your photo takes a couple of minutes to appear, unlike the words above it, which are live as soon as you publish.',
  },
  portraitAlt: {
    label: 'Description of your photo',
    kind: 'text',
    help: 'A few words describing the photo, read aloud to anyone using a screen reader. "Chef Kamalika Anand" is enough.',
  },
};

// Phase 3, Task 8: experiences.json's own descriptor -- ExperiencesArea.tsx.
export const EXPERIENCE_FIELDS: FieldsOf<Experience> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell items apart -- changing it does not rename or relink anything else.',
  },
  title: { label: 'Title', kind: 'text' },
  description: {
    label: 'Short description',
    kind: 'textarea',
    help: 'One line, shown under the title on the card.',
  },
  image: {
    label: 'Photo',
    kind: 'image',
    category: 'experiences',
    help: 'Every card needs a photo -- the card is mostly photo.',
  },
  // The field she is NOT expected to fill in by hand, and the reason it is
  // 'text' rather than a 'select' over page slugs: FieldSpec's select branch
  // requires `options: readonly V[]`, a compile-time literal, and the set of
  // page slugs is runtime content she can change. A select built from a
  // stale literal would offer her a page that no longer exists, which is
  // worse than a text box. The validator refuses anything that is not a
  // site-relative slug path, and Experiences.tsx degrades an unresolvable
  // one to a coming-soon card, so a wrong value here is caught before
  // publish and harmless if it somehow lands.
  // `optional: true` (FieldSpec's own comment above has the full reasoning):
  // without it, clearing this box committed `link: ''` -- a key RecordForm's
  // old plain `{ ...value, [key]: next }` path always wrote, present but
  // blank -- which validateExperience then read as BOTH "needs a page, or
  // leave it blank" (the pattern test on a blank string) AND, once she also
  // has `comingSoon: true`, "is marked coming soon, so it cannot open a page
  // yet" (the pair rule, which only excuses `undefined`, never `''`). Two
  // contradictory errors on a box she has already emptied, with no UI action
  // that clears either one -- reproduced directly against `mockEditBackend`.
  // With this flag, the same gesture now deletes the key, exactly matching
  // `blankExperience`'s own no-`link` shape, so the box being empty and the
  // key being absent are finally the same state.
  link: {
    label: 'Opens page',
    kind: 'text',
    help: 'Leave this blank for a coming-soon item. Otherwise a page on this site, like /catering.',
    optional: true,
  },
  comingSoon: {
    label: 'Coming soon',
    kind: 'toggle',
    help: 'A coming-soon item shows a stamp and does not open anything. Turn this off only once it has a page to open.',
  },
};

// ---------------------------------------------------------------------------
// Post -- and the one record type in this file that CANNOT be described whole.
//
// `FieldsOf<Post>` is uninhabitable, and that is a fact about the type system
// rather than a limitation of this file. FieldsOf demands a FieldSpec for
// every key of Required<T>; FieldSpec<V>'s three branches are all keyed on
// Kind<V>; and Kind<Block[]> matches none of Kind's five cases, so it is
// `never`, so no value of any shape satisfies it. Confirmed with a probe
// module: `blocks: { label: 'Blocks', kind: 'text' }` inside a
// FieldsOf<Post> fails `tsc -b` with TS2322 "Type 'string' is not assignable
// to type 'never'".
//
// So blocks are edited entirely outside FieldsOf/RecordForm -- the same
// decision GalleryList.tsx and StoryForm.tsx already took for an array-valued
// field, and the same `FieldsOf<Pick<...>>` shape GALLERY_IMAGE_FIELDS above
// already uses. PostList.tsx renders RecordForm<PostMeta> for the scalars and
// BlockList for the rest.
export type PostMeta = Omit<Post, 'blocks'>;

export const POST_FIELDS: FieldsOf<PostMeta> = {
  // 'readonly', and the label and help rewritten with it rather than left as
  // the sixth verbatim copy of a sentence written for hand-authored short
  // ids (DISH_FIELDS.id and the four after it). Three things were wrong with
  // that copy here, all found by review: 'ID' is a developer's word for a
  // developer's concept; "a short identifier" describes something this value
  // is not, since blankPost (PostsArea.tsx) makes it a 36-character
  // crypto.randomUUID(); and "changing it does not rename or relink anything
  // else" is false in THIS list, which is the part that made the box worse
  // than useless. PostList keys each row on `post.id`, so editing it
  // remounted the row and threw focus out of the box she was typing in on
  // every keystroke; the staged-photo bytes are collected under
  // `posts.json:<id>:image`, so an edit after picking a photo orphaned them;
  // and a value colliding with a sibling makes PostsArea's own
  // `byId.get(id)` reorder duplicate one post and drop another.
  //
  // Field.tsx's 'readonly' branch renders `<input disabled readOnly>` with no
  // onChange wired at all, so there is no write path left to close -- the
  // same mechanism nine SITE_FIELDS entries already rely on. Problems still
  // render: Field paints `problems` outside its kind switch, so a
  // `[i].id` message ("two posts share the id") still appears on the field.
  // The one thing that becomes unfixable from this dashboard is exactly that
  // collision, which needs hand-edited JSON or a stale draft to reach at all
  // -- so the help below names the escape hatch instead of pretending she can
  // do something about it, the same posture SITE_READONLY_HELP takes.
  id: {
    label: 'Reference',
    kind: 'readonly',
    help: 'Generated automatically when the post is created, and never shown to a visitor. It only tells posts apart, so there is nothing to fill in here. If the dashboard ever complains about this, ask your developer.',
  },
  // The web address, and the one field that is expensive to change after
  // publishing: an inbound link to the old one stops working. Said here
  // rather than left for her to find out, because nothing in this dashboard
  // can add a redirect on her behalf.
  slug: {
    label: 'Web address',
    kind: 'text',
    help: 'The last part of the post’s address, e.g. "spaghetti-all-assassina" for /blog/spaghetti-all-assassina. Letters a-z, numbers and hyphens only. Changing it after the post is live breaks any link anyone already has to it.',
  },
  // Options come from POST_TYPES (src/content/guards.ts), the one array that
  // is checked exhaustive against the PostType union at compile time -- the
  // same reason SECTION_FIELDS reads GALLERY_LAYOUTS rather than retyping
  // three strings. A select that could offer a type the validator refuses,
  // or miss one it accepts, is the failure this avoids.
  type: {
    label: 'Kind of post',
    kind: 'select',
    options: POST_TYPES,
    help: 'A recipe is something to cook, a story is something to read, and a mention is somebody else writing about the restaurant.',
  },
  title: { label: 'Title', kind: 'text' },
  date: { label: 'Published on', kind: 'date' },
  excerpt: {
    label: 'Short summary',
    kind: 'textarea',
    help: 'One or two sentences. This is what shows on the card, not in the post itself.',
  },
  // 'posts', the ninth upload category (src/shared/upload-categories.ts) and
  // the first one added for a content type rather than reused from a
  // neighbour -- unlike AWARD_FIELDS.image, which borrows 'press'. A post
  // photo is a full-width figure and a press logo is a small badge; sharing a
  // directory would mean sharing a max width neither wants.
  image: { label: 'Card photo', kind: 'image', category: 'posts' },
};

// ---------------------------------------------------------------------------
// sections.json, menus.json, galleries.json, and site.json's hours[] rows.

// Plan 7, Task 1: `FieldsOf<BespokeSection>`, not `FieldsOf<Section>` --
// SectionList.tsx's own screen only ever reorders/toggles the seven
// bespoke, component-backed entries (D6's "still only PERMUTES the seven"),
// never a template one, and `Section` (now a discriminated union) has no
// single `Required<T>` shape FieldsOf could describe directly. `kind` is
// declared (every key `BespokeSection` has must be, the same completeness
// FieldsOf<Dish> already enforces) but, like MENU_FIELDS.file below, never
// actually rendered through Field's generic dispatch -- SectionList.tsx
// hand-builds its own row markup and has no reason to show her an internal
// discriminant she never needs to see.
export const SECTION_FIELDS: FieldsOf<BespokeSection> = {
  kind: { label: 'Kind', kind: 'readonly' },
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
  // `kind: 'text'` here is never actually rendered -- AdminApp.tsx's own
  // menus section replaces this one field with PdfField directly (the same
  // "sibling component instead of a tenth kind" swap Field.tsx already makes
  // for `image`/PhotoField), because PdfField's own `name` prop
  // has to be derived from the record's CURRENT `file` value (so a
  // same-name replacement really does commit to the same path -- see
  // worker/upload.ts's own `menuAssetPath`), not a single unchanging value a
  // descriptor field could hold the way `image`'s `category` does above.
  // Kept here only so FieldsOf<MenuFile> stays total over every real key.
  file: { label: 'PDF file', kind: 'text' },
};

// Review finding (Task 9): an earlier version of this descriptor was
// `FieldsOf<GalleryImage>` in full, including a `src: { kind: 'image',
// category: 'atmosphere' }` entry -- a REAL image-kind FieldSpec, with a
// category that is WRONG for half of what this descriptor is shared by
// (GalleryList.tsx renders `src` directly through PhotoField with its own
// per-list category, 'atmosphere' or 'our_story', never reading this field
// at all). That made it a landmine: nothing stops a future caller from
// rendering `GALLERY_IMAGE_FIELDS.src` through `Field`'s ordinary generic
// dispatch the way every OTHER `image`-kind descriptor here is meant to be
// used -- and it is also the one `image`-kind descriptor
// fields.test.ts's own category sweep does not check (that sweep only
// covers DISH_FIELDS/DRINK_FIELDS/ARTICLE_FIELDS.image, the fields Field.tsx
// actually dispatches on), so a wrong category sitting there could reach
// production with nothing to catch it: every `ourStory` photo uploaded
// through that path would land in `assets-source/atmosphere/` instead.
//
// Fixed by not declaring `src` here at all -- `Pick<GalleryImage, 'alt'>`,
// not the full `GalleryImage`, is this descriptor's real type. `alt` is the
// only field GalleryList.tsx actually reads off it; `src` is handled
// entirely outside FieldsOf/Field.tsx, the same way MENU_FIELDS.file's own
// comment (above) documents for an unrelated reason.
export const GALLERY_IMAGE_FIELDS: FieldsOf<Pick<GalleryImage, 'alt'>> = {
  alt: { label: 'Alt text', kind: 'text', help: 'Describes the photo for screen readers and search engines.' },
};

// story.json's own heading -- the one FieldSpec story.json needs.
// `paragraphs` (a `string[]` prose list, not a single scalar) has no
// FieldSpec kind that fits it: 'tags' renders one comma-joined line, which
// would flatten six real paragraphs into a single unreadable row and offer
// no per-paragraph add/remove/reorder or per-paragraph validation message.
// StoryForm.tsx handles `paragraphs` itself, the same way GalleryList.tsx
// handles its own arrays outside FieldsOf/RecordForm entirely.
export const STORY_HEADING_FIELD: FieldSpec<string> = { label: 'Heading', kind: 'text' };

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
  'nav.pagesLabel': string;
  'hero.logoName': string;
  'hero.logoTagline': string;
  'hero.reservationsLabel': string;
  'hero.reserveButton': string;
  'atmosphere.heading': string;
  'food.heading': string;
  'drinks.heading': string;
  'drinks.intro': string;
  'experiences.heading': string;
  'experiences.intro': string;
  'press.heading': string;
  'press.intro': string;
  'press.readArticle': string;
  'press.viewAll': string;
  'awards.heading': string;
  'awards.intro': string;
  'visit.heading': string;
  'visit.navigateButton': string;
  'visit.mapTitle': string;
  'footer.hoursHeading': string;
  'footer.followLabel': string;
  'footer.reservationsLabel': string;
  'footer.rightsSuffix': string;
  'footer.instagramLabel': string;
  'footer.linkedinLabel': string;
  // Two of copy.json's seven `blogsPage` leaves, not all seven. The other
  // five (title, subtitle, back, previous, next) were the header, the back
  // button and the Previous/Next labels of BlogsPage.tsx, which Phase 5 Task
  // 8 took off every route -- /blogs redirects to /blog, and BlogIndex.tsx,
  // which renders there, has no header and numbers its pages rather than
  // stepping through them. A review found them still rendering as five
  // labelled controls on /edit/manage that changed nothing anywhere, which
  // is the worst thing a dashboard can do to somebody who is not going to
  // read the code to find out why. Removing the descriptor is what removes
  // the control; the VALUES stay in copy.json, untouched, because the
  // component that reads them stays on disk under the owner's never-delete
  // constraint (src/test/no-dead-backend.test.ts) and a page put back into
  // service should find its own words where it left them.
  //
  // heading and intro are live and stay: BlogIndex.tsx paints both through
  // renderText.
  'blogsPage.heading': string;
  'blogsPage.intro': string;
  'notFound.heading': string;
  'notFound.back': string;
}

export const COPY_FIELDS: FieldsOf<CopyLeafShape> = {
  'nav.wordmark': { label: 'Wordmark', kind: 'text' },
  'nav.instagramLabel': { label: 'Instagram link label', kind: 'text' },
  'nav.menuLabel': { label: 'Menu button label', kind: 'text' },
  'nav.pagesLabel': {
    label: 'Pages menu label',
    kind: 'text',
    help: "The one word the nav groups your separate pages under -- Catering, Cheeseboards and the rest. Only shown once you have two or more pages in the nav.",
  },
  'hero.logoName': { label: 'Hero logo name', kind: 'text' },
  'hero.logoTagline': { label: 'Hero logo tagline', kind: 'text' },
  'hero.reservationsLabel': { label: 'Reservations label', kind: 'text' },
  'hero.reserveButton': { label: 'Reserve button', kind: 'text' },
  'atmosphere.heading': { label: 'Gallery heading', kind: 'text' },
  'food.heading': { label: 'Menu heading', kind: 'text' },
  'drinks.heading': { label: 'Drinks heading', kind: 'text' },
  'drinks.intro': { label: 'Drinks intro', kind: 'textarea' },
  // Chrome only, the same split as awards.heading/awards.intro below: the
  // carousel's six cards themselves are experiences.json, out of scope for
  // /edit's inline editing this task (no UI -- see Experience's own comment,
  // src/content/types.ts). Heading and intro are plain copy.json text, so
  // they get the ordinary field treatment every other section's chrome does.
  'experiences.heading': { label: 'Experiences heading', kind: 'text' },
  'experiences.intro': { label: 'Experiences intro', kind: 'textarea' },
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
  // Chrome only -- the Awards entries themselves are D1-backed and out of
  // scope for /edit's inline editing this phase (Copy['awards']'s own
  // comment, src/content/types.ts). Task 11 gives them their own screen in
  // /edit/manage instead (AWARD_FIELDS, above, and AwardsArea.tsx) -- this
  // entry stays limited to the two copy.json strings because /edit's own
  // page overlay is untouched, not because the records are still
  // unreachable everywhere. Heading and intro are plain copy.json
  // text, so they get the ordinary field treatment every other section's
  // chrome does.
  'awards.heading': { label: 'Awards heading', kind: 'text' },
  'awards.intro': { label: 'Awards intro', kind: 'textarea' },
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
  // See CopyLeafShape above for why this group is two entries and not seven.
  'blogsPage.heading': { label: 'Stories page heading', kind: 'text' },
  'blogsPage.intro': { label: 'Stories page intro', kind: 'textarea' },
  'notFound.heading': { label: '404 heading', kind: 'text' },
  'notFound.back': { label: '404 back link', kind: 'text' },
};

// SiteContent's `hours` field (Hours[]) is deliberately absent below -- it's
// an array of objects, not a single value any FieldSpec kind can describe;
// each row is edited through HOURS_FIELDS instead. This is not the same
// split CopyLeafShape makes for Copy.nav.links: HOURS_FIELDS is a real,
// used dashboard-facing descriptor, while nav.links has no counterpart anywhere
// in src/admin/ -- there is no NAV_LINKS_FIELDS, and no other path edits a
// nav link's label either. That is a real, recorded gap (the edit mode
// plan's own D10 miss), not a parallel design choice to hours.
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

// ---------------------------------------------------------------------------
// Plan 7, Task 4, Step 2: template section content. The first DISCRIMINATED
// descriptor -- FieldsOf<TextTemplateContent> and FieldsOf<ItemListTemplateContent>
// are genuinely different shapes behind one `TemplateType` value, so there is
// no single `FieldsOf<TemplateContent>` the way DISH_FIELDS is one
// `FieldsOf<Dish>`. TemplateContentForm.tsx is what picks the right one of
// the four below, by `template` -- each covers only the SCALAR fields
// (`heading`, `body`, `layout`); every array field (`paragraphs`, `items`,
// `images`, `facts`) is handled by TemplateContentForm itself, the exact
// same "arrays handled outside FieldsOf/RecordForm entirely" precedent
// StoryForm.tsx's own header comment documents for `paragraphs` and
// GalleryList.tsx's for its own three lists.
export const TEXT_TEMPLATE_FIELDS: FieldsOf<Pick<TextTemplateContent, 'heading'>> = {
  heading: { label: 'Heading', kind: 'text' },
};

export const ITEM_LIST_TEMPLATE_FIELDS: FieldsOf<Pick<ItemListTemplateContent, 'heading'>> = {
  heading: { label: 'Heading', kind: 'text' },
};

export const GALLERY_TEMPLATE_FIELDS: FieldsOf<Pick<GalleryTemplateContent, 'heading'>> = {
  heading: { label: 'Heading', kind: 'text' },
};

// Kept as a bare FieldSpec, not folded into GALLERY_TEMPLATE_FIELDS -- the
// same STORY_HEADING_FIELD precedent (a single field with no sibling array
// to share a FieldsOf<T> with).
export const GALLERY_LAYOUT_FIELD: FieldSpec<GalleryTemplateContent['layout']> = {
  label: 'Layout',
  kind: 'select',
  options: GALLERY_LAYOUTS,
  // "Grid" no longer claims to be "usable for any small photo set" -- it is
  // not. It renders every image 96px tall and in black and white, which is
  // what a press logo wants and what a photograph does not; the branch
  // review found two live sections shipping as grey thumbnails because this
  // help text said otherwise. Say what each one actually looks like.
  help: '"Scroll" is a horizontal photo strip (Atmosfera\'s own layout) -- use it for a set of photos. "Hero" shows one large photo down the middle of the page, at its own shape -- use it when the picture IS the point. "Grid" is the logo row: small, black and white until you hover, for B2B clients and press mentions.',
};

export const DETAIL_BLOCK_TEMPLATE_FIELDS: FieldsOf<Pick<DetailBlockTemplateContent, 'heading' | 'body'>> = {
  heading: { label: 'Heading', kind: 'text' },
  body: { label: 'Body', kind: 'textarea' },
};

// Item list's own per-item fields -- `image` is handled through PhotoField
// directly (GALLERY_IMAGE_FIELDS' own precedent), not through Field's
// generic 'image' dispatch, since TemplateContentForm supplies the upload
// category itself rather than a FieldSpec carrying one.
export const TEMPLATE_LIST_ITEM_FIELDS: FieldsOf<Pick<TemplateListItem, 'name' | 'description'>> = {
  name: { label: 'Name', kind: 'text' },
  description: { label: 'Description', kind: 'textarea' },
};

export const TEMPLATE_FACT_FIELDS: FieldsOf<TemplateFact> = {
  label: { label: 'Label', kind: 'text', help: 'A short heading, e.g. "Day" or "Price".' },
  value: { label: 'Value', kind: 'text' },
};

export const WHATSAPP_BUTTON_FIELDS: FieldsOf<TemplateWhatsAppButton> = {
  label: { label: 'Button label', kind: 'text' },
  message: { label: 'Pre-filled WhatsApp message', kind: 'textarea' },
};

// A template section's own id -- her name for it, not a SectionId (there
// are only seven of those and this plan does not add an eighth -- see
// SectionId's own comment, types.ts). Free text, checked for uniqueness and
// collision with a built-in section server-side (guards.ts's
// assertSectionEntry) -- this descriptor only supplies the label/help; the
// actual refusal is what Task 4 Step 1 asks TemplateSectionList.tsx to
// surface inline, not silently allow and let the publish step reject.
// C1 review fix: the help text used to say only "must be different from
// every other section's name" -- true, but silent about the OTHER rule this
// field has always enforced server-side (guards.ts's own assertSectionEntry,
// validate.ts's own validateSectionEntry): letters a-z, numbers and hyphens
// only. A name like "Menu v2.0" used to pass this field with no warning,
// render editable at /edit, and silently discard every edit made to it --
// see guards.ts's own comment on assertSectionEntry for the full mechanism.
// Stated here now so she sees the constraint before she hits it as a
// validation problem.
export const TEMPLATE_SECTION_ID_FIELD: FieldSpec<string> = {
  label: 'Section name',
  kind: 'text',
  help: 'Used only to tell this section apart from others -- not shown to a visitor. Letters a-z, numbers and hyphens only (e.g. "our-menu"), and must be different from every other section\'s name.',
};

// ---------------------------------------------------------------------------
// Plan 7, Task 4, Step 3: pages.json's own scalar fields. `sections`
// (a list inside a list) is deliberately absent -- PageList.tsx handles it
// directly through TemplateSectionList, the same "arrays handled outside
// FieldsOf/RecordForm entirely" precedent this file's own template
// descriptors above already follow.
export const PAGE_FIELDS: FieldsOf<Pick<Page, 'slug' | 'name' | 'inNav' | 'enabled'>> = {
  slug: {
    label: 'Web address',
    kind: 'text',
    help: 'The page\'s own address, e.g. "our-menu" for viabiancadelhi.com/our-menu. Letters a-z, numbers and hyphens only.',
  },
  name: { label: 'Page name', kind: 'text' },
  inNav: { label: 'Shown in the navigation menu', kind: 'toggle' },
  enabled: { label: 'Shown on the site', kind: 'toggle' },
};

export const PAGE_SEO_FIELDS: FieldsOf<PageSeo> = {
  title: { label: 'SEO title', kind: 'text', help: 'Shown in the browser tab and search results.' },
  description: { label: 'SEO description', kind: 'textarea', help: 'Shown under the title in search results.' },
};
