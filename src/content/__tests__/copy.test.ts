import { describe, it, expect } from 'vitest';
import { copy, assertCopy } from '../index';

const strings = (obj: unknown, path = ''): [string, string][] =>
  typeof obj === 'string'
    ? [[path, obj]]
    : Array.isArray(obj)
      ? obj.flatMap((v, i) => strings(v, `${path}[${i}]`))
      : obj && typeof obj === 'object'
        ? Object.entries(obj).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
        : [];

describe('copy', () => {
  const all = strings(copy);

  it('finds strings to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all)('%s is not blank', (_path, value) => {
    expect(value.trim().length).toBeGreaterThan(0);
  });

  it('has at least one nav link, all fragments', () => {
    // Not pinned to today's count (5): adding or removing a nav link is a
    // legitimate content edit, and assertCopy already rejects an empty list
    // (see the "rejects an empty nav link list" test below) -- pinning an
    // exact count here would fail the deploy gate on that edit while adding
    // no coverage assertCopy doesn't already provide.
    expect(copy.nav.links.length).toBeGreaterThan(0);
    copy.nav.links.forEach((l) => expect(l.href).toMatch(/^#/));
  });
});

describe('assertCopy', () => {
  it('rejects a blank string, naming its path', () => {
    const bad = structuredClone(copy) as unknown as Record<string, Record<string, string>>;
    bad.atmosphere.heading = '   ';
    expect(() => assertCopy(bad)).toThrow(/atmosphere\.heading/);
  });

  it('rejects an empty nav link list', () => {
    const bad = structuredClone(copy) as unknown as { nav: { links: unknown[] } };
    bad.nav.links = [];
    expect(() => assertCopy(bad)).toThrow(/nav\.links/);
  });

  it('rejects a nav link whose section is not a real SectionId, naming the path', () => {
    const bad = structuredClone(copy) as unknown as { nav: { links: { section: string }[] } };
    bad.nav.links[0].section = 'atmosfera';
    expect(() => assertCopy(bad)).toThrow(/nav\.links\[0\]/);
  });
});
