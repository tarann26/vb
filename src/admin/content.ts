// Reads current content directly from `main`, through the Worker's GET
// /api/content (worker/index.ts's handleGetContent, Plan 4 Task 3) --
// deliberately never from src/content/index.ts, the build-time snapshot
// baked into whatever bundle happens to be sitting in her browser.
//
// Why that distinction matters: Cloudflare's rebuild after a publish takes
// 1-2 minutes. If she reloads -- or opens the dashboard on her phone -- in
// that window, a bundle-backed dashboard would show the content from
// *before* her last edit. Editing a different field from that stale copy
// and publishing the whole file back would silently drop the edit that
// hasn't built yet: `base_tree` is still set, the ref still fast-forwards
// cleanly, 200 OK, green "live" -- and the earlier change is gone, with no
// error anywhere. `fetchContent` below is what gives the dashboard a source
// that's actually current; `publishFile` (a later task) is what sends the
// `sha` this returns back as `baseSha`, so a second stale write is refused
// with a 409 instead of silently overwriting.
//
// Nothing here imports `../content` or `../content/index` -- only
// `../content/types`, whose types erase entirely at compile time and add
// nothing to the bundle. `src/admin/__tests__/content.test.ts` enforces
// that for the whole `src/admin/` directory, not just this file: importing
// the real module would both defeat the purpose above (it reads whatever
// was true at build time, not now) and drag all nine content JSON files
// into the lazy-loaded admin chunk for nothing.
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
} from '../content/types';

// The nine real files under src/content/ -- the same set validateContent
// (src/content/validate.ts) recognises and commitFiles (worker/github.ts)
// allows; see worker/__tests__/github.test.ts's "still accepts the real
// content file" block for that list's own authority. Kept as this module's
// own copy rather than imported from either of those: the Worker and this
// admin bundle are separate builds, and importing the JSON files themselves
// (the only other place this list lives today) is exactly what this module
// exists to avoid.
export const CONTENT_FILES = [
  'site.json',
  'galleries.json',
  'dishes.json',
  'drinks.json',
  'press.json',
  'story.json',
  'menus.json',
  'copy.json',
  'sections.json',
] as const;

export type ContentFileName = (typeof CONTENT_FILES)[number];

// Maps each content file to the shape its `content` field parses into.
// Purely a compile-time convenience for `fetchContent`'s generic `<K>`
// below -- erases entirely, adds nothing to the bundle.
export interface ContentTypeMap {
  'site.json': SiteContent;
  'galleries.json': Galleries;
  'dishes.json': Dish[];
  'drinks.json': Drink[];
  'press.json': Article[];
  'story.json': StoryContent;
  'menus.json': MenuFile[];
  'copy.json': Copy;
  'sections.json': Section[];
}

export interface LoadedContent<T> {
  data: T;
  // The blob sha GET /api/content read this content at -- round-tripped
  // back as POST /api/publish's `baseSha` (a later task) so a stale write
  // is refused with a 409 rather than silently overwriting a newer one.
  sha: string;
}

// GET /api/content?path=src/content/<name>.json -- authenticated the same
// way every other admin route is (a verified vb_session cookie); a missing
// or expired session answers 401, same as everywhere else in the
// dashboard. Throws on any non-2xx response: this module has no UI of its
// own, so a caller decides how to present "not logged in" vs. "GitHub is
// unreachable" vs. "that file doesn't exist yet", not this function.
export async function fetchContent<K extends ContentFileName>(name: K): Promise<LoadedContent<ContentTypeMap[K]>> {
  const response = await fetch(`/api/content?path=src/content/${name}`, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`could not load ${name} (status ${response.status})`);
  }
  const body = (await response.json()) as { content: string; sha: string };
  return { data: JSON.parse(body.content) as ContentTypeMap[K], sha: body.sha };
}
