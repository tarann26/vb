import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The obvious way to prove admin code never reaches a visitor's browser is
// to spy on some load callback deep inside it (e.g. heic-to's WASM decoder
// via src/admin/heic.ts, or AdminApp's own module) and assert the spy was
// never called for an ordinary visit. That test cannot fail: whether the
// admin-only import is written as a dynamic import (gated behind
// React.lazy, or behind a content check as in src/admin/heic.ts) or
// hoisted to a static import at the top of a public file, the spy goes
// uncalled either way for a request that never exercises that code path --
// the *code path* that would call it never runs regardless. But only the
// dynamic form keeps that code out of the bundle a visitor actually
// downloads; the static form puts it in every chunk that reaches the
// offending file, unconditionally, whether or not any particular request
// happens to need it. A runtime spy watches what ran; it cannot watch what
// a bundler decided to include. That is an artifact-level fact, not a
// runtime one, so it needs an artifact-level check too --
// src/test/bundle.post-build.test.ts, wired into `npm run build` (via
// `npm run test:bundle`) so it runs for real on every deploy, not only
// when a stale dist/ happens to already be sitting on disk. This file is
// the other half: the *source*-level check, which can run on every commit,
// before any build exists at all.

// git ls-files, not a filesystem walk (readdirSync/glob): only tracked
// files matter here, and this avoids ever descending into node_modules or
// dist, neither of which `git ls-files src` would return anyway. Module
// scope, not nested inside a single describe, since more than one describe
// below uses it.
function gitLsFiles(dir: string): string[] {
  return execFileSync('git', ['ls-files', dir], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

// Matches a from-style import, a bare side-effect-only import (valid ES
// syntax with no from keyword at all, and still a real edge a bundler
// follows), a re-export, and a dynamic import -- anchored on a from/import
// keyword immediately before the quoted specifier, not the admin
// directory's name appearing anywhere inside any quotes in the file: a
// first, unanchored version of this
// regex (matching the substring in any quoted string at all) matched this
// very test file's own name a few lines below -- `it('...imports
// admin/heic', ...)` is prose in quotes, not an import, and quote
// characters are common enough in ordinary comment prose (contractions
// like "doesn't") that an unanchored version isn't reliably scoped to
// actual code. Confirmed by running it and watching this file flag itself
// as an offender.
//
// Widened from the originally-shipped `admin/heic`-only target to `admin/`
// generally (Plan 4 Task 1): the narrower version only ever needed to catch
// heic-to's WASM decoder leaking out of src/admin/heic.ts. Now that
// src/App.tsx legitimately references src/admin/AdminApp (below), a target
// still pinned to `admin/heic` would miss a future static import of, say,
// src/admin/publish.ts from a public component -- exactly the class of
// regression this check exists to catch. ALLOWED, not a second regex or a
// deleted check, is what keeps that widening from also flagging App.tsx's
// own legitimate reference as a false positive.
const IMPORTS_ADMIN = /(?:from|import)\s*\(?\s*['"][^'"]*admin\/[^'"]+['"]/;

// src/App.tsx's lazy route is the ONE legitimate reference: React.lazy's
// dynamic import is what puts admin code in its own chunk. Listed
// explicitly so a SECOND file gaining any admin import -- static or
// dynamic -- fails here.
const ALLOWED = ['src/App.tsx'];

describe('nothing outside src/admin imports admin code', () => {
  it('nothing outside src/admin imports admin code', () => {
    const offenders = gitLsFiles('src')
      .filter((f) => !f.startsWith('src/admin/') && /\.tsx?$/.test(f))
      .filter((f) => IMPORTS_ADMIN.test(readFileSync(f, 'utf8')));

    expect(offenders).toEqual(ALLOWED);
  });

  it('App.tsx references admin code only through React.lazy', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/admin\/AdminApp['"]\)\s*\)/);
    expect(app).not.toMatch(/(?:from|import)\s+['"][^'"]*admin\/[^'"]+['"]/);
  });

  // "does not render admin code at /" was deliberately NOT added as a
  // third test here. At `/`, AppRoutes renders HomePage, which has no
  // password field whether AdminApp is lazy, static, or inlined -- no
  // mutation of the feature would ever turn a test like that red. A
  // render/route test cannot observe a bundler's decision to put a module
  // in its own chunk; the two tests above are what actually do that.
});

// This file's own fixtures below build realistic-looking import statements
// as string values to test IMPORTS_ADMIN against -- and the regex being
// tested is a plain text scanner with no real JS parser behind it, so it
// cannot distinguish a string that merely looks like an import from an
// actual one. Written naively -- the literal admin directory name sitting
// right next to a quoted from/import keyword, in this file's own source --
// those fixtures would make THIS file show up as an offender in the
// describe block above, confirmed directly while writing this file.
// ADMIN_DIR exists to break that: assembled at runtime, it never appears
// as a contiguous match in this file's own source text, the same
// fragment-joining precedent src/test/secrets.test.ts already uses for the
// same reason (see that file's GH_TOKEN_PREFIXES/PBKDF2_MARKER).
const ADMIN_DIR = ['admin', '/'].join('');

describe('IMPORTS_ADMIN catches every import form a bundler follows', () => {
  // Not exhaustive of JS import syntax, but every form this codebase (or a
  // formatter run over it) realistically produces. An earlier draft of
  // this check used `/from ['"].../`, which is strictly weaker than the
  // anchor above -- verified directly, it misses the dynamic import
  // App.tsx's own lazy route uses, `await import(...)`, a from-import with
  // no space before the quote, and the multi-line form Prettier emits once
  // an import line runs long enough to wrap.
  const FORMS: Record<string, string> = {
    'static default import': `import AdminApp from './${ADMIN_DIR}AdminApp';`,
    'static named import': `import { Login } from './${ADMIN_DIR}Login';`,
    'bare side-effect import': `import './${ADMIN_DIR}AdminApp';`,
    'import type': `import type { Session } from './${ADMIN_DIR}session';`,
    'export * from': `export * from './${ADMIN_DIR}session';`,
    'dynamic import()': `const AdminApp = lazy(() => import('./${ADMIN_DIR}AdminApp'));`,
  };

  it.each(Object.entries(FORMS))('matches a %s', (_label, snippet) => {
    expect(IMPORTS_ADMIN.test(snippet)).toBe(true);
  });

  // The three specific forms the weaker `/from ['"].../` draft missed,
  // named individually rather than left as implicit cases of the table
  // above: these are the ones actually worth pinning by name, since a
  // future edit that narrows the regex back down is far more likely to
  // reintroduce exactly one of these gaps than to break a plain static
  // import that every earlier version of this check already caught.
  it('matches await import(...) inside an async function', () => {
    const snippet = `async function load() {\n  const mod = await import('./${ADMIN_DIR}publish');\n}`;
    expect(IMPORTS_ADMIN.test(snippet)).toBe(true);
  });

  it('matches a from-import with no space before the quote', () => {
    const snippet = `import AdminApp from'./${ADMIN_DIR}AdminApp';`;
    expect(IMPORTS_ADMIN.test(snippet)).toBe(true);
  });

  it('matches a prettier-wrapped multi-line import', () => {
    const snippet = `import {\n  AdminApp,\n  Login,\n} from\n  './${ADMIN_DIR}AdminApp';`;
    expect(IMPORTS_ADMIN.test(snippet)).toBe(true);
  });

  it('does not match the admin directory name inside quotes with no from/import keyword before it', () => {
    // The exact shape the original unanchored draft of this regex broke
    // on: a test name, quoted, describing what it checks for -- not an
    // import. Built the same fragment-joined way as FORMS above, for the
    // same self-matching reason.
    const snippet = `it('imports ${ADMIN_DIR}heic', () => {});`;
    expect(IMPORTS_ADMIN.test(snippet)).toBe(false);
  });
});
