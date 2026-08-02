# Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cloudflare Worker that lets the restaurant owner publish content — verifying a password, validating her edit before it becomes a commit, committing to GitHub, accepting a photo, rebuilding when something is due, telling her whether it worked, and counting WhatsApp taps.

**Architecture:** One Worker on a route on the site's own zone, so `/api/*` is same-origin and the session cookie works. No database; KV for two counters. A shared password hashed into a secret; login returns an HMAC-signed token in an httpOnly cookie. Every write validates against the *same guard functions the site imports*, extracted in Task 1 so there is exactly one copy. One Publish is one commit via GitHub's Git Data API. Photos are committed to `assets-source/` untouched — the build processes them, per D4.

**Tech Stack:** Cloudflare Workers (module syntax, WebCrypto), Wrangler, Workers KV, TypeScript strict, Vitest, GitHub Git Data API, `heic-to` (WASM, admin bundle only).

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live. (This binds *your* git. The Worker's own runtime target branch is a separate decision — see Task 5.)
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase. It produced two false "typecheck clean" reports during Plan 2.
- **A test must be invariant under any legitimate content edit, and must still fail under a code regression.** `test:deploy` is `vitest run` and the deploy command is `npm run images && npm run test:deploy && npm run build`, so the suite gates every publish. Eleven content-coupled tests were found at the end of Plan 2; six were fixed and three are moved by Task 2 of this plan.
- **A test that cannot fail is a defect, not coverage.** Eight were caught during Plan 2, and this plan's own first draft specified four more. Trace every assertion you write: given the implementation, would it pass if the feature were absent? Break the specific thing and confirm *that* assertion fires — suite-level pass/fail cannot distinguish "this caught it" from "something else caught it".
- **No secrets in the repository.** Secrets are Wrangler secrets; `wrangler.toml` carries only non-secret bindings and vars.
- **The public bundle must not grow.** Worker code and admin code never ship to visitors. The rendered homepage stays byte-identical at **53473 bytes** — the measurement harness is built in Task 3 Step 5, and every later task runs it.
- **No `as` casts that assert a narrower type onto an unchecked value.** Two benign `Object.keys`-style casts exist at `src/content/index.ts:116,122`; do not copy the pattern without the same bidirectional `Record<K, true>` check behind it.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## Platform limits this plan is built around

Verified during plan review. Every one of these shaped a decision below; do not "simplify" past them.

| Limit | Value | What it forces |
|---|---|---|
| Cloudflare Pages Free builds | **500/month, 1 concurrent** | The cron must be conditional (Task 8). An unconditional hourly hook is 720–744 builds and exhausts the quota around day 21, after which nothing deploys and nobody is told. |
| Workers Free CPU | **10 ms per invocation** | PBKDF2 iterations must be measured, not assumed (Task 4). |
| workerd PBKDF2 ceiling | **100,000 iterations** | 100k is the hard cap, not a safe default. |
| KV Free writes | **1,000/day**, max 1/sec to the same key | `/api/wa` must be capped and origin-checked (Task 10), or it is a one-line denial of service that also disables login rate limiting. |
| KV `expirationTtl` minimum | **60 s** | 900 s login window is fine. |
| Workers subrequests | **50 per invocation** | A publish is N+5. Fine today; commented so a future bulk publish does not hit it silently. |
| Rate Limiting binding | `period` must be **10 or 60** seconds, per-location, no reset API | Cannot express a 15-minute window or "clear on success". Use KV (Task 4). |
| Deploy hook response | Carries **no deployment id** | Build status must be read from the Pages deployments API, not from the hook (Task 8). |

## What Plan 2 handed to this plan

1. **`npm run test:deploy` is the only net, not the second one.** Four of the five content guards produce a *successful* `npm run build` and a deployable `dist/` that white-pages: a disabled hero, a blank copy heading, a typo'd nav `section` id, an invalid day code. `vite build` bundles `src/content/index.ts` without executing it, so `assertCopy`, `assertSections`, `narrowSectionId` and `assertHours` never run at build time, and `main.tsx` evaluates the import graph before `createRoot`, so `ErrorBoundary` cannot catch them. Two consequences: the Worker must validate *before* committing (Task 2), and the cron must not trigger a build that skips the tests (Task 8).
2. **Three content rules must move out of the suite.** `Drinks.test.tsx:35-51` (a retired drink must not reappear — the block is `describes only drinks that exist`), `press.test.tsx:14-17` (articles stay in date order), `OurStory.test.tsx:7-12` (no trailing ellipsis). They break on legitimate edits, so they cannot stay in a gate that runs after the commit. Task 2 moves them.
3. **`.gitignore` lists eight `/public/` lines explicitly** (seven directories plus `og-image.jpg`). A category added later is not ignored, and `git add -A` would commit generated derivatives. Task 6 fixes this.

## File structure

| File | Responsibility |
|---|---|
| `src/content/guards.ts` | Every pure guard. Imports no JSON, so both the site and the Worker can use it. |
| `src/content/index.ts` | Unchanged role: imports the JSON, calls the guards, exports typed content. |
| `src/content/validate.ts` | Default-deny validation for a proposed write. Never throws. |
| `src/shared/image-format.ts` | `detectFormat` — imported by both the Worker and the admin bundle, so neither drags the other in. |
| `worker/index.ts` | Route table, `fetch` and `scheduled` handlers. Nothing else. |
| `worker/auth.ts`, `worker/ratelimit.ts`, `worker/github.ts`, `worker/upload.ts`, `worker/status.ts` | One concern each. |
| `src/admin/heic.ts` | HEIC→JPEG, dynamically imported so its WASM never enters the public bundle. |
| `plugins/build-info.ts` | Writes `dist/build-info.json` at build time. |
| `scripts/hash-password.mjs` | Generates the value that goes into the `ADMIN_PASSWORD_HASH` secret. |
| `tsconfig.worker.json` | Fourth project. `worker/` needs Workers globals, which conflict with the Node globals `plugins/` relies on. |
| `wrangler.toml` | Route, KV binding, vars, cron. No secrets. |

---

### Task 1: Extract the guards so the Worker and the site share one copy

**Files:**
- Create: `src/content/guards.ts`, `src/content/__tests__/guards.test.ts`
- Modify: `src/content/index.ts`
- Test: `src/content/__tests__/wiring.test.ts` must pass **unchanged**

**Interfaces:**
- Produces, with signatures exactly as they exist today — this block was wrong in the first draft, so read the source before trusting it:
  - `assertCopy(raw: unknown): Copy`
  - `assertSections(raw: unknown): Section[]`
  - `assertHours(raw: { days: string[]; opens: string; closes: string }): Hours` — **not** `unknown`. Widening it would erase a real compile-time check; that is a rewrite, not a move.
  - `isSectionId(v: unknown): v is SectionId` and `narrowSectionId(section: string, path: string): SectionId` — both **module-private today**. Exporting them is a deliberate new public surface.
  - `assertDrinkCategory(raw: unknown, index: number): DrinkCategory` — **this does not exist yet.** The check is an inline arrow inside `drinks.map(...)` at `src/content/index.ts:75-81`. Extracting it into a named function is the one genuine rewrite in this task; do it, and say so.
- **Not moved:** `isPublished` lives in `src/content/publish.ts` and stays there. `plugins/filter-unpublished.ts` and `publish.test.ts` import it from that path.

The Worker cannot import `src/content/index.ts`: that module imports ten JSON files and runs every guard against them at import time. A Worker validating *her* proposed JSON must not first validate *the repo's*.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('guards module', () => {
  it('imports no JSON, so a Worker can use it', () => {
    const source = readFileSync(new URL('../guards.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/[a-z-]+\.json['"]/);
  });

  it('accepts a valid copy fixture and rejects a blank string in it', async () => {
    const { assertCopy } = await import('../guards');
    const valid = {
      nav: { wordmark: 'Via Bianca', links: [{ section: 'hero', label: 'Home', href: '#a' }] },
      /* every other required Copy section — read src/content/types.ts and fill these in */
    };
    expect(() => assertCopy(valid)).not.toThrow();
    expect(() => assertCopy({ ...valid, nav: { ...valid.nav, wordmark: '   ' } }))
      .toThrow(/nav\.wordmark/);
  });
});
```

**Both halves are required and the first is why.** The obvious version of this test — `assertCopy({ nav: { wordmark: '' } })` — passes for the wrong reason: `assertCopy` bails on the missing `nav.links` before `assertNonBlank` ever runs, throwing `"nav.links" must not be empty`. Delete `assertNonBlank` entirely and that version still passes. Asserting the valid fixture does **not** throw is what proves your fixture actually reaches the blank-string branch.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/content/__tests__/guards.test.ts`
Expected: FAIL, `Cannot find module '../guards'`.

- [ ] **Step 3: Move, don't rewrite — except where the Interfaces block says otherwise**

Cut each guard into `guards.ts` byte-identical, comments included. Extract `assertDrinkCategory` from the inline arrow. Re-export from `index.ts` so existing importers keep working.

- [ ] **Step 4: Prove nothing moved semantically**

The suite must be green with **no test file edited**. `wiring.test.ts`'s four guard-invocation tests are the check: they mock the JSON modules and assert `await import('../index')` rejects. If any needs changing, you have changed behaviour, not location — stop and report that instead of editing it.

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

**Interfaces:**
- Produces: `type ValidationProblem = { field: string; message: string }` (declared in `validate.ts`) and `validateContent(file: string, data: unknown): ValidationProblem[]`. Returns `[]` only when the content is acceptable. **Never throws.**
- Consumes: `src/content/guards.ts` from Task 1.

**Default-deny.** A file with no rule returns a problem, not `[]`. `copy.json` and `sections.json` are two of the four guards Plan 2 proved produce a successful build and a deployable white page; a validator that waves through anything it does not recognise defeats its own purpose.

- [ ] **Step 1: Write the failing tests**

Read `src/content/types.ts` first and build fixtures that satisfy the real types — `Dish` requires `tags`, `Drink` requires `description`, `Article` has `publication`/`excerpt`/`image` and has no `outlet`. A fixture missing required fields produces extra structural problems and makes every count assertion wrong.

```ts
it('rejects a file it has no rule for, rather than committing it unvalidated', () => {
  expect(validateContent('unknown.json', {})).not.toEqual([]);
});

it('accepts content that is fine', () => {
  expect(validateContent('story.json', validStory)).toEqual([]);
});

it('names the field when a required value is blank', () => {
  const problems = validateContent('dishes.json', [{ ...validDish, name: '' }]);
  expect(problems.map((p) => p.message).join(' ')).toMatch(/name/i);
});

it('refuses a story paragraph that trails off', () => {
  const problems = validateContent('story.json', { ...validStory, paragraphs: ['It began…'] });
  expect(problems.map((p) => p.message).join(' ')).toMatch(/ellipsis|trails off/i);
});

it('refuses press articles out of date order', () => {
  const problems = validateContent('press.json', [olderArticle, newerArticle]);
  expect(problems.map((p) => p.message).join(' ')).toMatch(/newest first|order/i);
});

it('refuses a retired drink returning by name', () => {
  const problems = validateContent('drinks.json', [{ ...validDrink, name: 'Bicerin' }]);
  expect(problems.map((p) => p.message).join(' ')).toMatch(/retired/i);
});

it('refuses a retired drink named only in the intro prose', () => {
  const problems = validateContent('copy.json', { ...validCopy, drinks: { ...validCopy.drinks, intro: 'Try our basil-lime spritz.' } });
  expect(problems.map((p) => p.message).join(' ')).toMatch(/basil-lime spritz/i);
});

it('never throws, whatever it is handed', () => {
  for (const junk of [null, 42, 'string', [], {}, [{}], '{'] as unknown[]) {
    expect(() => validateContent('dishes.json', junk)).not.toThrow();
  }
});
```

Assert over the joined messages, not `problems[0]` — nothing promises ordering, and a structural problem may legitimately come first.

The `copy.json` case is not padding. The existing rule at `Drinks.test.tsx:35-50` checks the **rendered DOM** for seven strings, and three of them — `basil-lime spritz`, `rosemary-grapefruit fizz`, `espresso-orange tonic` — were never drink names. They were prose in the old intro copy, which now lives in `copy.drinks.intro`. A `drinks.json` rule alone lets those three walk back in.

The "never throws" test is the contract: this function's callers are HTTP handlers, and a throw becomes a 500 reading "something went wrong" instead of "this dish needs a name".

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

```ts
const RULES: Record<string, (data: unknown) => ValidationProblem[]> = {
  'copy.json': …, 'sections.json': …, 'dishes.json': …, 'drinks.json': …,
  'press.json': …, 'story.json': …, 'site.json': …, 'galleries.json': …, 'menus.json': …,
};

export function validateContent(file: string, data: unknown): ValidationProblem[] {
  const rule = RULES[file];
  if (!rule) return [{ field: '', message: `This file cannot be edited here (${file}).` }];
  try { return rule(data); }
  catch (error) { return [{ field: '', message: error instanceof Error ? error.message : String(error) }]; }
}
```

The outer `try` is what makes "never throws" true even if a rule has a bug. Structural rules wrap the Task 1 guards in the same shape.

- [ ] **Step 4: Move the three rules out of the suite**

Delete the duplicated blocks at `Drinks.test.tsx:35-51`, `press.test.tsx:14-17`, `OurStory.test.tsx:7-12`, each replaced by a one-line comment naming `src/content/validate.ts`.

**Read the surrounding lines before cutting.** `Drinks.test.tsx:21-33` is a *different* test — `shows a heading for every category that currently has a drink` — which Plan 2's final review deliberately rewrote to be content-invariant. Deleting it would undo that fix and leave a broken fragment.

Then prove the move worked: append a new newest article to `press.json`, run the suite, confirm green. Restore and confirm `git diff --exit-code src/content` is clean.

- [ ] **Step 5: Prove the rules still bite**

For each of the three, feed `validateContent` the exact content the old test rejected and confirm a problem names it. A rule that moved but stopped working is worse than one that never moved.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(content): add a validator that refuses a bad write before it becomes a commit"
```

---

### Task 3: Worker scaffold, its own tsconfig project, and same-origin routing

**Files:**
- Create: `worker/index.ts`, `tsconfig.worker.json`, `wrangler.toml`, `src/test/secrets.test.ts`, `src/test/homepage-bytes.test.tsx`
- Modify: `tsconfig.json`, `package.json`, `vitest.config.ts`, `public/_redirects`

**Interfaces:**
- Produces: a Worker exporting `default { fetch }` that returns 404 for every path. Later tasks add routes. `tsconfig.worker.json` as the fourth project reference.

**The routing decision, stated here because everything downstream depends on it.** The Worker lives on a **route on the site's own zone**, so `/api/*` is same-origin.

`public/_redirects` is currently exactly `/*    /index.html   200`. Without a decision, `navigator.sendBeacon('/api/wa')` resolves to the Pages origin, hits that SPA catch-all, gets HTTP 200 with HTML, and `sendBeacon` returns `true` — the counter increments zero times and nothing reports it. That is the `trackEvent` failure the spec itself documents, repeated. Same-origin also means `SameSite=Strict` works and no CORS is needed; a separate `*.workers.dev` origin would silently drop the session cookie on every fetch.

- [ ] **Step 1: Install the tooling**

```bash
npm i -D wrangler @cloudflare/workers-types
```

None of it is currently in `package.json`. Record the versions installed.

- [ ] **Step 2: Add the fourth tsconfig project**

`worker/` cannot live in `tsconfig.node.json`: its `lib` is `["ES2023"]` with no DOM, so `Response`, `Request`, `fetch`, `crypto` and `btoa` are all undeclared — `tsc -b` fails immediately. And `@cloudflare/workers-types` globally redeclares `Request`/`Response`/`fetch`, which conflicts with the `@types/node` globals `vite.config.ts` and `plugins/` rely on in that project.

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2023"], "module": "ESNext", "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true, "noEmit": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "isolatedModules": true, "moduleDetection": "force", "skipLibCheck": true
  },
  "include": ["worker"]
}
```

Add it to the root `tsconfig.json`'s `references`.

**Then prove it is actually checked**, the way Plan 2 proved it for `plugins/`: inject a deliberate type error into `worker/index.ts`, confirm `npx tsc -b --noEmit` fails naming that file, remove it. A directory outside every project type-checks as nothing while `tsc -b` stays green.

- [ ] **Step 3: Wrangler config, no secrets**

```toml
name = "via-bianca-admin"
main = "worker/index.ts"
compatibility_date = "2026-01-01"

# Same-origin: /api/* must be served by the Worker, not by the SPA catch-all in
# public/_redirects. A cross-origin Worker would drop the SameSite=Strict session
# cookie on every fetch and make sendBeacon('/api/wa') a silent no-op.
routes = [{ pattern = "viabiancadelhi.com/api/*", zone_name = "viabiancadelhi.com" }]

[vars]
GITHUB_OWNER = "tarann26"
GITHUB_REPO  = "vb"
GITHUB_BRANCH = "main"   # the branch Cloudflare Pages builds from

[[kv_namespaces]]
binding = "KV"
id = "…"                  # created with `wrangler kv namespace create`
```

Confirm the real domain from `src/content/site.json` rather than copying the placeholder above.

- [ ] **Step 4: Keep `/api/*` out of the SPA catch-all**

Add an exclusion to `public/_redirects` above the catch-all, and a test asserting it stays there. Cloudflare Routes take precedence over Pages for the same hostname, so this is belt-and-braces — but a future edit to `_redirects` is exactly the kind of change that would silently break every API call with a 200.

- [ ] **Step 5: Build the two harnesses this plan keeps asking for**

`src/test/homepage-bytes.test.tsx` — the 53473-byte invariant has been asserted by hand in four reviews and pinned by nothing:

```tsx
it('the public homepage is unchanged', () => {
  const { container } = render(<MemoryRouter><AppRoutes /></MemoryRouter>);
  expect(new TextEncoder().encode(container.innerHTML).length).toBe(53473);
});
```

Measure with `TextEncoder`; JS `.length` reads 53454 because the page contains U+00A0 and `é`, and is not the invariant.

`src/test/secrets.test.ts` — enumerate with `git ls-files` (not a tree walk; `node_modules` is on disk), build the patterns from concatenated fragments so the test does not match itself, and exclude only its own path with a comment saying why. Verify it can fail: write a fake token to a scratch file, `git add` it, run the test, confirm red, remove it.

- [ ] **Step 6: Wire the Worker into the test run**

`vitest.config.ts` is currently a single jsdom project with no `include`, so `worker/__tests__/*.test.ts` would be picked up and run under jsdom. Decide deliberately: either a Vitest workspace with a separate Node-environment project for `worker/`, or keep jsdom and note which globals are polyfilled. Whichever you pick, write it down — later tasks depend on knowing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): scaffold the admin worker with its own typecheck project and same-origin route"
```

---

### Task 4: Password login, session tokens, rate limiting

**Files:**
- Create: `worker/auth.ts`, `worker/ratelimit.ts`, `worker/__tests__/auth.test.ts`, `scripts/hash-password.mjs`
- Modify: `worker/index.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`; `verifyPassword(supplied: string, stored: string): Promise<boolean>`; `signToken(secret: string, expiresAt: number): Promise<string>`; `verifyToken(secret: string, token: string, now: number): Promise<boolean>`; `parseCookie(header: string | null, name: string): string | null`; `checkLoginRate(kv: KVNamespace, ip: string): Promise<boolean>`; `recordLoginFailure`, `clearLoginFailures`.

- [ ] **Step 1: Write the failing tests**

```ts
const SECRET = 'test-secret-not-a-real-one';

it('accepts a token it just signed', async () => {
  expect(await verifyToken(SECRET, await signToken(SECRET, 2_000_000), 1_000_000)).toBe(true);
});

it('rejects a token signed with a different secret', async () => {
  expect(await verifyToken(SECRET, await signToken('other', 2_000_000), 1_000_000)).toBe(false);
});

it('rejects an expired token', async () => {
  expect(await verifyToken(SECRET, await signToken(SECRET, 1_000_000), 1_000_001)).toBe(false);
});

it('rejects a token whose payload was edited to extend it', async () => {
  const token = await signToken(SECRET, 1_000_000);
  const tampered = btoa(JSON.stringify({ exp: 9_999_999 })).replace(/=+$/, '') + '.' + token.split('.')[1];
  expect(tampered).not.toBe(token);
  expect(await verifyToken(SECRET, tampered, 1_000_001)).toBe(false);
});

it('rejects a token with no signature at all', async () => {
  expect(await verifyToken(SECRET, btoa(JSON.stringify({ exp: 9_999_999 })), 1)).toBe(false);
});

it('round-trips a password through the real hash and verify', async () => {
  const stored = await hashPassword('correct horse');
  expect(await verifyPassword('correct horse', stored)).toBe(true);
  expect(await verifyPassword('Correct Horse', stored)).toBe(false);
});

it('produces a different hash each time, so the salt is real', async () => {
  expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
});

it('finds the named cookie among several', () => {
  expect(parseCookie('a=1; vb_session=xyz; b=2', 'vb_session')).toBe('xyz');
});
it('does not match a cookie whose name merely ends with the target', () => {
  expect(parseCookie('not_vb_session=xyz', 'vb_session')).toBeNull();
});
it('returns null for a missing header', () => {
  expect(parseCookie(null, 'vb_session')).toBeNull();
});
```

The tampered-payload test is the one that matters. A scheme that checks expiry before the signature, or trusts the payload it just parsed, passes every other test here and is trivially forgeable.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement, signature first**

```ts
export async function verifyToken(secret: string, token: string, now: number): Promise<boolean> {
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;
  if (!timingSafeEqual(await hmac(secret, payloadB64), sigB64)) return false;  // signature FIRST
  try {
    const { exp } = JSON.parse(atob(payloadB64));
    return typeof exp === 'number' && exp > now;
  } catch { return false; }
}
```

Write `timingSafeEqual` by hand as an XOR accumulator over equal-length strings. **Do not use `crypto.subtle.timingSafeEqual`** — it is a Cloudflare-only extension and is `undefined` in this repo's jsdom test environment, so the suite would crash.

Hash format `pbkdf2$<iterations>$<saltB64>$<hashB64>`, PBKDF2-SHA256, random 16-byte salt.

- [ ] **Step 4: Measure the iteration count instead of guessing**

Workers Free allows **10 ms CPU per invocation** and workerd rejects PBKDF2 above **100,000 iterations** — so 100k is the ceiling, not a safe default. A rough native measurement puts 100k SHA-256 iterations near 12 ms, which would return Error 1102 on every login.

Deploy a throwaway Worker, time `deriveBits` at 100k / 50k / 25k against the real runtime, and pin the highest value with at least a 3× margin under 10 ms. Record the measured numbers in a comment. Given the spec's own threat model — *"the realistic threat is defacement; the realistic recovery is `git revert`"* — trading iterations for a login that completes is correct, but it must be a measured decision.

- [ ] **Step 5: Rate limit with KV**

The Workers Rate Limiting binding cannot do this: its `period` must be 10 or 60 seconds, it is per-Cloudflare-location, and it has no reset API. Use KV.

```ts
// KV rather than the Rate Limiting binding: that binding's period must be 10 or
// 60 seconds (no 15-minute window), it counts per-location, and there is no way
// to clear a counter when she logs in successfully.
const key = `login:${request.headers.get('CF-Connecting-IP')}`;
const n = Number(await env.KV.get(key)) || 0;
if (n >= 5) return json(429, { message: 'Too many attempts. Try again in 15 minutes.' });
// on failure:  await env.KV.put(key, String(n + 1), { expirationTtl: 900 });
// on success:  await env.KV.delete(key);
```

Limit by IP only, never by password. Never log the supplied password in any form. Test against a fake KV so no network is involved.

- [ ] **Step 6: The login route and the hashing tool**

`POST /api/login` takes `{ password }` and returns 204 with
`Set-Cookie: vb_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`.

`scripts/hash-password.mjs` prints the stored-hash string using Node's WebCrypto with the same parameters. Without it there is no way to produce the value `ADMIN_PASSWORD_HASH` holds, and the owner's password can never be set. Test the round trip through the real `hashPassword`/`verifyPassword`, not a test-only copy.

Note in the runbook: rotating the password does not invalidate outstanding 7-day sessions unless `TOKEN_SECRET` is rotated too. Rotate both.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): add password login with signed session tokens and rate limiting"
```

---

### Task 5: Committing to GitHub

**Files:**
- Create: `worker/github.ts`, `worker/__tests__/github.test.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Produces: `commitFiles(env, files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[], message: string): Promise<{ sha: string }>`.
- Consumes: `validateContent` (Task 2), `verifyToken` (Task 4).

**`encoding` is not optional.** Task 6 commits photos through this function, and GitHub's blob endpoint takes `{ content, encoding }`. A JPEG passed as a JS string is corrupted.

One Publish is **one commit**, even across four files. That rules out the Contents API — one call per file, and a half-published state if the third fails.

- [ ] **Step 1: Write the failing tests**

Stub `fetch`, recording method, URL **and body** for each call.

```ts
it('creates one commit for several files', async () => {
  await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]'),
                                    utf8('src/content/drinks.json', '[]')], 'update menu');
  expect(stub.calls.filter((c) => c.url.includes('/git/blobs') && c.method === 'POST')).toHaveLength(2);
  expect(stub.calls.filter((c) => c.url.includes('/git/commits') && c.method === 'POST')).toHaveLength(1);
  expect(stub.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
});

it('bases the tree and the commit on the current head, so nothing is deleted', async () => {
  await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]')], 'm');
  expect(stub.bodies.find((b) => b.tree).base_tree).toBe(BASE_TREE_SHA);
  expect(stub.bodies.find((b) => b.parents).parents).toEqual([BASE_COMMIT_SHA]);
});

it('does not update the ref when creating the commit fails', async () => {
  const stub = makeGitHubStub({ failOn: '/git/commits' });
  await expect(commitFiles(envWith(stub), [utf8('a.json', 'b')], 'm')).rejects.toThrow();
  expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false);
});

it('sends a photo as base64, not as a mangled string', async () => {
  await commitFiles(envWith(stub), [{ path: 'assets-source/food/a.jpg', content: 'AAEC', encoding: 'base64' }], 'm');
  expect(stub.bodies.find((b) => b.content)).toMatchObject({ encoding: 'base64', content: 'AAEC' });
});

it.each([
  '../../.github/workflows/evil.yml',
  '.github/workflows/evil.yml',
  'src/content/../../package.json',
  'package.json',
])('refuses to write %s', async (path) => {
  await expect(commitFiles(env, [utf8(path, 'x')], 'm')).rejects.toThrow(/path/i);
});
```

**The `base_tree` test guards the most destructive plausible bug in this plan.** A tree created without `base_tree` contains *only* the listed entries — the commit succeeds, the ref updates, and `HEAD` is now a repository of two JSON files. Counting calls cannot see it; inspecting bodies can.

**The path allowlist is a real control, not a formality.** The Worker holds a token that can write anywhere in this repository, and this check is the only thing between a malformed or hostile request and a rewritten build config. Match the exact shape — `src/content/<name>.json` or `assets-source/<category>/<file>` — and reject any path containing `..` before resolving. Do not relax it to a `..` check alone.

Match URLs on method plus path, not `includes()` on a fragment: `/git/refs/` and `/git/ref/` differ between the read and the write, and a substring filter silently matches the wrong call.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Read the ref's SHA at the start of the request and base everything on it. If the ref moved in between, GitHub's update fails 422 — surface that as "someone else published while you were editing", not a generic error. Target `env.GITHUB_BRANCH` from `wrangler.toml`.

- [ ] **Step 4: Wire `POST /api/publish`**

Order is the deliverable: verify token → parse → validate **every** file → commit only if every file passed.

```ts
const problems = files.flatMap((f) => {
  if (f.encoding !== 'utf-8') return [];
  let parsed: unknown;
  try { parsed = JSON.parse(f.content); }
  catch { return [{ field: f.path, message: 'This file is not valid JSON.' }]; }
  return validateContent(basename(f.path), parsed);
});
if (problems.length) return json(422, { problems });
```

The `try` around `JSON.parse` matters: without it a malformed body throws a 500 one line before the function whose contract is "never throws".

Return `{ sha }` so Task 8 can poll for it.

- [ ] **Step 5: Prove the ordering**

Publish one valid and one invalid file: assert 422, the problem is listed, and **no** GitHub call was made. Assert an unauthenticated publish is 401 and also makes no GitHub call.

Add a comment noting a publish costs N+5 subrequests against the 50-per-invocation limit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): publish validated content as a single GitHub commit"
```

---

### Task 6: Photo upload

**Files:**
- Create: `src/shared/image-format.ts`, `src/shared/__tests__/image-format.test.ts`, `worker/upload.ts`, `worker/__tests__/upload.test.ts`
- Modify: `worker/index.ts`, `scripts/images.mjs`, `.gitignore`, `src/test/` (a new gitignore test)

**Interfaces:**
- Produces: `detectFormat(bytes: Uint8Array): Format | null` where `Format = 'jpeg'|'png'|'webp'|'avif'|'tiff'|'gif'|'heic'`; `uploadPath(category: string, bytes: Uint8Array, format: Format): string`.
- Consumes: `commitFiles` (Task 5).

`detectFormat` lives in `src/shared/` because both the Worker and the admin bundle need it. Putting it in `worker/` would drag Worker code across a tsconfig-project boundary into the client graph.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['png',  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['gif',  [...enc('GIF89a')]],
  ['gif',  [...enc('GIF87a')]],
  ['tiff', [0x49, 0x49, 0x2a, 0x00]],
  ['tiff', [0x4d, 0x4d, 0x00, 0x2a]],
])('detects %s', (expected, magic) => {
  expect(detectFormat(pad(magic))).toBe(expected);
});

it('detects webp from RIFF at 0 and WEBP at 8', () => {
  expect(detectFormat(riff('WEBP'))).toBe('webp');
});
it('does not call a wav file webp', () => {
  expect(detectFormat(riff('WAVE'))).toBeNull();
});

// HEIC and AVIF share an ISO-BMFF container and differ only by brand at bytes 8-11.
it('distinguishes heic from avif by brand, not by container', () => {
  expect(detectFormat(isobmff('heic'))).toBe('heic');
  expect(detectFormat(isobmff('mif1'))).toBe('heic');   // iPhone also emits this
  expect(detectFormat(isobmff('avif'))).toBe('avif');
});

it('returns null for a PDF rather than guessing', () => {
  expect(detectFormat(enc('%PDF-1.7'))).toBeNull();
});
it('returns null for an empty file', () => {
  expect(detectFormat(new Uint8Array(0))).toBeNull();
});
it('returns null for a truncated header', () => {
  expect(detectFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
});
```

HEIC detection is the single thing the entire iPhone story rests on — Step 3 rejects HEIC by name and Task 9 branches on it — and it is the hardest case, because HEIC and AVIF are the same container. Do not ship it untested.

Do **not** write a test claiming `detectFormat` ignores a lying filename: it takes only bytes, so no filename exists in the call. That property belongs at the route level, where the multipart filename does exist — test it there.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Content-addressed upload paths**

```ts
// The extension comes from detectFormat, never from the uploaded filename.
// scripts/images.mjs's listSources() filters by extension, so a wrong or missing
// one means the derivative is never generated and the build fails on the missing
// asset. The stem is content-addressed rather than derived from the filename or
// the item name: iPhone filenames collide constantly (IMG_1234.jpg and
// IMG_1234.png both map to public/<cat>/IMG_1234.webp, which makes findCollisions
// fail the whole image build), and public/ is copied verbatim, so a guessable
// name would leak a withheld future-dated item's photo.
export function uploadPath(category: string, bytes: Uint8Array, format: Format): string {
  return `assets-source/${category}/${sha256Hex(bytes).slice(0, 12)}.${EXT[format]}`;
}
```

Test that two different photos never collide, and that the same photo uploaded twice yields the same path (idempotent, not duplicated).

- [ ] **Step 4: The route**

`POST /api/upload`, multipart with `category` and `file`.

- Reject over **25MB** with the actual size, before reading the body into memory.
- Reject an unknown format naming what was detected.
- Reject `heic` with "convert before upload" — Task 9 converts in her browser, so a HEIC arriving here is a bug worth surfacing.
- `category` must be one of the seven existing `assets-source/` directories.
- Commit through `commitFiles` with `encoding: 'base64'`.

- [ ] **Step 5: Widen the pipeline's extension list**

`IMAGE_EXT` is at **`scripts/images.mjs:18`** — not `paths.mjs`, which has none. Note `images.mjs` loads `sharp` at module scope while `paths.mjs` carries a comment forbidding that, because `scripts/__tests__/images.test.mjs` imports from `paths.mjs` specifically to keep `sharp` out of the deploy gate. If you move `IMAGE_EXT` to `paths.mjs` for testability, keep `images.mjs` importing it and say so.

Widen to JPEG, PNG, WebP, AVIF, TIFF, GIF per D5, and add a test generating a derivative from each newly-supported extension. A widened list with nothing exercising it is a claim, not a capability.

- [ ] **Step 6: Fix the `.gitignore` category trap**

Replace the eight explicit `/public/` lines with:

```gitignore
/public/*/
!/public/menus/
/public/og-image.jpg
```

This keeps `menus/` and the loose committed files (`_headers`, `_redirects`, `favicon.svg`, `robots.txt`, `sitemap.xml`) tracked. The tempting `/public/**/*.webp` does **not** work — it leaves the directories themselves unignored.

Add a test driven by `git check-ignore` so it exercises the real rule: for every **directory** in `assets-source/`, the matching `public/` directory is ignored. Filter non-directories — `assets-source/` contains `Menu - Expanded.pdf`. `git check-ignore` exits 1 for "not ignored", which the test must read as a result, not an error.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): accept photo uploads, detecting format by content rather than extension"
```

---

### Task 7: Stamp the build

**Files:**
- Create: `plugins/build-info.ts`, `plugins/__tests__/build-info.test.ts`
- Modify: `vite.config.ts`, `public/_headers`, `src/test/hosting.test.ts`

**Interfaces:**
- Produces: `dist/build-info.json` containing `{ sha, builtAt }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes the commit sha into build-info.json', async () => { … expect(parsed.sha).toBe('abc1234'); });

it('does not run during the test suite or dev', async () => {
  // Behavioural, not `expect(plugin.apply).toBe('build')` — Plan 2 established that
  // reading the config property proves nothing about what actually runs.
  await runViteBuild({ mode: 'development', command: 'serve' });
  expect(existsSync('dist/build-info.json')).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

SHA from `CF_PAGES_COMMIT_SHA`, falling back to `git rev-parse HEAD`, falling back to `'unknown'`. Never fail the build over a missing stamp.

- [ ] **Step 4: Add the header, and fix the test it breaks**

`build-info.json` must be `Cache-Control: no-store`. A cached stamp tells the dashboard the old build is the new one, which is worse than no stamp.

**Adding that block breaks an existing deploy-gating test.** `src/test/hosting.test.ts:31-40` iterates every non-`/assets/` block and asserts `max-age=604800` and `must-revalidate`; the `no-store` block fails both, on every deploy, because `test:deploy` runs before `npm run build`. The filter to change is at line 35:

```ts
const unhashed = blocks.filter((b) => !b.startsWith('/assets/') && !/no-store/.test(b));
```

plus a new assertion that the `/build-info.json` block *is* `no-store`. Note `_headers` lives in `public/` while `build-info.json` is emitted to `dist/` — same served path, different source location.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(build): stamp the commit sha into the build for publish status"
```

---

### Task 8: Telling her whether it worked, and rebuilding only when something is due

**Files:**
- Create: `worker/status.ts`, `worker/__tests__/status.test.ts`, `worker/__tests__/scheduled.test.ts`
- Modify: `worker/index.ts`, `wrangler.toml`, `src/content/publish.ts`, `plugins/filter-unpublished.ts`, `docs/cloudflare-cutover.md`

**Interfaces:**
- Produces: `GET /api/build-status?sha=<sha>` returning `{ state: 'queued'|'building'|'live'|'failed', deploymentUrl, commitUrl }`; a `scheduled` handler.
- Consumes: `todayInKolkata` (moved here from `plugins/filter-unpublished.ts`), `isPublished`.

**This task exists because of the spec's own sentence:** *"Step 5 exists because of step 4. Once a bad edit cannot break the site, the new failure mode is that her work silently evaporates. She must be told."*

`build-info.json` alone cannot tell her. When `test:deploy` fails, no new file is written — the previous build's stamp stays live and the dashboard polls forever showing "publishing…", unable to distinguish *still building* from *build failed* from *hook never fired*. And the spec asks for "a link to the commit."

- [ ] **Step 1: Write the failing tests**

Stub the Cloudflare API. Assert each deployment state maps correctly, that an unknown SHA is `queued` rather than an error, and that the endpoint requires a session token.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

`GET /accounts/{account}/pages/projects/{project}/deployments`, matching on the deployment's commit hash. A deploy hook returns no deployment id, so the hook's response cannot be used. Needs a Pages-scoped API token as a secret. `build-info.json` stays as the cheap "is it live yet" signal; this is the failure signal.

- [ ] **Step 4: Make the cron conditional**

```toml
[triggers]
crons = ["0 * * * *"]
```

Hourly — but a build only when something is actually due:

```ts
// Pages Free allows 500 builds/month; an unconditional hourly hook is 720-744 and
// exhausts the quota around day 21, after which nothing deploys and nobody is told.
// Checking first costs one KV read and gives better granularity than a daily cron.
// Publish granularity is this cadence, not midnight -- do not promise otherwise.
if (!(await anythingPublishesToday(env, todayInKolkata()))) return;
await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
```

`todayInKolkata` currently lives in `plugins/filter-unpublished.ts`, a Vite-plugin module. Move it next to `isPublished` in `src/content/publish.ts` so the Worker can import it without dragging Vite types across the project boundary, and update the plugin to import from there. Its existing fake-timer tests must pass unchanged.

Test the handler against a stubbed fetch: the hook is called exactly once when something is due, **not at all** when nothing is, and a non-2xx is surfaced rather than swallowed.

Also decide and record whether an upload-only commit should trigger a build — each commit is its own build, and a photo upload followed by a publish is two.

- [ ] **Step 5: Close the test-gate gap, honestly**

The deploy hook triggers whatever build command the Cloudflare Pages dashboard holds. **That command is not in this repository and nothing here can verify it.** `src/test/hosting.test.ts:61` pins the ordering documented in `docs/cloudflare-cutover.md`; the dashboard is free to disagree with the doc.

Do exactly two things, and claim only these:
1. Add a step to `docs/cloudflare-cutover.md` requiring a human to read the dashboard's build command against the documented one, stating the reason: if `test:deploy` is missing, a bad commit deploys a white page, and the cron will do it unattended at 04:00.
2. Add a test asserting the documented command contains `test:deploy` **before** `npm run build`, so the doc cannot drift into describing an unsafe order.

**Do not add a test that claims to verify the dashboard.** It cannot, and a test that lies about its own reach is worse than no test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): report build status and rebuild only when scheduled content is due"
```

---

### Task 9: HEIC conversion in her browser

**Files:**
- Create: `src/admin/heic.ts`, `src/admin/__tests__/heic.test.ts`, `src/test/bundle.test.ts`
- Modify: `package.json`, `src/test/setup.ts`

**Interfaces:**
- Produces: `convertHeic(file: File): Promise<File>`.
- Consumes: `detectFormat` from `src/shared/image-format.ts` (Task 6).

Every iPhone photo is HEIC by default and the image library's prebuilt binaries cannot read it. Today an iPhone upload would be silently skipped, the derivative never created, the guardrail would catch the missing file and the build would fail — a confusing failure with a very common cause.

- [ ] **Step 1: Install and polyfill**

```bash
npm i heic-to
```

`heic-to` exports **named** `heicTo` and `isHeic` — not a default — with the signature `heicTo({ blob, type, quality }) => Promise<Blob>`. It is browser/WASM only.

This repo's jsdom (25.0.1) has **no `Blob.prototype.arrayBuffer`, `.text` or `.stream`**, so any implementation reading bytes off a `File` needs a polyfill in `src/test/setup.ts`. Add it and say so.

- [ ] **Step 2: Write the failing tests**

```ts
it('passes a jpeg through untouched', async () => {
  const file = new File([jpegBytes], 'a.jpg', { type: 'image/jpeg' });
  expect(await convertHeic(file)).toBe(file);          // same object, no work done
});

it('converts a heic file to jpeg and renames it', async () => {
  const out = await convertHeic(new File([heicBytes], 'IMG_1234.HEIC'));
  expect(detectFormat(new Uint8Array(await out.arrayBuffer()))).toBe('jpeg');
  expect(out.name).toBe('IMG_1234.jpg');
});

it('detects by content, so a renamed heic is still converted', async () => {
  const out = await convertHeic(new File([heicBytes], 'holiday.jpg'));
  expect(detectFormat(new Uint8Array(await out.arrayBuffer()))).toBe('jpeg');
});
```

`heicTo` returns a `Blob`, which has no `.name` — wrap it in `new File([blob], newName)`.

- [ ] **Step 3: Prove the WASM never reaches visitors — at the artifact, not at runtime**

The obvious test (spy on a `load` callback, assert it was not called for a JPEG) **cannot fail**: a static `import` at the top of the file leaves the spy uncalled too, while putting the decoder in the public bundle. No runtime spy can observe a bundler property. Task 9's sibling task modifies `Hero.tsx`, which *is* in the public bundle, so this is not hypothetical.

```ts
it('nothing outside src/admin imports the heic module', () => {
  const offenders = gitLsFiles('src')
    .filter((f) => !f.startsWith('src/admin/') && /\.tsx?$/.test(f))
    .filter((f) => /from ['"].*admin\/heic['"]/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
```

Plus a post-`npm run build` grep of `dist/assets/` for a libheif marker. Verify both can fail: add a static import to a public component, confirm red, remove it.

- [ ] **Step 4: Implement with a dynamic import**

```ts
if (detectFormat(bytes) !== 'heic') return file;      // content, not the filename
const { heicTo } = await import('heic-to');           // only now
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): convert heic uploads to jpeg in the browser"
```

---

### Task 10: Counting the taps that become revenue

**Files:**
- Create: `worker/__tests__/count.test.ts`
- Modify: `worker/index.ts`, `src/components/Hero.tsx`

**Interfaces:**
- Produces: `POST /api/wa` returning 204; `GET /api/wa` returning counts behind the session token.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a post from another origin', async () => {
  expect((await handle(post('/api/wa', { origin: 'https://evil.example' }))).status).toBe(403);
});

it('rate-limits by ip like login does', async () => { … });

it('stops writing once the daily cap is reached', async () => {
  // KV Free is 1,000 writes/day and 1 write/sec to the same key. Without a cap,
  // `while true; do curl -X POST .../api/wa; done` both inflates the number she
  // makes decisions on and exhausts the day's writes -- which, since login rate
  // limiting is also KV-backed, disables that too.
});

it('requires a session token to read the counts', async () => {
  expect((await handle(get('/api/wa'))).status).toBe(401);
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Per-day counter in KV. Store **nothing else** — no IP, no user agent, no timestamp beyond the date. There is no consent banner on this site and none should be needed. Require an `Origin` matching the site, rate-limit by IP, cap daily writes.

Note in the response and in the dashboard copy later: this is a **lower bound**, not a count. A capped, origin-checked counter is an estimate, and saying so is better than implying precision it does not have.

- [ ] **Step 4: Wire the button without slowing it down**

`Hero.tsx:76` builds the WhatsApp link inside `window.open`. Add a fire-and-forget `navigator.sendBeacon('/api/wa')` on click — same-origin, which Task 3 made real.

Three properties, each with a test that can fail:
- the WhatsApp link still opens when the beacon call throws
- the link still opens when `navigator.sendBeacon` is undefined (**note jsdom has no `sendBeacon` by default, so this is its natural state — assert it against an explicitly deleted global so the test is about the code, not the environment**)
- `window.open` is called synchronously in the same tick as the click, so navigation is never delayed

The whole point of `sendBeacon` is surviving navigation without delaying it. A counter that costs her a customer is worse than no counter.

- [ ] **Step 5: Re-measure the homepage**

This is the only task that legitimately touches a rendered component. Run `src/test/homepage-bytes.test.tsx` from Task 3. If the byte count changed, update the constant **in the same commit**, and state the old and new numbers and what accounts for the difference.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): count whatsapp taps server-side without slowing the link"
```

---

## Definition of done

- [ ] `npx vitest run` green; `npx tsc -b --noEmit` clean; `npm run build` exit 0; `npx eslint .` clean. Record the test count.
- [ ] `worker/` is genuinely type-checked, proven by a deliberate type error failing `tsc -b`.
- [ ] No secret in any committed file, proven by a test that can fail and does not match itself.
- [ ] A tampered token is rejected, proven by a test that edits the payload and keeps the signature.
- [ ] The PBKDF2 iteration count is a measured number under the 10 ms CPU limit, with the measurements recorded.
- [ ] A publish with one invalid file commits nothing and returns the problem naming the field.
- [ ] `validateContent` rejects a file it has no rule for.
- [ ] `commitFiles` sends `base_tree` and `parents`, proven by inspecting the request body.
- [ ] `commitFiles` refuses every path outside `src/content/` and `assets-source/`.
- [ ] Format detection reads content, distinguishes HEIC from AVIF by brand, and returns null rather than guessing.
- [ ] Upload paths are content-addressed, so two photos never collide and the same photo is idempotent.
- [ ] Every `assets-source/` category has its generated `public/` counterpart ignored, proven via `git check-ignore`.
- [ ] The cron does not call the deploy hook when nothing is due.
- [ ] A failed build is reported to the dashboard with a link to the commit — not silence.
- [ ] `docs/cloudflare-cutover.md` requires a human to verify the dashboard's build command, and a test pins the documented order.
- [ ] HEIC's WASM is absent from `dist/assets/`, proven by an import-graph test and a build grep, both shown to fail.
- [ ] The WhatsApp link opens even when the beacon fails or is unavailable, and `/api/wa` is origin-checked, rate-limited and capped.
- [ ] The homepage byte count is pinned by a test; any change is stated and justified.

## Handed to later plans

- **Plan 4 (Dashboard)** consumes `POST /api/publish`, `POST /api/upload`, `GET /api/build-status` and `build-info.json`. It must decide who owns `site.seo.*`, `site.name` and `site.tagline`: `src/test/head.test.ts` keeps `index.html` in sync with `site.json`, so either the build derives the head or those fields stay developer-owned and out of her form.
- **Plan 4** must make its write path the control point for the non-breaking space in `copy.footer.followLabel`. No test can catch that regression; it was previously ruled Critical and took a browser measurement at ≤280px to find.
- **Plan 4** must label the `press.readArticle` field as driving both the homepage teaser and `/blogs`.
- **Plan 4** must show the WhatsApp number as an estimate, not a count.
- **Plan 5 (Edit mode)** consumes the same publish endpoint.
- **Session revocation** does not exist: rotating the password leaves outstanding 7-day tokens valid unless `TOKEN_SECRET` is rotated too.
