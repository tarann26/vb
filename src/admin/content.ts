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
  Page,
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
  // Plan 7, Task 1: the tenth content file -- her authored pages. Included
  // here from Task 1 onward (not deferred to Task 4, which builds the
  // Pages screen) so /edit's own load effect (EditMode.tsx, keyed on this
  // exact list) already fetches it and every downstream type stays total.
  'pages.json',
] as const;

export type ContentFileName = (typeof CONTENT_FILES)[number];

// What each content file is CALLED when she reads it, as opposed to what it
// is named on disk. PublishBar's confirmation panel is the only caller
// today: it has to tell her which parts of the site a publish is about to
// change, and "dishes.json, site.json" is the same mistake
// PublishBar.tsx's own validation case already has a review finding
// against -- that one put internal validator paths like "[0].name" in front
// of her, and a filename with an extension is no more meaningful to someone
// who has never seen this repository.
//
// Every string here is the heading the dashboard already uses for the panel
// that owns that file (its own SectionErrorBoundary `name`), so the publish
// confirmation, the status strip and the undo description all name the same
// things the panels do rather than inventing a second vocabulary for the
// same ten files. site.json is the one that needs saying out loud: the panel
// that edits it is headed "Opening hours", and that is what it is called
// here too.
//
// Three of these were renamed alongside their panels ("Menus" -> "Menu
// PDFs", "Page copy" -> "Words on the site", "Homepage sections" -> "What
// shows on the homepage"). Renaming only the headings would have left the
// status strip saying "Menus has changes you haven't published yet" three
// inches under a panel headed "Menu PDFs" -- two names for one thing, in
// the same glance, which is the exact defect the two unsaved sentences were
// split to avoid.
//
// Typed as a TOTAL Record over ContentFileName, not a partial one or a
// lookup with a fallback: an eleventh content file added to CONTENT_FILES
// above without a name for it fails `tsc -b` here, which is the whole
// point. A fallback string would instead let that file reach her screen
// unnamed, or named by its filename, exactly the thing this map exists to
// prevent.
export const CONTENT_FILE_LABELS: Record<ContentFileName, string> = {
  'site.json': 'Opening hours',
  'galleries.json': 'Galleries',
  'dishes.json': 'Dishes',
  'drinks.json': 'Drinks',
  'press.json': 'Press',
  'story.json': 'About',
  'menus.json': 'Menu PDFs',
  'copy.json': 'Words on the site',
  'sections.json': 'What shows on the homepage',
  'pages.json': 'Pages',
};

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
  'pages.json': Page[];
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
    // The Worker puts the REASON in the body -- worker/index.ts's 502 branch
    // passes `error.message`, which worker/github.ts's `describeFailure`
    // built by reading GitHub's own response. Throwing only the status threw
    // all of that away: every one of the nine files reported "status 502" and
    // nothing anywhere said *why*, so a bad GITHUB_TOKEN and a real GitHub
    // outage looked identical -- to her AND to whoever she asked. The
    // machinery to explain it already existed; nothing displayed it.
    const detail = await response
      .json()
      .then((body: unknown) => (body as { message?: unknown })?.message)
      .catch(() => undefined);
    // The status stays in the message even when a reason is available: the
    // status is what a developer greps for and the reason is what tells
    // anyone what to actually do, and there is no cost to carrying both.
    const base = `could not load ${name} (status ${response.status})`;
    throw new Error(typeof detail === 'string' && detail.trim() ? `${base}: ${detail}` : base);
  }
  const body = (await response.json()) as { content: string; sha: string };
  let data: ContentTypeMap[K];
  try {
    data = JSON.parse(body.content) as ContentTypeMap[K];
  } catch {
    // Minor review finding: a hand-edited content file with a syntax error
    // used to reach every section's own "Could not load X: <message>" text
    // as V8's OWN raw parser output ("Expected property name or '}' in
    // JSON at position 2") -- accurate, but meaningless to a non-technical
    // owner and gives her nothing to act on. Every other error this
    // function raises is already a plain sentence a caller can show
    // directly (see this function's own header comment); this is the one
    // path that wasn't.
    throw new Error(`it looks like ${name} was edited incorrectly -- ask your developer to check it`);
  }
  return { data, sha: body.sha };
}
