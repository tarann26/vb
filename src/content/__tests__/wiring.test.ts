import { describe, it, expect, vi, afterEach } from 'vitest';

// content/index.ts's guards (assertCopy, assertSections, assertHours, the
// drinks category check) are each well covered on their own -- see
// copy.test.ts, sections.test.tsx, site.test.ts -- but nothing confirms
// they are actually *called* at the export sites that produce `copy`,
// `sections`, `site` and `drinks`. Proven: replacing each export site with
// a plain cast (e.g. `assertCopy(...)` -> `... as Copy`) leaves 611/611
// green, because every other test imports the already-valid real content
// and never exercises the rejection path through the real module graph.
//
// Each test here mocks the underlying JSON module (not `../index` itself,
// which is what's under test) with a deliberately invalid fixture, then
// dynamically imports `../index` fresh and asserts the import itself
// rejects -- which only happens if the corresponding guard actually runs
// during module evaluation.
describe('content/index.ts export-site guards', () => {
  afterEach(() => {
    vi.doUnmock('../sections.json');
    vi.doUnmock('../copy.json');
    vi.doUnmock('../site.json');
    vi.doUnmock('../drinks.json');
    vi.resetModules();
  });

  it('rejects a disabled hero via assertSections at the `sections` export site', async () => {
    vi.resetModules();
    vi.doMock('../sections.json', async () => {
      const actual = await vi.importActual<{ default: { id: string; enabled: boolean }[] }>(
        '../sections.json',
      );
      const bad = actual.default.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
      return { default: bad };
    });

    await expect(import('../index')).rejects.toThrow(/hero/);
  });

  it('rejects a blank copy.json field via assertCopy at the `copy` export site', async () => {
    vi.resetModules();
    vi.doMock('../copy.json', async () => {
      const actual = await vi.importActual<{ default: Record<string, unknown> }>('../copy.json');
      const bad = structuredClone(actual.default) as { atmosphere: { heading: string } };
      bad.atmosphere.heading = '   ';
      return { default: bad };
    });

    await expect(import('../index')).rejects.toThrow(/atmosphere\.heading/);
  });

  it('rejects a malformed hours entry via assertHours at the `site` export site', async () => {
    vi.resetModules();
    vi.doMock('../site.json', async () => {
      const actual = await vi.importActual<{ default: Record<string, unknown> }>('../site.json');
      const bad = structuredClone(actual.default) as { hours: { opens: string }[] };
      bad.hours[0].opens = 'nope';
      return { default: bad };
    });

    await expect(import('../index')).rejects.toThrow(/invalid "opens" time "nope"/);
  });

  it('rejects an invalid category via the drinks guard at the `drinks` export site', async () => {
    vi.resetModules();
    vi.doMock('../drinks.json', async () => {
      const actual = await vi.importActual<{ default: { category: string }[] }>('../drinks.json');
      const bad = structuredClone(actual.default);
      bad[0].category = 'soda';
      return { default: bad };
    });

    await expect(import('../index')).rejects.toThrow(/invalid category "soda"/);
  });
});
