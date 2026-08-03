// The seven directories that exist under assets-source/ today, and the only
// `category` values POST /api/upload accepts. Shared by the Worker
// (worker/upload.ts, which is the one place that actually enforces this)
// and the browser (src/admin/PhotoField.tsx, Task 5, which needs to know
// what categories exist so it can pass one) so there is exactly one list,
// not two that could silently drift out of step.
//
// Hardcoded, not read off disk: neither side has a filesystem to read
// assets-source/'s real directory list from at the moment that matters --
// the Worker has none at request time at all, and the browser bundle is
// built once and carries no live view of the repo either. An allowlist
// whose membership can only change by a code change -- never by whatever a
// request happens to name -- is the same posture worker/github.ts's own
// path allowlist takes, for the same reason.
export const UPLOAD_CATEGORIES = ['atmosphere', 'food', 'hero', 'mocktails', 'our_story', 'press', 'team'] as const;

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];
