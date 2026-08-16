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
