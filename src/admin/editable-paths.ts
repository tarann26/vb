// The explicit list of dotted copy.json paths edit mode lets her rewrite in
// place -- Plan 5 Task 3, Step 1. Derived from COPY_FIELDS
// (src/admin/fields.ts, Plan 4 Task 2's flat map), not re-typed by hand: a
// second, hand-copied 31-entry list here could silently drift from
// fields.ts the moment a field is added, renamed, or reclassified as
// attribute-only there. src/admin/__tests__/editable-paths.test.tsx imports
// this same constant for its own "recorded calls match exactly" check, so
// there is exactly one place this 31-entry set is ever written down.
//
// Two exclusions, both already decided by the edit mode plan's own coverage
// table, not re-litigated here:
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
import { COPY_FIELDS } from './fields';
import type { Copy } from '../content/types';

const ATTRIBUTE_ONLY_COPY_FIELDS = new Set([
  'nav.instagramLabel',
  'nav.menuLabel',
  'visit.mapTitle',
  'footer.instagramLabel',
  'footer.linkedinLabel',
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
  (key) => !ATTRIBUTE_ONLY_COPY_FIELDS.has(key),
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
export function setCopyText(copy: Copy, path: string, next: string): Copy {
  const [namespace, leaf] = path.split('.');
  const source = copy as unknown as Record<string, Record<string, unknown>>;
  const section = source[namespace];
  if (section === null || typeof section !== 'object') return copy;
  return {
    ...copy,
    [namespace]: { ...section, [leaf]: next },
  } as unknown as Copy;
}
