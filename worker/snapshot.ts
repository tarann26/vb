// The offline fallback for GET /api/published (worker/published.ts): a
// small set of file bodies compiled directly into the Worker, served when a
// D1 read fails outright. See published.ts's own comment on why that must
// cost freshness, never availability.
//
// For a public file that also lives as a real document in src/content/, this
// would hold a build-time copy of that document's actual last-known-good
// text. `awards.json` cannot be that: it is a D1_ONLY_PATH (worker/store.ts)
// and has never been a file in this repository -- there is nothing under
// src/content/ to copy from, and there will not be until the first publish
// against the real database (Task 12). So the entry below is not a snapshot
// of anything that was ever published; it is the honest empty state -- an
// empty awards list is a valid thing for the homepage to render, and a
// hand-written `[]` is a better failure mode than a 503 with no body for a
// section of the site that is allowed to have nothing in it yet.
const SNAPSHOTS: ReadonlyMap<string, string> = new Map([['awards.json', '[]']]);

export function snapshotFor(file: string): string | null {
  return SNAPSHOTS.get(file) ?? null;
}
