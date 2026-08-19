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

  // The reason the Worker sent, not just the status. Every content file
  // reporting a bare "status 502" is what a real, live GITHUB_TOKEN failure
  // looked like: nine identical messages, none of which said the token was
  // the problem. The Worker had already built the explanation
  // (worker/github.ts's describeFailure -> worker/index.ts's 502 branch) and
  // this function discarded it.
  it('surfaces the reason the Worker gave, not just the status code', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ message: 'could not read src/content/site.json (GitHub returned 401) -- Bad credentials' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(fetchContent('site.json')).rejects.toThrow(/Bad credentials/);
  });

  // A failure with no readable body must still say something useful rather
  // than throwing on the JSON parse of an empty or HTML response.
  it('falls back to the status when the body carries no message', async () => {
    stubFetch(async () => new Response('<!doctype html>', { status: 502 }));
    await expect(fetchContent('site.json')).rejects.toThrow(/status 502/);
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

  // Minor review finding: a hand-edited content file with a syntax error
  // used to reach the section's own "Could not load X: <message>" text as
  // V8's own raw parser output ("Unexpected token..."/"Expected property
  // name..."), meaningless to a non-technical owner. A plain, actionable
  // sentence naming the file, not the parser's own wording, is what she
  // should read instead.
  it('a malformed content file (real JSON syntax error) throws a plain, actionable message -- not the raw V8 parser text', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ content: '{ "a": }', sha: 'sha-3' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(fetchContent('galleries.json')).rejects.toThrow(/galleries\.json/);
    await expect(fetchContent('galleries.json')).rejects.toThrow(/edited incorrectly/i);
    // The raw V8 wording must NOT reach her -- confirmed the malformed
    // fixture above actually produces it, so this assertion is proving
    // something real, not a string that could never have appeared anyway.
    expect(() => JSON.parse('{ "a": }')).toThrow(/Unexpected token|Expected/);
    await expect(fetchContent('galleries.json')).rejects.not.toThrow(/Unexpected token|position \d/i);
  });

  // Every real file GET /api/content can serve, from the same list
  // worker/__tests__/github.test.ts's "still accepts the real content
  // file" block pins on the write side -- this is that list's read-side
  // twin, so the two are the ones that could quietly drift, not any
  // ad-hoc subset a test author happened to type here.
  // Review finding: a hand-typed nine-name literal compared against
  // CONTENT_FILES's own hand-typed nine names is a change detector, not a
  // real check -- neither side ever reads the actual repository. Derived
  // from `git ls-files` instead (the same tool `gitLsFiles`, below, already
  // shells out to for the import-graph check), so a real content file added
  // or removed under src/content/ without updating CONTENT_FILES fails this
  // for the right reason.
  // Phase 2, Task 11: `awards.json` is the one deliberate exception --
  // content.ts's own header comment on `CONTENT_FILES` explains why it names
  // a D1 row, not a file `git ls-files` could ever see. Listed alongside
  // `real` explicitly, not folded into the derivation above, so this test
  // still catches its original defect (a real file added to or removed from
  // src/content/ without a matching CONTENT_FILES update) while accepting
  // the one name that is correctly present without a file behind it.
  //
  // Phase 5B, Task 3: `posts.json`'s exception is GONE, and its inverse
  // assertion with it. 5A kept the file out of CONTENT_FILES because that
  // list is what areas.test.tsx requires a Manage panel for, and the Posts
  // panel did not exist yet. It does now, so posts.json is an ordinary
  // registered file and this derivation covers it with no carve-out. If you
  // are re-adding a filter here, something has gone backwards.
  // Two named exceptions, and each is spelled out rather than allowed by a
  // loose comparison, so a THIRD file drifting out of this list is still a
  // red test:
  //
  //   awards.json is in CONTENT_FILES with no file behind it -- D1-backed
  //   (worker/store.ts's D1_ONLY_PATHS), never a blob in this repository.
  //
  //   press.json is a file with no CONTENT_FILES entry, which is backlog item
  //   17. The blog superseded it and the dashboard no longer edits it. The
  //   file itself stays on disk because three components still read it
  //   (NewsPress, BlogTeaser, BlogsPage) and all three are under the owner's
  //   explicit never-delete constraint -- src/test/no-dead-backend.test.ts is
  //   what holds them there. None of the three is routed, so nothing a
  //   visitor can reach renders it either.
  it('CONTENT_FILES lists exactly the real *.json files under src/content/, plus awards.json and minus press.json', () => {
    const real = gitLsFiles('src/content')
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice('src/content/'.length));
    expect(real).toContain('press.json');
    const editable = real.filter((name) => name !== 'press.json');
    expect([...CONTENT_FILES].sort()).toEqual([...editable, 'awards.json'].sort());
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

// The five modules under src/content/ that are legitimate to import from
// src/admin/ -- none of them import any JSON, and none has a transitive path
// to src/content/index.ts, the build-time snapshot. `types`, `validate` and
// `guards` erase entirely at compile time (every export is a type or a pure
// function with no react/JSON dependency). `context` (post-review Fix 5) is
// the one exception to "erases entirely": it holds a real runtime
// `createContext` call from `react` -- safe to whitelist by name here
// anyway because it is react-only and imports no JSON, which is the actual
// property this whitelist exists to guard (see EditMode.tsx's own comment on
// why `../content/types` stopped being safe to whitelist blindly the moment
// it held that same call, before this fix moved it out). `collage` (Plan 9,
// Task 1) is the same shape as `validate`/`guards`: pure operations on the
// hero collage's split tree whose only import is an `import type` from
// ./types, which erases entirely -- needed by EditMode.tsx and
// GalleryList.tsx to rewrite one photo of the tree, the same functions
// `validateContent` and the build-time guard both read. It replaces
// `placement`, the deleted grid-layout module it succeeds. Anything else
// reachable via `content/<subpath>` is NOT safe, and a first version of this
// check (`content(?:/index)?`, matching only the bare barrel and an explicit
// `/index`) missed that: it let `import dishes from '../content/dishes.json'`
// -- a DIRECT import of the JSON itself, arguably the most likely form of
// this mistake, since a later task wanting one file's real shape reaches for
// exactly this -- straight through. Confirmed directly: that version left
// this exact line green across all 21 tests in this file's previous
// revision.
//
// `markdown` joins the list for Task 7, and it qualifies more plainly than
// anything already on it: `content/markdown.ts` imports NOTHING AT ALL --
// zero import statements, no JSON, no react, so no transitive path to
// `src/content/index.ts` can exist (confirmed by reading it, and by its own
// header, which says the property is deliberate because the Cloudflare Worker
// bundles this module). The dashboard reads `isSafeHref` out of it so the
// toolbar's link button refuses an unusable target with the same judgement
// the parser and the write boundary make, rather than a fourth copy of that
// judgement. Pinned in the case below, not merely added here: this list has
// already carried an entry (`placement`) that nothing asserted, so the suite
// stayed green with it present or absent alike.
//
// `inline-source` joins the list for the writing surface, and it inherits
// `markdown`'s argument almost whole: its ONLY import is an `import type` of
// InlineNode from `./markdown`, which erases at compile time, so there is no
// runtime path out of it at all -- let alone one to `src/content/index.ts`.
// `WritingSurface.tsx` reads `serializeInline` out of it because an editable
// host is read back as InlineNode values (dom-inline.ts) and something has to
// turn those into the markdown source a block actually stores; a second copy
// of that spelling in `src/admin/` would be a second grammar to keep in step
// with the parser. Pinned twice below -- once as this entry, once as the
// property of the real file that earns it.
const SAFE_CONTENT_SUBMODULES = ['types', 'validate', 'guards', 'context', 'collage', 'markdown', 'inline-source'];

function importsContentSnapshot(source: string, filePath: string): boolean {
  const dots = dotsNeeded(filePath);
  const safe = SAFE_CONTENT_SUBMODULES.join('|');
  // After `content`, either nothing (the bare barrel) or a `/` NOT
  // immediately followed by one of the safe submodule names -- so
  // `/types`, `/validate`, `/guards` (and their own further
  // subpaths, e.g. a hypothetical `/types/foo`) stay legal, while
  // `/index`, `/dishes.json`, `/index.ts`, or a bare trailing `/` with
  // nothing after it all match.
  const pattern = new RegExp(`(?:from|import)\\s*\\(?\\s*['"](?:\\.\\./){${dots}}content(?:/(?!(?:${safe})(?:['"/]|$))[^'"]*)?['"]`);
  return pattern.test(source);
}

// Everything under `src/admin/__tests__/` is test infrastructure, whether or
// not its own filename ends in `.test.ts`. The exclusion below used to be
// spelled as that filename pattern alone, which was a proxy for this and
// stopped being one the moment a `__tests__` module held shared fixtures
// rather than cases (dashboardFixtures.ts, which two test files read the
// real committed content through). The invariant this whole describe block
// guards is bundle pollution and a stale data source reaching the browser:
// Vitest transforms these files directly and `vite build` never touches the
// directory at all, so nothing in it can cause either. A production file
// doing the identical thing is still caught -- proven by the case below that
// runs `importsContentSnapshot` against a path outside this directory.
// Written as ANY `__tests__` directory under src/admin, not just the one at
// the top of it. Plan 10 Task 16 is where that stopped being a distinction
// without a difference: `src/admin/writing/__tests__/inline-dom.test.ts`
// proves the four-way loop between markdown source and the DOM, which means
// importing `serializeInline` from `../../../content/inline-source` -- a
// submodule that is NOT on the whitelist above and should not be, since no
// production file imports it yet. Spelled as the top-level directory alone,
// this scan called that test file a production offender and went red on the
// first test written in a subdirectory.
function isTestInfrastructure(filePath: string): boolean {
  return filePath.startsWith('src/admin/') && filePath.includes('/__tests__/');
}

function gitLsFiles(dir: string): string[] {
  return execFileSync('git', ['ls-files', dir], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('nothing under src/admin imports the build-time content snapshot', () => {
  // Scoped to PRODUCTION files (excludes `*.test.ts(x)`) -- the invariant
  // this guards is bundle pollution and a stale data source reaching the
  // browser, neither of which a test file can cause: Vitest transforms
  // `__tests__/*.test.ts` directly and nothing in `vite build` ever touches
  // it, so it never reaches the shipped admin chunk regardless of what it
  // imports. Confirmed this distinction is real, not assumed: widening the
  // direct-JSON-subpath check (below) to also cover `content/<name>.json`
  // immediately caught `src/admin/__tests__/fields.test.ts`'s own `import
  // copyRaw from '../../content/copy.json'` -- a DELIBERATE Task 2 choice
  // (see that file's own comment) to test `FieldsOf<Copy>`/`FieldsOf<
  // SiteContent>` against the real committed shape without pulling in the
  // stale barrel's other eight files. That's legitimate test infrastructure,
  // not the defect this check exists to catch.
  it('no production file under src/admin imports ../content or ../content/index, at the depth that actually reaches src/content', () => {
    const offenders = gitLsFiles('src/admin')
      .filter((f) => /\.tsx?$/.test(f) && !isTestInfrastructure(f))
      .filter((f) => importsContentSnapshot(readFileSync(f, 'utf8'), f));
    expect(offenders).toEqual([]);
  });

  // The exclusion above is scoped by filename, not blanket-applied --
  // proven directly against the real file it exists for, rather than left
  // as an assertion in a comment.
  it('fields.test.ts really does import a JSON subpath directly, and really is excluded from the scan', () => {
    const source = readFileSync('src/admin/__tests__/fields.test.ts', 'utf8');
    expect(importsContentSnapshot(source, 'src/admin/__tests__/fields.test.ts')).toBe(true);
    const scanned = gitLsFiles('src/admin').filter((f) => /\.tsx?$/.test(f) && !isTestInfrastructure(f));
    expect(scanned).not.toContain('src/admin/__tests__/fields.test.ts');
  });

  // The same, for the shared fixture module that is NOT named `*.test.ts`
  // and is exactly why the exclusion is spelled as a directory. Without
  // this, a future narrowing back to the filename pattern would go green
  // here and red only in an unrelated file's run.
  it('dashboardFixtures.ts imports the real committed content, and is excluded for being test infrastructure', () => {
    const path = 'src/admin/__tests__/dashboardFixtures.ts';
    expect(importsContentSnapshot(readFileSync(path, 'utf8'), path)).toBe(true);
    expect(isTestInfrastructure(path)).toBe(true);
    const scanned = gitLsFiles('src/admin').filter((f) => /\.tsx?$/.test(f) && !isTestInfrastructure(f));
    expect(scanned).not.toContain(path);
  });

  // The same, for a `__tests__` directory that is NOT the one at the top of
  // src/admin. Without this the exclusion could be narrowed back to that one
  // directory and stay green here, going red only in whichever subdirectory
  // next holds a test -- which is how it was found.
  it('a __tests__ directory deeper under src/admin is test infrastructure too, and really is excluded', () => {
    const path = 'src/admin/writing/__tests__/inline-dom.test.ts';
    // Driven by a snippet rather than by that file's own text, and the
    // difference is worth writing down. When this case was written the real
    // file matched on its own, because it imports `serializeInline` from a
    // submodule the safe list did not carry; the writing surface put that
    // submodule on the list, so the file stopped matching and this case went
    // red without anything about the exclusion changing. What the exclusion
    // has to survive is a test file in a nested directory reading the
    // committed snapshot itself, which is what is asserted here -- and it
    // cannot go stale the next time the safe list moves.
    expect(importsContentSnapshot(`import posts from '../../../content/posts.json';`, path)).toBe(true);
    expect(isTestInfrastructure(path)).toBe(true);
    const scanned = gitLsFiles('src/admin').filter((f) => /\.tsx?$/.test(f) && !isTestInfrastructure(f));
    expect(scanned).not.toContain(path);
    // And the production module beside it is still scanned, so the widening
    // exempts the tests and nothing else.
    expect(scanned).toContain('src/admin/writing/inline-dom.ts');
  });

  // The exclusion is for TEST files specifically, not a loophole that
  // exempts every direct-JSON-import mistake -- a production file doing the
  // exact same thing fields.test.ts does must still be caught.
  it('the same import from a real PRODUCTION file would still be scanned, and would still match', () => {
    const source = `import copyRaw from '../content/copy.json';`;
    expect(importsContentSnapshot(source, 'src/admin/notATestFile.ts')).toBe(true);
    expect(isTestInfrastructure('src/admin/notATestFile.ts')).toBe(false);
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
    'explicit /index.ts': `import { dishes } from '../content/index.ts';`,
    // The likeliest real version of this mistake: a later task wanting one
    // file's actual shape reaches straight for its JSON, not the barrel.
    'direct JSON subpath (the review-found gap)': `import dishes from '../content/dishes.json';`,
    'a different JSON subpath': `import site from '../content/site.json';`,
    'trailing slash with nothing after (the other review-found gap)': `import '../content/';`,
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

  it('does not match the validate/guards/context/collage/markdown modules, which import no JSON', () => {
    expect(importsContentSnapshot(`import { validateContent } from '../content/validate';`, AT_DEPTH_1)).toBe(false);
    expect(importsContentSnapshot(`import { assertSections } from '../content/guards';`, AT_DEPTH_1)).toBe(false);
    // Post-review Fix 5: `context` holds a real runtime `createContext` call
    // (unlike the others, which erase entirely), but it still imports
    // no JSON and has no path to src/content/index.ts -- the actual property
    // this whitelist exists to guard, per SAFE_CONTENT_SUBMODULES's own
    // comment above.
    expect(importsContentSnapshot(`import { ContentProvider } from '../content/context';`, AT_DEPTH_1)).toBe(false);
    // `collage` replaces the deleted `placement` on that list, for the
    // identical reason validate/guards are on it: it imports no JSON, no
    // react, and has no transitive path to src/content/index.ts (confirmed
    // directly -- its only import is `import type` from ./types, which
    // erases entirely). Pinned here rather than merely added to the array:
    // Plan 6's own review found `placement` on the list with NOTHING
    // asserting it, so 1844 tests stayed green with the entry present or
    // absent alike -- exactly the change this file exists to catch.
    expect(importsContentSnapshot(`import { setCollagePhotoSrc } from '../content/collage';`, AT_DEPTH_1)).toBe(false);
    // `markdown` is the strongest case on the list: the module has zero
    // import statements, so there is no path to the snapshot to have. The
    // dashboard's link button reads `isSafeHref` from it.
    expect(importsContentSnapshot(`import { isSafeHref } from '../content/markdown';`, AT_DEPTH_1)).toBe(false);
    // `inline-source`, read by WritingSurface.tsx. Written at depth 2 as well
    // as depth 1 because that is where the real importer sits
    // (`src/admin/writing/`), and the pattern is built per depth -- an entry
    // that worked only at depth 1 would still leave the real file red.
    expect(importsContentSnapshot(`import { serializeInline } from '../content/inline-source';`, AT_DEPTH_1)).toBe(false);
    expect(
      importsContentSnapshot(
        `import { serializeInline } from '../../content/inline-source';`,
        'src/admin/writing/WritingSurface.tsx',
      ),
    ).toBe(false);
  });

  // The half the pin above cannot state on its own, exactly as for `markdown`
  // below: `inline-source` is on the safe list because of a property of the
  // real file. Its one import is an `import type`, which erases entirely, so
  // it has no runtime path anywhere. Give it a value import and this reddens
  // and the entry has to be re-argued rather than silently inherited.
  it('the real content/inline-source module imports nothing that survives compilation', () => {
    const source = readFileSync('src/content/inline-source.ts', 'utf8');
    const importLines = source.split('\n').filter((line) => /^\s*(?:import|export\s*\*)\b/.test(line));
    expect(importLines).toEqual([`import type { InlineNode } from './markdown';`]);
  });

  // The half the pin above cannot state on its own: `markdown` is on the safe
  // list because of a property of the real file, and that property is
  // checkable. If somebody ever gives `content/markdown.ts` an import, this
  // reddens and the entry has to be re-argued rather than silently inherited.
  it('the real content/markdown module still imports nothing at all', () => {
    const source = readFileSync('src/content/markdown.ts', 'utf8');
    const importLines = source.split('\n').filter((line) => /^\s*(?:import|export\s*\*)\b/.test(line));
    expect(importLines).toEqual([]);
  });

  // The direct-JSON-import fix must not overreach into flagging the four
  // safe modules' OWN JSON-free submodule imports were they ever split up
  // further, e.g. a hypothetical 'validate/rules'.
  it('does not match a further subpath of a safe module', () => {
    expect(importsContentSnapshot(`import { x } from '../content/validate/rules';`, AT_DEPTH_1)).toBe(false);
    expect(importsContentSnapshot(`import type { Y } from '../content/types/leaf';`, AT_DEPTH_1)).toBe(false);
  });

  // A real file that merely starts with the same letters as a safe module
  // name must still be flagged -- the exclusion is for the four exact safe
  // modules, not a bare prefix match.
  it('still matches a lookalike name that only shares a prefix with a safe module', () => {
    expect(importsContentSnapshot(`import { x } from '../content/typesomething.json';`, AT_DEPTH_1)).toBe(true);
    expect(importsContentSnapshot(`import { x } from '../content/publishers.json';`, AT_DEPTH_1)).toBe(true);
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
