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

  // Pruning and undo both read "newest revisions for this path" -- exactly
  // what (path, id DESC) serves. The group restore reads by publish_id
  // instead. Nothing above this test pins either index's name or column
  // list, so a later edit could drop one, reorder its columns, or flip
  // DESC to ASC and every existing assertion would still pass.
  it('declares both revisions indexes with the columns their access patterns need', () => {
    const text = sql();

    const byPath = text.match(/CREATE INDEX IF NOT EXISTS revisions_by_path ON revisions\s*\(([\s\S]*?)\);/i);
    expect(byPath, 'no CREATE INDEX for revisions_by_path').not.toBeNull();
    // The DESC matters: pruning and undo both want the newest rows for a
    // path first, and an ascending index does not serve that read.
    expect(byPath![1].replace(/\s+/g, ' ').trim()).toBe('path, id DESC');

    const byPublish = text.match(/CREATE INDEX IF NOT EXISTS revisions_by_publish ON revisions\s*\(([\s\S]*?)\);/i);
    expect(byPublish, 'no CREATE INDEX for revisions_by_publish').not.toBeNull();
    expect(byPublish![1].replace(/\s+/g, ' ').trim()).toBe('publish_id');
  });
});

describe('0002_analytics.sql', () => {
  function columnsOf(table: string): string[] {
    const block = sql().match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
    expect(block, `no CREATE TABLE for ${table}`).not.toBeNull();
    return block![1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('--'))
      .map((line) => line.split(/\s+/)[0]);
  }

  it('records a tagged arrival with a source and a day and nothing else', () => {
    expect(columnsOf('campaign_arrivals')).toEqual(['id', 'source', 'day', 'created_at']);
  });

  it('holds no address, no agent and no identifier anywhere in the new tables', () => {
    // The privacy claim, as an assertion rather than a comment. The spec's
    // "It does not record who" is what lets the limiter live in D1 at all,
    // so the column lists are load-bearing.
    const columns = [...columnsOf('campaign_arrivals'), ...columnsOf('campaign_rate')].join(' ');
    for (const forbidden of ['ip', 'address', 'agent', 'visitor', 'session', 'cookie']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('indexes arrivals by day and limiter rows by expiry, which is how both are read', () => {
    expect(sql()).toContain('CREATE INDEX IF NOT EXISTS campaign_arrivals_by_day ON campaign_arrivals (day)');
    expect(sql()).toContain('CREATE INDEX IF NOT EXISTS campaign_rate_by_expiry ON campaign_rate (expires)');
  });

  it('keys the snapshot by day and the rollup by month, and marks a partial month', () => {
    expect(columnsOf('daily_visits')).toEqual(['day', 'visits', 'recorded_at']);
    expect(columnsOf('monthly_visits')).toEqual(['month', 'visits', 'complete', 'recorded_at']);
  });

  it('leaves 0001 alone', () => {
    // 0001 has been applied to the live database and its header records the
    // command that applied it. Anything appended to it is a statement nobody
    // can tell has run.
    const first = readFileSync(join(DIR, '0001_content.sql'), 'utf8');
    for (const table of ['campaign_arrivals', 'campaign_rate', 'daily_visits', 'monthly_visits']) {
      expect(first).not.toContain(table);
    }
  });
});
