// Phase 2 Task 9's fetch-and-shape-check for the Awards pilot, split out of
// Awards.tsx itself (not merely for tidiness): eslint's
// react-refresh/only-export-components rule flags a .tsx file that exports
// both a component and plain values/functions -- the same "only inspects
// .jsx/.tsx files" distinction src/content/ContentContext.ts's own header
// comment documents for the identical reason. `AWARDS_ENDPOINT`, `isAward`
// and `fetchAwards` hold no JSX at all, so they belong in a plain .ts module
// the same way that file's own runtime pieces do, and Awards.tsx imports
// from here rather than defining them inline.
import type { Award } from '../content/types';

export const AWARDS_ENDPOINT = '/api/published?path=awards.json';

// Shape-checked here rather than cast. This is content from a database with
// no build-time guard in front of it -- src/content/index.ts's own assert*
// functions have no equivalent on this path, so the check has to happen
// where the data arrives or it does not happen at all.
export function isAward(value: unknown): value is Award {
  if (!value || typeof value !== 'object') return false;
  const { id, title, awardedBy, year, image } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof title === 'string' &&
    typeof awardedBy === 'string' &&
    typeof year === 'string' &&
    (image === undefined || typeof image === 'string')
  );
}

// `fetchImpl` is injected with a default, the same posture requestPublish
// and fetchBuildStatus already take in src/admin/publish.ts -- what lets a
// test hand this a fake without stubbing the global.
export async function fetchAwards(fetchImpl: typeof fetch = fetch): Promise<Award[]> {
  const response = await fetchImpl(AWARDS_ENDPOINT);
  if (!response.ok) throw new Error(`awards unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isAward);
}
