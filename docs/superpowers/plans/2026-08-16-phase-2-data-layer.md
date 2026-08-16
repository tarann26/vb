# Phase 2: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a D1 database and an R2 bucket alongside the existing KV binding, and prove a complete content path through D1 — read with a versioned edge cache and a compiled snapshot fallback, write with path allowlisting, optimistic concurrency and undo — on exactly one new piece of content (Awards), while every file that exists today keeps its current GitHub path untouched and fully working.

**Architecture:** A `ContentStore` interface with two implementations, `GitHubStore` (a thin wrapper over the `worker/github.ts` that already works) and `D1Store` (new), selected per-path by `storeFor(env, path)`. The default routing sends every content file that exists today to GitHub, so the spec's "nothing that exists today migrates" is a property of the code rather than a promise anyone has to remember. A `CONTENT_STORE` env var is the eventual switch: setting it to `d1` moves everything at once, and unsetting it moves everything back, with no code change and no deploy of new logic. The pilot is Awards, pulled forward from Phase 4, stored in the generic `content` table rather than a bespoke `awards` table — a bespoke table would prove a bespoke route, not the seam.

**Tech Stack:** Cloudflare Workers (workerd, `@cloudflare/workers-types` 5), D1 (SQLite), R2, KV, wrangler 4. Vite 5, React 18, TypeScript strict (solution-style tsconfig), Tailwind 3, Vitest 3.2.7, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md` (Phase 2)

## Global Constraints

- Typecheck is `npx tsc -b --noEmit`. Plain `tsc --noEmit` checks nothing; the tsconfig is solution-style.
- Full gate: `npx tsc -b --noEmit && npm test -- --run && npx eslint .` plus `npx playwright test`. Run Playwright only when nothing else is running — concurrent runs share port 8080 and give phantom failures.
- Every test must be able to fail; every test-writing step needs an explicit mutation proof with the expected failure named. This project has shipped three tests that could not fail and each hid a real bug.
- jsdom has no layout engine — rendering, geometry, occlusion, and computed-style claims go in `e2e/`.
- Never list Claude or any AI as co-author, and never mention AI in a commit message.
- Retired hexes `#6B8B59` and `#5a7349` appear nowhere except `scripts/favicons.mjs`. Brand `#C8D8E8` is a surface colour only (1.45:1 on white); foreground text on light backgrounds uses accent `#9D4949` (6.03:1); on dark backgrounds brand stays.
- Verified free-tier limits (do not re-guess): D1 5,000,000 rows read/day, 100,000 written/day, 5 GB per account, 500 MB per database, 10 databases. R2 10 GB-month, 1M Class A ops, 10M Class B ops, egress free.
- Anything billable is forbidden without the owner's approval.
- `src/test/homepage-bytes.test.tsx` asserts an exact byte count and will need updating when the Awards section lands. Update the number, never the assertion.

### Constraints specific to this phase

- **D1 has no explicit transactions from a Worker.** `db.batch()` runs its statements together, but there is no `BEGIN`/`COMMIT` a handler can hold open across an `await`. A conditional `UPDATE ... WHERE sha = ?` that matches zero rows is **not an error** in D1 — it returns success with `meta.changes === 0`. Optimistic concurrency therefore guards **before** any mutation, by reading and comparing, and never by inspecting `meta.changes` afterwards. This is load-bearing and Task 4's mutation proof for it is not skippable.
- **Cross-store atomicity is genuinely lost** for the length of the pilot, one file wide. A publish that touches both `awards.json` (D1) and, say, `sections.json` (GitHub) can leave the first written and the second not. Say this plainly wherever it comes up; do not write a comment implying otherwise. It closes when `CONTENT_STORE` flips and the partition becomes one group again.
- **Write ordering is D1 first, GitHub second.** If the GitHub leg then fails, every `baseSha` in the request is still current and a retry succeeds. Reversed, a successful commit moves every blob sha, the retry gets a false 409, and the owner has to reload and redo the edit she already made.
- **R2 is bound in this phase and otherwise unused, deliberately.** The spec says the derivative pipeline "runs on upload inside the Worker rather than at build time". It cannot: `scripts/images.mjs` loads sharp's native binding at module scope, and workerd cannot execute native code. Every Cloudflare resizing product (Images, the `/cdn-cgi/image/` transform endpoint) is billable, which the standing authorization forbids. Three options are owed a decision before Phase 3 — generate derivatives at build time and upload the results to R2; upload originals and resize in the browser before the request; or buy Cloudflare Images. **Phase 2 records the three and picks none.**
- **The read path serves JSON, not server-rendered HTML.** `wrangler.toml` routes only `vb.aionxxxi.uk/api/*` to this Worker and the site is a Pages-hosted SPA; SSR would need a second route pattern and a React renderer inside the Worker, with no consumer in Phase 2 — and `worker/__tests__/bundle.test.ts` fails the build if React ever reaches the Worker bundle. Everything that makes the read path a *seam* — the content version, the cache key, invalidation without an explicit purge, the snapshot fallback, the `x-content-source` header — is built here and is independent of the body's format. The spec's SSR requirement attaches to per-post SEO, which is Phase 5's.
- `withSecurityHeaders` (worker/index.ts) sets `Cache-Control: no-store` on **every** response. The public read path is the first response in this Worker that must be cacheable, so that blanket rule gains a named exemption in Task 7. `worker/__tests__/hardening.test.ts` asserts `no-store` on `/api/health`, on a 404, and on a 401 — none of which are the exempt route, so those stay green and a new test pins the exemption.
- Worker tests run under this repo's single jsdom Vitest environment. `KVNamespace`, `D1Database` and `R2Bucket` are type-only here; there is no miniflare and no `vitest-pool-workers`. Every D1 test builds a hand-written fake, the same way `hardening.test.ts` builds `FakeKV`. `caches.default` does not exist either, so the read path takes its cache as a parameter rather than reaching for a global.

## File Structure

**Created:**
- `worker/migrations/0001_content.sql` — the `content`, `revisions` and `content_meta` tables.
- `worker/store.ts` — `ContentStore`, `StoredContent`, `StoreWriteFile`, `storeFor`, `D1_ONLY_PATHS`, `GitHubStore`.
- `worker/d1.ts` — `D1Store`, `D1ConflictError`, `REVISION_DEPTH`, `sha256Hex`.
- `worker/published.ts` — the public read route, the versioned cache key, `x-content-source`.
- `worker/snapshot.ts` — generated, committed: last-known-good JSON compiled into the bundle.
- `scripts/build-snapshot.mjs` — regenerates `worker/snapshot.ts` from the live D1 database.
- `worker/__tests__/fakeD1.ts` — the shared hand-written D1 fake.
- `worker/__tests__/store.test.ts`, `worker/__tests__/d1.test.ts`, `worker/__tests__/published.test.ts`, `worker/__tests__/snapshot.test.ts`, `worker/__tests__/migrations.test.ts`
- `src/components/Awards.tsx` — the homepage section, entries fetched at runtime.
- `src/components/__tests__/Awards.test.tsx`
- `src/admin/areas/AwardsArea.tsx` — the dashboard panel.
- `src/admin/areas/__tests__/AwardsArea.test.tsx`
- `src/test/awards-seed.json` — the committed seed used by Task 12's first D1 write and by the snapshot fallback.

**Modified:**
- `wrangler.toml` — D1 and R2 bindings, `CONTENT_STORE` var.
- `src/test/wrangler-config.test.ts` — placeholder-or-real-shape checks for the two new ids.
- `worker/index.ts` — `Env` gains `DB`/`R2`/`CONTENT_STORE`; publish, undo, `GET /api/content` route through `storeFor`; the new public route; the `Cache-Control` exemption.
- `src/content/types.ts` — `Award`, `SectionId` gains `awards`, `Copy` gains `awards`.
- `src/content/guards.ts` — `AWARD_KEYS`, `SECTION_ID_SET` gains `awards`.
- `src/content/validate.ts` — `validateAwards`, `RULES['awards.json']`.
- `src/content/sections.json`, `src/content/copy.json` — the awards entry and its heading/intro.
- `src/App.tsx`, `src/admin/EditMode.tsx`, `src/admin/SectionList.tsx` — the three `Record<SectionId, …>` literals.
- `src/content/__tests__/sections.test.tsx` — `MARKER` and `SECTION_SELECTOR`.
- `src/admin/content.ts` — `CONTENT_FILES`, `CONTENT_FILE_LABELS`, `ContentTypeMap`.
- `src/admin/publish.ts`, `src/admin/undo.ts`, `src/admin/PublishBar.tsx` — a publish that produces no commit.
- `src/admin/manage/areas.ts`, `src/admin/manage/ManageShell.tsx` — the eleventh panel.
- `src/test/homepage-bytes.test.tsx` — the byte count, in Task 9 only.

---

### Task 1: Create and bind D1 and R2

Nothing in this task can be done by an agent. Both resources need Cloudflare account access, and both are created by a human running a command. The agent's job is the `wrangler.toml` edit and the guard test; the human's job is the two commands and pasting two ids.

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/test/wrangler-config.test.ts`
- Modify: `worker/index.ts` (the `Env` interface only)

**Interfaces:**
- Consumes: nothing.
- Produces: `env.DB: D1Database`, `env.R2: R2Bucket`, `env.CONTENT_STORE?: 'github' | 'd1'`. Tasks 3, 4, 5, 6 and 7 all read `env.DB`; nothing in this phase reads `env.R2`.

- [ ] **Step 1: A human runs the two create commands**

Both are free-tier. Neither enables a billable add-on, and none is to be enabled:

```bash
npx wrangler d1 create via-bianca-content
npx wrangler r2 bucket create via-bianca-assets
```

`d1 create` prints a `database_id` — a UUID **with dashes**, 36 characters. `r2 bucket create` prints only the bucket name it created; there is no id to paste for R2.

Do not enable R2 Data Catalog, R2 Sippy, Cloudflare Images, or any Workers Paid feature while in the dashboard. D1 and R2 both have free tiers that this project fits inside with room to spare (whole current content set: 400 KB, against a 500 MB per-database cap), and anything billable needs the owner's approval first.

- [ ] **Step 2: Add the bindings to `wrangler.toml`**

Append **after** the existing `[[kv_namespaces]]` block, not before it. `src/test/wrangler-config.test.ts` finds the KV id with `/^id\s*=\s*"([^"]+)"/m` — the first line-anchored `id = "…"` in the file. D1 uses `database_id` and R2 uses `bucket_name`, so neither introduces a competing `^id =`, but keeping the order stable removes the question entirely.

```toml
# Phase 2. The content store the D1 path is proven on. Created by a human
# (`wrangler d1 create via-bianca-content`) for the same reason the KV id
# above was: an agent has no Cloudflare account access. A D1 database_id is a
# UUID WITH DASHES (36 characters), not the 32-character hex the KV id and
# the account id are -- src/test/wrangler-config.test.ts checks it against
# its own pattern for exactly that reason.
#
# Free tier, verified against the live docs 2026-08-15: 5,000,000 rows
# read/day, 100,000 rows written/day, 5 GB per account, 500 MB per database,
# 10 databases. The entire current content set is 400 KB.
[[d1_databases]]
binding = "DB"
database_name = "via-bianca-content"
database_id = "PLACEHOLDER-NOT-A-REAL-D1-DATABASE-ID"

# Phase 2 BINDS this and deliberately does not use it. The spec says the
# image derivative pipeline "runs on upload inside the Worker rather than at
# build time"; it cannot. scripts/images.mjs loads sharp's native binding at
# module scope and workerd cannot execute native code, and every Cloudflare
# resizing product (Images, the /cdn-cgi/image/ transform endpoint) is
# billable, which the standing authorization forbids without the owner's
# approval. Three options are owed a decision before Phase 3: generate
# derivatives at build time and upload the results here; upload originals and
# resize in the browser before the request; or buy Cloudflare Images. The
# bucket exists now so that decision is the only thing left to make.
#
# Free tier: 10 GB-month, 1,000,000 Class A ops/month, 10,000,000 Class B
# ops/month, egress free.
[[r2_buckets]]
binding = "R2"
bucket_name = "via-bianca-assets"
```

And in the `[vars]` block:

```toml
# The eventual switch. UNSET (or "github") is the default and means every
# content file that exists today is read from and written to GitHub, exactly
# as it is now -- see worker/store.ts's `storeFor`. "d1" moves all of them at
# once. The pilot file (src/content/awards.json) is on D1 either way, because
# it exists nowhere else. Flipping this is one config change with an instant
# rollback, which is the whole reason the ContentStore indirection exists.
CONTENT_STORE = "github"
```

- [ ] **Step 3: Extend the config guard**

In `src/test/wrangler-config.test.ts`, add alongside the existing checks. Keep the existing placeholder-or-well-formed posture exactly — the file's own header comment explains at length why exact equality to a placeholder is a test that goes red forever the moment the setup it guards is completed, and this task must not reintroduce that:

```ts
const D1_ID_PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-D1-DATABASE-ID';

// A D1 database_id is a dashed UUID -- 8-4-4-4-12 lowercase hex -- which is
// what `wrangler d1 create` prints. Deliberately NOT the HEX32 pattern the
// KV namespace id and the Cloudflare account id share above: those are UUIDs
// with the dashes stripped, and reusing HEX32 here would reject every real
// value this field can ever hold.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidD1IdOrPlaceholder(value: string): boolean {
  return value === D1_ID_PLACEHOLDER || UUID.test(value);
}

// R2 bucket names: lowercase letters, digits and hyphens, 3-63 characters,
// starting and ending alphanumeric. Same shape check, same reason.
const R2_BUCKET_SHAPE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

describe('wrangler.toml Phase 2 bindings', () => {
  it('binds a D1 database with either the placeholder id or a well-formed real one', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml).toMatch(/^\[\[d1_databases\]\]$/m);
    expect(toml).toMatch(/^binding\s*=\s*"DB"$/m);
    const match = toml.match(/^database_id\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(isValidD1IdOrPlaceholder(match![1])).toBe(true);
  });

  it('accepts a real dashed UUID and the placeholder, rejects a 32-hex id or a half-pasted value', () => {
    expect(isValidD1IdOrPlaceholder('4b1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
    expect(isValidD1IdOrPlaceholder(D1_ID_PLACEHOLDER)).toBe(true);
    // The exact wrong-shape mistake this pattern exists to catch: pasting the
    // KV namespace id (32 hex, no dashes) into the D1 field.
    expect(isValidD1IdOrPlaceholder('3e90a6b54f83487995156291801dce95')).toBe(false);
    expect(isValidD1IdOrPlaceholder('')).toBe(false);
    expect(isValidD1IdOrPlaceholder('PLACEHOLDER-partially-edited')).toBe(false);
  });

  it('binds an R2 bucket with a well-formed name', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml).toMatch(/^\[\[r2_buckets\]\]$/m);
    expect(toml).toMatch(/^binding\s*=\s*"R2"$/m);
    const match = toml.match(/^bucket_name\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(R2_BUCKET_SHAPE.test(match![1])).toBe(true);
  });

  // The KV id check above reads the FIRST line-anchored `id = "…"` in the
  // file. Pinned here so a future binding added ABOVE the KV block -- one
  // that happens to use a bare `id` key -- cannot silently redirect that
  // check onto a different value while still passing.
  it('still finds the KV namespace id first, ahead of the new bindings', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[d1_databases]]'));
  });

  it('defaults CONTENT_STORE to github, so nothing that exists today moves', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CONTENT_STORE\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('github');
  });
});
```

- [ ] **Step 4: Widen `Env`**

In `worker/index.ts`, extend the existing interface. Keep the module-owns-its-own-vars posture the file already documents:

```ts
export interface Env extends GitHubEnv, PagesEnv, WebAnalyticsEnv {
  KV: KVNamespace;
  ADMIN_PASSWORD_HASH: string;
  TOKEN_SECRET: string;
  // Phase 2. Read by worker/store.ts's storeFor and everything behind it.
  DB: D1Database;
  // Bound, and deliberately unused in Phase 2 -- see wrangler.toml's own
  // comment for why the derivative pipeline cannot run in this Worker and
  // what decision is owed before Phase 3. Declared here rather than left off
  // the type so that "bound but unused" is a visible statement rather than
  // an omission somebody has to go and check the toml to notice.
  R2: R2Bucket;
  // Optional so an env that predates this var (a local `wrangler dev`, an
  // older test fixture) behaves exactly like today rather than throwing.
  CONTENT_STORE?: string;
}
```

- [ ] **Step 5: Run the config guard and prove it can fail**

Run: `npx vitest run src/test/wrangler-config.test.ts`
Expected: PASS.

Then change `database_id` in `wrangler.toml` to `"3e90a6b54f83487995156291801dce95"` (the KV id — a plausible-looking wrong paste) and re-run. Expected: FAIL on the D1 id case. Revert.

Then delete the `[[r2_buckets]]` block and re-run. Expected: FAIL naming the R2 binding. Revert.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b --noEmit && npx eslint .`
Expected: both clean. `D1Database` and `R2Bucket` come from `@cloudflare/workers-types` via `tsconfig.worker.json`, which `worker/index.ts` is already compiled under.

- [ ] **Step 7: Commit**

```bash
git add wrangler.toml src/test/wrangler-config.test.ts worker/index.ts
git commit -m "feat(worker): bind a D1 database and an R2 bucket alongside KV

Both created by hand on the free tier, no billable add-on enabled. R2 is
bound and unused on purpose: the derivative pipeline cannot run in the
Worker (sharp is a native binding, workerd cannot execute native code) and
every Cloudflare resizing product is billable, so that decision is owed
before Phase 3 rather than made here."
```

---

### Task 2: Schema and migrations

The generic `content` table holds a whole JSON document per path, which is what makes the pilot prove the *seam* rather than a bespoke Awards route. Blocks and posts get their own tables in Phase 5; nothing here anticipates them beyond leaving the door open.

**Files:**
- Create: `worker/migrations/0001_content.sql`
- Create: `worker/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: three tables read by Task 4's `D1Store`:
  - `content(path TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
  - `revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, publish_id TEXT NOT NULL, body TEXT NOT NULL, sha TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL)`
  - `content_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`

- [ ] **Step 1: Write the migration**

Create `worker/migrations/0001_content.sql`:

```sql
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
```

- [ ] **Step 2: Write the failing schema test**

The value of this test is that it fails when the SQL and the code that queries it disagree — the single most likely defect in a phase where nothing in CI can run a real D1.

Create `worker/__tests__/migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'worker/migrations';

function sql(): string {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(DIR, f), 'utf8'))
    .join('\n');
}

describe('the D1 migrations', () => {
  it('are numbered so their apply order is the filename order', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9-]+\.sql$/);
  });

  // Re-applying a migration must be a no-op, not an error: there is no
  // migration runner inside this Worker, so "apply the file again" is the
  // normal recovery action a human takes, and a bare CREATE TABLE would make
  // it fail and look like the database is broken.
  it('are idempotent -- every CREATE carries IF NOT EXISTS', () => {
    const creates = sql().match(/CREATE\s+(TABLE|INDEX)[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const create of creates) expect(create.toUpperCase()).toContain('IF NOT EXISTS');
  });

  // The assertion that actually catches drift. Nothing in this repo's test
  // environment can run a real D1 query, so a column the store SELECTs and
  // the schema never declared would otherwise surface for the first time in
  // production, as a D1_ERROR on a live publish.
  it('declares every column worker/d1.ts reads or writes', () => {
    const text = sql();
    const required: Record<string, string[]> = {
      content: ['path', 'body', 'sha', 'version', 'updated_at'],
      revisions: ['id', 'path', 'publish_id', 'body', 'sha', 'version', 'created_at'],
      content_meta: ['key', 'value'],
    };
    for (const [table, columns] of Object.entries(required)) {
      const block = text.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
      expect(block, `no CREATE TABLE for ${table}`).not.toBeNull();
      for (const column of columns) {
        expect(block![1], `${table}.${column}`).toMatch(new RegExp(`^\\s*${column}\\s`, 'm'));
      }
    }
  });

  it('makes path the primary key of content, so one document cannot exist twice', () => {
    expect(sql()).toMatch(/path\s+TEXT\s+PRIMARY KEY/i);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run worker/__tests__/migrations.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Prove it can fail**

Delete the `version    INTEGER NOT NULL,` line from the `content` table and re-run. Expected: FAIL naming `content.version`. Restore it.

Then change `CREATE TABLE IF NOT EXISTS content_meta` to `CREATE TABLE content_meta` and re-run. Expected: FAIL on the idempotence case. Revert.

Both, not one: the column check and the idempotence check fail on completely different mistakes, and a single mutation only proves one of them is alive.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations src/../worker/__tests__/migrations.test.ts
git commit -m "feat(worker): add the D1 schema for content, revisions and metadata

Awards goes in the generic content table rather than a bespoke awards one:
a bespoke table would prove a bespoke route, not the seam every later phase
sits on. The schema test exists because nothing in CI can run a real D1, so
a column the store reads and the migration never declared would otherwise
first appear as a D1_ERROR on a live publish."
```

---

### Task 3: The `ContentStore` seam

The indirection layer, with only the GitHub implementation behind it. At the end of this task nothing behaves differently: every existing file still goes through exactly the same `worker/github.ts` calls it does today. What exists that did not before is a single function that decides where a path lives.

**Files:**
- Create: `worker/store.ts`
- Create: `worker/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `getFileContent`, `commitFiles`, `isContentPath`, `type GitHubEnv`, `type FileContent` from `worker/github.ts`.
- Produces, consumed by Tasks 4, 5, 6 and 7:

```ts
export interface StoredContent { content: string; sha: string; }
export interface StoreWriteFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  baseSha?: string;
}
export interface ContentStore {
  readonly name: 'github' | 'd1';
  read(path: string): Promise<StoredContent | null>;
  write(files: StoreWriteFile[], message: string, publishId: string): Promise<{ sha: string | null }>;
}
export interface StoreEnv extends GitHubEnv { DB: D1Database; CONTENT_STORE?: string; }
export const D1_ONLY_PATHS: ReadonlySet<string>;
export function storeFor(env: StoreEnv, path: string): ContentStore;
export function partitionByStore(env: StoreEnv, files: StoreWriteFile[]): { d1: StoreWriteFile[]; github: StoreWriteFile[] };
```

- [ ] **Step 1: Write the module**

Create `worker/store.ts`. `D1Store` is imported but not written until Task 4 — write Task 4's file first as an empty stub if the typecheck order bothers you, or write this task's steps 1 and 2 and let `tsc` fail until Task 4 lands; the commit at the end of this task must typecheck either way, so create `worker/d1.ts` with just the class shell here and fill it in next task.

```ts
// Where a content file lives. One function answers that for the whole
// Worker, so "nothing that exists today migrates" (the spec's own Phase 2
// instruction) is enforced by code rather than by discipline -- there is no
// path through publish, undo or GET /api/content that can send an existing
// file to D1 without this function saying so.
//
// Two implementations rather than write-to-both or a straight migration.
// Write-to-both doubles the failure surface of every publish and leaves the
// two stores disagreeing with no reconciliation story; a straight migration
// has no rollback. This is the only option where the switch is one config
// change and the rollback is the same change backwards.
import {
  commitFiles,
  getFileContent,
  type GitHubEnv,
} from './github';
import { D1Store } from './d1';

export interface StoredContent {
  // The exact text of the document. On GitHub this is the decoded blob; on
  // D1 it is the `body` column verbatim.
  content: string;
  // An opaque token that changes when the content changes and never
  // otherwise. GitHub supplies a blob sha; D1 supplies a SHA-256 of the body.
  // The dashboard round-trips it as `baseSha` and never inspects it, which is
  // what lets the two stores use different things here.
  sha: string;
}

export interface StoreWriteFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  // Present only from a caller that tracks one -- see handlePublish's step 3.
  // The GitHub store ignores it (handlePublish does that comparison itself,
  // before this module is reached); the D1 store re-checks it INSIDE `write`,
  // before any mutation, which is its whole concurrency guard.
  baseSha?: string;
}

export interface ContentStore {
  readonly name: 'github' | 'd1';
  read(path: string): Promise<StoredContent | null>;
  // Returns the commit sha for GitHub and `null` for D1, because a D1 write
  // creates no commit and there is nothing honest to put there. Callers must
  // handle `null` rather than inventing a value: worker/index.ts's publish
  // response and the dashboard's build-status polling both branch on it
  // (Task 10).
  write(files: StoreWriteFile[], message: string, publishId: string): Promise<{ sha: string | null }>;
}

export interface StoreEnv extends GitHubEnv {
  DB: D1Database;
  CONTENT_STORE?: string;
}

// Paths that live in D1 regardless of CONTENT_STORE, because they exist
// nowhere else. src/content/awards.json has never been a file in this
// repository and never will be: Awards is built on D1 from the start rather
// than as a JSON file that would need migrating two months later (the spec's
// own words, Phase 4).
export const D1_ONLY_PATHS: ReadonlySet<string> = new Set(['src/content/awards.json']);

// The GitHub store is exactly today's behaviour behind the interface. It
// deliberately adds nothing: no retry, no caching, no extra validation. If
// this wrapper ever grows a behaviour of its own, the "the GitHub path is
// left fully working" property of this phase stops being checkable by
// reading one small file.
class GitHubStore implements ContentStore {
  readonly name = 'github' as const;
  constructor(private readonly env: GitHubEnv) {}

  async read(path: string): Promise<StoredContent | null> {
    return getFileContent(this.env, path);
  }

  async write(files: StoreWriteFile[], message: string): Promise<{ sha: string }> {
    // `baseSha` is stripped rather than passed through: commitFiles' own
    // CommitFile type has no such field, and handlePublish has already done
    // the comparison this store's conflict detection relies on (its step 3,
    // plus updateBranchHead's own 422). Passing an unknown key through would
    // be harmless today and a silent contract change the first time
    // commitFiles started reading its input more strictly.
    return commitFiles(
      this.env,
      files.map(({ path, content, encoding }) => ({ path, content, encoding })),
      message,
    );
  }
}

export function storeFor(env: StoreEnv, path: string): ContentStore {
  if (D1_ONLY_PATHS.has(path)) return new D1Store(env.DB);
  return env.CONTENT_STORE === 'd1' ? new D1Store(env.DB) : new GitHubStore(env);
}

// Splits one publish request into its two legs, preserving the caller's
// order within each. Order BETWEEN the legs is decided by the caller
// (worker/index.ts writes D1 first -- see its own comment for why), not here.
export function partitionByStore(
  env: StoreEnv,
  files: StoreWriteFile[],
): { d1: StoreWriteFile[]; github: StoreWriteFile[] } {
  const d1: StoreWriteFile[] = [];
  const github: StoreWriteFile[] = [];
  for (const file of files) {
    (storeFor(env, file.path).name === 'd1' ? d1 : github).push(file);
  }
  return { d1, github };
}
```

- [ ] **Step 2: Write the routing test**

This is the test that makes the spec's "nothing that exists today migrates" mechanical. Create `worker/__tests__/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { D1_ONLY_PATHS, partitionByStore, storeFor, type StoreEnv } from '../store';
import { CONTENT_FILES } from '../../src/admin/content';

function env(overrides: Partial<StoreEnv> = {}): StoreEnv {
  return {
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'store-test-token-not-real',
    DB: {} as D1Database,
    ...overrides,
  };
}

describe('storeFor, with CONTENT_STORE unset or "github"', () => {
  // The whole point of the interface, as an assertion rather than a promise.
  // Every file that exists in src/content/ today keeps its GitHub path, and
  // this fails the moment one of them is quietly moved.
  it.each([undefined, 'github'])('leaves every existing content file on GitHub (CONTENT_STORE=%s)', (mode) => {
    const e = env({ CONTENT_STORE: mode });
    for (const file of CONTENT_FILES) {
      const path = `src/content/${file}`;
      if (D1_ONLY_PATHS.has(path)) continue;
      expect(storeFor(e, path).name, path).toBe('github');
    }
  });

  it('sends the pilot file to D1 anyway, because it exists nowhere else', () => {
    expect(storeFor(env(), 'src/content/awards.json').name).toBe('d1');
  });

  it('sends photo and menu paths to GitHub -- R2 is bound and unused in this phase', () => {
    expect(storeFor(env(), 'assets-source/food/photo.jpg').name).toBe('github');
    expect(storeFor(env(), 'public/menus/food-menu.pdf').name).toBe('github');
  });
});

describe('storeFor, with CONTENT_STORE="d1"', () => {
  it('moves everything at once -- the switch is one value, not a code change', () => {
    const e = env({ CONTENT_STORE: 'd1' });
    for (const file of CONTENT_FILES) {
      expect(storeFor(e, `src/content/${file}`).name, file).toBe('d1');
    }
  });

  // An unrecognised value must behave like the default, not like "d1".
  // Fail-safe in the direction that keeps the working path working.
  it('treats any unrecognised value as github', () => {
    expect(storeFor(env({ CONTENT_STORE: 'D1' }), 'src/content/dishes.json').name).toBe('github');
    expect(storeFor(env({ CONTENT_STORE: 'postgres' }), 'src/content/dishes.json').name).toBe('github');
  });
});

describe('partitionByStore', () => {
  it('splits a mixed publish and keeps each leg in the caller order', () => {
    const files = [
      { path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' as const },
      { path: 'src/content/sections.json', content: '[]', encoding: 'utf-8' as const },
      { path: 'src/content/copy.json', content: '{}', encoding: 'utf-8' as const },
    ];
    const { d1, github } = partitionByStore(env(), files);
    expect(d1.map((f) => f.path)).toEqual(['src/content/awards.json']);
    expect(github.map((f) => f.path)).toEqual(['src/content/sections.json', 'src/content/copy.json']);
  });
});
```

- [ ] **Step 3: Run it and prove it can fail**

Run: `npx vitest run worker/__tests__/store.test.ts`
Expected: PASS.

Mutation: add `'src/content/dishes.json'` to `D1_ONLY_PATHS` and re-run. Expected: FAIL on "leaves every existing content file on GitHub", naming `src/content/dishes.json`. Remove it.

Second mutation, because the first only proves one direction: change `storeFor`'s last line to `return new GitHubStore(env);` and re-run. Expected: FAIL on the `CONTENT_STORE="d1"` case. Revert.

- [ ] **Step 4: Full gate and commit**

Run: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

```bash
git add worker/store.ts worker/__tests__/store.test.ts
git commit -m "feat(worker): route content reads and writes through a ContentStore

Two stores behind one interface, chosen per path, with the default sending
every file that exists today to GitHub exactly as before. The routing test
is what makes 'nothing that exists today migrates' a property of the code
instead of a promise somebody has to remember."
```

---

### Task 4: The D1 store

The load-bearing task. Optimistic concurrency, revisions, pruning and restore, on a database with no transactions a handler can hold.

**Files:**
- Create: `worker/d1.ts`
- Create: `worker/__tests__/fakeD1.ts`
- Create: `worker/__tests__/d1.test.ts`

**Interfaces:**
- Consumes: `StoredContent`, `StoreWriteFile`, `ContentStore` from `worker/store.ts`.
- Produces, consumed by Tasks 5, 6 and 7:

```ts
export class D1ConflictError extends Error {}
export class D1Store implements ContentStore {
  readonly name: 'd1';
  constructor(db: D1Database);
  read(path: string): Promise<StoredContent | null>;
  write(files: StoreWriteFile[], message: string, publishId: string): Promise<{ sha: null }>;
  version(path: string): Promise<number | null>;
  undo(publishId: string): Promise<string[]>;   // the paths actually restored
}
export const REVISION_DEPTH = 20;
export async function sha256Hex(text: string): Promise<string>;
```

- [ ] **Step 1: Write the fake D1**

There is no miniflare here and `D1Database` is type-only in this test environment, so the fake is the test surface. It has to reproduce the two D1 behaviours the design turns on: a conditional `UPDATE` matching zero rows is a **success**, and `batch` is the only grouping available.

Create `worker/__tests__/fakeD1.ts`:

```ts
// A hand-written D1 stand-in, in the same spirit as hardening.test.ts's
// FakeKV: @cloudflare/workers-types has no runtime shape in this repo's
// jsdom Vitest environment, so there is nothing to import and instantiate.
//
// Deliberately NOT a general SQL engine. It understands exactly the handful
// of statements worker/d1.ts issues, matched by shape, and throws loudly on
// anything else -- a fake that silently accepted an unknown query would let
// a typo'd statement pass every test here and fail only in production.
//
// The two behaviours it reproduces on purpose, because the design turns on
// them: an UPDATE whose WHERE matches nothing SUCCEEDS with changes: 0 (it
// is not an error, which is why optimistic concurrency cannot be built on
// inspecting `meta.changes` after the fact), and there is no BEGIN/COMMIT a
// caller can hold across an await.
export interface ContentRow { path: string; body: string; sha: string; version: number; updated_at: number }
export interface RevisionRow { id: number; path: string; publish_id: string; body: string; sha: string; version: number; created_at: number }

export class FakeD1 {
  content = new Map<string, ContentRow>();
  revisions: RevisionRow[] = [];
  statements: string[] = [];
  private nextId = 1;
  // Set to a message to make every subsequent call reject -- how the
  // snapshot-fallback tests force a query failure.
  failWith: string | null = null;

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return new FakeStatement(this, normalized, []);
  }

  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    if (this.failWith) throw new Error(this.failWith);
    const out: unknown[] = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }

  execute(statement: FakeStatement): { changes: number; row?: unknown; rows?: unknown[] } {
    if (this.failWith) throw new Error(this.failWith);
    this.statements.push(statement.sql);
    const sql = statement.sql;
    const args = statement.args;

    if (sql.startsWith('SELECT body, sha, version FROM content WHERE path = ?')) {
      const row = this.content.get(args[0] as string);
      return { changes: 0, row: row ? { body: row.body, sha: row.sha, version: row.version } : undefined };
    }
    if (sql.startsWith('SELECT version FROM content WHERE path = ?')) {
      const row = this.content.get(args[0] as string);
      return { changes: 0, row: row ? { version: row.version } : undefined };
    }
    if (sql.startsWith('INSERT INTO revisions')) {
      const [path, publishId, body, sha, version, createdAt] = args as [string, string, string, string, number, number];
      this.revisions.push({ id: this.nextId++, path, publish_id: publishId, body, sha, version, created_at: createdAt });
      return { changes: 1 };
    }
    if (sql.startsWith('INSERT INTO content')) {
      const [path, body, sha, version, updatedAt] = args as [string, string, string, number, number];
      const existing = this.content.get(path);
      // ON CONFLICT ... WHERE sha = ?: the conditional half. A mismatch
      // changes nothing AND DOES NOT THROW -- the exact D1 behaviour the
      // pre-mutation guard in D1Store exists because of.
      if (existing) {
        const expected = args[5] as string | undefined;
        if (expected !== undefined && existing.sha !== expected) return { changes: 0 };
      }
      this.content.set(path, { path, body, sha, version, updated_at: updatedAt });
      return { changes: 1 };
    }
    if (sql.startsWith('DELETE FROM revisions WHERE path = ? AND id NOT IN')) {
      const path = args[0] as string;
      const keep = args[1] as number;
      const mine = this.revisions.filter((r) => r.path === path).sort((a, b) => b.id - a.id);
      const survivors = new Set(mine.slice(0, keep).map((r) => r.id));
      this.revisions = this.revisions.filter((r) => r.path !== path || survivors.has(r.id));
      return { changes: 0 };
    }
    if (sql.startsWith('SELECT path, body, sha FROM revisions WHERE publish_id = ?')) {
      const rows = this.revisions
        .filter((r) => r.publish_id === args[0])
        .map((r) => ({ path: r.path, body: r.body, sha: r.sha }));
      return { changes: 0, rows };
    }
    if (sql.startsWith('SELECT path, body FROM content')) {
      return { changes: 0, rows: [...this.content.values()].map((r) => ({ path: r.path, body: r.body })) };
    }
    throw new Error(`FakeD1 does not know this statement: ${sql}`);
  }
}

export class FakeStatement {
  constructor(private readonly db: FakeD1, readonly sql: string, readonly args: unknown[]) {}
  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, args);
  }
  async first<T>(): Promise<T | null> {
    return (this.db.execute(this).row as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: (this.db.execute(this).rows as T[] | undefined) ?? [] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    return { meta: { changes: this.db.execute(this).changes } };
  }
}

export function asD1(fake: FakeD1): D1Database {
  return fake as unknown as D1Database;
}
```

- [ ] **Step 2: Write `worker/d1.ts`**

```ts
// The D1 half of the ContentStore. Everything here exists to reproduce a
// guarantee worker/github.ts already provides for free, and the comments say
// which one, because "we also have undo" is not the same claim as "undo
// behaves the way git's did".
import type { ContentStore, StoreWriteFile, StoredContent } from './store';

// Distinguishable from a generic Error so worker/index.ts can map a
// concurrent edit to 409 -- the same status a GitHub PublishConflictError
// and a baseSha mismatch already answer with, so the dashboard keeps
// branching on STATUS alone and never on message text.
export class D1ConflictError extends Error {}

// The spec's own number. Twenty revisions per path, pruned on write, so the
// table cannot grow without bound on a database with a 500 MB cap.
export const REVISION_DEPTH = 20;

// SHA-256 of the exact body text, lowercase hex. This is the D1 store's
// equivalent of a GitHub blob sha: an opaque token the dashboard round-trips
// as `baseSha` and never inspects. crypto.subtle.digest is present in
// workerd and in this repo's Node-backed test environment alike -- unlike
// crypto.subtle.timingSafeEqual, which is Cloudflare-only (see
// vitest.config.ts's own list).
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ContentRowRead { body: string; sha: string; version: number }

export class D1Store implements ContentStore {
  readonly name = 'd1' as const;
  constructor(private readonly db: D1Database) {}

  async read(path: string): Promise<StoredContent | null> {
    const row = await this.db
      .prepare('SELECT body, sha, version FROM content WHERE path = ?')
      .bind(path)
      .first<ContentRowRead>();
    return row ? { content: row.body, sha: row.sha } : null;
  }

  // Read separately from `read` because the public read path needs the
  // version to BUILD its cache key, before it knows whether it will need the
  // body at all. One row either way -- see worker/published.ts's own comment
  // on what the cache is and is not buying at this size.
  async version(path: string): Promise<number | null> {
    const row = await this.db
      .prepare('SELECT version FROM content WHERE path = ?')
      .bind(path)
      .first<{ version: number }>();
    return row ? row.version : null;
  }

  // THE CONCURRENCY GUARD, and the reason it is shaped like this.
  //
  // D1 gives a Worker no explicit transaction: there is no BEGIN a handler
  // can hold across an await, and `batch` groups statements but cannot be
  // conditioned on a read the handler performed earlier. Worse, a
  // conditional `UPDATE ... WHERE sha = ?` that matches nothing is NOT an
  // error in D1 -- it returns success with meta.changes === 0. So the
  // tempting design ("write conditionally, then check meta.changes") has two
  // separate problems: it inspects a value that means "nothing matched" for
  // several unrelated reasons, and it discovers the conflict AFTER the other
  // statements in the same batch have already run.
  //
  // Therefore: every baseSha is compared BEFORE any mutation is issued, for
  // every file in the request, and a mismatch throws before a single write
  // happens. The conditional WHERE on the write itself is kept as a second
  // line of defence, not as the detection mechanism.
  //
  // What that leaves, stated rather than papered over: two writes landing
  // between the guard and the batch can both pass the guard. The conditional
  // WHERE makes the loser a no-op instead of an overwrite, and the loser's
  // prior value survives in `revisions` either way. On a single-owner site
  // with a 12-publishes-per-6-hours rate limit this window is not reachable
  // in practice; it is written down because a comment claiming atomicity
  // here would be false.
  async write(files: StoreWriteFile[], _message: string, publishId: string): Promise<{ sha: null }> {
    const now = Date.now();

    const prepared: {
      path: string;
      body: string;
      sha: string;
      version: number;
      prior: ContentRowRead | null;
    }[] = [];

    for (const file of files) {
      if (file.encoding !== 'utf-8') {
        // Binary belongs in R2, and R2 is deliberately unused this phase --
        // see wrangler.toml. Refused rather than stored as text, which would
        // corrupt it silently.
        throw new Error(`refuses to store "${file.path}" in D1: only utf-8 content is supported`);
      }
      const prior = await this.db
        .prepare('SELECT body, sha, version FROM content WHERE path = ?')
        .bind(file.path)
        .first<ContentRowRead>();

      // The guard, before anything is written. Both directions are real
      // conflicts and both are refused with the same error type:
      if (file.baseSha !== undefined) {
        if (!prior) throw new D1ConflictError(`${file.path} no longer exists -- reload before publishing`);
        if (prior.sha !== file.baseSha) throw new D1ConflictError(`someone else changed ${file.path} while you were editing`);
      }

      prepared.push({
        path: file.path,
        body: file.content,
        sha: await sha256Hex(file.content),
        version: (prior?.version ?? 0) + 1,
        prior: prior ?? null,
      });
    }

    const statements: D1PreparedStatement[] = [];
    for (const entry of prepared) {
      // The revision holds the PRIOR value, so undo means "write the newest
      // revision's body back". A brand-new path has no prior and therefore
      // no revision row: undoing the creation of a document would mean
      // deleting it, and this store never deletes -- the same posture
      // handleUndo already takes for paths a commit ADDED.
      if (entry.prior) {
        statements.push(
          this.db
            .prepare('INSERT INTO revisions (path, publish_id, body, sha, version, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(entry.path, publishId, entry.prior.body, entry.prior.sha, entry.prior.version, now),
        );
      }
      statements.push(
        this.db
          .prepare(
            'INSERT INTO content (path, body, sha, version, updated_at) VALUES (?, ?, ?, ?, ?) ' +
              'ON CONFLICT(path) DO UPDATE SET body = excluded.body, sha = excluded.sha, ' +
              'version = excluded.version, updated_at = excluded.updated_at WHERE content.sha = ?',
          )
          .bind(entry.path, entry.body, entry.sha, entry.version, now, entry.prior?.sha ?? ''),
      );
      // Pruned on write, per the spec, rather than by a scheduled job: this
      // Worker exports no `scheduled` handler and wrangler.toml declares an
      // explicitly empty cron list (see its own comment on why that empty
      // list is load-bearing), so a sweeper would need infrastructure this
      // project has deliberately removed.
      statements.push(
        this.db
          .prepare(
            'DELETE FROM revisions WHERE path = ? AND id NOT IN ' +
              '(SELECT id FROM revisions WHERE path = ? ORDER BY id DESC LIMIT ?)',
          )
          .bind(entry.path, REVISION_DEPTH),
      );
    }

    await this.db.batch(statements);
    // No commit, so no sha. Returning `null` rather than a made-up value is
    // what forces the caller to decide what a publish with no build means --
    // see worker/index.ts's publish response and Task 10's client.
    return { sha: null };
  }

  // Restores exactly the group one publish wrote. Returns the paths actually
  // put back, so the caller can tell "nothing to undo" from "undone".
  async undo(publishId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT path, body, sha FROM revisions WHERE publish_id = ?')
      .bind(publishId)
      .all<{ path: string; body: string; sha: string }>();
    if (results.length === 0) return [];

    // Restoring is an ordinary write: it goes through the same path so the
    // restore is itself revisioned and itself pruned. `undoPublishId` is a
    // fresh group, which is what keeps "undo" from being special-cased in
    // the revision history.
    const undoPublishId = `undo:${publishId}`;
    await this.write(
      results.map((row) => ({ path: row.path, content: row.body, encoding: 'utf-8' as const })),
      'Put back the previous version',
      undoPublishId,
    );
    return results.map((row) => row.path);
  }
}
```

Note the `baseSha` is deliberately **not** passed on the restore write: an undo is authorised by the caller having proved which publish it is undoing, and re-checking a `baseSha` there would refuse a restore for the very reason the restore exists.

- [ ] **Step 3: Write the tests**

Create `worker/__tests__/d1.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { D1ConflictError, D1Store, REVISION_DEPTH, sha256Hex } from '../d1';
import { asD1, FakeD1 } from './fakeD1';

let fake: FakeD1;
let store: D1Store;

beforeEach(() => {
  fake = new FakeD1();
  store = new D1Store(asD1(fake));
});

function file(path: string, content: string, baseSha?: string) {
  return { path, content, encoding: 'utf-8' as const, baseSha };
}

describe('read and write', () => {
  it('round-trips a document byte for byte', async () => {
    const body = '[{"id":"a","title":"Best Restaurant","awardedBy":"Delhi Times","year":"2025"}]';
    await store.write([file('src/content/awards.json', body)], 'first', 'p1');
    const read = await store.read('src/content/awards.json');
    expect(read?.content).toBe(body);
    // Not a re-serialisation. `sha` is a hash OF the stored text, so the two
    // cannot be allowed to disagree -- a store that reformatted the JSON on
    // the way in would produce a sha that matched nothing the client held.
    expect(read?.sha).toBe(await sha256Hex(body));
  });

  it('answers null for a path that has never been written', async () => {
    expect(await store.read('src/content/awards.json')).toBeNull();
  });

  it('bumps the version on every write, which is what invalidates the cache', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    expect(await store.version('src/content/awards.json')).toBe(1);
    await store.write([file('src/content/awards.json', '[{"id":"a"}]')], 'second', 'p2');
    expect(await store.version('src/content/awards.json')).toBe(2);
  });

  it('refuses non-utf-8 content rather than corrupting it', async () => {
    await expect(
      store.write([{ path: 'src/content/awards.json', content: 'AAAA', encoding: 'base64' }], 'x', 'p1'),
    ).rejects.toThrow(/only utf-8/);
  });
});

describe('optimistic concurrency', () => {
  it('accepts a write whose baseSha is current', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const current = await store.read('src/content/awards.json');
    await expect(
      store.write([file('src/content/awards.json', '[{"id":"a"}]', current!.sha)], 'second', 'p2'),
    ).resolves.toEqual({ sha: null });
  });

  it('refuses a write whose baseSha is stale', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const stale = (await store.read('src/content/awards.json'))!.sha;
    await store.write([file('src/content/awards.json', '[{"id":"a"}]')], 'second', 'p2');
    await expect(
      store.write([file('src/content/awards.json', '[{"id":"b"}]', stale)], 'third', 'p3'),
    ).rejects.toBeInstanceOf(D1ConflictError);
  });

  it('refuses a baseSha for a document that does not exist', async () => {
    await expect(
      store.write([file('src/content/awards.json', '[]', 'whatever')], 'x', 'p1'),
    ).rejects.toBeInstanceOf(D1ConflictError);
  });

  // The assertion the whole design turns on. A conditional UPDATE matching
  // zero rows is NOT an error in D1, so a guard that ran after the mutation
  // would already have written the revision row and the sibling files by the
  // time it noticed. Checking that NOTHING was written is what distinguishes
  // "guarded before" from "detected after".
  it('writes nothing at all when any file in the request conflicts', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const stale = 'not-the-current-sha';
    const before = fake.revisions.length;
    await expect(
      store.write(
        [
          file('src/content/awards.json', '[{"id":"a"}]', stale),
          file('src/content/other.json', '{}'),
        ],
        'mixed',
        'p2',
      ),
    ).rejects.toBeInstanceOf(D1ConflictError);
    expect(fake.revisions.length, 'a revision row was written before the conflict was noticed').toBe(before);
    expect(fake.content.has('src/content/other.json'), 'a sibling file was written anyway').toBe(false);
    expect((await store.read('src/content/awards.json'))!.content).toBe('[]');
  });
});

describe('revisions', () => {
  it('records the PRIOR value on every write, not the new one', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    const rows = fake.revisions.filter((r) => r.publish_id === 'p2');
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('v1');
  });

  it('records nothing for the first write of a new path -- there is no prior', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    expect(fake.revisions).toHaveLength(0);
  });

  it(`keeps at most ${REVISION_DEPTH} per path, pruned on write`, async () => {
    for (let i = 0; i <= REVISION_DEPTH + 5; i += 1) {
      await store.write([file('src/content/awards.json', `v${i}`)], 'x', `p${i}`);
    }
    const mine = fake.revisions.filter((r) => r.path === 'src/content/awards.json');
    expect(mine.length).toBe(REVISION_DEPTH);
    // The NEWEST are what survive. A prune that kept the oldest would pass a
    // bare length assertion and make undo restore ancient content.
    expect(mine.map((r) => r.body)).toContain(`v${REVISION_DEPTH + 4}`);
    expect(mine.map((r) => r.body)).not.toContain('v0');
  });

  it('prunes per path, so a busy file cannot evict a quiet one', async () => {
    await store.write([file('src/content/quiet.json', 'q1')], 'x', 'q');
    await store.write([file('src/content/quiet.json', 'q2')], 'x', 'q2');
    for (let i = 0; i <= REVISION_DEPTH + 5; i += 1) {
      await store.write([file('src/content/busy.json', `b${i}`)], 'x', `b${i}`);
    }
    expect(fake.revisions.filter((r) => r.path === 'src/content/quiet.json')).toHaveLength(1);
  });
});

describe('undo', () => {
  it('puts back exactly the group one publish wrote', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    expect(await store.undo('p2')).toEqual(['src/content/awards.json']);
    expect((await store.read('src/content/awards.json'))!.content).toBe('v1');
  });

  it('reports nothing restored for a publish id with no revisions', async () => {
    expect(await store.undo('never-happened')).toEqual([]);
  });

  it('is itself revisioned, so the state before the undo is not lost', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    await store.undo('p2');
    expect(fake.revisions.some((r) => r.publish_id === 'undo:p2' && r.body === 'v2')).toBe(true);
  });
});
```

- [ ] **Step 4: Run and prove the concurrency guard can fail**

Run: `npx vitest run worker/__tests__/d1.test.ts`
Expected: PASS.

**The mutation proof for the guard is not optional.** In `worker/d1.ts`, move the guard from before the mutation to after it: delete the two `throw new D1ConflictError(...)` lines from the preparation loop, and instead check the batch result afterwards with `if (results.some((r) => r.meta.changes === 0)) throw new D1ConflictError('conflict')`. Re-run.

Expected: the "refuses a write whose baseSha is stale" case may still pass — which is exactly the point — but **"writes nothing at all when any file in the request conflicts" FAILS**, reporting that a revision row was written before the conflict was noticed. That failure is the whole reason the guard is where it is. Revert the mutation and confirm green.

Second mutation: change `LIMIT ?` binding from `REVISION_DEPTH` to `REVISION_DEPTH + 10` and re-run. Expected: FAIL on the depth case. Revert.

- [ ] **Step 5: Commit**

```bash
git add worker/d1.ts worker/__tests__/fakeD1.ts worker/__tests__/d1.test.ts
git commit -m "feat(worker): add the D1 content store with revisions and undo

D1 gives a handler no transaction and a conditional UPDATE that matches
nothing is not an error there, so optimistic concurrency compares every
baseSha BEFORE any statement is issued rather than reading meta.changes
afterwards. The test that proves the difference asserts nothing was written
at all on a conflict; a guard placed after the mutation passes the obvious
test and fails that one."
```

---

### Task 5: Route the existing content routes through the store

`GET /api/content` and `POST /api/publish` stop calling `worker/github.ts` directly. Behaviour for every file that exists today is unchanged, and there is a test that says so.

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `storeFor`, `partitionByStore` from `worker/store.ts`; `D1ConflictError` from `worker/d1.ts`.
- Produces: the publish response shape Task 10's client consumes:

```ts
// 200 from POST /api/publish
{ sha: string | null; publishId: string; d1Paths: string[] }
```

- [ ] **Step 1: `GET /api/content` reads through the store**

In `handleGetContent`, replace the direct `getFileContent(env, path)` call:

```ts
  try {
    // Through storeFor rather than straight to GitHub, so the dashboard's
    // one read route serves a D1-backed file with no client change at all --
    // the `sha` it returns is whatever that store's opaque token is (a blob
    // sha, or a SHA-256 of the body) and the dashboard round-trips it
    // without inspecting it. `isContentPath` above still bounds this to
    // src/content/<name>.json regardless of which store answers.
    const file = await storeFor(env, path).read(path);
    if (!file) {
      return json(404, { message: 'That file does not exist yet.' });
    }
    return json(200, { content: file.content, sha: file.sha });
  } catch (error) {
    return json(502, { message: error instanceof Error ? error.message : 'Could not read that file.' });
  }
```

- [ ] **Step 2: `handlePublish`'s step 3 reads through the store**

Change the one call inside the `baseSha` loop from `getFileContent(env, f.path)` to `storeFor(env, f.path).read(f.path)`. Nothing else in that block changes: the `isContentPath` check, the collected-conflicts behaviour and the 409 all stay exactly as they are. Add above the loop:

```ts
  // Step 3's read now goes through storeFor, so a D1-backed file gets the
  // same stale-edit refusal a GitHub-backed one does, from the same code.
  // The D1 store ALSO re-checks baseSha inside its own write, before any
  // mutation -- that is not redundant, it is the difference between checking
  // and enforcing: this loop's read and the eventual write are separated by
  // several awaits.
```

- [ ] **Step 3: Partition the write, D1 first**

Replace `handlePublish`'s step 6:

```ts
  // 6. Write. Partitioned by store, D1 FIRST, and the ordering is a real
  // decision rather than an accident of how the code was typed.
  //
  // If the D1 leg succeeds and the GitHub leg then fails, every baseSha in
  // the request is still current -- the GitHub blobs did not move -- so she
  // presses Publish again and it succeeds. Reversed, a successful commit
  // moves every blob sha in the request, the retry gets a 409 that means
  // "someone else changed this" when the someone else was her own successful
  // half-publish, and the only way out is a reload that discards her buffer.
  //
  // CROSS-STORE ATOMICITY IS GENUINELY LOST HERE, one file wide, for the
  // length of the pilot. A publish touching both awards.json and any GitHub
  // file can leave the first written and the second not. Nothing in this
  // Worker can fix that -- there is no distributed transaction across a
  // SQLite database and a git remote -- so it is stated rather than
  // disguised. It closes when CONTENT_STORE flips to "d1" and the partition
  // becomes one group again.
  const publishId = crypto.randomUUID();
  const { d1, github } = partitionByStore(env, files);

  try {
    if (d1.length) await storeFor(env, d1[0].path).write(d1, message, publishId);
  } catch (error) {
    if (error instanceof D1ConflictError) return json(409, { message: error.message });
    return json(502, { message: error instanceof Error ? error.message : 'Publish failed.' });
  }

  let commitSha: string | null = null;
  if (github.length) {
    try {
      const result = await commitFiles(env, github.map(({ path, content, encoding }) => ({ path, content, encoding })), message);
      commitSha = result.sha;
    } catch (error) {
      if (error instanceof DisallowedPathError) return json(400, { message: error.message });
      if (error instanceof PublishConflictError) return json(409, { message: error.message });
      // The D1 leg above has already landed. Said out loud in the message
      // rather than left for her to discover: telling her "publish failed"
      // when half of it did not is the failure mode this sentence exists to
      // prevent.
      return json(502, {
        message: error instanceof Error ? error.message : 'Publish failed.',
        partial: d1.length > 0,
      });
    }
  }

  // `sha` is null when the publish produced no commit -- an awards-only
  // publish. The client must not poll build-status for a build that will
  // never exist (Task 10).
  return json(200, { sha: commitSha, publishId, d1Paths: d1.map((f) => f.path) });
```

Note `commitFiles` is called directly rather than through `GitHubStore` here, because `handlePublish` needs to distinguish `DisallowedPathError` from `PublishConflictError` and the store interface deliberately does not model either. That is a knowing asymmetry: `GitHubStore.write` exists for the `CONTENT_STORE="d1"`-era symmetry and is exercised by Task 3's tests; this route keeps its own error mapping until the switch flips. Record it in the self-review.

- [ ] **Step 4: Add the "GitHub path is untouched" test**

In `worker/__tests__/index.test.ts`, alongside the existing publish tests (which use `githubStub.ts` and must keep passing unchanged — that is the actual regression signal for this task):

```ts
  // The claim this whole phase rests on, as an assertion. A publish of
  // existing files makes exactly the GitHub calls it made before Phase 2 and
  // touches D1 not at all.
  it('publishes an existing content file through GitHub only, with no D1 traffic', async () => {
    const fake = new FakeD1();
    const response = await worker.fetch(
      publishRequest([{ path: 'src/content/dishes.json', content: '[]', encoding: 'utf-8' }]),
      { ...env, DB: asD1(fake) },
    );
    expect(response.status).toBe(200);
    expect(fake.statements, 'a GitHub-backed publish issued a D1 statement').toEqual([]);
    expect(await response.json()).toMatchObject({ sha: expect.any(String), d1Paths: [] });
  });

  it('publishes the pilot file through D1 only, with no commit and no build', async () => {
    const fake = new FakeD1();
    const response = await worker.fetch(
      publishRequest([{ path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' }]),
      { ...env, DB: asD1(fake) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sha: string | null; publishId: string; d1Paths: string[] };
    expect(body.sha, 'a D1-only publish invented a commit sha').toBeNull();
    expect(body.d1Paths).toEqual(['src/content/awards.json']);
    expect(fake.content.get('src/content/awards.json')?.body).toBe('[]');
  });
```

`publishRequest` here is whatever helper the existing suite already uses to build an authenticated publish; reuse it rather than writing a second one, and use the file's existing GitHub stub for the first case.

- [ ] **Step 5: Run and prove both can fail**

Run: `npx vitest run worker/__tests__/`
Expected: PASS, including every pre-existing publish and undo test unchanged.

Mutation one: set `CONTENT_STORE: 'd1'` in the test env for the first case and re-run. Expected: FAIL — `dishes.json` now issues D1 statements. Revert.

Mutation two: change the publish response to `sha: commitSha ?? 'none'` and re-run. Expected: FAIL on "invented a commit sha". Revert.

- [ ] **Step 6: Commit**

```bash
git add worker/index.ts worker/__tests__/index.test.ts
git commit -m "feat(worker): publish through the store, D1 before GitHub

D1 first because a GitHub failure afterwards leaves every baseSha current
and a retry works; reversed, the commit moves every blob sha and the retry
gets a 409 for a conflict that never happened. Cross-store atomicity is
genuinely lost for the length of the pilot -- one file wide -- and the code
says so rather than implying otherwise."
```

---

### Task 6: Undo across both stores

**Files:**
- Modify: `worker/index.ts` (`handleUndo`)
- Modify: `worker/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `D1Store.undo(publishId)` from Task 4.
- Produces: `POST /api/undo` accepts `{ sha?: string; publishId?: string }` and answers `{ sha: string | null; restored: string[] }`.

- [ ] **Step 1: Widen the request parse**

In `handleUndo`'s step 2, replace the "sha is required" parse:

```ts
  // Two identifiers now, because a publish can move two stores. `sha` names
  // the commit (GitHub's half); `publishId` names the revision group (D1's).
  // At least one is required. Both come from the client's own UndoRecord --
  // held client-side, never derived from whatever happens to be at the
  // branch head, for the reason this route's header comment already gives:
  // content in this repository has historically arrived by hand commit, and
  // a head-inspecting undo would offer to revert a developer's edit and
  // describe it to her as "the change you published".
  let sha: string | null;
  let publishId: string | null;
  try {
    const body: unknown = await request.json();
    const rawSha = (body as { sha?: unknown } | null)?.sha;
    const rawPublishId = (body as { publishId?: unknown } | null)?.publishId;
    sha = typeof rawSha === 'string' && rawSha.length > 0 ? rawSha : null;
    publishId = typeof rawPublishId === 'string' && rawPublishId.length > 0 ? rawPublishId : null;
    if (!sha && !publishId) {
      return json(400, { message: 'No change named to put back.' });
    }
  } catch {
    return json(400, { message: 'Invalid request body.' });
  }
```

- [ ] **Step 2: Run the D1 leg first, then the GitHub leg**

```ts
  // Same ordering as publish, for the same reason: the GitHub leg's own
  // guard is the head-sha check plus a non-fast-forward PATCH, and both stay
  // valid whether or not the D1 restore has already happened. Reversed, a
  // successful revert commit would move the head and make the D1 leg's own
  // failure unrecoverable without a second reload.
  const restored: string[] = [];
  if (publishId) {
    try {
      restored.push(...(await new D1Store(env.DB).undo(publishId)));
    } catch (error) {
      return json(502, { message: error instanceof Error ? error.message : 'Could not put that change back.' });
    }
  }

  if (!sha) {
    // A publish that only touched D1 produced no commit, so there is nothing
    // for the GitHub half to do. `restored` empty here means the revision
    // group was already undone (or never existed) -- 409, the same word this
    // codebase uses everywhere for "the state you were looking at is not the
    // state that is there now".
    if (restored.length === 0) return json(409, { message: 'There is nothing left to put back.' });
    return json(200, { sha: null, restored });
  }
```

Then the existing GitHub body follows unchanged, with its final success line becoming `return json(200, { sha: result.sha, restored });`.

- [ ] **Step 3: Tests**

```ts
  it('puts back a D1-only publish with no commit involved', async () => {
    const fake = new FakeD1();
    const d1env = { ...env, DB: asD1(fake) };
    await worker.fetch(publishRequest([{ path: 'src/content/awards.json', content: '[{"id":"a"}]', encoding: 'utf-8' }]), d1env);
    const second = await worker.fetch(publishRequest([{ path: 'src/content/awards.json', content: '[{"id":"b"}]', encoding: 'utf-8' }]), d1env);
    const { publishId } = (await second.json()) as { publishId: string };

    const undone = await worker.fetch(undoRequest({ publishId }), d1env);
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ sha: null, restored: ['src/content/awards.json'] });
    expect(fake.content.get('src/content/awards.json')?.body).toBe('[{"id":"a"}]');
  });

  it('refuses a second undo of the same publish rather than reverting twice', async () => {
    // ... same setup, then:
    await worker.fetch(undoRequest({ publishId }), d1env);
    const again = await worker.fetch(undoRequest({ publishId }), d1env);
    expect(again.status).toBe(409);
  });

  it('still refuses an undo whose commit sha is no longer the head', async () => {
    // The pre-existing GitHub behaviour, re-asserted here because this task
    // rewrote the function around it.
  });
```

- [ ] **Step 4: Run and prove they can fail**

Run: `npx vitest run worker/__tests__/index.test.ts`
Expected: PASS, with every pre-existing undo test still green.

Mutation: make `D1Store.undo` return the paths without performing the restore write (`return results.map((r) => r.path)` immediately after the `all()`). Re-run. Expected: FAIL on the body assertion in the first case — it reports a restore that did not happen. Revert.

Second mutation: delete the `restored.length === 0` guard and re-run. Expected: FAIL on the double-undo case. Revert.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts worker/__tests__/index.test.ts
git commit -m "feat(worker): undo a D1 publish by its revision group

A publish can now move two stores, so undo takes two identifiers: the
commit sha for the git half and the publish id for the revision group. Both
still come from the client's own record rather than from the branch head,
so an undo can never offer to revert a hand commit and call it hers."
```

---

### Task 7: The public read path

A cached, versioned, unauthenticated JSON read, with a header that says where the bytes came from.

**Files:**
- Create: `worker/published.ts`
- Modify: `worker/index.ts` (route + the `Cache-Control` exemption)
- Create: `worker/__tests__/published.test.ts`
- Modify: `worker/__tests__/hardening.test.ts`

**Interfaces:**
- Consumes: `D1Store` (`read`, `version`).
- Produces:

```ts
export const CONTENT_SOURCE_HEADER = 'x-content-source';
export type ContentSource = 'd1' | 'cache' | 'snapshot';
export const PUBLIC_FILES: ReadonlyMap<string, string>;   // "awards.json" -> "src/content/awards.json"
export function publicCacheKey(request: Request, file: string, version: number): Request;
export async function handlePublished(request: Request, env: PublishedEnv, cache: Cache): Promise<Response>;
export interface PublishedEnv { DB: D1Database }
```

- [ ] **Step 1: Write the module**

```ts
// GET /api/published?path=awards.json -- the public read path.
//
// JSON, not server-rendered HTML, and that is a decision. wrangler.toml
// routes only vb.aionxxxi.uk/api/* to this Worker and the site itself is a
// Pages-hosted SPA, so SSR would need a second route pattern AND a React
// renderer inside this Worker -- which worker/__tests__/bundle.test.ts fails
// the build over, on purpose. Everything that makes this a SEAM rather than
// an endpoint -- the content version, the cache key, invalidation with no
// explicit purge, the snapshot fallback, the source header -- is built here
// and is independent of the body's format. The spec's SSR requirement
// attaches to per-post SEO, which is Phase 5's.
import { D1Store } from './d1';
import { snapshotFor } from './snapshot';

export const CONTENT_SOURCE_HEADER = 'x-content-source';
export type ContentSource = 'd1' | 'cache' | 'snapshot';

// The public API names a file, never a repository path: `?path=awards.json`,
// not `?path=src/content/awards.json`. Two reasons -- the public surface
// should not leak the repo layout, and this map is a positive allowlist, so
// a D1 document added later is private until someone puts it here.
export const PUBLIC_FILES: ReadonlyMap<string, string> = new Map([
  ['awards.json', 'src/content/awards.json'],
]);

export interface PublishedEnv {
  DB: D1Database;
}

// The cache key is a URL, so the version has to be IN the URL. That is the
// whole invalidation mechanism: a publish bumps `version`, the next request
// computes a different key, and the old entry is simply never asked for
// again. No purge call, no API token, nothing to fail silently.
//
// Deliberately built on the request's own origin rather than a hardcoded
// host, the same self-configuring posture siteOriginOf takes in index.ts:
// buying the real domain must not quietly split the cache.
export function publicCacheKey(request: Request, file: string, version: number): Request {
  const url = new URL(request.url);
  url.pathname = '/__cache/published';
  url.search = `?file=${encodeURIComponent(file)}&v=${version}`;
  return new Request(url.toString(), { method: 'GET' });
}

function body(text: string, source: ContentSource, sha: string | null): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [CONTENT_SOURCE_HEADER]: source,
    // 60 seconds, not longer, and not `no-store`. The cache KEY carries the
    // version, so the edge is invalidated the instant a publish lands -- but
    // the URL the BROWSER holds does not, so a browser copy can only expire
    // on time. A minute is the honest trade: it is shorter than the 2-3
    // minutes a Pages build used to take for the same edit, which is the bar
    // this path has to clear to be an improvement.
    'Cache-Control': 'public, max-age=60',
  };
  if (sha) headers.ETag = `"${sha}"`;
  return new Response(text, { status: 200, headers });
}

export async function handlePublished(request: Request, env: PublishedEnv, cache: Cache): Promise<Response> {
  const file = new URL(request.url).searchParams.get('path') ?? '';
  const path = PUBLIC_FILES.get(file);
  if (!path) {
    return new Response(JSON.stringify({ message: 'Not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const store = new D1Store(env.DB);

  // One row read to get the version, then a cache lookup on path + version.
  //
  // Worth being exact about what that buys TODAY, because at this size it is
  // not much: the generic `content` table holds one row per document, so
  // reading the version and reading the body cost the same one row, and the
  // cache saves a round trip and a little CPU rather than a meaningful
  // number of D1 reads. It is built now, on a case whose correctness is
  // checkable by hand, because Phase 5's blog reads N block rows per post
  // and the mechanism has to already exist and already be trusted by then.
  // At 5,000,000 row reads/day on the free tier, one row per request is not
  // a constraint at this site's traffic.
  let version: number | null = null;
  try {
    version = await store.version(path);
  } catch {
    // Fall through to the snapshot -- a version read that failed is a
    // database problem, and a database problem must cost freshness, never
    // availability.
    version = null;
  }

  if (version === null) {
    const fallback = snapshotFor(file);
    if (fallback === null) {
      return new Response(JSON.stringify({ message: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', [CONTENT_SOURCE_HEADER]: 'snapshot' },
      });
    }
    return body(fallback, 'snapshot', null);
  }

  const key = publicCacheKey(request, file, version);
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set(CONTENT_SOURCE_HEADER, 'cache');
    return new Response(hit.body, { status: hit.status, headers });
  }

  let stored;
  try {
    stored = await store.read(path);
  } catch {
    const fallback = snapshotFor(file);
    if (fallback === null) {
      return new Response(JSON.stringify({ message: 'Temporarily unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', [CONTENT_SOURCE_HEADER]: 'snapshot' },
      });
    }
    return body(fallback, 'snapshot', null);
  }

  if (!stored) {
    const fallback = snapshotFor(file);
    return fallback === null
      ? new Response(JSON.stringify({ message: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      : body(fallback, 'snapshot', null);
  }

  const response = body(stored.content, 'd1', stored.sha);
  // Stored BEFORE the router's security headers run. withSecurityHeaders
  // rewrites Cache-Control to no-store on everything this Worker returns,
  // and a no-store response is not something the Cache API will keep -- so
  // caching has to happen here, on the response this handler built, not on
  // the one the router eventually hands back.
  await cache.put(key, response.clone());
  return response;
}
```

- [ ] **Step 2: Wire the route and the header exemption**

In `worker/index.ts`:

```ts
// The one route in this Worker whose response is meant to be cached. Every
// other response here says no-store for a good reason -- the reads exist
// precisely because their answers change -- but this one is the public read
// path, invalidated by a versioned cache key rather than by freshness, and
// forcing no-store on it would defeat the entire mechanism AND make the
// Cache API refuse to store it at all.
//
// Named as a set rather than an `if` inside withSecurityHeaders so the
// exemption is a list somebody has to edit, the same posture
// AUTHENTICATED_UNLIMITED takes: a second cacheable route added later is a
// visible decision, not a condition that quietly grew an `||`.
export const CACHEABLE_PATHS = new Set(['/api/published']);

function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === 'Cache-Control' && CACHEABLE_PATHS.has(pathname)) continue;
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await route(request, env), new URL(request.url).pathname);
  },
};
```

and in `route`, before the authenticated routes:

```ts
  // Unauthenticated by design -- this is what the public homepage reads.
  // Deliberately not rate-limited: it makes one D1 row read, spends no KV
  // write, and the limiter's own bookkeeping IS a KV write against a
  // 1,000/day namespace-wide cap (see RATE_POLICIES' own reasoning). The
  // volumetric backstop is the WAF rule in docs/cloudflare-cutover.md, the
  // same one GET /api/wa relies on.
  if (url.pathname === '/api/published' && request.method === 'GET') {
    return handlePublished(request, env, contentCache());
  }
```

with, near the top of the file:

```ts
// `caches.default` exists in workerd and does not exist in this repo's jsdom
// test environment (see vitest.config.ts's own list of what is and is not
// real here). Resolved once, here, so handlePublished takes a Cache as a
// parameter and its tests can hand it a fake instead of monkey-patching a
// global that only sometimes exists.
function contentCache(): Cache {
  const global = globalThis as { caches?: { default?: Cache } };
  return (
    global.caches?.default ?? {
      match: async () => undefined,
      put: async () => undefined,
      delete: async () => false,
    } as unknown as Cache
  );
}
```

- [ ] **Step 3: Tests**

Create `worker/__tests__/published.test.ts` with a `FakeCache` (a `Map` keyed on `key.url`) and the `FakeD1` from Task 4:

```ts
describe('GET /api/published', () => {
  it('serves from D1 on a miss and labels the source', async () => { /* x-content-source: d1 */ });

  it('serves from the cache on the second identical request', async () => {
    // x-content-source: cache, and fake.statements records only the version
    // reads -- the body was never re-read from D1.
  });

  // The spec asks for this one by name: "publishes, then reads, and asserts
  // the new value, not the cached one."
  it('serves the new value after a publish, with no purge call anywhere', async () => {
    // read -> cached. write through D1Store (version 1 -> 2). read again.
    // Expect the NEW body and x-content-source: d1, because the key changed.
    // Assert no cache.delete was ever called.
  });

  // Also asked for by name: "forces a query failure and asserts the snapshot
  // fallback serves."
  it('falls back to the compiled snapshot when D1 throws', async () => {
    fake.failWith = 'D1_ERROR: no such table: content';
    // Expect 200, the snapshot body, x-content-source: snapshot.
  });

  it('404s an unknown or non-public path rather than reading anything', async () => {
    // ?path=dishes.json and ?path=../../etc/passwd both 404, and
    // fake.statements is empty -- the allowlist is checked before any read.
  });
});
```

In `worker/__tests__/hardening.test.ts`, add to the security-headers describe:

```ts
  // The one exemption to the blanket no-store, pinned in BOTH directions:
  // the public read path is cacheable, and nothing else became cacheable
  // with it.
  it('leaves the public read path cacheable and everything else no-store', async () => {
    const cacheable = await worker.fetch(new Request(`${SITE_ORIGIN}/api/published?path=awards.json`), env);
    expect(cacheable.headers.get('Cache-Control')).not.toBe('no-store');
    expect(cacheable.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...CACHEABLE_PATHS]).toEqual(['/api/published']);
  });
```

- [ ] **Step 4: Run and prove they can fail**

Run: `npx vitest run worker/__tests__/published.test.ts worker/__tests__/hardening.test.ts`
Expected: PASS.

Mutation one: drop `&v=${version}` from `publicCacheKey` and re-run. Expected: FAIL on "serves the new value after a publish" — it serves the stale cached body. That failure is the entire justification for the versioned key. Revert.

Mutation two: make `snapshotFor` return `null` unconditionally and re-run. Expected: FAIL on the fallback case with a 503 instead of a 200. Revert.

Mutation three: add `'/api/health'` to `CACHEABLE_PATHS` and re-run. Expected: FAIL on the existing `/api/health` no-store case. Revert.

- [ ] **Step 5: Commit**

```bash
git add worker/published.ts worker/index.ts worker/__tests__/published.test.ts worker/__tests__/hardening.test.ts
git commit -m "feat(worker): serve public content from a version-keyed edge cache

The version is in the cache key, so a publish invalidates by making the old
key unreachable rather than by calling a purge API that can fail silently.
x-content-source says d1, cache or snapshot on every response, which is the
only way to tell a working fallback from a working database from outside."
```

---

### Task 8: The last-known-good snapshot

A database outage must degrade freshness, never availability. This is the piece that makes moving content off static acceptable.

**Files:**
- Create: `worker/snapshot.ts` (generated, committed)
- Create: `scripts/build-snapshot.mjs`
- Create: `worker/__tests__/snapshot.test.ts`
- Create: `src/test/awards-seed.json`

**Interfaces:**
- Consumes: `validateContent` from `src/content/validate.ts` (in the test only).
- Produces: `snapshotFor(file: string): string | null` and `SNAPSHOT_BUILT_AT: string`, consumed by Task 7.

- [ ] **Step 1: Write the seed**

Create `src/test/awards-seed.json` — the initial Awards content, three real entries or placeholders the owner will replace. It is a test-directory file on purpose: nothing in `src/content/` may be an awards file, because the whole point is that awards has never lived on GitHub. This one is the seed a human loads into D1 in Task 12 and the bootstrap the first snapshot is generated from.

- [ ] **Step 2: Write the generator**

Create `scripts/build-snapshot.mjs`:

```js
// Regenerates worker/snapshot.ts from the LIVE D1 database, so the fallback
// the Worker compiles in is the content that was actually serving, not a
// hand-maintained copy that drifts.
//
// Run by a human before a deploy that matters:
//   node scripts/build-snapshot.mjs
//
// Not a build step, deliberately. Making it one would put a `wrangler d1
// execute` (an authenticated network call) on Cloudflare Pages' own build
// path, where a transient failure would fail a deploy of unrelated code --
// and Pages builds in this project are already intermittently flaky enough
// that three consecutive builds failed on unchanged, working source.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'via-bianca-content';
const raw = execFileSync('npx', [
  'wrangler', 'd1', 'execute', DB, '--remote', '--json',
  '--command', 'SELECT path, body FROM content',
], { encoding: 'utf8' });

const rows = JSON.parse(raw)[0]?.results ?? [];
if (rows.length === 0) throw new Error('refusing to write an empty snapshot -- is the database seeded?');

const entries = Object.fromEntries(
  rows.map((row) => [row.path.replace(/^src\/content\//, ''), row.body]),
);

writeFileSync(
  'worker/snapshot.ts',
  `// GENERATED by scripts/build-snapshot.mjs. Do not edit by hand.\n` +
    `//\n` +
    `// The last-known-good content, compiled into the Worker bundle. If a D1\n` +
    `// query fails or times out, worker/published.ts serves this instead. A\n` +
    `// database outage costs freshness; it never costs availability.\n` +
    `export const SNAPSHOT_BUILT_AT = ${JSON.stringify(new Date().toISOString())};\n\n` +
    `const SNAPSHOT: Record<string, string> = ${JSON.stringify(entries, null, 2)};\n\n` +
    `export function snapshotFor(file: string): string | null {\n` +
    `  return Object.prototype.hasOwnProperty.call(SNAPSHOT, file) ? SNAPSHOT[file] : null;\n` +
    `}\n`,
);
console.log(`snapshot: ${Object.keys(entries).length} document(s)`);
```

`hasOwnProperty.call`, not `in` — the same reason `unknownKeys` in `src/content/guards.ts` gives: a plain object literal answers `true` for `'toString' in SNAPSHOT`, and a request for `?path=toString` would otherwise return a function's source as content.

- [ ] **Step 3: Generate the first snapshot by hand**

Until D1 is seeded (Task 12), write `worker/snapshot.ts` directly with the seed content, in the exact shape the generator produces, and note in its header that Task 12 regenerates it from the real database.

- [ ] **Step 4: Test it**

```ts
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_BUILT_AT, snapshotFor } from '../snapshot';
import { validateContent } from '../../src/content/validate';

describe('the compiled snapshot', () => {
  it('holds the pilot document', () => {
    expect(snapshotFor('awards.json')).not.toBeNull();
  });

  // A corrupt snapshot is worse than none: it would serve broken content at
  // exactly the moment nobody can look at the database to find out why.
  it('parses, and passes the same validator the write path runs', () => {
    const parsed = JSON.parse(snapshotFor('awards.json')!);
    expect(validateContent('awards.json', parsed)).toEqual([]);
  });

  it('does not answer for inherited object properties', () => {
    expect(snapshotFor('toString')).toBeNull();
    expect(snapshotFor('constructor')).toBeNull();
  });

  it('records when it was built', () => {
    expect(new Date(SNAPSHOT_BUILT_AT).getTime()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Prove the bundle stays clean**

Run: `npx vitest run worker/__tests__/bundle.test.ts worker/__tests__/snapshot.test.ts`
Expected: both PASS. The bundle test refuses any `\breact\b` (case-insensitive) or `createContext` in the esbuilt Worker; the snapshot is inert data and must not introduce either. If a future award citation contains the standalone word "react", that test goes red and the fix is the content, not the test.

Mutation: change `snapshotFor` to `return SNAPSHOT[file] ?? null` (an `in`-equivalent lookup via prototype is what the `hasOwnProperty` guard prevents; this weaker version still passes the first two cases) — then change it to `return (SNAPSHOT as Record<string, unknown>)[file] as string ?? null` and add `file in SNAPSHOT` short-circuiting. Re-run. Expected: FAIL on the inherited-properties case. Revert.

Second mutation: corrupt one character of the JSON string in `worker/snapshot.ts` and re-run. Expected: FAIL on the parse case. Revert.

- [ ] **Step 6: Commit**

```bash
git add worker/snapshot.ts scripts/build-snapshot.mjs worker/__tests__/snapshot.test.ts src/test/awards-seed.json
git commit -m "feat(worker): compile a last-known-good snapshot into the bundle

Generated from the live database rather than hand-maintained, so the
fallback is what was actually serving. Deliberately not a build step: a
wrangler call on the Pages build path would fail deploys of unrelated code,
and this project's Pages builds are already flaky enough without it."
```

---

### Task 9: Awards — type, validator, section

The pilot content itself. New, owner-editable, and visible, which is what makes a failure obvious rather than silent.

**Files:**
- Modify: `src/content/types.ts`, `src/content/guards.ts`, `src/content/validate.ts`
- Modify: `src/content/sections.json`, `src/content/copy.json`
- Modify: `src/App.tsx`, `src/admin/EditMode.tsx`, `src/admin/SectionList.tsx`
- Modify: `src/content/__tests__/sections.test.tsx`, `src/test/homepage-bytes.test.tsx`
- Create: `src/components/Awards.tsx`, `src/components/__tests__/Awards.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface Award { id: string; title: string; awardedBy: string; year: string; image?: string; }
export type SectionId = 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'press' | 'awards' | 'visit';
export const AWARD_KEYS: Record<keyof Award, true>;
export function validateAwards(data: unknown): ValidationProblem[];   // RULES['awards.json']
export const AWARDS_ENDPOINT = '/api/published?path=awards.json';
export async function fetchAwards(fetchImpl?: typeof fetch): Promise<Award[]>;
```

- [ ] **Step 1: Add the type and widen `SectionId`**

In `src/content/types.ts`:

```ts
// Phase 2's pilot, pulled forward from Phase 4. Built on D1 from the start
// rather than as a JSON file that would need migrating two months later --
// the spec's own words. `image` is the optional badge; everything else is
// required, because an award with no year or no awarding body is not an
// award, it is a claim.
export interface Award {
  id: string;
  title: string;
  awardedBy: string;
  year: string;
  image?: string;
}

export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'press' | 'awards' | 'visit';
```

The union grows for the first time since it was written, and the file's own comment says it "stays closed at seven, on purpose" — update that comment to say eight and that nothing SHE does can add a ninth. The closure guarantee is unchanged; only the number moves.

Add to `Copy`:

```ts
  awards: { heading: string; intro: string };
```

The Awards *entries* live in D1. The section's heading and intro stay in `copy.json` on GitHub, deliberately: it keeps the section's chrome renderable at first paint with no network, which is what lets `sections.test.tsx`'s marker assertion and `homepage-bytes.test.tsx` stay deterministic, and it means a D1 outage costs the list, never the section.

- [ ] **Step 2: The compile-error sweep**

`npx tsc -b --noEmit` now fails in exactly the places the `Record<SectionId, …>` idiom is designed to fail. Fix each:

| File | Literal | Add |
|---|---|---|
| `src/content/guards.ts:201` | `SECTION_ID_SET` | `awards: true,` |
| `src/App.tsx:44` | `SECTION_COMPONENTS` | `awards: () => <Awards />,` |
| `src/admin/EditMode.tsx:88` | `SECTION_COMPONENTS` | `awards: () => <Awards />,` |
| `src/admin/EditMode.tsx:98` | `SECTION_LABELS` | `awards: 'Awards',` |
| `src/admin/SectionList.tsx:65` | `SECTION_NAMES` | `awards: { name: 'Awards', anchor: '#awards' },` |
| `src/content/__tests__/sections.test.tsx:24` | `MARKER` | `awards: copy.awards.heading,` |
| `src/content/__tests__/sections.test.tsx:65` | `SECTION_SELECTOR` | `awards: '#awards',` |

`EditMode`'s entry renders the same read-only `<Awards />`. Inline editing of D1-backed content on `/edit` is deliberately out of scope for this phase — the Manage panel in Task 11 is where Awards is edited — and that is recorded in the self-review, not left to be discovered.

Then add the section to `src/content/sections.json`, between `press` and `ourStory`, matching the spec's stated final order (… blog, awards, about, visit):

```json
  { "kind": "bespoke", "id": "awards", "enabled": true },
```

`assertSections` requires every `SectionId` to appear exactly once among the bespoke entries, so omitting this is a hard build failure rather than a missing section — which is the guarantee working.

And to `src/content/copy.json`:

```json
  "awards": { "heading": "Awards", "intro": "Recognition the kitchen has picked up along the way." }
```

- [ ] **Step 3: The validator**

In `src/content/guards.ts`, next to the other key sets:

```ts
export const AWARD_KEYS: Record<keyof Award, true> = {
  id: true,
  title: true,
  awardedBy: true,
  year: true,
  image: true,
};
```

In `src/content/validate.ts`, add `validateAwards` following the shape of `validatePress` (which validates the closest analogue — a list of id-carrying records with a date and an optional image), and register it:

```ts
  'awards.json': validateAwards,
```

`RULES` is default-deny — a file with no entry is refused, not waved through — so without this line every awards publish answers 422 with "This file cannot be edited here (awards.json)". Registering it is what moves validation from build time to write time for this file: nothing compiles `awards.json` into a bundle, so `validateContent` inside the Worker is the *only* thing standing between a bad write and bad content.

`validateAwards` must check: an array; a unique non-empty `id` per entry; non-empty `title` and `awardedBy`; a `year` matching `/^\d{4}$/`; `image` either absent or a non-empty string; and no unknown keys, via `unknownKeys(item, AWARD_KEYS)`.

- [ ] **Step 4: The component**

Create `src/components/Awards.tsx`. Entries are fetched at runtime; the heading and intro come from the content context. `fetchImpl` is injected with a default, the same posture `requestPublish` and `fetchBuildStatus` already take in `src/admin/publish.ts`:

```tsx
export const AWARDS_ENDPOINT = '/api/published?path=awards.json';

export async function fetchAwards(fetchImpl: typeof fetch = fetch): Promise<Award[]> {
  const response = await fetchImpl(AWARDS_ENDPOINT);
  if (!response.ok) throw new Error(`awards unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  // Shape-checked here rather than cast. This is content from a database
  // with no build-time guard in front of it -- src/content/index.ts's own
  // assert* functions have no equivalent on this path, so the check has to
  // happen where the data arrives or it does not happen at all.
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isAward);
}
```

The component renders `<section id="awards">` with the heading and intro always, and the list only once loaded. A fetch failure renders the chrome and no list — the section degrades to a heading, never to a crash and never to an error message a customer can see.

In jsdom the relative URL fails to parse and the promise rejects; the `catch` handles it, no network call is made, and every existing test that renders the homepage stays offline. Verify that directly rather than assuming: run the full suite and confirm no test slows down or emits a network warning.

- [ ] **Step 5: Test the component**

`src/components/__tests__/Awards.test.tsx`: renders with an injected fetch returning two awards and asserts both titles appear; renders with a rejecting fetch and asserts the heading is present and no error text is; renders with a fetch returning `{}` instead of an array and asserts no crash and an empty list.

- [ ] **Step 6: Run the gate and update the byte count**

Run: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

`src/test/homepage-bytes.test.tsx` fails. The homepage now renders an extra section — the heading, the intro and an empty list container. Update the expected number to whatever the run reports, and **only** that number. In the same commit, state the old number, the new number, and that the difference is the Awards section chrome at first paint with the list unresolved.

`src/admin/__tests__/SectionList.test.tsx` and `src/admin/__tests__/areas.test.tsx` may assert on a count of seven sections. Those are real assertions doing their job; update them to eight and read the diff before you do.

- [ ] **Step 7: Prove the validator and the section can fail**

Mutation one: publish-shaped call in a test — `validateContent('awards.json', [{ id: 'a', title: 'x', awardedBy: 'y', year: 'nineteen' }])` must return a problem naming `year`. Delete the year rule and confirm the test goes red. Revert.

Mutation two: remove the `awards` entry from `sections.json` and run `npm test -- --run`. Expected: `assertSections` throws at import time, naming the missing section, and a large number of tests fail. Restore it. That is the completeness guarantee working, and it is worth seeing once.

- [ ] **Step 8: Commit**

```bash
git add -A src/
git commit -m "feat(awards): add the Awards section, read from the content API

SectionId grows from seven members to eight for the first time since it was
written; the Record<SectionId, …> literals in App, EditMode, SectionList and
the section tests all failed to compile until each was updated, which is the
guarantee working rather than a chore.

The entries come from D1 at runtime; the heading and intro stay in copy.json
so the section renders at first paint with no network and a database outage
costs the list rather than the section.

homepage-bytes: NNNNN -> NNNNN, the Awards heading, intro and empty list
container at first paint."
```

---

### Task 10: A publish that produces no commit

The dashboard assumes every publish creates a commit and starts a Cloudflare build. An awards-only publish does neither — it is live the moment the request returns, which is the phase's most visible win and also the thing that breaks the client if it is not handled.

**Files:**
- Modify: `src/admin/publish.ts`, `src/admin/undo.ts`, `src/admin/PublishBar.tsx`
- Modify: `src/admin/__tests__/publish.test.ts`, `src/admin/__tests__/undo.test.ts`, `src/admin/__tests__/PublishBar.test.tsx`

**Interfaces:**
- Produces:

```ts
export type PublishRequestResult =
  | { status: 'success'; sha: string | null; publishId: string; d1Paths: string[] }
  | { status: 'validation'; problems: ValidationProblem[] }
  | { status: 'conflict' }
  | { status: 'unauthenticated' }
  | { status: 'server-error'; message: string }
  | { status: 'network-error' };

export interface UndoRecord { sha: string | null; publishId: string | null; at: number; paths: string[] }
export function requestUndo(record: Pick<UndoRecord, 'sha' | 'publishId'>, fetchImpl?: typeof fetch): Promise<UndoRequestResult>;
```

- [ ] **Step 1: Widen `requestPublish`'s success**

In `src/admin/publish.ts`, the 200 branch:

```ts
  if (response.status === 200) {
    try {
      const body = (await response.json()) as { sha?: unknown; publishId?: unknown; d1Paths?: unknown };
      // `sha` is null for a publish that touched only D1 -- no commit, no
      // Pages build, live immediately. Accepted as null rather than coerced
      // to a string: a fabricated sha here would be polled against
      // build-status forever and time out after ten minutes on a publish
      // that was actually finished before the response arrived.
      if (typeof body.publishId === 'string' && (body.sha === null || typeof body.sha === 'string')) {
        return {
          status: 'success',
          sha: body.sha ?? null,
          publishId: body.publishId,
          d1Paths: Array.isArray(body.d1Paths) ? (body.d1Paths as string[]) : [],
        };
      }
    } catch {
      // falls through to the generic server-error below
    }
    return { status: 'server-error', message: 'The server did not confirm what was published.' };
  }
```

- [ ] **Step 2: Skip build tracking when there is no build**

In `PublishBar.tsx`, where the success branch currently calls `trackPublish(sha, …)`:

```tsx
        if (result.sha === null) {
          // No commit, so no Cloudflare build to wait for -- the change is
          // already live. Polling build-status here would ask about a
          // deployment that will never exist, sit on `queued` for ten
          // minutes, and end on `stalled`: the failure state, for the fastest
          // publish this dashboard can make.
          setProgress({ phase: 'live' });
        } else {
          void trackPublish(result.sha, deps, setProgress);
        }
```

- [ ] **Step 3: The undo record carries both identifiers**

In `src/admin/undo.ts`, `UndoRecord.sha` becomes `string | null` and gains `publishId: string | null`. `loadUndoRecord`'s validation currently rejects a record whose `sha` is not a non-empty string; relax it to: **at least one** of `sha` and `publishId` must be a non-empty string, and anything else is still rejected. Everything else about this module — the one-hour cap, the never-throw posture, the client-side-only offer — is unchanged and must stay that way.

`requestUndo` sends both:

```ts
    body: JSON.stringify({ sha: record.sha ?? undefined, publishId: record.publishId ?? undefined }),
```

- [ ] **Step 4: Tests**

In `publish.test.ts`: a 200 with `{"sha":null,"publishId":"p1","d1Paths":["src/content/awards.json"]}` yields `status: 'success', sha: null`; a 200 with no `publishId` yields `server-error`.

In `undo.test.ts`: a record with `sha: null, publishId: 'p1'` round-trips through `rememberPublish`/`loadUndoRecord`; a record with both null is rejected; `requestUndo` sends both fields.

In `PublishBar.test.tsx`: a success with `sha: null` never calls `fetchBuildStatus` and lands on `live`. That assertion — that a function was *not* called — is the one that catches the ten-minute stall, and a test asserting only the final state would pass even while polling ran.

- [ ] **Step 5: Run and prove they can fail**

Run: `npx vitest run src/admin/__tests__/`
Expected: PASS.

Mutation: in `PublishBar.tsx`, remove the `result.sha === null` branch so every success polls. Re-run. Expected: FAIL on the "never calls fetchBuildStatus" case. Revert.

Second mutation: in `requestPublish`, change `body.sha ?? null` to `String(body.sha)`. Re-run. Expected: FAIL on the null-sha case, which now reports the string `"null"`. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/admin
git commit -m "feat(admin): handle a publish that creates no commit

An awards publish writes to D1 and returns; there is no commit and no Pages
build, so the dashboard goes straight to live instead of polling
build-status for a deployment that will never exist. The undo record now
carries a publish id alongside the commit sha, since one publish can move
two stores."
```

---

### Task 11: The Awards panel

**Files:**
- Create: `src/admin/areas/AwardsArea.tsx`, `src/admin/areas/__tests__/AwardsArea.test.tsx`
- Modify: `src/admin/content.ts`, `src/admin/manage/areas.ts`, `src/admin/manage/ManageShell.tsx`
- Modify: `src/admin/manage/__tests__/areas.test.tsx`

**Interfaces:**
- Consumes: `AreaProps` from `src/admin/areas/area-props.ts`; `fetchContent`, `registerLoaded`, `useValidation`, `RecordList`.
- Produces: `PanelId` gains `'awards'`; `ContentFileName` gains `'awards.json'`.

- [ ] **Step 1: Register the file**

In `src/admin/content.ts`:
- `CONTENT_FILES` gains `'awards.json'`. Every downstream type is total over this union, so `tsc -b` will name each place that needs an entry — which is the point.
- `CONTENT_FILE_LABELS` gains `'awards.json': 'Awards'`. It is a total `Record<ContentFileName, string>`; omitting it does not compile.
- `ContentTypeMap` gains `'awards.json': Award[]`.

Add a comment at `CONTENT_FILES` recording that this is the first entry in that list which is **not** a file in the repository: `GET /api/content` serves it from D1 through `storeFor`, and the dashboard cannot tell the difference, which is the seam working.

- [ ] **Step 2: The panel**

`AwardsArea.tsx` follows `PagesArea.tsx`'s shape exactly — `SectionErrorBoundary` wrapping `CollapsibleSection` wrapping a section component that loads through `fetchContent`, registers via `registerLoaded`, validates via `useValidation`, and commits via `registry.updateData`. The list itself is `RecordList` with `RecordForm` fields for title, awarding body, year and an optional `PhotoField` badge, mirroring how `press.json` is edited today.

The one difference worth a comment: a brand-new document. `fetchContent('awards.json')` answers 404 until the first write, so the load effect must treat 404 as **an empty list**, not an error. Every other content file has always existed; this one does not until the owner adds her first award.

- [ ] **Step 3: Register the panel**

In `src/admin/manage/areas.ts`: `PanelId` gains `'awards'`, `PANELS` gains `awards: { id: 'awards', heading: 'Awards', file: 'awards.json' }`, and `'awards'` joins the `pages` area's `panelIds` after `'sections'` — Awards is a homepage section, and that area is already "what shows on the homepage". `PANELS` is a total record, so the compiler names this.

In `ManageShell.tsx`, `PagesArea` renders it: add `<AwardsArea {...areaProps} />` to the `pages` case. No new `AreaSlug`, so the `never` exhaustiveness switch is untouched.

`src/admin/manage/__tests__/areas.test.tsx` pins the ten panel ids against what the dashboard renders. It becomes eleven. Update the list and read the diff.

- [ ] **Step 4: Test**

`AwardsArea.test.tsx`: renders with a stubbed `fetchContent` returning two awards and asserts both are editable; renders with a 404 and asserts an empty list with an Add button rather than an error; edits a title and asserts `registry.updateData` was called with the new array.

- [ ] **Step 5: Run, prove, gate**

Run: `npx vitest run src/admin/`
Expected: PASS.

Mutation: make the load effect treat 404 as an error. Re-run. Expected: FAIL on the empty-list case with the error text rendered. Revert.

Run: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

- [ ] **Step 6: Commit**

```bash
git add src/admin
git commit -m "feat(admin): add the Awards panel

The first entry in CONTENT_FILES that is not a file in this repository. The
dashboard loads it, validates it, tracks its sha and publishes it through
exactly the same code path as the other ten, and cannot tell the difference
-- which is the entire point of the store seam."
```

---

### Task 12: Migrate, seed, deploy, verify

**Files:**
- Modify: `worker/snapshot.ts` (regenerated)
- Modify: `docs/cloudflare-cutover.md`

- [ ] **Step 1: Full gate, locally, before anything touches Cloudflare**

```bash
npm run images
npx tsc -b --noEmit
npm test -- --run
npx eslint .
npm run test:csp
```

All clean before proceeding. Then, on its own, with nothing else running:

```bash
npx playwright test
```

Concurrent runs share port 8080 and produce phantom failures — if anything else is running, wait.

- [ ] **Step 2: A human applies the migration**

```bash
npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0001_content.sql
```

Then confirm the tables exist:

```bash
npx wrangler d1 execute via-bianca-content --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected: `content`, `revisions`, `content_meta` (plus SQLite's own `sqlite_sequence`).

- [ ] **Step 3: Deploy the Worker**

```bash
npx wrangler deploy
```

Then confirm the route answers and the fallback works before any content exists:

```bash
curl -si "https://vb.aionxxxi.uk/api/published?path=awards.json" | head -20
```

Expected: 200, `x-content-source: snapshot`, and the seed content — because D1 has the tables but no rows yet, which is exactly the "database has nothing to say" case the fallback exists for. If this returns 404 with `content-type: text/html`, the Pages SPA answered instead of the Worker and the route pattern is wrong.

- [ ] **Step 4: Seed the first content through the dashboard, not by hand**

Open `/edit/manage`, go to the Pages area, open the Awards panel, add the first award, and press Publish.

Through the dashboard on purpose: a `wrangler d1 execute --command "INSERT …"` would put content in the table without ever exercising validation, the sha, the revision row, or the version bump — which is to say, it would prove nothing. This is the first end-to-end write and it is the point of the whole phase.

Expected, watching it: the publish returns immediately, there is no build to wait for, and the homepage shows the award on the next load.

- [ ] **Step 5: Verify the read path by hand**

```bash
curl -si "https://vb.aionxxxi.uk/api/published?path=awards.json" | head -20   # x-content-source: d1
curl -si "https://vb.aionxxxi.uk/api/published?path=awards.json" | head -20   # x-content-source: cache
```

Then edit the award in the dashboard, publish, and immediately curl again. Expected: the new value with `x-content-source: d1`, with no purge called anywhere. If it serves the old value, the version is not reaching the cache key and Task 7's mutation proof was not honest.

- [ ] **Step 6: Verify undo**

Publish a change, then press Undo in the dashboard, then curl again. Expected: the previous value back, `x-content-source: d1`, and a second Undo not offered.

- [ ] **Step 7: Confirm the GitHub path is untouched**

Edit one dish description in the dashboard and publish. Expected: a real commit on `main`, a Pages build, the two-to-three-minute wait, and the live site updated — exactly as before this phase. Then `npm run verify:deploy`. Do not skip the settle window; fetching assets the instant the sha flips is what poisoned the asset cache once before.

- [ ] **Step 8: Regenerate the snapshot from the real database**

```bash
node scripts/build-snapshot.mjs
npx vitest run worker/__tests__/snapshot.test.ts
npx wrangler deploy
```

The snapshot now holds what is actually serving rather than the bootstrap seed.

- [ ] **Step 9: Record the state in the cutover doc**

Add to `docs/cloudflare-cutover.md`: the D1 database name and what is in it; the R2 bucket name and that it is bound and unused, with the three derivative options and the note that the decision is owed before Phase 3; the `CONTENT_STORE` switch, what flipping it does, and that flipping it back is the rollback; and the migration command, since it is the thing a human runs again if the database is ever rebuilt.

- [ ] **Step 10: Close every browser you opened**

```bash
pgrep -fl "Chrome for Testing|chromium" || echo "clean"
```

`browser.close()` has left orphaned renderers behind in this project before. Check, do not assume.

- [ ] **Step 11: Commit**

```bash
git add worker/snapshot.ts docs/cloudflare-cutover.md
git commit -m "chore(deploy): seed D1, regenerate the snapshot, record the runbook

The first content written through the dashboard rather than by hand, so
validation, the sha, the revision row and the version bump were all
exercised on the way in. R2 is recorded as bound and unused, with the
derivative decision named as owed before Phase 3 rather than left implied."
```

---

## Self-Review

**Spec coverage.** Phase 2 of the spec lists six items.

- *D1 schema, migrations in `worker/migrations/`*: Task 2. The spec names tables for `posts`, `blocks`, `experiences`, `awards` and a generic `content` table; this plan creates only `content`, `revisions` and `content_meta`. Deliberate — see the deviations below.
- *R2 bucket*: Task 1 binds it. The spec's claim that the derivative pipeline runs in the Worker is wrong and Task 1 says why in the file that binds the bucket.
- *Read path, cached on path plus content version, invalidated by a publish with no purge*: Task 7.
- *Snapshot fallback*: Task 8, plus the forced-failure test the spec's testing section asks for by name.
- *Write path, validation moved from build time to write time*: Tasks 4, 5 and 9. `validateContent` gains an `awards.json` rule and it is the only validation that file will ever get, because nothing compiles it into a bundle.
- *Undo, a `revisions` table, depth 20 pruned on write*: Tasks 4 and 6, with the depth-and-pruning test the spec asks for by name.
- *"What migrates in Phase 2: nothing that exists today"*: Task 3's routing test, which iterates the real `CONTENT_FILES` list and asserts every one of them routes to GitHub under the default.

**Deliberate deviations, with reasons.**

1. **Only the generic `content` table is created.** The spec lists five tables. `posts` and `blocks` have no consumer until Phase 5 and no settled shape until the block editor is designed; `experiences` belongs to Phase 3; `awards` is deliberately *not* a bespoke table, because a bespoke table would prove a bespoke route rather than the seam. Creating empty tables now would freeze three schemas against requirements nobody has written yet, and `CREATE TABLE IF NOT EXISTS` in a later migration costs nothing.
2. **The read path serves JSON, not server-rendered HTML.** Argued at length in the Global Constraints. Every property that makes the read path a seam is built and tested here; the format of the body is the one thing that is not, and it has no consumer until Phase 5's per-post SEO.
3. **R2 is bound and unused.** The spec's mechanism is impossible in workerd and every alternative Cloudflare offers is billable. Three options are recorded; none is chosen; the decision is owed before Phase 3.
4. **Awards is pulled forward from Phase 4.** The spec's Phase 2 says to prove the D1 path on "one new, low-stakes piece of content" without naming it. Awards is new (nothing regresses if it breaks), genuinely owner-editable (so the write path is exercised for real, not by a fixture), and visible (so a failure is obvious rather than silent) — and it is already specified, so it is not throwaway content invented to be thrown away.
5. **`SectionId` grows from seven members to eight.** Phase 1's plan pinned it closed at seven; that constraint was Phase 1's, and it was about not renaming `ourStory`, which this plan does not touch. The `Record<SectionId, …>` completeness idiom means growing the union is a compile-error-driven sweep with a known, listed set of sites, not a search.
6. **`handlePublish` calls `commitFiles` directly rather than through `GitHubStore.write`.** It needs to distinguish `DisallowedPathError` from `PublishConflictError`, and the `ContentStore` interface deliberately models neither. `GitHubStore.write` exists for the post-switch symmetry and is covered by Task 3's tests. When `CONTENT_STORE` flips, this asymmetry is what needs collapsing, and it is written down here so that it is found.
7. **Inline editing of Awards on `/edit` is out of scope.** `EditMode`'s `SECTION_COMPONENTS` entry renders the same read-only component. The Manage panel is where Awards is edited in this phase; inline editing of D1-backed content is a Phase 3+ concern.
8. **Cross-store atomicity is lost, one file wide.** Not a deviation that can be fixed within this phase — there is no transaction across SQLite and a git remote — so it is stated in the code, in the commit messages and here, rather than disguised. It closes when `CONTENT_STORE` flips.

**Placeholders.** Two, both requiring Cloudflare account access and both following the existing `wrangler.toml` convention exactly: `PLACEHOLDER-NOT-A-REAL-D1-DATABASE-ID`, and the R2 bucket name, which is a real name a human types rather than an id anyone pastes. `src/test/wrangler-config.test.ts` accepts either the placeholder or a well-formed real value for the D1 id — never exact equality to the placeholder, which is the defect that file's own header comment describes at length and which this plan must not reintroduce. The D1 id is a **dashed UUID**, not the 32-hex the KV id and account id are, and reusing `HEX32` for it would reject every real value; the new test has its own pattern and a case that specifically rejects a pasted KV id.

**Type consistency across tasks.** `StoredContent { content, sha }` is intentionally structurally identical to `worker/github.ts`'s exported `FileContent`, so `GitHubStore.read` can return `getFileContent`'s result unchanged and `GET /api/content`'s response body does not change shape at all. `StoreWriteFile` is `CommitFile` plus the optional `baseSha` that `worker/index.ts` already models locally as `PublishFile`; Task 5 should delete the local `PublishFile` type and import `StoreWriteFile` instead rather than maintaining two names for one shape. `ContentStore.write` returns `{ sha: string | null }` — the `null` is the single type change that propagates furthest, through `handlePublish`'s response, `requestPublish`'s success variant, `UndoRecord.sha` and `PublishBar`'s tracking branch, and Task 10 exists specifically so that propagation is one reviewed change rather than four unreviewed ones. `D1Store.write` narrows its own return to `{ sha: null }`, which satisfies the interface and lets a direct caller skip the null check the polymorphic path cannot.

**Ordering risk.** Task 3 imports `D1Store` from Task 4's file. Create `worker/d1.ts` with the class shell during Task 3 and fill in the bodies in Task 4, or run the two tasks in one sitting. Every other task depends only on tasks before it.
