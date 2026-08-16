-- Phase 2. Applied by a human with:
--   npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0001_content.sql
--
-- Every statement is IF NOT EXISTS so re-running the file is a no-op rather
-- than an error. D1 has no migration runner this Worker can call at runtime,
-- and adding one would mean a schema write on a request path -- so the file
-- is idempotent instead, and applying it twice is the normal, safe case.

-- One row per content document, not one row per field. That is the point of
-- the pilot: Awards goes in the GENERIC table so what gets proven is the
-- store, not a bespoke Awards route. `body` is the exact JSON text the
-- dashboard sent, byte for byte -- never a re-serialisation -- because `sha`
-- is a hash OF that text and the two must not be able to disagree.
CREATE TABLE IF NOT EXISTS content (
  path       TEXT    PRIMARY KEY,
  body       TEXT    NOT NULL,
  -- SHA-256 of `body`, lowercase hex. This is what the dashboard round-trips
  -- as `baseSha` (worker/index.ts's handlePublish step 3), so it plays the
  -- exact role a GitHub blob sha plays on the other store: an opaque token
  -- that changes whenever the content changes and never otherwise.
  sha        TEXT    NOT NULL,
  -- Bumped on every write. The read path's cache key is path + version, so a
  -- publish invalidates the edge cache without an explicit purge.
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Undo. Git gave this for free on the other store; D1 does not. One row per
-- write, holding the value that was there BEFORE that write -- so restoring
-- means reading the newest revision for a path and writing its body back.
-- Depth 20 per path, pruned on write (Task 4).
CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  -- Groups every row written by ONE publish request. A publish that touches
  -- three D1 paths writes three revision rows sharing one publish_id, and
  -- undo restores exactly that group. Without it, undo could only ever mean
  -- "the newest revision of each path", which silently mixes two publishes
  -- together when one of them did not touch every path.
  publish_id TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  sha        TEXT    NOT NULL,
  version    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Pruning and undo both read by (path, id DESC); the group restore reads by
-- publish_id. Two indexes, because those are two different access patterns
-- and neither serves the other.
CREATE INDEX IF NOT EXISTS revisions_by_path ON revisions (path, id DESC);
CREATE INDEX IF NOT EXISTS revisions_by_publish ON revisions (publish_id);

-- Deliberately empty of rows at creation. It exists now so that Phase 5 has
-- somewhere to put a schema version / snapshot stamp without a second
-- migration, and so the schema test below has a third table to prove it is
-- reading the real file rather than matching on two lucky strings.
CREATE TABLE IF NOT EXISTS content_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
