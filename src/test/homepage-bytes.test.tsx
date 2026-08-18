import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';

// Pinned by hand in four separate plan reviews and enforced by nothing
// until now. Measured with `TextEncoder`, not `.length`: the rendered page
// contains U+00A0 (non-breaking space) and `é`, both of which are one JS
// UTF-16 code unit but more than one UTF-8 byte, so `.length` reads 53454 --
// a different number that is not the invariant this test exists to guard.
//
// Every task in the worker plan runs this. A change here is either a real,
// deliberate edit to the public homepage (state the old and new numbers and
// what accounts for the difference, in the same commit) or a regression --
// this test cannot tell those apart, which is the point: it forces the
// distinction to be made explicitly rather than silently.
//
// ---------------------------------------------------------------------------
// THIS FILE IS EXCLUDED FROM `npm run test:deploy`, AND MUST STAY EXCLUDED.
// ---------------------------------------------------------------------------
// "Forces a developer to make the distinction explicitly" is the right
// discipline for a developer. It is an outright bug for the restaurant owner,
// and that was proven the hard way: a fifteen-character edit to one dish
// description, published from the dashboard, took the homepage from 47758 to
// 47773 bytes. The publish succeeded, the commit landed on `main`, and then
// the Cloudflare build ran `test:deploy`, failed HERE, and refused the
// deploy. The edit never reached the site.
//
// Worse, it did not fail alone. The bad commit sits on `main`, so every
// SUBSEQUENT publish of any other file failed this same assertion too, and
// the owner had no way out: worker/github.ts's `isContentPath` restricts
// publishing to `src/content/*.json`, so the dashboard physically cannot
// touch this file to update the number. Every control she could reach made
// it worse.
//
// That is not an edge case. Dish names, drink descriptions, opening hours,
// gallery images, page copy -- anything the homepage renders moves this
// number, which is to say: normal use of the product.
//
// So the two audiences are split rather than the test being weakened:
//
//   npm test         runs this. A DEVELOPER changing the homepage without
//                    meaning to is still caught, before merge, exactly as
//                    designed. Nothing about that guarantee is reduced.
//   npm run test:deploy   does not. A CONTENT PUBLISH is a deliberate,
//                    legitimate homepage change made by someone who cannot
//                    edit this file, so blocking the build on it blocks the
//                    product's primary function.
//
// package.json's `test:deploy` carries the `--exclude` (alongside the one for
// images.derivatives, which is excluded for its own unrelated reason), and
// src/test/hosting.test.ts asserts that exclusion is still there -- because
// silently losing it would restore the outage without anything going red.
//
// Plan 6, Task 2, Step 3: 53473 -> 53485 (+12 bytes). `galleries.json`'s
// entry 4 gained an explicit `row-start-1` -- twelve ASCII characters,
// including the leading space Hero.tsx's own template-literal join adds
// (`` `${className} relative overflow-hidden` ``) -- so it stops
// auto-placing into an implicit seventh row, where `Hero.tsx:57`'s
// `overflow-hidden` hid it. This is the one task in this plan that is
// EXPECTED to move this number: `className` is rendered into the DOM
// verbatim regardless of whether Tailwind has a matching CSS rule for it,
// so this invariant cannot see -- and is not the guard for -- the CSS
// repair itself (Task 2's own rule-level stylesheet diff is).
//
// Plan 6, Task 4, Step 1: 53485 -> 53773 (+288 bytes). Hero.tsx passed
// `draggable={false}` on every one of the sixteen collage `<img>`s (React
// renders `draggable` as an explicit `draggable="false"` attribute, never
// omitted the way a plain boolean HTML attribute would be for `false` --
// eighteen bytes, `" draggable=\"false\""`, times sixteen tiles).
//
// I-A review finding (repair): 53773 -> 53485 (-288 bytes), back to the
// pre-Task-4 number. The `draggable={false}` above was never the only way
// to stop native HTML5 image drag from hijacking a real drag-to-move's
// pointer sequence -- it was just the one that happened to cost public
// bytes for an /edit-only requirement. `dragstart` bubbles, so
// CollageTile.tsx's own `onDragStart` on its (edit-only) tile wrapper
// cancels the child `<img>`'s native drag just as effectively, confirmed
// directly in real Chromium (see that file's own comment for the full
// comparison against the other candidates that also worked). Hero.tsx (the
// public page) no longer sets `draggable` on this `<img>` at all.
//
// Drinks section rebuild: 53486 -> 44113 (-9373 bytes). Drinks.tsx stopped
// rendering three text-list categories (Mocktails/Cocktails/Wine -- 37 of
// the 38 real drinks.json records have no photo yet, and every one of them
// used to print as a name-and-description `<li>`) and became a single
// FoodGallery-style photo carousel, the owner's own request: "I don't need
// to list out these things. It just adds too much." The three category
// `<h3>` headings (and copy.json's own drinks.mocktails/cocktails/wine
// strings that fed them) are also gone. What's left renders one card --
// today exactly one drink (`Piccante`) has an `image` -- so the removed
// markup (37 list items' worth of name/description text plus three
// headings) accounts for the whole drop; nothing else on the page changed.
// Plan 9, Task 2: 46494 -> 47758 (+1264 bytes). The collage stopped being a
// flat CSS grid of sixteen tiles and became a nested-flex split tree, so the
// markup changes shape rather than merely changing values. Accounted for
// exactly, by measuring the collage subtree's own tags in a worktree checkout
// of the parent commit against this one (3539 -> 4803 bytes; the sixteen
// <img> elements are byte-identical in both and cancel):
//
//   +1246  thirteen split container <div>s that did not exist before -- one
//          per cut through the hero, each `class="flex flex-row|flex-col
//          gap-1 overflow-hidden"` plus its own inline sizing.
//     +47  the sixteen photo boxes, net: each loses its grid-placement class
//          string (572 bytes of `col-start-*`/`row-span-*` across all
//          sixteen, plus sixteen separating spaces) and gains an inline
//          `flex-grow`/`flex-basis` pair instead.
//     -29  the outer container: `absolute inset-0 grid grid-cols-6
//          grid-rows-6 gap-1` becomes `absolute inset-0 flex`.
//
// Nothing outside the collage moved: the hero's own subtree accounts for the
// entire difference, and the rest of the page is byte-for-byte unchanged.
// The trade is deliberate and is bought back many times over in CSS -- the
// same change removes 36 rules from the shipped stylesheet (adding one), a
// net 1347 fewer CSS bytes, which every visitor downloads once per deploy.
//
// Phase 2, Task 9: 46028 -> 46443 (+415 bytes). The Awards section is new --
// its entries are fetched from D1 at runtime (Awards.tsx), so at the first
// paint this test renders in jsdom the fetch has not resolved yet (in fact
// never resolves in this environment at all -- jsdom cannot parse a relative
// URL, so the request rejects and Awards.tsx's own catch swallows it, per
// that file's own comment). What this count picks up is only the section's
// CHROME: `<section id="awards">`, the heading, the intro paragraph, and the
// empty grid `<div>` the (zero-length) awards list maps into -- no cards,
// because there is nothing loaded yet to render one from.
//
// Phase 3, Task 3: 46443 -> 52109 (+5666 bytes). The Experiences carousel is
// new, and unlike Awards it is NOT chrome-only: its content is the committed
// build-time snapshot (`experiences.json`, Task 2), not a runtime fetch, so
// every card is already resolved at the first paint this test renders. The
// difference is the whole section: `<section id="experiences">`, the
// heading and intro, and six full cards -- each an `<img>`, a title and a
// description. Four of the six (Catering, Cheeseboards, Cooking Class,
// Membership) link to real, enabled pages and render as a plain `<a>`; the
// other two (Gifting, Retail) carry no link and render as a static `<div>`
// with a "Coming Soon" stamp.
//
// Phase 3, Task 5: 52109 -> 51667 (-442 bytes). The nav dropdown gives way to
// the carousel -- a content edit (pages.json's four pages turned `inNav:
// false`, copy.json gained an "Experiences" section link), not a code
// change to NavBar.tsx, but the rendered nav is exactly what this test
// measures, so the content edit still moves it. Two changes, netted:
//
//   -805  the disclosure `<div class="relative"><button ...>Experiences
//         <svg ...chevron-down.../></button></div>` no longer renders at
//         all -- `grouped` (NavBar.tsx) is false once no page carries
//         `inNav`, and this measurement runs before any hover/click ever
//         opens it, so the four page links it used to reveal were never in
//         this count either, before or after.
//   +363  one new flat `<a href="#experiences" class="...">Experiences</a>`,
//         copy.json's new nav.links entry, rendered as a section anchor
//         between Menu and About like every other section link.
//
// Measured directly, both branches, via `container.querySelector('[data-
// testid="desktop-nav-links"]').innerHTML` before and after this task's
// content edit, to attribute the delta rather than assume it.
//
// Phase 3 critical fix: 51667 -> 51865 (+198 bytes). This is HTML going UP
// so that CSS can come down, deliberately, and the trade is the whole point.
// The Experiences carousel's card scrim was written as two Tailwind
// gradient-stop utilities whose values appear nowhere else in this codebase;
// each emitted a brand-new rule, and with the caption's one-off white and a
// redundant cursor utility they added 477 bytes to a stylesheet with 145
// bytes of headroom -- which is what made `npm run build` exit 1 on this
// branch. The scrim is now an inline gradient producing the identical
// pixels and no CSS rule at all (Experiences.tsx carries the contrast
// measurement behind that choice). Stylesheet: 39032 -> 38555, byte-
// identical to `main`. Three changes, netted, and this is arithmetic on the
// real serialized markup rather than an assumption:
//
//   +228  the scrim element is 38 bytes longer -- a 95-byte <div> carrying
//         four utility classes became a 133-byte <div> carrying one class
//         and a style attribute (measured by serializing both) -- and all
//         six cards carry it (6 x 38).
//   -30   the redundant cursor utility is gone from the two coming-soon
//         cards' class strings (2 x 15, counting the separating space).
//   0     the caption's text colour moved from a one-off 85% white to the
//         80% the rest of the site already uses. Same character count.
//
// Note what this number is and is not. It measures the rendered HTML, which
// every visitor downloads once, uncompressed, and which gzip compresses well
// because the same gradient string repeats six times. The stylesheet it
// bought back is downloaded once too and is CACHED under a content hash that
// a change would bust for every returning visitor. 198 bytes of repeated
// HTML for 477 bytes of new CSS and a build that exits 0 is not a close
// call, but it should be a recorded one.
//
// Plan 4, Task 2: 51865 -> 52355 (+490 bytes). Two sources, not one, netted:
//
//   +457  the About section's chef byline -- a portrait `<img>` plus her
//         name and role -- is new markup below the six paragraphs, built
//         entirely from utility classes already emitted in the stylesheet
//         (see OurStory.tsx's comment on the byline element).
//    +33  the carousel div beside it picked up `data-testid="our-story-
//         carousel"` in the same commit, which renders into the DOM like
//         any other attribute.
//
// Both are pure HTML with no accompanying CSS change: `dist/assets/
// index-*.css` stays 38555 bytes, byte-identical to `main`.
//
// Phase 5B, Task 11, the homepage press section becomes the blog:
// 52355 -> 48404 (-3951). Four sources, measured separately rather than
// attributed to one, because a prior entry in this comment was found
// crediting a whole delta to one cause when it had two -- measured directly,
// by rendering `#blogs` in a worktree checkout of the parent commit (BlogTeaser,
// three real press.json cards) against this one (BlogSection, three real
// posts.json cards) and diffing `outerHTML`, not estimated:
//   -7116  BlogTeaser's three press cards leaving, each a
//          `<article>` with an external anchor, a publication badge, a date
//          line, a title, an excerpt and a Read-Article link out to the
//          publication.
//   +3530  PostCard's three post cards arriving, each a smaller `<article>`
//          wrapping one internal `<Link>` -- a type badge, a date line, a
//          title and an excerpt, with no separate external anchor inside it.
//   -362   the through-link's own markup: BlogTeaser's `<button
//          onClick={navigate}>` carried an inline `<span>`, a lucide
//          `ArrowRight` `<svg>` (nine attributes plus two `<path>`s) and a
//          longer class list; BlogSection's `<Link to="/blog">` is a single
//          anchor with a shorter, already-shipped class list and no icon.
//   -3     `copy.json`'s `nav.links[4].label`, "Stories" (7 characters) ->
//          "Blog" (4), rendered once in the desktop nav link list (the
//          mobile panel is not in the DOM at first paint, so this is not
//          doubled).
// Sum: -7116 + 3530 - 362 - 3 = -3951, matching the whole-page delta exactly
// -- nothing outside these four is chrome, and nothing is left unaccounted.
// The section id (`press`), the `#blogs` anchor and both `press.heading`/
// `press.intro` copy leaves are byte-identical before and after; only the
// cards, the through-link and the nav label moved.
//
// Owner request, 2026-08-17: 48404 -> 48074 (-330 bytes). Two removals in
// the same commit, measured separately by toggling each file back to its
// HEAD content in isolation (not estimated):
//
//   -191  the Reserve a Table button leaving Hero.tsx entirely:
//         `<button class="bg-brand hover:bg-brand-dark text-ink px-8 py-4
//         rounded-lg font-semibold uppercase tracking-wide shadow-lg
//         hover:shadow-xl transition-all duration-300">Reserve a
//         Table</button>`. `copy.hero.reserveButton`'s value is untouched
//         (see editable-paths.ts's own comment on why the leaf itself
//         stays); this is only the markup that painted it.
//   -139  `site.json`'s second phone number leaving `site.phones`, which
//         drops one `<p>` in each of the two places that map over the
//         array: Hero's reservation block (-98, `<p class="font-['Open_
//         Sans'] text-lg font-semibold text-ink whitespace-nowrap">+91
//         92117 91188</p>`) and the footer (-41, `<p class="text-
//         white">+91 92117 91188</p>`).
//
// Sum: -191 + -139 = -330, matching the whole-page delta exactly.
//
// Admin redesign Task 34, the section washes: 48074 -> 48134 (+60 bytes). The
// owner's complaint is that the bands are invisible on a phone, so the eight
// homepage sections below the hero move onto two new tokens 18 points below
// white, seven of them also gain `relative`, and three carousel fades follow
// their section to the new colour. All three changes are pure class strings,
// so all three land here. Each row below is a real measurement, taken by
// restoring that one file to its HEAD content and re-running this test with
// the others already changed, then subtracting from 48134.
//
//    -1  PlaceGallery.tsx      section :8 `py-20 bg-[#F9F9F9]`
//                              -> `py-20 relative bg-wash` (+4), and fade :35
//                              `from-[#F9F9F9]` -> `from-wash` (-5)
//    +8  Drinks.tsx            section :13 `py-20 bg-cream relative overflow-
//                              hidden` -> `py-20 bg-wash-warm relative
//                              overflow-hidden` (+4), and fade :63
//                              `from-cream` -> `from-wash-warm` (+4)
//   +17  Experiences.tsx       section :32 `py-20 bg-cream` -> `py-20 relative
//                              bg-wash-warm` (+13), and fade :111
//                              `from-cream` -> `from-wash-warm` (+4)
//    +5  BlogSection.tsx:39    `py-20 bg-slate-50` -> `py-20 relative bg-wash`
//    +9  OurStory.tsx:63       `py-20 bg-cream-alt`
//                              -> `py-20 relative bg-wash-warm`
//    +4  VisitUs.tsx:9         `py-20 bg-cream-alt` -> `py-20 relative bg-wash`
//    +9  FoodGallery.tsx:8     `py-20 bg-white` -> `py-20 relative bg-white`
//    +9  Awards.tsx:44         `py-20 bg-white` -> `py-20 relative bg-white`
//     0  templates/ItemListSection.tsx took the same two swaps as PlaceGallery
//        and moves nothing here, because it renders on the template pages and
//        never at `/`. Measured, not assumed: reverting it alone leaves 48134.
//
// Sum: -1 + 8 + 17 + 5 + 9 + 4 + 9 + 9 = +60, matching the whole-page delta
// exactly. Split by kind instead: the six section token swaps come to -6 (-5,
// +4, +4, -4, 0, -5); ` relative` costs nine characters including its
// separating space on each of the seven sections that did not already carry
// it, +63; and the three homepage fades come to +3 (-5, +4, +4).
//
// The fades are not cosmetic tidying. Each is a 64px gradient over the right
// edge of a horizontal-scroll strip whose opaque end has to BE the section
// background, or a bright vertical edge appears where the strip stops.
// src/test/bundle.post-build.test.ts's own entry for this task carries the
// three measured step edges and the matched-fade control.
//
// The positioning is a rendering change and not a cosmetic one. src/index.css
// paints a fixed, full-viewport brick pseudo-element at 10% over the whole
// page; a static section paints UNDER it and a positioned one paints OVER it.
// Task 33 measured that overlay's contribution at 2.3 to 23.7 points depending
// only on where a sample lands down the viewport, so without `relative` an
// 18-point token renders as a ~30-point drop and two sections carrying the
// same token measure differently. e2e/section-washes.spec.ts's header carries
// that measurement in full.
describe('homepage byte count', () => {
  it('the public homepage is unchanged', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(new TextEncoder().encode(container.innerHTML).length).toBe(48134);
  });
});
