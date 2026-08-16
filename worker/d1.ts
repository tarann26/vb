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
          // Three placeholders, three values: SQLite parameters are
          // positional, and the inner subquery's `path = ?` cannot see the
          // outer query's bound value -- it needs its own, so `entry.path`
          // is bound twice. A two-argument bind here is an arity mismatch
          // against this three-placeholder SQL: most D1/SQLite drivers
          // reject that outright ("Incorrect number of bindings supplied")
          // before the statement runs at all, and if a driver let it
          // through, LIMIT would receive NULL and SQLite raises "datatype
          // mismatch" on `LIMIT NULL" rather than returning rows. Either way
          // this fails loudly on every write that touches an existing path
          // -- not the silent, unbounded deletion an unguarded
          // `NOT IN (empty set)` reading might suggest, since that reading
          // only applies once LIMIT already holds a valid integer, which an
          // unbound third parameter cannot supply.
          .bind(entry.path, entry.path, REVISION_DEPTH),
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

    // Consumes the group once it has been restored. Without this, the SELECT
    // above would find the exact same rows on a SECOND call to
    // `undo(publishId)` -- nothing about restoring them removes them from
    // `revisions` -- and would restore them again, silently, rather than
    // reporting nothing left to undo. worker/index.ts's handleUndo relies on
    // an EMPTY result here to refuse a repeat undo with 409 instead of
    // reverting twice.
    //
    // Run after the restoring write, not batched with it: if this delete
    // itself fails, the worst case is a group that can still be undone again
    // (a redundant, harmless re-restore, since `content` is already at the
    // restored value) -- never a group whose restore silently didn't happen.
    // Scoped to `publish_id`, not `path`: it must not touch any OTHER
    // publish's revisions for the same path, including the one this very
    // call just created for `undoPublishId`.
    await this.db.prepare('DELETE FROM revisions WHERE publish_id = ?').bind(publishId).run();
    return results.map((row) => row.path);
  }
}
