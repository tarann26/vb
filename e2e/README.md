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
9. **Nothing here is typechecked.** `e2e/*.spec.ts` is in no tsconfig project,
   so `npx tsc -b --noEmit` reads not one line of it, and Vitest does not
   typecheck either. ESLint and Playwright's own runtime are the only checks a
   spec file gets, and a type error in here has already survived a whole task
   on this project. Run the spec.
