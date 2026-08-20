-- Applied by a human, exactly like 0001:
--   npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0002_analytics.sql
--
-- Same rule as 0001 and for the same reason: D1 has no migration runner this
-- Worker can call at runtime, and adding one would put a schema write on a
-- request path. Every statement is IF NOT EXISTS, so re-running the file is a
-- no-op rather than an error.
--
-- A SECOND file rather than more statements in 0001, because 0001 has already
-- been applied to the live database and its own header documents the exact
-- command that applied it. Appending to a file somebody has already run makes
-- "has this been applied?" un-answerable -- and every read against these
-- tables is deliberately no-throw, so a missing table is a card that reads
-- zero forever with nothing anywhere saying why.

-- One row per TAGGED arrival. Not per page view -- see the spec's "What a
-- number on this panel means": a visitor who arrives through Instagram and
-- reads four pages came from Instagram once, and a table with four rows for
-- that visitor would be wrong by a factor of four. The guard is in
-- src/campaign.ts (per tab) and in the fact that only an arrival URL ever
-- carries the tag.
--
-- WHAT IS NOT HERE, deliberately: no address, no user agent, no identifier of
-- any kind. A source and a day is the whole record. The site is cookieless on
-- the public side and this does not change that.
CREATE TABLE IF NOT EXISTS campaign_arrivals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- One of src/shared/campaign-sources.ts's KNOWN_CAMPAIGN_SOURCES, or the
  -- literal 'ai', or the literal 'other'. Collapsed at the WRITE boundary, so
  -- this column's value space is six strings forever no matter what anyone
  -- puts in a URL.
  source     TEXT    NOT NULL,
  -- IST calendar date, YYYY-MM-DD, from todayInKolkata(). IST because the
  -- restaurant's day is what she is reading, and because wa:counts is already
  -- keyed that way -- two date conventions in one panel is how a future
  -- reader gets an off-by-one that nothing on screen explains.
  day        TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_arrivals_by_day ON campaign_arrivals (day);

-- The rate limiter and the daily cap, which are the same shape and therefore
-- the same table. `bucket` is opaque BY CONSTRUCTION: for the per-address
-- limiter it is a truncated SHA-256 of the address, the window number and a
-- committed salt, so it cannot be linked back to an address without the
-- address and cannot be linked across windows at all; for the daily cap it is
-- the literal 'day:<IST date>', which identifies nobody. Rows are deleted
-- when they expire, by the same prune the nightly job runs.
--
-- THIS is how the spec's "rate limited per address, capped daily" is honoured
-- without a KV write (the namespace budget is ~800 of 1,000 already spent)
-- and without storing an address (the spec's "It does not record who").
CREATE TABLE IF NOT EXISTS campaign_rate (
  bucket  TEXT PRIMARY KEY,
  hits    INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_rate_by_expiry ON campaign_rate (expires);

-- Cloudflare's own daily total, copied into our storage before Cloudflare
-- discards it. One row per UTC day, written by the scheduled handler.
--
-- UTC here, IST above, and that is not an oversight: this row is a copy of a
-- Cloudflare number and Cloudflare's RUM days are UTC. Re-bucketing it into
-- IST would mean splitting a day we only have the total of, which invents
-- precision. The offset is 5h30m at the edges of a window, the same accepted
-- mismatch worker/analytics.ts already records for taps.
CREATE TABLE IF NOT EXISTS daily_visits (
  day         TEXT PRIMARY KEY,
  visits      INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);

-- The archive that outlives Cloudflare's six months. Twelve rows a year,
-- forever, is nothing.
--
-- `complete` is the column the by-year view turns on. A month rolled up from
-- eleven days is not comparable to one rolled from thirty, and a flag is the
-- only way the read side can tell. The panel draws a partial month WITH an
-- asterisk rather than omitting it: an omitted month is a gap she cannot see,
-- and an unlabelled short column is a collapse that did not happen. Stated
-- plainly because it cannot be fixed -- this archive accumulates from the day
-- it was switched on and the first year in it IS partial.
CREATE TABLE IF NOT EXISTS monthly_visits (
  month       TEXT PRIMARY KEY,  -- YYYY-MM
  visits      INTEGER NOT NULL,
  complete    INTEGER NOT NULL,  -- 1 when every day of that month is present in daily_visits
  recorded_at INTEGER NOT NULL
);
