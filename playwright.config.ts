import { defineConfig, devices } from '@playwright/test';

// I-B review finding (repair of Plan 6): "no Playwright dependency, no
// *.spec.ts, and no committed browser test anywhere in the repo" -- every
// browser-verified claim across Plans 5 and 6, including the two z-index
// fixes CollageTile.tsx and EditableImage.tsx each carried their own long
// comments about (CollageTile.tsx was later deleted whole, along with the
// grid machinery, when Plan 9 rebuilt the collage as a split tree --
// EditableImage.tsx's own copy of that comment is the one still readable),
// was a one-shot manual run recorded in prose, never re-checked by anything
// that runs again. jsdom (every vitest test in this
// repo) has no layout engine and cannot hit-test a stacking-context
// regression at all -- confirmed directly, the reviewer's own mutation
// (revert both `z-20`s back to `z-10`) left 1844 passed, 1 skipped, nothing
// red. `e2e/collage-hit-test.spec.ts` is the first committed counter-example:
// a REAL Chromium (downloaded via `npx playwright install chromium`, a
// one-time step this repo's own README/setup does not yet document --
// see this task's own report) driven against a REAL vite dev server.
//
// Deliberately its own script (`npm run test:e2e`, package.json), not part
// of `npm run test`/`test:deploy`/`build`: it needs a browser binary
// `npm install` alone does not provide, and it starts its own dev server
// (`webServer` below) rather than assuming one is already running -- both
// make it a genuinely different KIND of check from the jsdom suite, meant
// to run as its own CI job or pre-merge gate. See this task's own report
// for exactly how CI would run it.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  // Reuses whatever's already on :8080 outside CI (a developer's own `npm
  // run dev`), starts a fresh one under CI -- the same convention Playwright
  // itself documents as the default-recommended shape for this option.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
