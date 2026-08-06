import { createElement, useContext } from 'react';
import { site, galleries, dishes, drinks, press, story, menus, copy, sections, pages } from './index';
import type { ContentBundle, EditableTextPath, EditableImagePath } from './types';
import {
  ContentReactContext,
  ContentProvider,
  defaultRenderCollagePhoto,
  defaultRenderCollageSplit,
} from './context';

// .ts, not .tsx: eslint's react-refresh/only-export-components rule (which
// warns on a file that exports both components and non-component values,
// since Vite's Fast Refresh can't hot-reload it cleanly) only inspects
// .jsx/.tsx files. This module exports defaultBundle, ContentProvider and
// useContent alongside no component of its own -- exactly the shape the
// rule warns about -- so it warned twice here (defaultBundle, useContent)
// even though nothing here is broken: nothing in this file is a component,
// so there is nothing for Fast Refresh to lose. Written with createElement
// instead of a JSX `<img />` below for the one place that used to need it,
// so the file parses as plain TypeScript with no JSX syntax to gate behind
// a .tsx extension. Confirmed directly: renaming and making that one swap
// takes eslint from 2 warnings to 0, with byte-identical rendered output.
//
// Task 1 keeps both of these as plain string aliases -- distinct names only,
// not distinct shapes. Task 3's own review left both this way, deliberately:
// `EditableTextPath` could be narrowed to the real 28-entry EDITABLE_TEXT_PATHS
// union (moving CopyLeafShape, fields.ts, into a type-only module would let
// `keyof` do that with no bundle risk), but every real
// `content.renderText('a.b', …)` call site already passes one of those exact
// 28 literals, so the narrower type would catch nothing today that this
// file's own boundary test (src/admin/__tests__/editable-paths.test.tsx)
// doesn't already catch at runtime -- and a wider surface of call sites
// (every migrated public component) would have to type-check against it for
// no behavioural change. Left as `string` rather than done for its own sake;
// revisit if a future task needs the compile-time guarantee specifically.
//
// ContentBundle now lives in ./types, ContentReactContext and
// ContentProvider in ./context (Plan 5 Task 2, corrected by the post-review
// Fix 5 -- see each module's own comment on why), and are simply re-exported
// here unchanged so every existing caller of this module (all twelve
// migrated public components, plus
// src/content/__tests__/ContentContext.test.tsx and
// src/admin/__tests__/editable-paths.test.tsx) keeps working without a
// single import path changing.
export type { EditableTextPath, EditableImagePath, ContentBundle };
export { ContentProvider };

// The bundle every rendered component falls back to when no provider is
// mounted -- the same static, build-time-validated exports src/content/
// index.ts already produces (its guards run at import and are untouched
// here), wrapped rather than re-derived. renderText/renderImage are the
// identity: a path is accepted and ignored, the value/props pass straight
// through, so a component that calls either renders exactly what it
// rendered before this file existed. Exported so tests can spread it (the
// provider-sentinel test overrides one leaf of `copy` and nothing else).
export const defaultBundle: ContentBundle = {
  site,
  galleries,
  dishes,
  drinks,
  press,
  story,
  menus,
  copy,
  sections,
  pages,
  renderText: (_path, value) => value,
  // createElement, not JSX: this file is .ts rather than .tsx (see the
  // module-level comment above ContentBundle for why), and .ts is not
  // parsed for JSX syntax at all.
  renderImage: (_path, props) => createElement('img', props),
  // The real public renderers, shared with /edit rather than written out a
  // second time here -- see ./context for both, and for why one definition
  // rather than two identical-by-assertion copies.
  renderCollagePhoto: defaultRenderCollagePhoto,
  renderCollageSplit: defaultRenderCollageSplit,
};

export function useContent(): ContentBundle {
  return useContext(ContentReactContext) ?? defaultBundle;
}
