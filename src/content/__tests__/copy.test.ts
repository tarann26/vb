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

  // copy.footer.followLabel ('Follow Us:') must keep a non-breaking
  // space between its two words, not an ordinary one -- validateContent
  // (src/content/validate.ts) enforces this on every dashboard write, and
  // this pins the same invariant against the real, committed copy.json so a
  // hand-edit that reaches `main` outside the dashboard is caught too.
  // Invariant under any legitimate rewording of the label itself: it
  // constrains the separator, not the words.
  it('footer.followLabel uses a non-breaking space, not an ordinary one', () => {
    expect(copy.footer.followLabel).not.toMatch(/ /); // U+0020, not U+00A0
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

  it('rejects a non-string nav label, naming the path', () => {
    // A number falls through every branch of assertNonBlank (it only
    // recurses into strings, arrays and objects), so `"label": 42` renders
    // as literal "42" text with nothing else in this suite catching it.
    const bad = structuredClone(copy) as unknown as { nav: { links: { label: unknown }[] } };
    bad.nav.links[0].label = 42;
    expect(() => assertCopy(bad)).toThrow(/nav\.links\[0\]/);
  });

  it('rejects a nav href that is not a "#"-prefixed fragment, naming the path', () => {
    const bad = structuredClone(copy) as unknown as { nav: { links: { href: unknown }[] } };
    bad.nav.links[0].href = 'galery';
    expect(() => assertCopy(bad)).toThrow(/nav\.links\[0\]/);
  });
});
