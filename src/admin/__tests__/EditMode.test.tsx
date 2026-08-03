// Coverage for EditMode.tsx (Plan 5 Task 2): the /edit route renders the
// real public homepage components with content fetched live from the
// Worker, a login overlay that survives a mid-session 401 without
// unmounting anything, and a capture-phase click guard so the page's own
// links (WhatsApp + the beacon, "View all", a menu download, the Maps
// link) cannot fire while she is just reading the page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import EditMode from '../EditMode';
import { AppRoutes } from '../../App';
import type { Article, Copy, Dish, Drink, Galleries, MenuFile, Section, SiteContent, StoryContent } from '../../content/types';
// Real, committed files for galleries/story/menus/copy -- the same choice
// AdminApp.test.tsx already makes (see that file's own comment): each has
// real structural shape a hand-typed fixture would have to reproduce, and
// reusing the real ones means this file's fixtures can never quietly drift
// out of sync with what src/admin/fields.ts or the real components actually
// expect. This is a *.test.tsx file, so src/admin/__tests__/content.test.ts's
// "no build-time snapshot" guard does not apply to it -- confirmed directly
// against that file's own scope (fields.test.ts's own comment documents the
// identical exclusion for the identical reason).
import galleriesJson from '../../content/galleries.json';
import storyJson from '../../content/story.json';
import menusJson from '../../content/menus.json';
import copyJson from '../../content/copy.json';

const GALLERIES = galleriesJson as Galleries;
const STORY = storyJson as StoryContent;
const MENUS = menusJson as MenuFile[];
const COPY = copyJson as Copy;

// Deliberately NOT "Via Bianca" (the real committed name) -- distinct on
// purpose, so a test asserting this text proves live content actually
// reached the page rather than passing vacuously against the build-time
// snapshot too.
const SITE: SiteContent = {
  name: 'Edit Mode Live Test',
  tagline: 'Fetched, Not Bundled',
  strapline: 'A live strapline',
  address: { street: '1 Test Street', locality: 'Delhi', postalCode: '110048', country: 'IN' },
  phones: ['+91 00000 00000'],
  whatsapp: { number: '910000000000', prefilledMessage: 'Hi' },
  socials: { instagram: 'https://instagram.com/test', linkedin: null },
  hours: [],
  seo: { title: 'Edit Mode Live Test', description: 'd', keywords: 'k', ogImage: '/og.jpg', url: 'https://example.com', locale: 'en_IN' },
  copyrightYear: 2026,
};

const SECTIONS: Section[] = [
  { id: 'hero', enabled: true },
  { id: 'ourStory', enabled: true },
  { id: 'atmosphere', enabled: true },
  { id: 'food', enabled: true },
  { id: 'drinks', enabled: true },
  { id: 'press', enabled: true },
  { id: 'visit', enabled: true },
];

const DISHES: Dish[] = [];
const DRINKS: Drink[] = [];
const PRESS: Article[] = [];

const WA_RESPONSE = () =>
  new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

function contentResponse(data: unknown, sha: string): Response {
  return new Response(JSON.stringify({ content: JSON.stringify(data), sha }));
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ message: 'Not authenticated.' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

// `pressResponse` (and the other per-file overrides below) may be a
// Promise, not just a Response, so a caller can gate one file's resolution
// independently -- every other file resolves immediately, matching how nine
// independent GET /api/content calls actually behave (not sequenced against
// one another). `siteResponse`/`copyResponse`/`sectionsResponse` (post-review
// Fix 2/Fix 4)
// let a test break exactly one of the three files whose own malformed-shape
// coverage this review added, without hand-rolling a whole new fetch stub
// per test.
function stubFetch(overrides: {
  siteResponse?: Promise<Response> | Response;
  dishesResponse?: Promise<Response> | Response;
  pressResponse?: Promise<Response> | Response;
  copyResponse?: Promise<Response> | Response;
  sectionsResponse?: Promise<Response> | Response;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url === '/api/login') return new Response(null, { status: 204 });
      if (url.includes('dishes.json')) return overrides.dishesResponse ?? contentResponse(DISHES, 'sha-dishes');
      if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
      if (url.includes('press.json')) return overrides.pressResponse ?? contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return overrides.sectionsResponse ?? contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return overrides.siteResponse ?? contentResponse(SITE, 'sha-site');
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return overrides.copyResponse ?? contentResponse(COPY, 'sha-copy');
      throw new Error(`EditMode.test.tsx: unexpected fetch to ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the /edit route', () => {
  it('renders EditMode, lazily, at the exact /edit path', async () => {
    stubFetch();
    render(
      <MemoryRouter initialEntries={['/edit']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    // findBy: the route is lazy, and the session probe + all nine content
    // fetches resolve asynchronously after the initial render.
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Mode Live Test' })).toBeInTheDocument();
  });
});

describe('EditMode renders live content, not the build-time snapshot', () => {
  it('shows the fetched site name, not whatever src/content/index.ts has baked in', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Edit Mode Live Test');
  });
});

describe('EditMode: a 401 mid-load does not unmount the page or lose what already loaded', () => {
  // Post-review Fix 1 (Critical). This test replaces an earlier version
  // whose own comment claimed "nothing re-fetched it, so a since-changed
  // mock response could never have overwritten it either" -- UNDETECTABLE
  // as written, because that fixture returned identical content on every
  // call to every file, so a wrongly-repeated re-fetch and a correctly
  // skipped one would have rendered identically. It was also, after Fix 1's
  // production change, simply wrong: Fix 1 makes press.json genuinely
  // retried on re-login, and reusing the SAME already-settled 401 Response
  // for that retry (the old fixture's `pressResponse: press.promise`, a
  // single deferred value handed back on every call) made the retry 401
  // again too, re-triggering logout and hanging the test forever -- the
  // "replayed 401 fixture re-triggers logout" case named in this review.
  // This version makes the two fixtures that matter -- the one file that
  // already loaded (copy.json) and the one that 401'd (press.json) --
  // return DIFFERENT content on a SECOND fetch, so "was it clobbered?" and
  // "was it refilled?" are both directly observable on screen, not inferred
  // from a comment.
  it('a loaded file is never re-fetched after a re-login (no clobber); a 401\'d file IS retried and fills in (no permanent blank)', async () => {
    let copyCalls = 0;
    let pressCalls = 0;
    // If copy.json were wrongly re-fetched after the re-login, THIS is what
    // would land on screen instead of the original reserve-button text.
    const CLOBBERED_COPY: Copy = { ...COPY, hero: { ...COPY.hero, reserveButton: 'CLOBBERED-IF-REFETCHED' } };
    const REAL_PRESS: Article[] = [
      {
        id: 'after-relogin',
        title: 'Loaded After Re-Login',
        publication: 'Test Press',
        date: '2026-01-01',
        excerpt: 'x',
        url: null,
        image: '/x.jpg',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/login') return new Response(null, { status: 204 });
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) {
          copyCalls += 1;
          return contentResponse(copyCalls === 1 ? COPY : CLOBBERED_COPY, 'sha-copy');
        }
        if (url.includes('press.json')) {
          pressCalls += 1;
          return pressCalls === 1 ? unauthorizedResponse() : contentResponse(REAL_PRESS, 'sha-press-2');
        }
        throw new Error(`EditMode.test.tsx (per-file guard test): unexpected fetch to ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // copy.json loaded on the first pass.
    expect(await screen.findByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
    expect(copyCalls).toBe(1);

    // press.json 401'd -- the corrected notice appears (Fix 1's other
    // half: the old wording promised the page "will still be showing
    // exactly what it was", which is untrue for a file that hadn't loaded
    // yet).
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(await screen.findByText(/whatever has already loaded will stay exactly as it was.*whatever hasn't will load now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());

    // Half 1 -- not clobbered: copy.json was fetched exactly once, ever.
    // The button still shows the ORIGINAL text; the second fixture's text
    // never appears.
    expect(copyCalls).toBe(1);
    expect(screen.getByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
    expect(screen.queryByText('CLOBBERED-IF-REFETCHED')).not.toBeInTheDocument();

    // Half 2 -- refilled: press.json WAS retried after the re-login, and
    // its real content is now on screen -- not permanently blank.
    expect(pressCalls).toBe(2);
    expect(await screen.findByText('Loaded After Re-Login')).toBeInTheDocument();
  });

  // The reviewer's own exact repro: the session PROBE (/api/wa) says she's
  // logged in (so `status` starts 'in' and the nine content fetches fire
  // immediately), but the Worker rejects every one of them -- "a cookie the
  // client believes in and the Worker rejects." Before Fix 1, this
  // permanently stranded the page: `startedRef` had already fired once, so
  // logging in again never re-fetched anything.
  it('all nine files 401ing on the very first load recovers fully after logging in -- no permanently blank page, no eternal loading banner', async () => {
    let loggedIn = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/login') {
          loggedIn = true;
          return new Response(null, { status: 204 });
        }
        if (!loggedIn) return unauthorizedResponse();
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        throw new Error(`EditMode.test.tsx (all-401 test): unexpected fetch to ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());
    // The page is not a permanent blank -- real content loaded on retry...
    expect(await screen.findByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
    // ...and the loading banner is gone, not stuck forever.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  // "make sure a file that ends up permanently unloadable for a non-401
  // reason surfaces an error rather than an eternal banner" -- a genuine
  // fetch failure (not a 401, and not merely valid-JSON-wrong-shape, which
  // content.ts's fetchContent resolves rather than rejects), with no
  // re-login involved at all.
  it('a file that fails for a genuine, non-401 reason stops the loading banner and shows an error, with no re-login needed', async () => {
    stubFetch({ pressResponse: new Response(null, { status: 500 }) });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The rest of the page still renders -- e.g. the reserve button, which
    // depends only on copy.json (unaffected here).
    expect(await screen.findByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
    // The failure is reported, naming the file...
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/press\.json/);
    // ...and the loading banner is gone, not stuck forever.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('EditMode: the page\'s own links do not fire', () => {
  afterEach(() => {
    // jsdom has no navigator.sendBeacon by default; restore that natural
    // state between tests the same way Hero.test.tsx's own suite does.
    delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
  });

  it('clicking the reserve button fires no beacon and opens no window', async () => {
    stubFetch();
    const beaconSpy = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { value: beaconSpy, configurable: true });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: COPY.hero.reserveButton });
    fireEvent.click(button);

    expect(beaconSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('clicking the Visit Us Maps link does not navigate -- preventDefault fires on the anchor itself', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: COPY.visit.navigateButton });
    // fireEvent.click's own return value is `!event.defaultPrevented` --
    // `false` here is direct proof the click handler called preventDefault
    // on this exact anchor, not merely that nothing threw.
    expect(fireEvent.click(link)).toBe(false);
  });
});

describe('EditMode: one malformed content file does not take down the page', () => {
  it('dishes.json parsing to the wrong shape (an object, not an array) shows a per-section error, while the rest of the page still renders', async () => {
    // Valid JSON, wrong shape: content.ts's fetchContent only parses --
    // it has no runtime shape check (that module's own header comment names
    // this exact risk) -- so this reaches FoodGallery's `dishes.map(...)`
    // as a plain object, which throws "dishes.map is not a function".
    stubFetch({ dishesResponse: contentResponse({}, 'sha-dishes-bad') });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The one broken section reports itself...
    expect(await screen.findByText(/could not show menu/i)).toBeInTheDocument();
    // ...while an unrelated section (Hero, which never touches dishes)
    // still rendered normally.
    expect(screen.getByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
  });

  // Post-review Fix 2 (Important): the review's own measured table found
  // `sections.json` uniquely different from every other malformed-file case
  // -- `document.body.textContent === ''`, total page loss, because
  // `bundle.sections.filter(...)` used to run directly in EditMode's own
  // render body, outside every SectionErrorBoundary.
  it('sections.json parsing to an object instead of an array shows a boundary fallback for the section list, not a blanked page', async () => {
    stubFetch({ sectionsResponse: contentResponse({}, 'sha-sections-bad') });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The one broken piece reports itself, by name -- this costs the WHOLE
    // section list (every dynamic section lives inside the one boundary
    // that wraps DynamicSections, so a crash in DynamicSections' own
    // `.filter` is not further isolated per-section), which is the correct,
    // bounded cost: not one section, but not the page either.
    expect(await screen.findByText(/could not show sections/i)).toBeInTheDocument();
    // Navbar ALSO reads `sections` directly (its own `enabledSectionIds`
    // filter, NavBar.tsx), so its boundary fires too -- a real, separate
    // consequence of the same malformed file, not a bug in this fix.
    expect(screen.getByText(/could not show navigation/i)).toBeInTheDocument();
    // Footer touches neither `sections` nor anything derived from it, and
    // survives untouched -- proof this cost exactly what actually reads
    // sections.json, not the whole page.
    expect(screen.getByText(SITE.name)).toBeInTheDocument();
    expect(document.body.textContent).not.toBe('');
  });
});

// Post-review Fix 4 (Important): the three SectionErrorBoundary wrappers
// around <SeoHead/>, <Navbar/> and <Footer/> already existed and already
// worked -- deleting any of the three left the whole suite green, because
// nothing exercised them. The one existing malformed-file test above only
// ever breaks dishes.json/FoodGallery. site.json and copy.json are the two
// highest-fan-in files (read by nearly every component), so they are what
// actually drives these three boundaries.
describe('EditMode: post-review Fix 4 -- SEO, Navigation and Footer each have their own tested boundary', () => {
  it('a malformed site.json trips the SEO, Navigation and Footer boundaries individually -- a section that never reads site.json still renders', async () => {
    stubFetch({ siteResponse: contentResponse({}, 'sha-site-bad') });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/could not show seo/i)).toBeInTheDocument();
    expect(screen.getByText(/could not show navigation/i)).toBeInTheDocument();
    expect(screen.getByText(/could not show footer/i)).toBeInTheDocument();
    // FoodGallery ("Menu") reads only copy.food and dishes -- neither
    // depends on site.json -- so it survives untouched, proving this cost
    // exactly the sections/components that actually touch site.json, not
    // the page.
    expect(screen.getByText(COPY.food.heading)).toBeInTheDocument();
  });

  it('a malformed copy.json trips the Navigation and Footer boundaries -- SEO does not read copy.json at all, and the page still stands', async () => {
    stubFetch({ copyResponse: contentResponse({}, 'sha-copy-bad') });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/could not show navigation/i)).toBeInTheDocument();
    expect(screen.getByText(/could not show footer/i)).toBeInTheDocument();
    // SeoHead reads only `site`, never `copy` -- confirmed here rather than
    // merely assumed: its own boundary must NOT have fired.
    expect(screen.queryByText(/could not show seo/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toBe('');
  });
});

// Post-review Fix 6: /edit is not a page any search engine, scraper, or
// share preview should ever treat as its own indexable entity -- see
// SeoHead.tsx's own `emitMetadata` comment for the full reasoning (an empty
// `site.seo.url` self-canonicalizing to /edit while logged out; a
// pointless duplicate of the homepage's own JSON-LD while logged in).
describe('EditMode: post-review Fix 6 -- /edit never emits a canonical link or Restaurant JSON-LD', () => {
  it('no canonical link and no Restaurant JSON-LD script are ever added, even once real content has loaded', async () => {
    stubFetch();

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: COPY.hero.reserveButton });
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});

// Post-review Fix 3 (Important): SECTION_COMPONENTS is deliberately
// duplicated here rather than imported from src/App.tsx (see this file's own
// header comment on why), which means nothing but careful reading kept the
// two in sync -- the reviewer swapped `ourStory`/`atmosphere` in THIS map
// only and got a fully green suite, `tsc -b` exit 0, on the one surface
// whose entire value is that it is NOT a preview.
describe("EditMode's SECTION_COMPONENTS never diverges from App.tsx's (post-review Fix 3)", () => {
  // Extracts just the object literal's body (from the `{` after `=` to the
  // matching `};`), not the surrounding `const ... : Record<...> = ...`
  // declaration -- the two files spell the return-type annotation
  // differently (`React.ReactNode` here vs. a bare `ReactNode` in App.tsx,
  // which imports the type directly), which is a legitimate, harmless
  // difference this check must not flag. A LAZY `[\s\S]*?` between the
  // identifier and `=\s*{`, not `[^=]*` -- both files' type annotations are
  // `Record<SectionId, () => ReactNode>`, which contains its OWN `=` (the
  // arrow's `=>`) before the real assignment. `[^=]*` cannot consume that
  // `=` at all and fails to match the line outright; a lazy `[\s\S]*?` just
  // keeps extending until it finds a real `=` followed by optional
  // whitespace then `{` -- which `=>` never satisfies (`>` is not
  // whitespace or `{`), so it correctly skips past the arrow and lands on
  // the genuine ` = {`. Confirmed directly while writing this test: the
  // `[^=]*` version threw "SECTION_COMPONENTS literal not found" on both
  // files.
  function extractSectionComponentsBody(source: string): string {
    const match = source.match(/SECTION_COMPONENTS[\s\S]*?=\s*{([\s\S]*?)\n};/);
    if (!match) throw new Error('SECTION_COMPONENTS literal not found in source');
    return match[1].trim();
  }

  it('the two literals map every SectionId to the identical component, in the identical order', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const editModeSource = readFileSync('src/admin/EditMode.tsx', 'utf8');
    expect(extractSectionComponentsBody(editModeSource)).toEqual(extractSectionComponentsBody(appSource));
  });
});

// Post-review Fix 7: nothing pinned that /edit and /edit/manage -- siblings
// in src/App.tsx's route table -- each resolve to their OWN component.
// React Router 7 ranks routes by specificity regardless of declaration
// order, so this has always behaved correctly; this is the regression test
// that was missing, not a bug fix.
describe('EditMode: post-review Fix 7 -- /edit and /edit/manage never resolve to each other\'s component', () => {
  // Logged out is what makes the two routes visually distinguishable at
  // all: both mount <Login/> when status is 'out', but EditMode renders it
  // as an OVERLAY on top of the real page (Navbar's own <nav>, among
  // others), while AdminApp's logged-out view is nothing but the bare login
  // form. /api/wa alone is stubbed -- neither route fetches anything else
  // while logged out.
  function stubFetchLoggedOut() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response(null, { status: 401 });
        throw new Error(`EditMode.test.tsx (route precedence): unexpected fetch to ${url} while logged out`);
      }),
    );
  }

  it('/edit renders EditMode -- the underlying page shows beneath the login overlay', async () => {
    stubFetchLoggedOut();
    const { container } = render(
      <MemoryRouter initialEntries={['/edit']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(container.querySelector('nav')).not.toBeNull();
  });

  it('/edit/manage renders AdminApp -- a bare login form, with no underlying page beneath it', async () => {
    stubFetchLoggedOut();
    const { container } = render(
      <MemoryRouter initialEntries={['/edit/manage']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(container.querySelector('nav')).toBeNull();
  });
});
