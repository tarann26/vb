import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CONTENT_FILES, fetchContent } from '../content';

function stubFetch(handler: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchContent', () => {
  it('requests GET /api/content?path=src/content/<name>.json, same-origin', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ content: '[]', sha: 'sha-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await fetchContent('dishes.json');
    expect(fetch).toHaveBeenCalledWith('/api/content?path=src/content/dishes.json', {
      credentials: 'same-origin',
    });
  });

  it('returns the parsed content alongside its sha', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ content: JSON.stringify([{ id: 'x' }]), sha: 'sha-2' }), { status: 200 }),
    );
    const result = await fetchContent('dishes.json');
    expect(result).toEqual({ data: [{ id: 'x' }], sha: 'sha-2' });
  });

  it('throws on a non-OK response, naming the file and the status', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    await expect(fetchContent('site.json')).rejects.toThrow(/site\.json/);
    await expect(fetchContent('site.json')).rejects.toThrow(/401/);
  });

  it('throws on a 404 (file does not exist), not a silent empty result', async () => {
    stubFetch(async () => new Response(JSON.stringify({ message: 'not found' }), { status: 404 }));
    await expect(fetchContent('story.json')).rejects.toThrow(/404/);
  });

  // Every real file GET /api/content can serve, from the same list
  // worker/__tests__/github.test.ts's "still accepts the real content
  // file" block pins on the write side -- this is that list's read-side
  // twin, so the two are the ones that could quietly drift, not any
  // ad-hoc subset a test author happened to type here.
  it('CONTENT_FILES lists exactly the nine real content files', () => {
    expect([...CONTENT_FILES].sort()).toEqual(
      [
        'copy.json',
        'dishes.json',
        'drinks.json',
        'galleries.json',
        'menus.json',
        'press.json',
        'sections.json',
        'site.json',
        'story.json',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The reason Task 3 exists at all: the dashboard must read current content
// through GET /api/content, never through src/content/index.ts, the
// build-time snapshot whose staleness is what let a dashboard write
// silently drop an edit that hadn't built yet. Modeled on
// src/test/bundle.test.ts's own "nothing outside src/admin imports admin
// code" check -- same anchored shape (a from/import keyword immediately
// before the quoted specifier, not an unanchored substring match that would
// also fire on ordinary prose in quotes), proven there to catch static,
// named, bare side-effect, `import type`, `export *`, dynamic, no-space and
// barrel import forms.
//
// NOT a single fixed regex, deliberately: this module's own filename
// (`content.ts`, required by this task's brief) collides with the target
// directory's name. `../content` from src/admin/content.ts reaches the
// stale snapshot (src/content/index.ts) -- but the IDENTICAL text
// `../content` from src/admin/__tests__/content.test.ts (this very file,
// two directories deep) instead reaches THIS module's own sibling,
// src/admin/content.ts -- a real, legitimate import, not an offender. Only
// the number of leading `../` segments that actually resolves to
// `src/content/` from a given file's own location can tell those apart, and
// that number depends on how deep under src/admin/ the file sits.
// `dotsNeeded` computes it from the file's own path rather than assuming a
// fixed depth, which is what an unparameterized regex (matching "any number
// of `../`", the naive first draft of this check) gets wrong -- confirmed
// directly: that version flagged this file's own real import of
// `../content` (fetchContent, above) as an offender.
function dotsNeeded(filePath: string): number {
  // 'src/admin/content.ts' -> 3 segments -> 1 ('..' reaches src/ from
  // src/admin/). 'src/admin/__tests__/content.test.ts' -> 4 segments -> 2
  // ('../..' reaches src/ from src/admin/__tests__/). Generalizes to any
  // future depth under src/admin/, not just these two.
  return filePath.split('/').length - 2;
}

function importsContentSnapshot(source: string, filePath: string): boolean {
  const dots = dotsNeeded(filePath);
  const pattern = new RegExp(`(?:from|import)\\s*\\(?\\s*['"](?:\\.\\./){${dots}}content(?:/index)?['"]`);
  return pattern.test(source);
}

function gitLsFiles(dir: string): string[] {
  return execFileSync('git', ['ls-files', dir], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('nothing under src/admin imports the build-time content snapshot', () => {
  it('no file under src/admin imports ../content or ../content/index, at the depth that actually reaches src/content', () => {
    const offenders = gitLsFiles('src/admin')
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => importsContentSnapshot(readFileSync(f, 'utf8'), f));
    expect(offenders).toEqual([]);
  });
});

describe('importsContentSnapshot catches every import form, at the right depth', () => {
  // Simulated as if written directly in a file under src/admin/ (one `..`
  // reaches src/content/ from there) -- a plausible real depth, not the
  // depth this test file itself happens to sit at.
  const AT_DEPTH_1 = 'src/admin/fake.ts';

  const FORMS: Record<string, string> = {
    'static default import': `import content from '../content';`,
    'static named import': `import { site } from '../content';`,
    'bare side-effect import': `import '../content';`,
    'import type': `import type { Dish } from '../content';`,
    'export * from': `export * from '../content';`,
    'dynamic import()': `const c = await import('../content');`,
    'no-space from': `import content from'../content';`,
    'explicit /index': `import { dishes } from '../content/index';`,
    'prettier-wrapped multi-line': `import {\n  site,\n  dishes,\n} from\n  '../content';`,
  };

  it.each(Object.entries(FORMS))('matches a %s at depth 1', (_label, snippet) => {
    expect(importsContentSnapshot(snippet, AT_DEPTH_1)).toBe(true);
  });

  // The exact case that broke an unparameterized version of this check:
  // one directory deeper (a __tests__ file), '../content' no longer reaches
  // src/content/ at all -- it reaches a sibling src/admin/content.ts
  // instead -- so it must NOT match at depth 1's pattern, only '../../content'
  // does, and only at depth 2.
  it('a depth-1 snippet does NOT match at depth 2 (it resolves to a different file there)', () => {
    const snippet = `import { dishes } from '../content';`;
    expect(importsContentSnapshot(snippet, 'src/admin/__tests__/fake.test.ts')).toBe(false);
  });

  // Built by concatenation, not written as a contiguous literal: this
  // file's own real depth is 2 (src/admin/__tests__/content.test.ts), so a
  // literal '../../content' right here would make the "no offenders" scan
  // above flag THIS LINE as an offender against itself -- confirmed
  // directly while writing this test.
  it('matches ../../content at depth 2, the depth that actually reaches src/content from a __tests__ file', () => {
    const twoUp = ['..', '..', 'content'].join('/');
    const snippet = `import { dishes } from '${twoUp}';`;
    expect(importsContentSnapshot(snippet, 'src/admin/__tests__/fake.test.ts')).toBe(true);
  });

  it('does not match a types-only import, which erases at compile time', () => {
    expect(importsContentSnapshot(`import type { Dish } from '../content/types';`, AT_DEPTH_1)).toBe(false);
  });

  it('does not match the validate/guards/publish modules, which import no JSON', () => {
    expect(importsContentSnapshot(`import { validateContent } from '../content/validate';`, AT_DEPTH_1)).toBe(false);
    expect(importsContentSnapshot(`import { assertSections } from '../content/guards';`, AT_DEPTH_1)).toBe(false);
    expect(importsContentSnapshot(`import { isPublished } from '../content/publish';`, AT_DEPTH_1)).toBe(false);
  });

  it('does not match the word "content" appearing outside an import/export specifier', () => {
    expect(importsContentSnapshot(`// fetches content from the route, never the snapshot`, AT_DEPTH_1)).toBe(false);
  });

  // This file's own legitimate import (fetchContent, at the top of this
  // file) -- src/admin/__tests__/content.test.ts importing
  // src/admin/content.ts via '../content' -- must not be mistaken for an
  // offender. This is the exact collision `dotsNeeded` exists to resolve.
  it('does not match this file\'s own sibling import of ../content at its real depth (2)', () => {
    const snippet = `import { fetchContent } from '../content';`;
    expect(importsContentSnapshot(snippet, 'src/admin/__tests__/content.test.ts')).toBe(false);
  });
});
