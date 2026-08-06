// Plan 5 Task 2 correction (post-review Fix 5): the raw React Context object
// and ContentProvider live HERE, not in ./types -- Task 2 originally put
// them in types.ts specifically so src/admin/ (whose own
// src/admin/__tests__/content.test.ts only whitelists types/validate/guards/
// publish as safe src/content/ imports -- see that file's own
// SAFE_CONTENT_SUBMODULES) could reach ContentProvider without a transitive
// path to src/content/index.ts, the build-time snapshot. That reasoning was
// right; the destination was wrong. types.ts's OTHER exports (ContentBundle,
// SectionId, ...) are pure TypeScript types -- `import type` erases them
// completely, and the whitelist's own review comment leaned on that ("types
// erases entirely at compile time"). `createContext` is not a type, though:
// it is a real `react` runtime call, so the moment types.ts held it, the
// whitelist's name-based check ("types" is safe) could no longer tell a type
// import from a value import at that path apart -- src/content/index.ts:73's
// `export * from './types'` silently became a path by which the Worker
// bundle (worker/index.ts -> ../src/content/validate -> ./guards -> ./types)
// COULD have pulled in react, resting entirely on nobody ever importing a
// value across that path. Nothing did (confirmed: bundling worker/index.ts
// with esbuild, see worker/__tests__/bundle.test.ts), but the invariant was
// no longer something the whitelist itself enforced -- it was an accident of
// nobody having done it yet.
//
// This module is the one place that actually needs the runtime `react`
// import. Safe for src/admin/ to reach via SAFE_CONTENT_SUBMODULES
// (content.test.ts) for the same reason `validate`/`guards`/`publish` are:
// it imports no JSON and has no path to src/content/index.ts -- unlike
// those three, it is not type-erasing (it holds a real `createContext`
// call), which is exactly why it must never be allowed to import JSON
// itself, or gain one indirectly. `types.ts` is the only other module it
// touches, and only for `ContentBundle`'s type.
import { createContext, createElement } from 'react';
import type { ContentBundle, CollageBox, CollageNode, CollagePhoto, CollageSplit } from './types';
import type { ReactNode } from 'react';

// null when no provider is mounted -- useContent() (ContentContext.ts) is
// what turns that into defaultBundle; this module has no static import into
// src/content/index.ts to build a default from, deliberately (see above).
export const ContentReactContext = createContext<ContentBundle | null>(null);
export const ContentProvider = ContentReactContext.Provider;

// ---------------------------------------------------------------------------
// The hero collage's two default node renderers.
//
// These are not stubs: they ARE how the public homepage draws the collage
// (ContentContext.ts's `defaultBundle` uses them unchanged), and they are
// what /edit falls back to for the parts of the tree it does not override.
// They live HERE, rather than being written out twice, because those two
// callers are in different halves of the codebase that may not import each
// other -- ContentContext.ts imports the build-time JSON snapshot, which
// src/admin/ is forbidden to reach (src/admin/__tests__/content.test.ts's
// SAFE_CONTENT_SUBMODULES). The previous seam WAS written out twice, in
// exactly those two places, with a comment claiming the two copies were
// byte-identical; one definition is what makes that true rather than
// asserted.
//
// `key` is set from `path` (`galleries.heroCollage.<node id>`) rather than
// from the child's position: a node's id is stable across a swap and across
// an add or remove elsewhere in the tree, so React keeps the same DOM for a
// box that did not move. A positional key would re-key every later sibling
// the moment a photo is added, unmounting subtrees -- which on this exact
// surface has twice destroyed the local preview of a photo she had just
// picked and left a broken image for the rest of the session.
//
// Written with `createElement` rather than JSX because this file is `.ts`,
// not `.tsx` (see the header comment above for why it may not become one).
export function defaultRenderCollagePhoto(
  path: string,
  _photo: CollagePhoto,
  box: CollageBox,
  image: ReactNode,
): ReactNode {
  return createElement('div', { key: path, className: box.className, style: box.style }, image);
}

export function defaultRenderCollageSplit(
  path: string,
  _split: CollageSplit,
  box: CollageBox,
  children: ReactNode[],
): ReactNode {
  return createElement('div', { key: path, className: box.className, style: box.style }, children);
}

// The Tailwind chrome each kind of box carries, and nothing else -- every
// number that decides where a box actually sits travels in `style`.
//
// `overflow-hidden` on BOTH kinds is load-bearing, not decoration: a flex
// item's automatic minimum size is its content's min-content size unless the
// item is a scroll container, and a box holding a photo has a min-content
// size well over zero. Without it a `flexBasis: 0` box can still refuse to
// go below its image's intrinsic width, and the ratios quietly stop meaning
// what they say -- the exact failure the "a 1:1 split renders two equal
// boxes whatever is in them" e2e test exists to catch.
//
// `relative` on a photo box is what EditableImage's own camera badge (and
// Task 4's drag affordances) position against at /edit; it costs the public
// page nothing, and it is the one piece of the old tile's className that
// still had a job after the grid placement went away.
export const COLLAGE_PHOTO_CLASSNAME = 'relative overflow-hidden';

export const COLLAGE_SPLIT_CLASSNAME: Record<CollageSplit['direction'], string> = {
  row: 'flex flex-row gap-1 overflow-hidden',
  column: 'flex flex-col gap-1 overflow-hidden',
};

// `galleries.heroCollage.<id>` -- the one place the collage's path scheme is
// spelled, so Hero.tsx (which hands it to `renderImage`), EditMode.tsx (which
// parses it back to find the photo to rewrite) and every test cannot disagree
// about it.
export const COLLAGE_PATH_PREFIX = 'galleries.heroCollage';

export function collageNodePath(node: CollageNode): string {
  return `${COLLAGE_PATH_PREFIX}.${node.id}`;
}
