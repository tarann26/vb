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
  // worker/analytics-store.ts's four tables. Kept as plain collections rather
  // than rows-with-a-schema for the same reason the two above are: this is a
  // stand-in for the statements that module issues, not a database.
  campaignArrivals: Array<{ source: string; day: string; created_at: number }> = [];
  campaignRate = new Map<string, { hits: number; expires: number }>();
  dailyVisits = new Map<string, { visits: number; recorded_at: number }>();
  monthlyVisits = new Map<string, { visits: number; complete: number; recorded_at: number }>();
  statements: string[] = [];
  private nextId = 1;
  // Set to a message to make every subsequent call reject -- how the
  // snapshot-fallback tests force a query failure.
  failWith: string | null = null;
  // Lets `failWith` reject only from the Nth call onward, rather than
  // immediately. worker/published.ts's handlePublished makes two separate
  // reads per request -- `store.version` first, then `store.read` on a
  // cache miss -- each guarded by its own try/catch with its own fallback.
  // failWith alone can only ever fail the FIRST of the two (version is
  // always checked before read is ever reached), so a test that wants to
  // prove the read()-specific fallback -- as opposed to the version-read one
  // -- needs version() to succeed and read() to fail in the same request.
  // Decremented on every call while positive; failWith takes effect once it
  // reaches zero. TRAP: "every call" means every `execute` -- so a `batch`
  // of N statements decrements N times via `execute`, PLUS once more of its
  // own in `batch` itself, for N + 1 total. D1Store.write's batch always
  // carries at least 2 statements per file (an INSERT INTO content and a
  // pruning DELETE, plus an INSERT INTO revisions when overwriting an
  // existing path), so `failAfter: 2` set before a write does NOT mean "let
  // the first two statements through" -- it can be consumed entirely by
  // `batch`'s own check plus the first statement inside it, failing before
  // the write's second statement is ever reached. Set generously past a
  // batch's true statement count, or avoid `failAfter` around `write`
  // altogether and reach for it only around the single-statement
  // `version`/`read` calls it was built for (see worker/published.ts's own
  // comment on why those two need to fail independently).
  failAfter = 0;
  // Counts invocations of `batch`, including ones called with an empty
  // statement list. `statements` alone cannot tell a caller that skipped
  // `batch` entirely from one that called it with nothing to do -- an empty
  // `batch([])` executes zero statements and so leaves `statements`
  // unchanged either way. That distinction is exactly what proves whether
  // D1Store.undo's early return on "no revisions" is doing anything: without
  // it, `undo` still calls `write([])`, which still calls `batch([])`.
  batchCalls = 0;

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return new FakeStatement(this, normalized, []);
  }

  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    this.batchCalls += 1;
    if (this.shouldFailNow()) throw new Error(this.failWith as string);
    const out: unknown[] = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }

  private shouldFailNow(): boolean {
    if (!this.failWith) return false;
    if (this.failAfter > 0) {
      this.failAfter -= 1;
      return false;
    }
    return true;
  }

  execute(statement: FakeStatement): { changes: number; row?: unknown; rows?: unknown[] } {
    if (this.shouldFailNow()) throw new Error(this.failWith as string);
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
    if (sql.startsWith('DELETE FROM revisions WHERE publish_id = ?')) {
      // Consumes a whole revision group by publish_id -- distinct from the
      // pruning DELETE below, which scopes by path and keeps a count. This
      // one deletes everything sharing the bound publish_id, regardless of
      // path, which is what makes a second `undo(publishId)` find nothing.
      const publishId = args[0] as string;
      this.revisions = this.revisions.filter((r) => r.publish_id !== publishId);
      return { changes: 0 };
    }
    if (sql.startsWith('DELETE FROM revisions WHERE path = ? AND id NOT IN')) {
      // Three `?` placeholders in the real SQL (outer path, inner subquery's
      // path, LIMIT), because the inner subquery re-selects by path rather
      // than sharing the outer bind -- SQLite has no way to reference the
      // outer query's parameter from inside the subquery. args[1] is the
      // second `path = ?`, not the keep count; the keep count is args[2].
      // Binding only two values here (path, keep) would leave the real SQL's
      // third placeholder unbound and its second `path = ?` comparing
      // against a number that matches no path -- see worker/d1.ts's own
      // comment on why the bind is three values, not two.
      const path = args[0] as string;
      // The inner subquery's own `path = ?` (args[1]) must be the same path
      // as the outer one (args[0]) -- they are the same column compared to
      // the same value twice, not two independent parameters. A caller that
      // bound anything else there (including the old two-argument bind,
      // which left this slot holding REVISION_DEPTH) is reproducing the
      // exact arity bug this fake exists to catch, so it fails loudly here
      // instead of silently keeping every revision (`path !== args[1]` would
      // otherwise match nothing and prune nothing).
      if (args[1] !== path) {
        throw new Error(`FakeD1: DELETE FROM revisions bound mismatched paths (${String(args[0])} vs ${String(args[1])})`);
      }
      const keep = args[2] as number;
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

    // ---- worker/analytics-store.ts ------------------------------------
    //
    // These branches READ the clauses their tests hold the statement to --
    // the ORDER BY direction and tiebreak, the presence of a WHERE, the
    // comparison in a DELETE, the reset arm of the limiter's CASE, whether a
    // DO UPDATE replaces or accumulates -- rather than reimplementing the
    // intended behaviour from memory. A fake that hard-codes what the query
    // was MEANT to do absorbs an edit to the query and reports green, which
    // is the same defect as accepting an unknown statement, one layer in.
    if (sql.startsWith('INSERT INTO campaign_arrivals')) {
      const [source, day, createdAt] = args as [string, string, number];
      this.campaignArrivals.push({ source, day, created_at: createdAt });
      return { changes: 1 };
    }
    if (sql.startsWith('SELECT source, COUNT(*) AS arrivals FROM campaign_arrivals')) {
      const since = sql.includes('WHERE day >= ?') ? (args[0] as string) : '';
      const totals = new Map<string, number>();
      const firstSeen: string[] = [];
      for (const row of this.campaignArrivals) {
        if (row.day < since) continue;
        if (!totals.has(row.source)) firstSeen.push(row.source);
        totals.set(row.source, (totals.get(row.source) ?? 0) + 1);
      }
      // SQLite promises nothing about the order of rows a query does not
      // order. When the statement names no second key, this fake hands back
      // the legal-but-opposite tie order, so a caller that depends on an
      // unspecified one fails here instead of reshuffling the card between
      // refreshes in production.
      const tie = sql.includes(', source ASC')
        ? (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
        : (a: string, b: string) => firstSeen.indexOf(b) - firstSeen.indexOf(a);
      const direction = sql.includes('ORDER BY arrivals DESC') ? -1 : 1;
      const rows = [...totals.entries()]
        .sort((a, b) => (a[1] === b[1] ? tie(a[0], b[0]) : direction * (a[1] - b[1])))
        .map(([source, arrivals]) => ({ source, arrivals }));
      return { changes: 0, rows };
    }
    if (sql.startsWith('INSERT INTO campaign_rate')) {
      const [bucket, expires] = args as [string, number];
      const existing = this.campaignRate.get(bucket);
      // Three clauses read off the statement rather than assumed.
      //
      // `increments`: a DO UPDATE that wrote a literal 1 would let every
      // request through, so the arm that counts has to be visible here.
      //
      // `resets`: an expiry-comparing CASE arm is the defect this limiter was
      // repaired for -- it resets whenever the new expiry is larger than the
      // stored one, and both callers bind an expiry that grows every second.
      // Mirrored so that re-adding it reddens a test instead of silently
      // switching the limiter and the daily cap off.
      //
      // `refreshes`: without `expires = excluded.expires` a bucket still
      // being written to keeps its first expiry and the night's prune deletes
      // it mid-window, which restarts the day's cap from zero.
      const increments = sql.includes('campaign_rate.hits + 1');
      const resets = sql.includes('CASE WHEN campaign_rate.expires <= excluded.expires - 1');
      const refreshes = sql.includes('expires = excluded.expires');
      const stale = resets && existing !== undefined && existing.expires <= expires - 1;
      const hits = existing === undefined || stale || !increments ? 1 : existing.hits + 1;
      this.campaignRate.set(bucket, { hits, expires: existing !== undefined && !refreshes ? existing.expires : expires });
      return { changes: 0, row: { hits } };
    }
    if (sql.startsWith('DELETE FROM campaign_rate WHERE expires')) {
      const cutoff = args[0] as number;
      const dead = sql.includes('expires < ?')
        ? (expires: number) => expires < cutoff
        : (expires: number) => expires > cutoff;
      for (const [bucket, row] of [...this.campaignRate]) if (dead(row.expires)) this.campaignRate.delete(bucket);
      return { changes: 0 };
    }
    if (sql.startsWith('INSERT INTO daily_visits')) {
      const [day, visits, recordedAt] = args as [string, number, number];
      const existing = this.dailyVisits.get(day);
      // ON CONFLICT(day) DO NOTHING keeps the first number it ever saw; the
      // real statement replaces it. Which of the two is written is what the
      // "corrects a day it has already recorded" test is about.
      if (existing !== undefined && !sql.includes('DO UPDATE SET visits = excluded.visits')) return { changes: 0 };
      this.dailyVisits.set(day, { visits, recorded_at: recordedAt });
      return { changes: 1 };
    }
    if (sql.startsWith('SELECT day, visits FROM daily_visits')) {
      const since = sql.includes('WHERE day >= ?') ? (args[0] as string) : '';
      const rows = [...this.dailyVisits.entries()]
        .filter(([day]) => day >= since)
        .sort((a, b) => (sql.includes('ORDER BY day ASC') ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
        .map(([day, row]) => ({ day, visits: row.visits }));
      return { changes: 0, rows };
    }
    if (sql.startsWith('SELECT MIN(day) AS first_day FROM daily_visits')) {
      // An aggregate over an empty table returns ONE row holding NULL, not
      // zero rows -- the difference the store's `null` check is written for.
      const days = [...this.dailyVisits.keys()].sort();
      return { changes: 0, row: { first_day: days.length > 0 ? days[0] : null } };
    }
    if (sql.startsWith('DELETE FROM daily_visits WHERE day')) {
      const cutoff = args[0] as string;
      const dead = sql.includes('day < ?') ? (day: string) => day < cutoff : (day: string) => day > cutoff;
      for (const day of [...this.dailyVisits.keys()]) if (dead(day)) this.dailyVisits.delete(day);
      return { changes: 0 };
    }
    if (sql.startsWith('SELECT substr(day')) {
      const width = Number(sql.match(/substr\(day, 1, (\d+)\)/)?.[1] ?? 7);
      const since = sql.includes('WHERE day >= ?') ? (args[0] as string) : '';
      const totals = new Map<string, { visits: number; days: number }>();
      for (const [day, row] of this.dailyVisits) {
        if (day < since) continue;
        const month = day.slice(0, width);
        const current = totals.get(month) ?? { visits: 0, days: 0 };
        totals.set(month, { visits: current.visits + row.visits, days: current.days + 1 });
      }
      return {
        changes: 0,
        rows: [...totals.entries()].map(([month, value]) => ({ month, visits: value.visits, days: value.days })),
      };
    }
    if (sql.startsWith('INSERT INTO monthly_visits')) {
      const [month, visits, complete, recordedAt] = args as [string, number, number, number];
      const existing = this.monthlyVisits.get(month);
      // `visits = excluded.visits` REPLACES. A statement that added to the
      // stored total instead would double a month on the second run of the
      // night, which is the one number on this panel she would believe.
      const replaces = sql.includes('DO UPDATE SET visits = excluded.visits');
      const total = existing !== undefined && !replaces ? existing.visits + visits : visits;
      this.monthlyVisits.set(month, { visits: total, complete, recorded_at: recordedAt });
      return { changes: 1 };
    }
    if (sql.startsWith('SELECT month, visits, complete FROM monthly_visits')) {
      const since = sql.includes('WHERE month >= ?') ? (args[0] as string) : '';
      const rows = [...this.monthlyVisits.entries()]
        .filter(([month]) => month >= since)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, row]) => ({ month, visits: row.visits, complete: row.complete }));
      return { changes: 0, rows };
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM monthly_visits')) {
      return { changes: 0, row: { n: this.monthlyVisits.size } };
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
