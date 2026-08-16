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
// A generator that keeps this map current later (a natural Task 8 shape) MUST
// read its source text from D1, not from the repo -- walking src/content/*.json
// finds nothing for `awards.json`, for the same reason the paragraph above
// gives, and would silently leave this exact hand-written entry as the only
// one that ever gets refreshed.
//
// Staleness here is invisible on purpose, and that is a real cost worth
// naming rather than a gap to close in this task: once real awards exist and
// D1 fails, this still answers 200 with `[]`, ETag-less and cache-friendly,
// and a visitor reads that as "no awards yet" rather than as "something is
// broken". There is no signal in the response that distinguishes a fresh
// snapshot from a stale one.
const SNAPSHOTS: ReadonlyMap<string, string> = new Map([['awards.json', '[]']]);

export function snapshotFor(file: string): string | null {
  return SNAPSHOTS.get(file) ?? null;
}
