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
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LOCKUP_ACCESSIBLE_NAME } from '../src/admin/manage/brand';
import { ZERO_DATA_PAYLOAD } from '../src/shared/analytics-payload';
import type { AnalyticsPayload } from '../src/shared/analytics-payload';

// Every file src/admin/content.ts's own CONTENT_FILES fetches, EXCEPT
// awards.json -- deliberately, see its own note below. For every name that
// IS listed here, a name missing would be answered 404 by the route below,
// which surfaces on screen as a "Could not load <file>" banner ABOVE the
// real page content -- i.e. it shifts everything a spec is about to
// measure.
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
  // Phase 3, Task 2 (pulled forward): experiences.json is a real, committed
  // file on the GitHub store, exactly like the ten files above it and
  // unlike awards.json below -- see src/admin/content.ts's own comment on
  // why the twelfth CONTENT_FILES entry is not the same kind of exception
  // the eleventh is. Listed here, not carved out: a name missing from this
  // array 404s (the route below), which is the correct fixture only for a
  // file that genuinely does not exist yet, and experiences.json has existed
  // since Task 2.
  'experiences.json',
  // Phase 5B, Task 3: posts.json joined src/admin/content.ts's CONTENT_FILES,
  // so EditMode's blanket load effect now fetches it and the route below has
  // to answer. A name missing from this array is answered 404, which paints a
  // "Could not load posts.json" banner ABOVE the real page content -- i.e. it
  // shifts everything every spec in this suite is about to measure, including
  // four already on the flake watchlist. It stays listed after Task 9 moves
  // the live copy to D1: realContentJson reads the committed file, which
  // still exists as the first-paint fallback.
  'posts.json',
];

// awards.json is deliberately NOT in the list above, and that is not the
// same omission the "Could not load" warning names. Every file that IS
// listed always exists in the real repository, so a 404 for one of THOSE
// really is a bug this list exists to prevent. awards.json is different: it
// is D1-backed (worker/store.ts's D1_ONLY_PATHS), never a file in this
// repository, and genuinely 404s until the very first award is ever
// published (content.ts's own ContentNotFoundError) -- which is exactly the
// un-seeded state this fixture is standing in for. Both consumers
// (AwardsArea.tsx and EditMode.tsx, Phase 2 Task 11) already treat that 404
// as an empty list, not an error, so the route below answering 404 for it is
// the CORRECT fixture, not a gap. Adding an entry here would need a
// `realContentJson('awards.json')` file that must not exist -- do not add
// one.

// The real, committed content -- not a hand-built fixture, so every spec
// built on this measures the same photos, the same collage placements and
// the same counts the deployed site has.
export function realContentJson(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'content', name), 'utf8');
}

// The suite must not depend on WHICH post is first. A new post landing at the
// top of posts.json broke the block-label assertions once and would again --
// the three committed posts happen to share a shape today, and the moment one
// does not, whichever spec reached for index 0 fails somewhere far from the
// change that caused it.
//
// Finds a post carrying every named block kind, and throws a sentence naming
// what it wanted when none does. That refusal is the point: a helper that fell
// back to `posts[0]` would put the assumption back where it was and hide it
// behind a function name.
export function postWithBlocks(kinds: string[]): { slug: string; title: string } {
  const posts = JSON.parse(realContentJson('posts.json')) as Array<{
    slug: string;
    title: string;
    blocks: Array<{ kind: string }>;
  }>;
  const found = posts.find((post) => kinds.every((kind) => post.blocks.some((block) => block.kind === kind)));
  if (!found) throw new Error(`no committed post has all of: ${kinds.join(', ')}`);
  return { slug: found.slug, title: found.title };
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
//
// `hourly` is an EMPTY ARRAY here, not the shared fixture's `null`, for the
// same reason worker/__tests__/analytics.test.ts's ZERO_DATA_HERE overrides
// it: Cloudflare's RUM dataset DOES offer an hour dimension for this site
// (worker/analytics-schema.ts, hourDimension: 'datetimeHour'), so a real body
// at the default range carries a week of cells that all happen to be zero.
// `null` is what the Worker answers for a whole YEAR, where the archive holds
// one row per month and an hour cannot be recovered from it -- a state the
// browser suite reaches through its own fixture rather than through the
// launch default.
export const ANALYTICS_ZERO: AnalyticsPayload = { ...ZERO_DATA_PAYLOAD, hourly: [] };

export const ANALYTICS_POPULATED: AnalyticsPayload = {
  ...ZERO_DATA_PAYLOAD,
  visits: 4100,
  thisWeekVisits: 312,
  priorWeekVisits: 240,
  bookingTaps: { total: 512, days: 30, lowerBound: true },
  byPath: [
    { path: '/', visits: 2000 },
    { path: '/catering', visits: 400 },
  ],
  byReferer: [
    { kind: 'instagram', label: 'Instagram', host: null, visits: 1200 },
    { kind: 'direct', label: 'Typed it in or used a bookmark', host: null, visits: 900 },
  ],
  range: '30d',
  series: [
    { date: '2026-07-20', visits: 90, complete: true },
    { date: '2026-07-21', visits: 140, complete: true },
    { date: '2026-07-22', visits: 60, complete: true },
    { date: '2026-07-23', visits: 200, complete: true },
  ],
  seriesGrain: 'day',
  seriesSource: 'snapshot',
  // BEFORE the first point of `series`, deliberately, because that is what
  // the real payload sends: the archive backfills ninety days on its first
  // night and the default range draws thirty of them. Holding the two equal
  // made the trend caption green whether it named the drawn series' first
  // point or the archive's earliest row, in this suite and in jsdom both --
  // and it named the wrong one.
  seriesStartsOn: '2026-05-22',
  // A Friday evening and a Tuesday lunchtime, so the drawing has a real peak
  // and a real quiet cell to be measured against in a browser. An all-zero
  // week would leave every cell at the same opacity and every geometry claim
  // passing for the wrong reason.
  hourly: [
    { day: 2, hour: 13, visits: 40 },
    { day: 5, hour: 20, visits: 210 },
    { day: 5, hour: 21, visits: 180 },
  ],
  campaigns: [
    { source: 'instagram', label: 'Instagram link', arrivals: 84 },
    { source: 'other', label: 'Someone else’s link', arrivals: 12 },
  ],
  campaignsAreExact: true,
  visitsPrevious: 3300,
  tapsPrevious: 470,
  yearAvailable: false,
};

// The body every geometric claim in e2e/numbers-visuals.spec.ts is measured
// against. ANALYTICS_POPULATED above is the story fixture -- it exists so the
// copy on the screen reads like a real week -- and its numbers were chosen for
// what they SAY. These were chosen for what can be measured about them without
// a tolerance argument:
//
//   * byPath is 400 against 100. Each bar is drawn as its share of the LEADER
//     (src/admin/manage/chart-geometry.ts's barPercents), so the leader fills
//     its track and the second row is a quarter of it -- two independent
//     numbers a bounding box can be held to, rather than one ratio that a
//     share-of-total mistake would satisfy just as well.
//   * The series rises and falls with a single clear peak, so a chart drawn
//     upside down is not symmetric with one drawn the right way up.
//   * yearAvailable is true, so all four range pills are on screen and the
//     overlap sweep has something to sweep.
export const ANALYTICS_DRAWN: AnalyticsPayload = {
  ...ANALYTICS_POPULATED,
  series: [
    { date: '2026-08-11', visits: 100, complete: true },
    { date: '2026-08-12', visits: 50, complete: true },
    { date: '2026-08-13', visits: 200, complete: true },
    { date: '2026-08-14', visits: 25, complete: true },
    { date: '2026-08-15', visits: 400, complete: true },
  ],
  // Inherited from ANALYTICS_POPULATED above and repeated here only to say
  // that it is EARLIER than this fixture's own first point too: the caption
  // has two dates to tell apart and a fixture that hands it one cannot.
  seriesStartsOn: '2026-05-22',
  byPath: [
    { path: '/', visits: 400 },
    { path: '/catering', visits: 100 },
  ],
  campaigns: [
    { source: 'instagram', label: 'Instagram link', arrivals: 84 },
    { source: 'other', label: 'Someone else’s link', arrivals: 21 },
  ],
  yearAvailable: true,
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
  // `**/api/analytics**`, with the trailing double star -- the panel's range
  // control appends `?range=7d|30d|90d|year`, and Playwright matches the whole
  // URL including its query string. A pattern ending at `analytics` stops
  // matching the moment a parameter is added, and the failure is silent: the
  // request goes to the dev server, answers 404, and every card on the screen
  // reads "the visitor numbers aren't connected yet". The same trap
  // `**/api/content**` below already carries a paragraph about.
  await page.route('**/api/analytics**', async (route) => {
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

// Moved here from dashboard-sections.spec.ts, byte-identical, the first time
// a second spec needed it. The alternative -- a copy in the new file -- is
// exactly how CONTENT_FILES above came to be maintained by hand in three
// places, which this file's own header already records as the reason it
// exists.
// `options` reaches mockEditBackend, and that is not a convenience: Playwright
// matches routes most-recently-registered first, so a caller that mocked its
// own analytics body and THEN called this would have had it overridden by the
// launch-state default registered here. The one way to open the dashboard on a
// chosen payload is to pass it through.
export async function openDashboard(page: Page, path = '/edit/manage', options: EditBackendOptions = {}): Promise<void> {
  await mockEditBackend(page, options);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: LOCKUP_ACCESSIBLE_NAME })).toBeVisible();
  // Every area's own fetches have settled -- otherwise anything measured
  // below is measured against a page still filling in. All five areas load
  // at once (they are mounted from the first render and merely hidden), so
  // this covers the whole page, not just the visible area.
  await expect(page.getByText(/^Loading /)).toHaveCount(0);
}
