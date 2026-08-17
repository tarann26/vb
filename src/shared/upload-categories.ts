// The nine directories that may exist under assets-source/, and the only
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
//
// 'posts' is the ninth, and the first whose directory does not exist yet.
// That is fine and is not an oversight: scripts/images.mjs walks
// assets-source/ and simply finds no files under a directory that is not
// there, worker/upload.ts commits into the path on the first upload, and
// scripts/paths.mjs's DIR_MAX_WIDTH has no entry for it deliberately -- a
// post photo is a full-width figure inside a wide column, so
// DEFAULT_MAX_WIDTH (1000) is the right size and a special case would be one
// more thing to keep true. Nothing binds this list to the filesystem: both
// tests that read it check MEMBERSHIP, never length.
export const UPLOAD_CATEGORIES = ['atmosphere', 'food', 'hero', 'mocktails', 'our_story', 'press', 'team', 'experiences', 'posts'] as const;

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];
