import { createContext, useContext, type ImgHTMLAttributes, type ReactNode } from 'react';
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
  // default: (_, p) => <img {...p} /> -- see defaultBundle below.
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
  renderImage: (_path, props) => <img {...props} />,
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
