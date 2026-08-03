import { createContext, createElement, useContext, type ImgHTMLAttributes, type ReactNode } from 'react';
import { site, galleries, dishes, drinks, press, story, menus, copy, sections } from './index';
import type {
  SiteContent,
  Galleries,
  Dish,
  Drink,
  Article,
  StoryContent,
  MenuFile,
  Copy,
  Section,
} from './types';

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
// not distinct shapes. That is deliberate: Task 3 narrows EditableTextPath to
// the real EDITABLE_TEXT_PATHS union and Task 4 gives EditableImagePath its
// real scheme, and neither change needs to touch a single existing
// `content.renderText('a.b', …)` / `content.renderImage(path, …)` call site,
// because every literal already in use here is a value the narrower union
// will still contain.
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
  // default: (_, v) => v -- see defaultBundle below.
  renderText(path: EditableTextPath, value: string): ReactNode;
  // default: (_, p) => createElement('img', p) -- see defaultBundle below.
  renderImage(path: EditableImagePath, props: ImgHTMLAttributes<HTMLImageElement>): ReactNode;
}

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
  renderText: (_path, value) => value,
  // createElement, not JSX: this file is .ts rather than .tsx (see the
  // module-level comment above ContentBundle for why), and .ts is not
  // parsed for JSX syntax at all.
  renderImage: (_path, props) => createElement('img', props),
};

const ContentContext = createContext<ContentBundle | null>(null);

// Exported as the raw Provider, not a wrapping component, so callers pass
// `value` directly: <ContentProvider value={bundle}>…</ContentProvider>.
// Task 2 mounts this at /edit with live, fetched content and real render
// functions; nothing in this task mounts it at all.
export const ContentProvider = ContentContext.Provider;

export function useContent(): ContentBundle {
  return useContext(ContentContext) ?? defaultBundle;
}
