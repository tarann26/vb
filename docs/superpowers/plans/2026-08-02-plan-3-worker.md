# Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cloudflare Worker that lets the restaurant owner publish content — verifying a password, validating her edit before it becomes a commit, committing to GitHub, accepting a photo, rebuilding on a schedule, and counting WhatsApp taps.

**Architecture:** One Worker, no database, no state between requests. A shared password hashed into a secret; login returns an HMAC-signed token in an httpOnly cookie. Every write validates against the *same guard functions the site imports*, extracted in Task 1 so there is exactly one copy. Commits go through GitHub's Git Data API so one Publish is one commit. Photos are committed to `assets-source/` untouched — the build processes them, per D4.

**Tech Stack:** Cloudflare Workers (module syntax, WebCrypto), Wrangler, TypeScript strict, Vitest with `@cloudflare/vitest-pool-workers`, GitHub Git Data API.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase. It produced two false "typecheck clean" reports during Plan 2.
- **A test must be invariant under any legitimate content edit, and must still fail under a code regression.** `test:deploy` is `vitest run`, and the deploy command is `npm run images && npm run test:deploy && npm run build`, so the suite gates every publish. A test that breaks when the owner edits content means her change never reaches the site and she gets a Vitest log she cannot act on. Eleven such tests were found and six fixed at the end of Plan 2.
- **A test that cannot fail is a defect, not coverage.** Eight were caught during Plan 2. Suite-level pass/fail cannot distinguish "this assertion caught it" from "something else caught it" — when you claim an assertion covers something, break that specific thing and confirm that assertion fires.
- **No secrets in the repository.** No password, no token, no account id in any committed file. Secrets are Wrangler secrets; `wrangler.toml` carries only non-secret bindings. A test asserts no committed file matches the token patterns.
- **The public bundle must not grow.** Admin code and the Worker never ship to visitors. The rendered homepage stays byte-identical at **53473 bytes** (`container.innerHTML` of `<AppRoutes>` at `/` under `MemoryRouter`, measured with `TextEncoder` — JS `.length` reads 53454 and is not the invariant).
- **No `as` casts that assert a narrower type onto an unchecked value.** Two benign `Object.keys`-style casts exist at `src/content/index.ts:116,122`; do not copy the pattern without the same bidirectional `Record<K, true>` check behind it.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## What Plan 2 handed to this plan

Three things the final review established, all load-bearing here:

1. **`npm run test:deploy` is the only net, not the second one.** Four of the five content guards produce a *successful* `npm run build` and a deployable `dist/` that white-pages: a disabled hero, a blank copy heading, a typo'd nav `section` id, an invalid day code. `vite build` bundles `src/content/index.ts` without executing it, so `assertCopy`, `assertSections`, `narrowSectionId` and `assertHours` never run at build time. `main.tsx` evaluates the import graph before `createRoot`, so `ErrorBoundary` cannot catch them. **Any path that reaches `npm run build` without `test:deploy` turns a malformed commit into a successful deploy of a white page** — which is exactly what a naive cron trigger would do. Task 6 addresses this directly.
2. **Three content rules currently live in the test suite and must move here.** `Drinks.test.tsx:21-36` (a retired drink must not reappear), `press.test.tsx:14-17` (articles stay in date order), `OurStory.test.tsx:9-11` (no trailing ellipsis in a story paragraph). They break on legitimate edits, so they cannot stay in a gate that runs after the commit. They belong in the Worker's validator, which refuses with a sentence she can read. Task 2 moves them.
3. **`.gitignore` lists seven `/public/` category paths explicitly.** A new asset category created through the upload UI would not be auto-ignored, and a later `git add -A` would commit generated derivatives. Task 5 fixes this.

## File structure

| File | Responsibility |
|---|---|
| `src/content/guards.ts` | Every pure guard function. Imports no JSON, so both the site and the Worker can use it. |
| `src/content/index.ts` | Unchanged role: imports the JSON, calls the guards, exports typed content. |
| `src/content/validate.ts` | Content rules that are advisory for the site but blocking for a write (sort order, retired names, prose style). |
| `worker/index.ts` | Route table and the `fetch`/`scheduled` handlers. Nothing else. |
| `worker/auth.ts` | Password verification, token signing and verification, cookie parsing. |
| `worker/github.ts` | Git Data API client: blob, tree, commit, ref. |
| `worker/upload.ts` | Format detection by content, size limit, path construction. |
| `worker/ratelimit.ts` | Login attempt limiting. |
| `src/admin/heic.ts` | HEIC→JPEG conversion, dynamically imported so its WASM never enters the public bundle. |
| `plugins/build-info.ts` | Writes `dist/build-info.json` with the commit SHA at build time. |
| `wrangler.toml` | Bindings, cron schedule. No secrets. |

---

### Task 1: Extract the guards so the Worker and the site share one copy

**Files:**
- Create: `src/content/guards.ts`, `src/content/__tests__/guards.test.ts`
- Modify: `src/content/index.ts`
- Test: existing `src/content/__tests__/wiring.test.ts` must still pass unchanged

**Interfaces:**
- Produces: every existing guard, re-exported from `src/content/guards.ts` with identical signatures — `assertCopy(raw: unknown): Copy`, `assertSections(raw: unknown): Section[]`, `assertHours(raw: unknown): Hours`, `isSectionId(v: unknown): v is SectionId`, `narrowSectionId(section: string, path: string): SectionId`, `isPublished(item, today)`, and the drinks-category check as a named exported function.
- Consumes: nothing new.

The Worker cannot import `src/content/index.ts`: that module imports ten JSON files and runs every guard against them at import time. A Worker validating *her* proposed JSON must not first validate *the repo's* JSON. Splitting the pure functions out is the whole task.

- [ ] **Step 1: Write the failing test**

`src/content/__tests__/guards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('guards module is importable without content', () => {
  it('imports no JSON, so a Worker can use it', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../guards.ts', import.meta.url), 'utf8'));
    expect(source).not.toMatch(/from ['"]\.\/[a-z]+\.json['"]/);
  });

  it('exports assertCopy, which still throws on a blank string', async () => {
    const { assertCopy } = await import('../guards');
    expect(() => assertCopy({ nav: { wordmark: '' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/content/__tests__/guards.test.ts`
Expected: FAIL, `Cannot find module '../guards'`.

- [ ] **Step 3: Move, do not rewrite**

Cut every guard function out of `index.ts` into `guards.ts` **byte-identical**, including its comments. Add `import { ... } from './guards'` to `index.ts`. The only change to any function body is nothing at all.

Re-export from `index.ts` so existing importers keep working:

```ts
export { assertCopy, assertSections, assertHours, isSectionId, narrowSectionId } from './guards';
```

- [ ] **Step 4: Prove nothing moved semantically**

The suite must be green with **no test file edited**. `wiring.test.ts`'s four guard-invocation tests are the ones that matter — they mock the JSON modules and assert `await import('../index')` rejects. If any needs changing, you have changed behaviour, not location. Stop and report that instead.

Confirm the homepage is still 53473 bytes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(content): split the pure guards out of the module that imports content"
```

---

### Task 2: Validation that refuses before committing

**Files:**
- Create: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`
- Modify: `src/components/__tests__/Drinks.test.tsx`, `src/components/__tests__/press.test.tsx`, `src/components/__tests__/OurStory.test.tsx`
- Test: `src/content/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `validateContent(file: string, data: unknown): ValidationProblem[]` where `ValidationProblem = { field: string; message: string }`. Returns `[]` when the content is acceptable. **Never throws** — the caller turns problems into a 422 response.
- Consumes: `src/content/guards.ts` from Task 1.

Two kinds of rule live here. **Structural** rules are the existing guards: they throw, so wrap each in `try/catch` and convert the message. **Editorial** rules are the three currently sitting in the test suite; they must produce a sentence the owner can act on.

The distinction that matters: a guard failing means the site would break. An editorial rule failing means the content is wrong in a way only a human would notice. Both block a write; only the first would white-page the site.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { validateContent } from '../validate';

describe('validateContent', () => {
  it('accepts content that is fine', () => {
    expect(validateContent('story.json', { heading: 'Our Story', paragraphs: ['A sentence.'] })).toEqual([]);
  });

  it('names the field when a required value is blank', () => {
    const problems = validateContent('dishes.json', [{ id: 'x', name: '', description: 'd', image: '/food/a.webp' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('[0].name');
    expect(problems[0].message).toMatch(/name/i);
  });

  it('refuses a story paragraph that trails off', () => {
    const problems = validateContent('story.json', { heading: 'H', paragraphs: ['It began…'] });
    expect(problems[0].message).toMatch(/ellipsis|trails off/i);
  });

  it('refuses press articles out of date order', () => {
    const problems = validateContent('press.json', [
      { id: 'a', title: 'A', date: '2024-01-01', outlet: 'O', url: null },
      { id: 'b', title: 'B', date: '2025-01-01', outlet: 'O', url: null },
    ]);
    expect(problems[0].message).toMatch(/newest first|order/i);
  });

  it('refuses a retired drink returning by name', () => {
    const problems = validateContent('drinks.json', [
      { id: 'bicerin', name: 'Bicerin', category: 'cocktail', image: null },
    ]);
    expect(problems[0].message).toMatch(/retired/i);
  });

  it('returns every problem, not just the first', () => {
    const problems = validateContent('dishes.json', [
      { id: '', name: '', description: '', image: '/food/a.webp' },
    ]);
    expect(problems.length).toBeGreaterThan(1);
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of [null, 42, 'string', [], {}, [{}]]) {
      expect(() => validateContent('dishes.json', junk)).not.toThrow();
    }
  });
});
```

The last test is the important one. This function's callers are HTTP handlers; a throw becomes a 500 and she sees "something went wrong" instead of "this dish needs a name".

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/content/__tests__/validate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Structural rules wrap the Task 1 guards:

```ts
function fromGuard(run: () => unknown): ValidationProblem[] {
  try { run(); return []; }
  catch (error) { return [{ field: '', message: error instanceof Error ? error.message : String(error) }]; }
}
```

Editorial rules are new code. Take the retired-drink list and the ellipsis rule **verbatim from the tests you are about to change** — do not invent a new list.

- [ ] **Step 4: Move the three rules out of the suite**

Delete the now-duplicated blocks from `Drinks.test.tsx:21-36`, `press.test.tsx:14-17`, `OurStory.test.tsx:9-11`, replacing each with a one-line comment naming `src/content/validate.ts` as the new home.

This is the step that stops the deploy gate from rejecting the owner's legitimate edits. Confirm it worked: append a new newest article to `press.json`, run the suite, confirm green; restore and confirm `git diff --exit-code src/content` is clean.

- [ ] **Step 5: Prove the rules still bite**

For each of the three moved rules, feed `validateContent` the exact content the old test rejected and confirm a problem comes back naming it. A rule that moved but stopped working is worse than one that never moved.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(content): add a validator that refuses a bad write before it becomes a commit"
```

---

### Task 3: The Worker, its scaffold, and authentication

**Files:**
- Create: `worker/index.ts`, `worker/auth.ts`, `worker/ratelimit.ts`, `worker/__tests__/auth.test.ts`, `wrangler.toml`
- Modify: `package.json`, `tsconfig.node.json`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Produces: `verifyPassword(supplied: string, stored: string): Promise<boolean>`; `signToken(secret: string, expiresAt: number): Promise<string>`; `verifyToken(secret: string, token: string, now: number): Promise<boolean>`; `parseCookie(header: string | null, name: string): string | null`.
- Consumes: nothing from earlier tasks.

**`tsconfig.node.json` currently has `"include": ["vite.config.ts"]`.** A new `worker/` directory falls outside every project, so it would ship with **zero type checking** while `tsc -b` stayed green. Plan 2 hit this exact trap with `plugins/`. Add `worker` to the include list, then prove it: inject a deliberate type error into `worker/index.ts`, confirm `npx tsc -b --noEmit` fails naming that file, remove it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, parseCookie, verifyPassword } from '../auth';

const SECRET = 'test-secret-not-a-real-one';

describe('token', () => {
  it('accepts a token it just signed', async () => {
    const token = await signToken(SECRET, 2_000_000);
    expect(await verifyToken(SECRET, token, 1_000_000)).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken('other-secret', 2_000_000);
    expect(await verifyToken(SECRET, token, 1_000_000)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const token = await signToken(SECRET, 1_000_000);
    expect(await verifyToken(SECRET, token, 1_000_001)).toBe(false);
  });

  it('rejects a token whose payload was edited to extend it', async () => {
    const token = await signToken(SECRET, 1_000_000);
    const [payload, sig] = token.split('.');
    const tampered = btoa(JSON.stringify({ exp: 9_999_999 })).replace(/=+$/, '') + '.' + sig;
    expect(tampered).not.toBe(token);
    expect(await verifyToken(SECRET, tampered, 1_000_001)).toBe(false);
  });

  it('rejects a token with no signature at all', async () => {
    expect(await verifyToken(SECRET, btoa(JSON.stringify({ exp: 9_999_999 })), 1)).toBe(false);
  });
});

describe('parseCookie', () => {
  it('finds the named cookie among several', () => {
    expect(parseCookie('a=1; vb_session=xyz; b=2', 'vb_session')).toBe('xyz');
  });
  it('does not match a cookie whose name merely ends with the target', () => {
    expect(parseCookie('not_vb_session=xyz', 'vb_session')).toBeNull();
  });
  it('returns null for a missing header', () => {
    expect(parseCookie(null, 'vb_session')).toBeNull();
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashForTest('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('Correct Horse', stored)).toBe(false);
  });
});
```

The tampered-payload test is the one that matters. A token scheme that checks expiry *before* the signature, or that trusts the payload it just parsed, passes every other test here and is trivially forgeable.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run worker/__tests__/auth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement auth**

Use WebCrypto only — Workers have no Node crypto. PBKDF2-SHA256, 100,000 iterations, random 16-byte salt, stored as `pbkdf2$<iterations>$<saltB64>$<hashB64>`.

HMAC-SHA256 for the token, over the exact payload bytes:

```ts
export async function verifyToken(secret: string, token: string, now: number): Promise<boolean> {
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;
  const expected = await hmac(secret, payloadB64);
  if (!timingSafeEqual(expected, sigB64)) return false;   // signature FIRST
  try {
    const { exp } = JSON.parse(atob(payloadB64));
    return typeof exp === 'number' && exp > now;
  } catch { return false; }
}
```

Signature before payload parsing, always. Compare with a constant-time comparison, not `===`.

- [ ] **Step 4: Write the login route and rate limiting**

`POST /api/login` takes `{ password }`, returns 204 with `Set-Cookie: vb_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`.

Rate limit: **5 failed attempts per IP per 15 minutes**, keyed on `CF-Connecting-IP`. Cloudflare offers two mechanisms; pick one and record why in a comment:
- the Workers **rate-limiting binding** (`[[unsafe.bindings]]` / `ratelimit`), no storage needed
- a **KV namespace** with a short TTL

Prefer the binding if it is available on the free plan at implementation time; verify rather than assume, and if it is not, use KV. Either way the *behaviour* is the test's subject, not the mechanism — write the test against a fake so it does not need network.

A successful login clears the counter. **Do not rate-limit by password**, only by IP; and never log the supplied password, hashed or otherwise.

- [ ] **Step 5: Wrangler config with no secrets**

```toml
name = "via-bianca-admin"
main = "worker/index.ts"
compatibility_date = "2026-01-01"
```

Secrets `ADMIN_PASSWORD_HASH`, `TOKEN_SECRET`, `GITHUB_TOKEN` are set with `wrangler secret put` and appear in no file. Add a test in `src/test/` asserting no committed file contains a GitHub token pattern (`ghp_`, `github_pat_`) or a `pbkdf2$` string. Verify it can fail by writing one to a scratch file, running the test, then deleting it.

- [ ] **Step 6: Verify and commit**

Confirm the deliberate-type-error probe from the task preamble. Confirm the public bundle did not grow: homepage still 53473 bytes, and `dist/assets/` contains nothing from `worker/`.

```bash
git add -A
git commit -m "feat(worker): add the admin worker with password login and signed session tokens"
```

---

### Task 4: Committing to GitHub

**Files:**
- Create: `worker/github.ts`, `worker/__tests__/github.test.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Produces: `commitFiles(env, files: { path: string; content: string }[], message: string): Promise<{ sha: string }>`.
- Consumes: `validateContent` from Task 2, `verifyToken` from Task 3.

One Publish is **one commit**, even when she changed four files. That rules out the Contents API, which is one call per file and would leave a half-published state if the third call failed. Use the Git Data API: create a blob per file, build a tree, create a commit, update the ref.

- [ ] **Step 1: Write the failing tests**

Test against a stubbed `fetch`, asserting the call sequence and that failures propagate:

```ts
it('creates one commit for several files', async () => {
  const calls: string[] = [];
  const fetchStub = makeGitHubStub(calls);
  await commitFiles(envWith(fetchStub), [
    { path: 'src/content/dishes.json', content: '[]' },
    { path: 'src/content/drinks.json', content: '[]' },
  ], 'update menu');
  expect(calls.filter((c) => c.includes('/git/blobs'))).toHaveLength(2);
  expect(calls.filter((c) => c.includes('/git/commits'))).toHaveLength(1);
  expect(calls.filter((c) => c.includes('/git/refs/'))).toHaveLength(1);
});

it('does not update the ref when creating the commit fails', async () => {
  const calls: string[] = [];
  const fetchStub = makeGitHubStub(calls, { failOn: '/git/commits' });
  await expect(commitFiles(envWith(fetchStub), [{ path: 'a', content: 'b' }], 'm')).rejects.toThrow();
  expect(calls.some((c) => c.includes('/git/refs/'))).toBe(false);
});

it('refuses to write outside src/content and assets-source', async () => {
  await expect(commitFiles(env, [{ path: '../../.github/workflows/evil.yml', content: 'x' }], 'm'))
    .rejects.toThrow(/path/i);
});
```

The path test is a real control, not a formality. The Worker holds a token that can write anywhere in the repository; the only thing keeping a malformed or hostile request from rewriting the build config is this check. Reject anything that is not exactly `src/content/<name>.json` or `assets-source/<category>/<file>`, and reject any path containing `..` before resolving it.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `commitFiles`**

Base every commit on the ref's current SHA read at the start of the request. If the ref moved in between, GitHub's ref update fails with 422 — surface that as "someone else published while you were editing" rather than a generic error.

- [ ] **Step 4: Wire `POST /api/publish`**

Order matters and is testable: verify token → validate **every** file → commit only if every file passed. A partially valid publish commits nothing.

```ts
const problems = files.flatMap((f) => validateContent(basename(f.path), JSON.parse(f.content)));
if (problems.length) return json(422, { problems });
```

Return `{ sha }` so the dashboard can poll for it in Task 6.

- [ ] **Step 5: Prove the ordering**

Send a publish with one valid and one invalid file; assert the response is 422, lists the problem, and that **no** GitHub call was made. Assert an unauthenticated publish is 401 and also makes no GitHub call.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): publish validated content as a single GitHub commit"
```

---

### Task 5: Photo upload

**Files:**
- Create: `worker/upload.ts`, `worker/__tests__/upload.test.ts`
- Modify: `worker/index.ts`, `scripts/paths.mjs`, `.gitignore`, `scripts/__tests__/` as needed

**Interfaces:**
- Produces: `detectFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'gif' | 'heic' | null`; `uploadPath(category: string, filename: string): string`.
- Consumes: `commitFiles` from Task 4.

Per D4 the Worker commits her original to `assets-source/` and does nothing else to it. Per D5 detection is **by content, not extension** — `assets-source/atmosphere/dining.jpg` is PNG data with a `.jpg` name, found during A2 review, and the pipeline survives only because the library sniffs content.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['png',  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['gif',  [...new TextEncoder().encode('GIF89a')]],
])('detects %s from its magic bytes', (expected, magic) => {
  expect(detectFormat(new Uint8Array([...magic, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(expected);
});

it('detects webp, which needs bytes 8-11 and not just the RIFF header', () => {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  expect(detectFormat(bytes)).toBe('webp');
});

it('does not call a bare RIFF file webp', () => {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  expect(detectFormat(bytes)).toBeNull();
});

it('detects a PNG that lies about being a jpg', () => {
  expect(detectFormat(pngBytes)).toBe('png');   // filename is irrelevant
});

it('returns null for a PDF rather than guessing', () => {
  expect(detectFormat(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
});

it('returns null for an empty file', () => {
  expect(detectFormat(new Uint8Array(0))).toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement detection and the route**

`POST /api/upload` takes multipart form data with `category` and `file`.

- Reject over **25MB** with the actual size in the message, before reading the body into memory.
- Reject an unknown format with a plain-English message naming what was detected.
- Reject `heic` here with "convert before upload" — Task 7 does the conversion in her browser, so a HEIC reaching the Worker is a bug worth surfacing, not something to silently accept.
- `category` must be one of the seven existing `assets-source/` directories. A new category is a developer operation until `.gitignore` can follow it — see Step 5.

- [ ] **Step 4: Widen the pipeline's extension list**

`scripts/paths.mjs:18` is `export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);`. D5 requires JPEG, PNG, WebP, AVIF, TIFF and GIF. Widen it, and add a test that generates a derivative from each newly-supported extension — a widened list with nothing exercising it is a claim, not a capability.

- [ ] **Step 5: Fix the `.gitignore` category trap**

`.gitignore` lists seven `/public/` paths explicitly. A category added later is not ignored, and `git add -A` would commit generated derivatives — the thing Plan 1 removed.

Replace the seven lines with a rule that covers any generated category, keeping `/public/menus/` and the other committed assets tracked. Add a test asserting that for every directory in `assets-source/`, the matching `public/` directory is ignored — driven by `git check-ignore`, so it tests the real rule rather than a copy of it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): accept photo uploads, detecting format by content rather than extension"
```

---

### Task 6: The scheduled rebuild, and knowing whether a publish worked

**Files:**
- Create: `plugins/build-info.ts`, `plugins/__tests__/build-info.test.ts`, `worker/__tests__/scheduled.test.ts`
- Modify: `worker/index.ts`, `wrangler.toml`, `vite.config.ts`, `docs/cloudflare-cutover.md`

**Interfaces:**
- Produces: `dist/build-info.json` containing `{ sha, builtAt }`; a `scheduled` handler on the Worker.
- Consumes: nothing.

**This task carries Plan 2's most important finding.** Four of the five content guards produce a successful `npm run build` and a deployable `dist/` that white-pages, because `vite build` bundles `src/content/index.ts` without executing it. Only `test:deploy` catches them. A cron that triggers a build without the tests would turn a malformed commit into a successful deploy of a blank site — and unlike a publish, nobody is watching when it happens at 04:00.

- [ ] **Step 1: Write the failing test for the build stamp**

```ts
it('writes the commit sha into dist/build-info.json', async () => {
  const plugin = buildInfo({ sha: () => 'abc1234' });
  const emitted = captureEmit(plugin);
  await plugin.generateBundle!.call(emitted.ctx, {}, {});
  expect(JSON.parse(emitted.files['build-info.json']).sha).toBe('abc1234');
});

it('does not run during dev or test', () => {
  expect(buildInfo().apply).toBe('build');
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement the plugin**

Read the SHA from `CF_PAGES_COMMIT_SHA`, falling back to `git rev-parse HEAD`, falling back to `'unknown'`. Never fail the build over a missing SHA — a build that works is worth more than a stamp that is always right.

Add `_headers` coverage so `build-info.json` is served with `Cache-Control: no-store`. A cached stamp tells the dashboard the old build is the new one, which is worse than no stamp.

- [ ] **Step 4: Add the cron trigger**

```toml
[triggers]
crons = ["0 * * * *"]
```

Hourly. D9's granularity is the cron cadence, not midnight — say so in a comment so nobody promises her otherwise.

The `scheduled` handler POSTs to a Cloudflare **Deploy Hook** URL held as a secret. Test the handler against a stubbed fetch: it calls the hook exactly once, and a non-2xx response is surfaced rather than swallowed.

- [ ] **Step 5: Close the test-gate gap, honestly**

The deploy hook triggers whatever build command the Cloudflare Pages dashboard holds. **That command is not in this repository and nothing here can verify it.** `src/test/hosting.test.ts:61` pins the ordering documented in `docs/cloudflare-cutover.md`; the dashboard is free to disagree with the doc.

Do two things, and claim only these:
1. Add a step to `docs/cloudflare-cutover.md` requiring a human to read the dashboard's build command aloud against the documented one, with the reason stated: if `test:deploy` is missing, a bad commit deploys a white page and the cron will do it unattended.
2. Add a test asserting the documented command in the cutover doc contains `test:deploy` **before** `npm run build`, so the doc cannot drift into describing an unsafe order.

Do not add a test that claims to verify the dashboard. It cannot.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(build): stamp the commit sha into the build, and rebuild hourly for scheduled content"
```

---

### Task 7: HEIC conversion, and counting the taps that become revenue

**Files:**
- Create: `src/admin/heic.ts`, `src/admin/__tests__/heic.test.ts`, `worker/__tests__/count.test.ts`
- Modify: `worker/index.ts`, `src/components/Hero.tsx`

**Interfaces:**
- Produces: `convertHeic(file: File): Promise<File>`; `POST /api/wa` returning 204.
- Consumes: `detectFormat` from Task 5.

Every iPhone photo is HEIC by default and the image library's prebuilt binaries cannot read it. Today an iPhone upload would be silently skipped, the derivative would never be created, the guardrail would catch the missing file, and the build would fail — a confusing failure with a very common cause.

- [ ] **Step 1: Write the failing tests**

```ts
it('passes a jpeg through untouched', async () => {
  const file = new File([jpegBytes], 'a.jpg', { type: 'image/jpeg' });
  expect(await convertHeic(file)).toBe(file);      // same object, no work done
});

it('converts a heic file to jpeg', async () => {
  const out = await convertHeic(new File([heicBytes], 'IMG_1234.HEIC'));
  expect(detectFormat(new Uint8Array(await out.arrayBuffer()))).toBe('jpeg');
  expect(out.name).toBe('IMG_1234.jpg');
});

it('loads the wasm only when a heic file actually arrives', async () => {
  const importSpy = vi.fn();
  await convertHeic(new File([jpegBytes], 'a.jpg'), { load: importSpy });
  expect(importSpy).not.toHaveBeenCalled();
});
```

The third is the one that protects visitors: a static import would pull a WASM decoder into the public bundle for people who will never upload anything.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement with a dynamic import**

```ts
if (detectFormat(bytes) !== 'heic') return file;      // check content, not the name
const { default: convert } = await import('heic-to');  // only now
```

Detect by content here too. `IMG_1234.HEIC` renamed to `.jpg` is still HEIC, and a `.heic` extension on a JPEG is not.

- [ ] **Step 4: Add the conversion count**

`POST /api/wa` increments a per-day counter in KV. Store **nothing else** — no IP, no user agent, no timestamp beyond the date. There is no consent banner on this site and none should be needed.

`GET /api/wa` returns the counts, behind the session token.

- [ ] **Step 5: Wire the button without slowing it down**

`Hero.tsx:76` builds the WhatsApp link. Add a fire-and-forget `navigator.sendBeacon('/api/wa')` on click.

Three properties, each with a test that can fail:
- the WhatsApp link still opens when the beacon call throws
- the link still opens when `navigator.sendBeacon` is undefined
- the click handler does not `await` anything

The whole point of `sendBeacon` is that it survives navigation without delaying it. A counter that costs her a customer is worse than no counter.

Confirm the homepage is still **53473 bytes** after this change, or state the new number and why it changed — this is the one task that legitimately touches a rendered component.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(admin): convert heic uploads in the browser and count whatsapp taps server-side"
```

---

## Definition of done

- [ ] `npx vitest run` green; `npx tsc -b --noEmit` clean; `npm run build` exit 0; `npx eslint .` clean. Record the test count.
- [ ] No secret in any committed file, proven by a test that can fail.
- [ ] A tampered token is rejected, proven by a test that edits the payload and keeps the signature.
- [ ] A publish with one invalid file commits nothing and returns the problem naming the field.
- [ ] `commitFiles` refuses a path outside `src/content/` and `assets-source/`.
- [ ] Format detection reads content, not extensions, and returns null rather than guessing.
- [ ] Every `assets-source/` category has its generated `public/` counterpart ignored, proven via `git check-ignore`.
- [ ] The cron handler calls the deploy hook exactly once and surfaces a failure.
- [ ] `docs/cloudflare-cutover.md` requires a human to verify the dashboard's build command, and a test pins the documented order.
- [ ] HEIC's WASM is not in the public bundle, proven by asserting it is not imported unless a HEIC arrives.
- [ ] The WhatsApp link opens even when the beacon fails or is unavailable.
- [ ] The homepage is 53473 bytes, or the change is stated and justified.

## Handed to later plans

- **Plan 4 (Dashboard)** consumes `POST /api/publish`, `POST /api/upload`, and `build-info.json` for publish status. It must also decide who owns `site.seo.*`, `site.name` and `site.tagline`: `src/test/head.test.ts` keeps `index.html` in sync with `site.json`, so either the build derives the head or those fields stay developer-owned and out of her form. And it must make its write path the control point for the non-breaking space in `copy.footer.followLabel` — no test can catch that regression, which was previously ruled Critical.
- **Plan 4** must label the `press.readArticle` field as driving both the homepage teaser and `/blogs`.
- **Plan 5 (Edit mode)** consumes the same publish endpoint.
- **The upload UI must not derive filenames from item names.** `public/` is copied verbatim, so a withheld future-dated item's photo stays fetchable at a guessable URL. Generic names like `idk1.webp` are what makes this harmless today.
