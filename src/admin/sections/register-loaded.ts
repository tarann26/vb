// Moved out of AdminApp.tsx unchanged when the ten panels were carried into
// five area modules. It lives here rather than staying an export of
// AdminApp because every area module calls it and AdminApp renders every
// area module: exporting it from there would make the import graph a cycle
// for the sake of one function.
import type { ContentFileName, ContentTypeMap, LoadedContent } from '../content';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';

// The registry's own `initial` must always be the value GET /api/content
// most recently returned -- never the restored draft -- so a restored file
// correctly reads as dirty (it genuinely IS unpublished) rather than being
// mistaken for the committed baseline itself. Registers the server value
// FIRST (pinning `initial`), then, only if a draft exists for this file,
// re-registers with the draft's own `data` on top of it -- `register`'s own
// contract (publish.ts) is that `initial` is set once, on the first call,
// and never moves after -- so two calls in this exact order is what makes
// both true at once. Returns whichever value the caller's own local state
// should actually hold.
export function registerLoaded<K extends ContentFileName>(
  registry: ContentRegistry,
  file: K,
  loaded: LoadedContent<ContentTypeMap[K]>,
  restoreDraft: DraftMap | null,
): ContentTypeMap[K] {
  registry.register(file, loaded.data, loaded.sha);
  const draftEntry = restoreDraft?.[file];
  if (draftEntry === undefined) return loaded.data;
  registry.register(file, draftEntry.data, loaded.sha);
  return draftEntry.data as ContentTypeMap[K];
}
