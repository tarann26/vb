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
