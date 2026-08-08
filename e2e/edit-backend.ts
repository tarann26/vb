// The /edit backend mock, extracted so the three specs that need it share
// one copy instead of three. It was written twice already (collage-hit-test
// and publish-confirm each carried a byte-identical copy of CONTENT_FILES,
// realContentJson and mockEditBackend); the third spec is what made that a
// list to keep in sync by hand rather than a coincidence -- Plan 7's own
// tenth content file, pages.json, had to be added to two separate arrays
// when it landed, and a spec that missed it would have shown a "Could not
// load pages.json" banner over the page it was measuring.
//
// Not a `.spec.ts`: playwright.config.ts's `testDir: './e2e'` picks up
// every file it considers a test, and a helper module with no `test()` call
// in it is reported as an empty suite. The plain `.ts` extension keeps it a
// module the specs import.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ZERO_DATA_PAYLOAD } from '../src/shared/analytics-payload';
import type { AnalyticsPayload } from '../src/shared/analytics-payload';

// Every file src/admin/content.ts's own CONTENT_FILES fetches. A name
// missing here is answered 404 by the route below, which surfaces on screen
// as a "Could not load <file>" banner ABOVE the real page content -- i.e. it
// shifts everything a spec is about to measure.
export const CONTENT_FILES = [
  'site.json',
  'galleries.json',
  'dishes.json',
  'drinks.json',
  'press.json',
  'story.json',
  'menus.json',
  'copy.json',
  'sections.json',
  'pages.json',
];

// The real, committed content -- not a hand-built fixture, so every spec
// built on this measures the same photos, the same collage placements and
// the same counts the deployed site has.
export function realContentJson(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'content', name), 'utf8');
}

// EditMode.tsx's own `useSession` treats a 200 JSON response from GET
// /api/wa as "logged in" -- it doubles as the session probe (see that
// hook's own header comment for why), so faking that one response is
// enough to reach the real, authenticated /edit screen without a real
// Worker, a real KV namespace, or a real login POST anywhere in these
// tests. GET /api/content?path=src/content/<name> is the only other network
// call EditMode makes before first paint (one per file in CONTENT_FILES) --
// faked here from the real files on disk so the page renders the actual
// production content, not a stand-in.
// A fixed build stamp for /build-info.json.
//
// This fixture is REQUIRED, not a convenience. playwright.config.ts runs
// `npm run dev`, and plugins/build-info.ts is build-only -- so under the dev
// server that file does not exist at all, every run reads "Couldn't check
// when the site last updated." in the status strip, and "Last published 2
// hours ago" is untestable. Frozen rather than relative to `Date.now()` so
// the strip's own relative-time formatting is what is being measured, not
// the clock.
export const BUILD_INFO_FIXTURE = { sha: 'e2ee2ee', builtAt: '2026-08-07T10:00:00.000Z' };

// The two GET /api/analytics bodies worth driving a browser against, built
// from the shared contract (src/shared/analytics-payload.ts) rather than
// hand-typed -- a hand-typed fixture drifts from what the Worker actually
// returns, and the first integration is then a rewrite.
//
// ZERO_DATA is the state the screen SHIPS in, and is therefore the default:
// an e2e run that only ever exercised populated cards would never see the
// copy she will actually read for the first fortnight.
export const ANALYTICS_ZERO = ZERO_DATA_PAYLOAD;

export const ANALYTICS_POPULATED: AnalyticsPayload = {
  ...ZERO_DATA_PAYLOAD,
  visits: 4100,
  thisWeekVisits: 312,
  priorWeekVisits: 240,
  bookingTaps: { total: 512, days: 28, lowerBound: true },
  byPath: [
    { path: '/', visits: 2000 },
    { path: '/catering', visits: 400 },
  ],
  byReferer: [
    { kind: 'instagram', label: 'Instagram', host: null, visits: 1200 },
    { kind: 'direct', label: 'Typed it in or used a bookmark', host: null, visits: 900 },
  ],
};

export interface EditBackendOptions {
  // When true, /build-info.json answers 404 -- the state the strip must
  // report as "couldn't check" rather than as the site being down.
  buildInfoUnavailable?: boolean;
  // Which analytics body GET /api/analytics answers with. Defaults to the
  // launch state.
  analytics?: AnalyticsPayload;
}

export async function mockEditBackend(page: Page, options: EditBackendOptions = {}): Promise<void> {
  await page.route('**/api/analytics', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(options.analytics ?? ANALYTICS_ZERO),
    });
  });
  await page.route('**/build-info.json', async (route) => {
    if (options.buildInfoUnavailable) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(BUILD_INFO_FIXTURE),
    });
  });
  await page.route('**/api/wa', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // `**/api/content**` -- the trailing double star, not a single one:
  // Playwright's glob route patterns treat a bare `*` as "any characters
  // except `/`", and this request's own query string
  // (`?path=src/content/<name>`) contains slashes, so a single-star pattern
  // here silently never matches at all (confirmed directly -- the route
  // handler's own body never ran, and every one of the files failed to load
  // with no other explanation on screen).
  await page.route('**/api/content**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    const name = path.replace('src/content/', '');
    if (!CONTENT_FILES.includes(name)) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: realContentJson(name), sha: 'e2e-test-sha' }),
    });
  });
}
