# The browser suite

`npm run test:e2e`. Needs a Chromium binary that `npm install` does not
provide: `npx playwright install chromium`, once per machine.

## Rules this suite is held to

1. **Never assert a class name.** The dev server's Tailwind JIT never removes
   a rule inside a session, so a class assertion can be green against a
   stylesheet a cold production build would not produce. Assert computed
   style, geometry, or sampled pixels.
2. **Wait for fonts before measuring width.** `fontsSettled(page)` in
   `blog-controls.spec.ts`. Montserrat and the fallback measure 333.7px and
   365.3px for the same string, and that difference decides whether controls
   wrap.
3. **Use `await expect(locator).toHaveCSS(...)`, never a one-shot
   `evaluate(getComputedStyle)`, for anything that transitions.** A read taken
   immediately after a class flips returns the FROM value, which passes on a
   defect and fails on the fix.
4. **A navigation claim is asserted, not assumed.** `getByRole`'s name
   matching is substring and case-insensitive, so a click that hits the wrong
   element still "succeeds". Every in-app navigation in this suite is followed
   by `await expect(page).toHaveURL(...)`, so a test cannot be satisfied by
   standing still. This is not hypothetical: this site's whole nav bar is
   `#` fragments rendered as plain anchors, and a spec that clicked them
   believed it had changed four pages when it had scrolled.
5. **Tests inside one file run in order; files run four at a time.** Do not
   write a spec that assumes it owns the dev server.
6. **A `flaky` result in the html report is a bug.** The single retry exists
   to keep a scheduling blip from blocking a deploy, not to make an
   intermittent failure invisible. Two flaky runs of the same spec means fix
   the spec.
7. **The dev server serves `npm run dev`, so React StrictMode is live.**
   Every component mounts, unmounts and remounts. Anything that must happen
   once per document either runs at module scope or marks before it acts.
8. **Budget a spec for a contended run, not a solo one.** Four workers share
   one vite dev server. `collage-swap.spec.ts:151` costs 6.9s alone and still
   outran a 30s per-test timeout once in three full runs, so the timeout is
   60s. A spec whose own waits — `waitForStableLayout` allows itself 10s, and
   `openCollage` calls it — could add up to more than half the budget on a
   quiet machine has no room left for a busy one.
9. **`test.fail` goes on the test, never beside it.** `test.fail(title, body)`
   declares one expected-to-fail test. The bare statement form,
   `test.fail(true, '…')` written above a test, marks **every** test in the
   enclosing `describe` — which inverts the three assertions standing beside
   it, so they pass when they fail. And an expected-to-fail test that dies on
   a bad locator instead of on its own assertion is reported as a pass, so
   read the failure once, with the annotation off, before trusting it.
10. **Nothing here is typechecked.** `e2e/*.spec.ts` is in no tsconfig project,
   so `npx tsc -b --noEmit` reads not one line of it, and Vitest does not
   typecheck either. ESLint and Playwright's own runtime are the only checks a
   spec file gets, and a type error in here has already survived a whole task
   on this project. Run the spec.

11. **A `page.route` glob matches the whole URL, query string included.**
   `**/api/analytics` stops matching the moment the request becomes
   `/api/analytics?range=30d`, and the failure is silent: the request reaches
   the dev server, answers 404, and the screen under test renders its error
   state instead of its content. That has now cost this repo twice — first on
   `**/api/content**`, then on the analytics route when the range control
   landed. End a route pattern at a path segment only when you mean it.

## What the config change was actually measured to do

Recorded here because it is not what the change was expected to do, and the
next person to tune this file should not repeat the reasoning that was wrong.

Twenty-five full runs on one machine, four settings, `flaky` counted from the
html report:

| Config | Runs | Flaky |
|---|---|---|
| `workers: 4`, `fullyParallel: false`, `timeout: 30_000` | 3 | **1** — `collage-swap.spec.ts:151`, a 30s test timeout, passed on retry |
| `workers: 4`, `fullyParallel: false`, `timeout: 60_000` | 5 | 0 |
| uncapped, `fullyParallel: true`, `timeout: 60_000` | 5 | 0 |
| uncapped, `fullyParallel: true`, `timeout: 30_000` | 6 | **1**, on run 3 |
| `workers: 4`, `fullyParallel: false`, `timeout: 60_000`, `retries: 0` | 5 | 0 |

**The timeout is the change that carries the result.** A flake appeared under
both worker settings while the budget was 30s, and under neither once it was
60s. Reverting the cap alone reproduced nothing in five runs. So the worker
cap is **not** the thing shown to have fixed the flakes, whatever the comment
in `playwright.config.ts` argues from history.

**The cap is kept anyway, on a different measurement.** Capped runs took
3.5–3.8 minutes; uncapped runs took 4.0–4.4. Oversubscribing one vite dev
server with 10–14 workers is slower than feeding it four, consistently, across
ten runs. It is kept for the wall clock, not for a flake it was proven to
prevent, and that is the honest reason to state.

**The retry is not hiding anything here.** Five runs with `retries: 0` and the
cap in place were green, so no test in this suite currently needs its retry.
Rule 6 still stands: the day one does, that is a bug to fix.

**Both flakes were the same shape** — a test exhausting its wall-clock budget,
never an assertion disagreeing with the page. That is worth knowing before
anyone reads a future red run as a product defect.
