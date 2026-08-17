// The explicit list of dotted copy.json paths edit mode lets her rewrite in
// place -- Plan 5 Task 3, Step 1. Derived from COPY_FIELDS
// (src/admin/fields.ts, Plan 4 Task 2's flat map), not re-typed by hand: a
// second, hand-copied 27-entry list here could silently drift from
// fields.ts the moment a field is added, renamed, or reclassified as
// attribute-only there. src/admin/__tests__/editable-paths.test.tsx imports
// this same constant for its own "recorded calls match exactly" check, so
// there is exactly one place this 27-entry set is ever written down.
// (32 through Phase 5, Task 7; Task 8 retired five blogsPage.* leaves along
// with BlogsPage.tsx's own route -- see the exclusion set's own comment,
// below.)
//
// Four exclusions now, not three. The first two were decided by the edit
// mode plan's own coverage table and are not re-litigated here:
//   - the five COPY_FIELDS leaves wired straight to an HTML attribute
//     (an aria-label, or VisitUs.tsx's <iframe title>) rather than painted
//     as visible text -- no component has a content.renderText call for
//     any of these, so they can never be reached through EditableText.
//     fields.ts's own CopyLeafShape comment documents the identical five as
//     attribute-bound.
//   - site.* entirely -- but COPY_FIELDS never had any: site.json's leaves
//     live in the separate SITE_FIELDS map (also fields.ts) and are never
//     passed through content.renderText at all (Hero.tsx / Footer.tsx / NotFound.tsx
//     render `{site.name}` / `{site.tagline}` as bare, un-wrapped text).
//     Filtering COPY_FIELDS's own keys therefore already excludes site.*
//     for free, with nothing further to subtract here.
// The third is this repair's own:
//   - `nav.pagesLabel`, the word the nav groups her pages under. It is a
//     <button>'s own label (NavBar.tsx's desktop disclosure), and a
//     contentEditable inside a button cannot be focused in any browser --
//     a click reaches the button, toggles the menu and focuses nothing. So
//     /edit rendered the dashed "you can type here" edge over a word that
//     silently refused every attempt. See NavBar.tsx's own comment at that
//     line for why the label was NOT lifted out of the button instead. This
//     list is what makes "nothing anywhere advertises it" enforceable
//     rather than a promise about one file: it is the set every /edit
//     surface is checked against
//     (src/admin/__tests__/editable-paths.test.tsx mounts the real app
//     under a real editing bundle and compares what it finds), so a future
//     component that wrapped this leaf in renderText again would fail
//     there.
// The fourth is Phase 5, Task 8's: BlogsPage.tsx's own title, subtitle,
//   back button and Previous/Next pagination labels, orphaned when /blogs
//   became a redirect to /blog and BlogIndex.tsx -- a different component,
//   with no header and no Previous/Next -- became what actually renders
//   there. See the exclusion set's own comment, below, for the full
//   reasoning and for why blogsPage.heading/intro are NOT part of it.
import { COPY_FIELDS } from './fields';
import type { Copy } from '../content/types';

// Named for what it MEANS -- "not offered as an in-place edit at /edit" --
// rather than for the one reason five of its six members happen to share.
// Every member is still fully editable on the dashboard (/edit/manage
// renders one Field per COPY_FIELDS key, this filter never reaches it);
// what this set decides is only whether the LIVE PAGE puts an editing
// affordance on it.
const NOT_EDITABLE_IN_PLACE_COPY_FIELDS = new Set([
  // Bound to an attribute, never painted as visible text.
  'nav.instagramLabel',
  'nav.menuLabel',
  'visit.mapTitle',
  'footer.instagramLabel',
  'footer.linkedinLabel',
  // Painted as visible text, but inside a control that owns the click.
  'nav.pagesLabel',
  // Phase 5, Task 8: BlogsPage.tsx stopped being routed -- /blogs is now a
  // redirect to /blog (App.tsx), and BlogIndex.tsx is what renders there.
  // These five were BlogsPage's own header title/subtitle, its "back to
  // home" button, and its Previous/Next pagination labels -- none of which
  // BlogIndex has an equivalent for (its own pagination is bare page
  // numbers, not Previous/Next, and it carries no page header at all). Kept
  // on disk in copy.json and BlogsPage.tsx under the owner's never-delete
  // constraint, and still fully editable on the dashboard (COPY_FIELDS,
  // below, is untouched) -- only the LIVE, in-place affordance is gone,
  // because there is no longer a live element to put it on.
  // (`blogsPage.heading`/`.intro` are NOT here: BlogIndex reuses those two
  // keys for its own real heading and intro, through `renderText`, so they
  // stay in EDITABLE_TEXT_PATHS below.)
  'blogsPage.title',
  'blogsPage.subtitle',
  'blogsPage.back',
  'blogsPage.previous',
  'blogsPage.next',
]);

// `readonly string[]`, not a narrowed literal union: `Object.keys(COPY_FIELDS)`
// always widens to `string[]` in TypeScript regardless of how literal
// CopyLeafShape's own keys are (a known limitation of `Object.keys`'s
// built-in type, not something a type annotation here can recover) -- a
// type alias claiming otherwise would promise a compile-time guarantee this
// value cannot actually provide. What DOES keep this list honest is
// runtime: src/admin/__tests__/editable-paths.test.tsx's own boundary test
// mounts the real app and checks the recorded set against this exact
// export.
export const EDITABLE_TEXT_PATHS: readonly string[] = Object.keys(COPY_FIELDS).filter(
  (key) => !NOT_EDITABLE_IN_PLACE_COPY_FIELDS.has(key),
);

// Rewrites exactly the one leaf named by `path`, leaving every sibling leaf
// -- and every OTHER namespace object (`copy.hero`, `copy.footer`, ...) --
// at its prior object identity. Every real EDITABLE_TEXT_PATHS entry is
// exactly `namespace.leaf` (CopyLeafShape's own shape, fields.ts, is flat,
// one dot deep), so a two-level split is exhaustive here, not a
// simplification that silently drops a deeper case.
//
// The `as unknown as` double-hop below is NOT the pattern the edit mode
// plan's definition of done rules out: that phrase names the rejected
// value-substitution design, where `Copy`'s own leaf TYPES would have been
// cast to ReactNode, changing what `Copy` means everywhere it is used. This
// function still takes and returns a real `Copy`, unchanged; the cast is
// purely local, needed only because `namespace` is widened to a bare
// `string` by `.split('.')`, and `Copy`'s own interface (unlike a
// `Record<string, ...>`) has no index signature for tsc to key into with a
// dynamic string -- `Copy` and a generic string-keyed record structurally
// share nothing tsc can see, hence the bridge through `unknown` (its own
// error message, without it, says exactly that: "neither type sufficiently
// overlaps with the other").
// Malformed-namespace guard, matching AdminApp.tsx's own `withLeaf` (its own
// comment cites a prior review finding for the identical shape): `source[namespace]`
// is trusted to be a real object below ONLY after this check passes.
// `{ ...null, [leaf]: next }` is not a TypeScript error and does not throw --
// object-spreading `null`/`undefined` is a silent no-op per the language
// spec -- so without this guard, a `copy` value whose own namespace was
// somehow not a plain object would silently REPLACE it with a fresh
// single-leaf record instead of leaving it alone, the same landmine
// `withLeaf`'s own comment already documents for the identical reason.
//
// Throws, rather than returning `copy` unchanged (repair-review pattern
// fix): this exact "return the input unchanged" guard is what made THREE
// separate defects silent in this codebase before anyone noticed --
// Plan 5's own Critical, Task 5's own Critical, and C1
// (template-section-paths.ts's own header comment tells the C1 story in
// full: a path like `sections.<id>.content.heading` used to resolve
// `namespace = 'sections'`, `source['sections']` is `undefined`, and this
// guard handed back the ORIGINAL `copy` with no signal anything was wrong --
// she would type, watch the heading change, blur, and lose the edit on the
// next reload). C1 itself is now closed a different way, at the point she
// AUTHORS a section id (guards.ts's own assertSectionEntry, validate.ts's
// own validateSectionEntry) -- `commitText` (EditMode.tsx) also checks
// `parseSectionContentPath` FIRST and never reaches this function for a real
// `sections.*` path at all. So by construction, every path that still
// reaches this point names a real, hardcoded `EDITABLE_TEXT_PATHS` entry
// (never something she typed) -- which makes a namespace failing to resolve
// here a pure PROGRAMMER mistake (a typo'd literal, a leaf renamed in
// fields.ts without this module noticing), the exact class of bug this
// codebase's own guards.ts already throws loudly for (assertHours,
// assertDrinkCategory, assertSections, ...) rather than silently
// discarding. Thrown from inside a DOM blur handler (EditableText.tsx),
// so it surfaces as a real, visible console error the moment it happens,
// in dev and in CI, instead of a write that looks like it worked and
// silently wasn't.
export function setCopyText(copy: Copy, path: string, next: string): Copy {
  const [namespace, leaf] = path.split('.');
  const source = copy as unknown as Record<string, Record<string, unknown>>;
  const section = source[namespace];
  if (section === null || typeof section !== 'object') {
    throw new Error(`setCopyText: "${path}" does not name a real copy.json field -- refusing to silently discard this edit`);
  }
  return {
    ...copy,
    [namespace]: { ...section, [leaf]: next },
  } as unknown as Copy;
}
