import type { CSSProperties, ImgHTMLAttributes, ReactNode } from 'react';

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

// Publishing is instantaneous, everywhere. There is no per-item or
// per-section "go live on this date" field on any type in this file, and no
// build-time or cron machinery that would act on one -- content is live the
// moment it is committed and the site rebuilds. A section she does not want
// shown yet is switched off (`enabled: false`), which is immediate,
// reversible, and the only visibility control this content model has.
export interface Dish {
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

export interface Drink {
  id: string;
  name: string;
  description: string;
  category: 'mocktail' | 'cocktail' | 'wine';
  image: string | null;
}

export interface Article {
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

// ---------------------------------------------------------------------------
// The hero collage, as a tree of splits. See src/content/collage.ts for the
// operations on it, the limits, and why a size is a number rather than a
// class name.

// 'row' lays a split's children out side by side (a vertical cut through the
// box); 'column' stacks them (a horizontal cut). Named for the CSS
// `flex-direction` each one renders as, so the data and the rendered layout
// cannot drift apart in anybody's head.
export type SplitDirection = 'row' | 'column';

// `id` is the ONE thing about a photo that survives every edit -- it is not
// derived from `src` (which she can replace) and not derived from position
// (which a swap changes). Task 4's swap exchanges two photos' POSITIONS in
// the tree, taking each photo's whole payload -- id, src and alt -- with it,
// exactly as the owner described the gesture: "the photo fills the box it
// travels to". So `galleries.heroCollage.<id>` names the same photograph
// before and after a swap, and a replacement she staged for it follows it
// across. A positional path (`heroCollage.5`, which is what this collage used
// before) would name a DIFFERENT photo the instant two are swapped -- the
// exact class of bug this project has hit repeatedly.
//
// `alt` may legitimately be empty, and is empty for all sixteen committed
// photos: this collage is decorative background behind the hero's own <h1>,
// tagline and phone numbers, and giving sixteen background photos alt text
// would make a screen reader read sixteen descriptions before the
// restaurant's name. `src` may not be blank -- see validate.ts.
export interface CollagePhoto {
  kind: 'photo';
  id: string;
  src: string;
  alt: string;
}

// N-ary children with a parallel `sizes` array, not strictly binary splits.
// Decided on what the editing gestures need, and the deciding case is Task
// 5's divider drag:
//
//   Three boxes in a row, A | B | C. With BINARY splits that is
//   `split(A, split(B, C))`, so the line the owner sees between A and B is
//   the OUTER split's divider -- dragging it grows A against the whole (B,C)
//   subtree, shrinking C as well, even though C is nowhere near the line she
//   grabbed. Her requirement is exactly the opposite: dragging a photo's
//   left edge to widen it must take that width from the box immediately to
//   its left, and from that box only -- one box, the adjacent one. (Her own
//   sentence is quoted verbatim in
//   docs/superpowers/plans/2026-08-05-plan-9-collage-split-tree.md and
//   deliberately paraphrased here: one of its words is also a real, bare,
//   no-argument Tailwind utility with no rule in the shipped stylesheet
//   today, and this repo's content scanner has no JS parser to tell a class
//   name from prose inside a comment. Same hazard, same remedy, as
//   validate.ts's own slug message and tailwind.config.js's `blocklist`.)
//   With n-ary children a divider is (this split, the gap at index i) and
//   resolves to `children[i]` and `children[i + 1]`, always exactly two
//   adjacent boxes, and the drag moves size between exactly those two while
//   conserving their total.
//
// It also keeps the tree shallow (the committed arrangement's middle band is
// one five-child row split that binary would need four nested levels for),
// which makes MAX_COLLAGE_DEPTH a meaningful limit rather than a formality,
// and it makes Task 6's remove cheaper: dropping one child of a three-child
// split needs no structural surgery at all, only a renormalise, where binary
// would leave a redundant one-child split to collapse every single time.
//
// The property binary was supposed to buy -- "every divider is unambiguous"
// -- is bought here by the sizes array instead, and more literally.
export interface CollageSplit {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  children: CollageNode[];
  // Proportions, parallel to `children`, normalised to sum to
  // `children.length` (src/content/collage.ts's `normalizeSizes`). A
  // mismatched length is refused by both the build-time guard and the write
  // boundary -- two positional arrays that can desync is precisely what a
  // validator is for.
  sizes: number[];
}

export type CollageNode = CollagePhoto | CollageSplit;

export interface Galleries {
  atmosphere: GalleryImage[];
  ourStory: GalleryImage[];
  // `null` is "there is no collage to draw", the same state the old
  // sixteen-entry array expressed as `[]`. It is not a publishable state --
  // validateContent refuses it, so a write can never produce one -- it exists
  // only as /edit's fallback for the moment before galleries.json has
  // finished loading, exactly as the empty array was before it. A tree with
  // ZERO photos is unrepresentable (see collage.ts), so this is the only way
  // "no photos" can be spelled at all.
  heroCollage: CollageNode | null;
}

// Phase 4. Kamalika's byline under the About prose. The six paragraphs are
// already written in her first person and already signed off in her name
// (src/content/story.json), so this adds attribution and a face rather than
// a second block of prose saying the same thing again -- which is what the
// spec's "adds Kamalika's personal introduction" turns out to mean once you
// read the copy that is already there.
//
// Every field is REQUIRED. A byline with no name, or a name with no
// photograph, reads as a half-finished page rather than as a smaller
// version of the same idea -- the same reasoning Experience['image'] uses
// (see that interface) and the opposite of Award['image'], where an award
// with no badge is simply an ordinary award.
//
// `portrait` is a site-relative derivative path ('/team/kamalika-anand.webp'),
// never an absolute URL: validateStory refuses anything else. The committed
// story.json is ONE OF THREE places (with src/content/press.json and
// src/components/ChefGallery.tsx) that keep this path inside
// src/content/__tests__/assets.test.ts's walk even after Phase 4 moves this
// document's live copy to D1 (see that task's own reasoning) -- not the
// only one, but the one this field's own value has to stay correct
// independent of the other two.
export interface ChefIntro {
  name: string;
  role: string;
  portrait: string;
  portraitAlt: string;
}

export interface StoryContent {
  heading: string;
  paragraphs: string[];
  chef: ChefIntro;
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
//
// Grew to eight in Phase 2 Task 9, the first time since this union was
// written. 'awards' is its own kind of member: every other SectionId names a
// component whose CONTENT lives in a JSON file on GitHub; awards' entries
// live in D1 instead (see the Award interface below), read at runtime rather
// than compiled in. Nine now, Phase 3: 'experiences' is back to the GitHub-
// JSON kind, same as every other member but 'awards' (see the Experience
// interface below for why this one is committed rather than D1). The id
// itself is still just a string in this union -- SECTION_ID_SET (guards.ts),
// SECTION_COMPONENTS (App.tsx, EditMode.tsx) and every other
// `Record<SectionId, …>` literal had to grow a matching entry before
// `tsc -b` went green again, which is the completeness guarantee working,
// not incidental churn.
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'experiences' | 'press' | 'awards' | 'visit';

// Phase 2's pilot, pulled forward from Phase 4. Built on D1 from the start
// rather than as a JSON file that would need migrating two months later --
// the spec's own words. `image` is the optional badge; everything else is
// required, because an award with no year or no awarding body is not an
// award, it is a claim.
export interface Award {
  id: string;
  title: string;
  awardedBy: string;
  year: string;
  image?: string;
}

// Phase 3. One card in the homepage carousel. `link` and `comingSoon` are
// BOTH declared because the spec names both, and they are kept from
// disagreeing by validateExperiences rather than by collapsing one into the
// other: a derived `comingSoon = link === undefined` would read the same in
// every rendering path today, but it would also make "an item that links
// somewhere AND says coming soon" unspellable, which is a decision that
// belongs in the validator where the owner gets a sentence about it, not in
// the type where she gets nothing.
//
// `image` is REQUIRED, unlike Award['image']. An award with no badge is an
// ordinary award; a carousel card with no photo is an empty rectangle. That
// difference is also why this file is committed JSON rather than D1 -- see
// the plan's own storage section: src/content/__tests__/assets.test.ts only
// walks src/content/, so a D1-stored image path would be checked by nothing.
//
// `link` is a site-relative path ("/catering"), never an absolute URL. The
// validator refuses anything else; Experiences.tsx resolves it against the
// live pages list and renders an unresolvable one as a coming-soon card
// rather than as a dead <Link>.
export interface Experience {
  id: string;
  title: string;
  description: string;
  image: string;
  link?: string;
  comingSoon: boolean;
}

// ---------------------------------------------------------------------------
// Phase 5. A post is a list of typed blocks.
//
// Three types, and they differ in what the reader is being given rather than
// in shape: a Recipe is something to cook, a Story is something to read, and
// a Mention is somebody else writing about the restaurant. The spec's own
// words: "Mention covers press coverage: publication, date, an excerpt in her
// own words, and a citation with a link." That is why a Mention's citation is
// a BLOCK rather than four fields on Post -- a Mention with two citations is
// a real thing (a piece syndicated twice), and a Recipe with a citation
// (adapted from a cookbook) is also a real thing. Putting it on the post
// would make the first unspellable and the second dishonest.
export type PostType = 'recipe' | 'story' | 'mention';

// Text fields on a block hold markdown restricted to INLINE syntax -- bold,
// emphasis, links, inline code. src/content/markdown.ts parses it to an AST
// and src/components/blog/Inline.tsx renders that AST as React elements. No
// block field ever holds markup, and nothing in this codebase turns one into
// markup: src/test/html-sinks.test.ts fails the build if any shipped module
// so much as names a parsing sink.
export type InlineText = string;

// The ten kinds, paired with their own content shape. `Block` below is
// DERIVED from this map -- a mapped type distributed over its own keys, not
// ten hand-written union members -- for exactly the reason
// TemplateContentMap's own comment (below) spells out at length: a
// hand-written union leaves every downstream `switch (block.kind)` narrowing
// over the OLD union when an eleventh kind is added, so the exhaustiveness
// check that was supposed to catch it compiles cleanly and the new kind
// silently renders nothing. Confirmed there by direct experiment; re-confirmed
// as this task's mutation 2 and not re-litigated here.
//
// `heading` carries no level. Every heading inside a post body is an <h2>
// under the post's own <h1> -- a level field would let her produce an <h4>
// under an <h2> with nothing between them, which is a real accessibility
// defect and buys a distinction she has no reason to want.
interface BlockContentMap {
  paragraph: { text: InlineText };
  heading: { text: InlineText };
  bulletList: { items: InlineText[] };
  numberList: { items: InlineText[] };
  // `caption` and `attribution` are OPTIONAL, and the review that found them
  // required is the reason they are not. Both were declared as required
  // `InlineText` while nothing at either boundary enforced them: `{ kind:
  // 'image', src, alt }` and `{ kind: 'quote', text }` are accepted by
  // validatePosts (validate.ts calls validateInlineLinks on them, which
  // returns [] for a non-string, deliberately -- its own comment already
  // calls the caption "genuinely optional") and waved through by assertBlock,
  // which stops at the discriminant and the key set. So the type promised a
  // string that a committed file need not carry, and the first consumer to
  // hand one to parseInline would have thrown on content already committed
  // to this branch.
  //
  // Fixed at the TYPE end rather than the validator end, because the
  // validator is right: a photo that speaks for itself needs no words under
  // it, and an unattributed quote is an ordinary thing. `?` is what makes the
  // compiler force every renderer to handle the absence instead of
  // discovering it at runtime.
  //
  // The contrast is `citation.url`, which stays REQUIRED and nullable
  // (`string | null`). "There is no online copy" is a fact the author states,
  // not a field she omits -- and validatePosts does catch a citation with the
  // key missing entirely, which is the behaviour that distinguishes the two.
  image: { src: string; alt: string; caption?: InlineText };
  gallery: { images: GalleryImage[] };
  quote: { text: InlineText; attribution?: InlineText };
  ingredients: { heading: string; items: InlineText[] };
  steps: { heading: string; items: InlineText[] };
  // `url` is nullable, matching Article['url'] -- press.json's own committed
  // entries prove a real citation sometimes has no online copy, and a
  // citation with no link is still a citation.
  citation: { publication: string; url: string | null; date: string };
}

export type BlockKind = keyof BlockContentMap;

export type Block = { [K in BlockKind]: { kind: K } & BlockContentMap[K] }[BlockKind];

// `image` is the CARD image -- what the index, the homepage section and (in
// 5C) the Open Graph tag use. Required, for the reason Experience['image'] is
// required and Award['image'] is not: a card with no photo is an empty
// rectangle, and every surface that lists posts is a grid of cards.
//
// `slug` is the URL, addressed at /blog/<slug>, and is checked for URL-safety
// and uniqueness by assertPosts (build time) and validatePosts (write
// boundary) -- the same two-ended treatment Page['slug'] already gets.
//
// `date` is "YYYY-MM-DD", the same shape Article['date'] uses and the same
// shape src/content/article-date.ts's formatArticleDate reads.
export interface Post {
  id: string;
  slug: string;
  type: PostType;
  title: string;
  date: string;
  excerpt: string;
  image: string;
  blocks: Block[];
}

// Plan 7, Task 1: the homepage's section list stops being seven fixed ids
// and becomes a list of two kinds -- bespoke sections rendered by name (the
// same seven above, unchanged) and template sections rendered by TYPE, with
// her own authored content. `kind` is the discriminant both variants below
// carry, which is what makes a `switch (section.kind)` (App.tsx,
// EditMode.tsx) exhaustive and a missing case a compile error, the same
// closure guarantee `SectionId` already gets from `SECTION_ID_SET`
// (guards.ts).
//
// `SectionId` itself stays closed at nine, on purpose (see this file's own
// comment on it, above) -- nothing she does can add a tenth. A template
// section's `id`, by contrast, is a free string SHE creates, so it carries
// no such closure and needs its own uniqueness rule instead (assertSections/
// assertPages in guards.ts: a template id must be unique among every
// section's id, bespoke and template alike, in the same list).
export interface BespokeSection {
  kind: 'bespoke';
  id: SectionId;
  enabled: boolean;
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
// partners) OR a single full-width hero photograph, told apart by `layout`
// alone; all three are the same `GalleryImage[]` list underneath.
// `GalleryImage` (declared above, `{ src, alt }`) is reused rather than a
// second, identical shape invented for this one field.
//
// 'hero' is the third member, added after the final branch review found the
// cooking-class pamphlet rendering at 60x96 and desaturated. 'grid' is the
// LOGO strip -- a fixed 96px-tall row of `object-contain`, `grayscale`
// images -- which is correct for a press logo and wrong for any photograph
// meant to be looked at. 'scroll' is right for a SET of photos but wrong for
// one, since a lone card in a horizontal scroller is a 256px square that
// crops a portrait document to nothing. A single image that is the point of
// the page needs its own arrangement, so it has one.
export type GalleryLayout = 'scroll' | 'grid' | 'hero';

export interface GalleryTemplateContent {
  heading: string;
  layout: GalleryLayout;
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
  [K in TemplateType]: { kind: 'template'; id: string; enabled: boolean; template: K; content: TemplateContentMap[K] };
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
// same per-template content checks sections.json gets).
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
  nav: { wordmark: string; links: NavLink[]; instagramLabel: string; menuLabel: string; pagesLabel: string };
  hero: { logoName: string; logoTagline: string; reservationsLabel: string; reserveButton: string };
  atmosphere: { heading: string };
  food: { heading: string };
  drinks: { heading: string; intro: string };
  experiences: { heading: string; intro: string };
  press: { heading: string; intro: string; readArticle: string; viewAll: string };
  // Chrome only -- the Awards entries themselves live in D1 (see the Award
  // interface, above), not here. Kept in copy.json, on GitHub, deliberately:
  // it is what lets this section's heading and intro render at first paint
  // with no network, and what keeps sections.test.tsx's marker assertion and
  // homepage-bytes.test.tsx's byte count deterministic regardless of D1's
  // own availability -- a database outage costs the list, never the section.
  awards: { heading: string; intro: string };
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
  // Phase 3. The homepage carousel's six cards, in experiences.json order --
  // committed JSON on the GitHub store (see Experience's own comment, above,
  // for why), present on ContentBundle from this task onward so the
  // rendering surface Task 3 adds needs no further plumbing here.
  experiences: Experience[];
  // Phase 5. Every post, in posts.json order -- committed JSON on the GitHub
  // store in 5A (see the Post interface's own comment on why the card image
  // being required is what decides that), read by /blog, /blog/:slug and the
  // homepage's own blog section. Present on ContentBundle from this task
  // onward so the rendering surfaces Tasks 7-9 add need no further plumbing.
  posts: Post[];
  // default: (_, v) => v -- see ContentContext.ts's defaultBundle.
  renderText(path: EditableTextPath, value: string): ReactNode;
  // default: (_, p) => createElement('img', p) -- see ContentContext.ts's defaultBundle.
  renderImage(path: EditableImagePath, props: ImgHTMLAttributes<HTMLImageElement>): ReactNode;
  // The two seams that let `/edit` add affordances to the collage while
  // Hero.tsx (the public page) stays entirely unaware anything is editable --
  // the same "default is the identity, /edit overrides it" shape
  // `renderText`/`renderImage` already establish. One per node kind, because
  // the two editing gestures this plan builds attach to different things: a
  // swap (Task 4) is a property of a PHOTO's box, and a divider (Task 5)
  // lives between two adjacent children of a SPLIT, which no photo-level seam
  // can reach.
  //
  // `box` carries everything the node's own outermost element must keep --
  // spread it (`<div {...box} onPointerDown={…}>`) and an override cannot
  // accidentally drop the sizing that places the box. `path` is
  // `galleries.heroCollage.<node id>` for both kinds; ids are unique across
  // the whole tree (guards.ts), so one scheme addresses every node without
  // ambiguity, and a photo's path is the SAME string Hero.tsx hands
  // `renderImage`, so a staged replacement and an editing affordance always
  // name the same photograph.
  //
  // Both defaults are the real public renderer, not a stub -- see
  // `defaultRenderCollagePhoto`/`defaultRenderCollageSplit` in
  // src/content/context.ts, which /edit also uses verbatim for the parts of
  // the collage it does not override.
  renderCollagePhoto(path: EditableImagePath, photo: CollagePhoto, box: CollageBox, image: ReactNode): ReactNode;
  renderCollageSplit(path: string, split: CollageSplit, box: CollageBox, children: ReactNode[]): ReactNode;
}

// What every collage node's own outermost element has to carry: the Tailwind
// chrome for its kind, and the inline sizing that places it inside its parent
// split (`flexGrow` from the parent's `sizes`, plus a zero `flexBasis` so an
// image's intrinsic width never leaks into the ratio). Deliberately one
// spreadable object rather than two parameters: an override that forgets one
// of them is a layout bug that renders almost right, which is the hardest
// kind to notice.
export interface CollageBox {
  className: string;
  style: CSSProperties;
}
