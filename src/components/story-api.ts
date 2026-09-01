// Phase 4's runtime read for the About section, split out of OurStory.tsx
// for the same reason awards-api.ts is split out of Awards.tsx: eslint's
// react-refresh/only-export-components flags a .tsx file that exports both
// a component and plain values.
//
// The shape check is stricter than isAward's, and deliberately so. A
// malformed award is one missing card in a grid; a malformed story is the
// entire visible content of a homepage section. So this returns `null` --
// "keep whatever you already have" -- for anything it is not completely
// sure about, and the component treats `null` as "the compiled-in copy
// stands", never as "render nothing".
//
// It also checks the portrait's SHAPE, not just its type. validateStory
// refuses an off-site path at the write boundary, but this body arrives
// from a database at runtime with no build-time guard in front of it, and a
// type-only check would put an attacker-supplied URL straight into a
// homepage <img src>.
//
// IMPORTED NOW, NOT RE-IMPLEMENTED. This was three string tests written out
// by hand, because the answer it wanted lived in src/content/validate.ts,
// which is the Worker's module and does not export it. The cost of the copy
// came due at the 2026-08-21 migration: the copy accepts a leading slash and
// nothing else, so the moment story.json's portrait became a URL on the
// image host this function returned null for a perfectly good document, and
// null here means "the compiled-in copy stands" -- the About section would
// have gone on showing whatever shipped with the last build while the
// database said something else, silently, with every test green.
// src/content/asset-reference.ts is the one answer now, and it holds no JSX
// and touches no DOM, so it costs this bundle two tiny modules.
import { isSiteAssetReference } from '../content/asset-reference';
import type { StoryContent } from '../content/types';

export const STORY_ENDPOINT = '/api/published?path=story.json';

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isStoryContent(value: unknown): value is StoryContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { heading, paragraphs, chef } = value as Record<string, unknown>;
  if (!isNonBlankString(heading)) return false;
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return false;
  if (!paragraphs.every(isNonBlankString)) return false;
  if (!chef || typeof chef !== 'object' || Array.isArray(chef)) return false;
  const { name, role, portrait, portraitAlt } = chef as Record<string, unknown>;
  return (
    isNonBlankString(name) &&
    isNonBlankString(role) &&
    isSiteAssetReference(portrait) &&
    isNonBlankString(portraitAlt)
  );
}

// `fetchImpl` is injected with a default, the same posture fetchAwards,
// requestPublish and fetchBuildStatus already take -- what lets a test hand
// this a fake without stubbing the global.
export async function fetchStory(fetchImpl: typeof fetch = fetch): Promise<StoryContent | null> {
  const response = await fetchImpl(STORY_ENDPOINT);
  if (!response.ok) throw new Error(`the About section is unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  return isStoryContent(parsed) ? parsed : null;
}
