// Coverage for EditMode.tsx (Plan 5 Task 2): the /edit route renders the
// real public homepage components with content fetched live from the
// Worker, a login overlay that survives a mid-session 401 without
// unmounting anything, and a capture-phase click guard so the page's own
// links (WhatsApp + the beacon, "View all", a menu download, the Maps
// link) cannot fire while she is just reading the page -- while an in-page
// "#" nav jump and the hamburger, neither external nor destructive, still
// work (post-review, Task 2 Step 4 finding).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EditMode, { buildBundle } from '../EditMode';
import { AppRoutes } from '../../App';
import type { ContentEntries, ContentRegistry } from '../publish';
import { loadDraft, saveDraft } from '../drafts';
import type { Article, Copy, Dish, Drink, Experience, Galleries, MenuFile, Post, Section, SiteContent, StoryContent } from '../../content/types';
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
import { collagePhotos, findCollagePhoto } from '../../content/collage';
import storyJson from '../../content/story.json';
import menusJson from '../../content/menus.json';
import copyJson from '../../content/copy.json';

const GALLERIES = galleriesJson as unknown as Galleries;

// The collage photo whose src is /atmosphere/dining.webp -- the same
// photograph galleries.atmosphere[0] carries, which is the whole point of the
// two staging tests that use it. Addressed by the photo's own id, so a future
// swap that moves it to another box does not silently retarget these tests.
const COLLAGE_DINING_ID = 'photo-15';
const COLLAGE_DINING_PATH = `galleries.heroCollage.${COLLAGE_DINING_ID}`;
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
  { kind: 'bespoke', id: 'hero', enabled: true },
  { kind: 'bespoke', id: 'ourStory', enabled: true },
  { kind: 'bespoke', id: 'atmosphere', enabled: true },
  { kind: 'bespoke', id: 'food', enabled: true },
  { kind: 'bespoke', id: 'drinks', enabled: true },
  { kind: 'bespoke', id: 'press', enabled: true },
  { kind: 'bespoke', id: 'visit', enabled: true },
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
// Publish opens a confirmation before anything is POSTed -- one panel,
// portaled to document.body, used on BOTH surfaces (PublishBar.tsx). Every
// test below that wants the real request has to walk through it, exactly
// the way she does.
function acceptPublishConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
}

function stubFetch(overrides: {
  siteResponse?: Promise<Response> | Response;
  dishesResponse?: Promise<Response> | Response;
  pressResponse?: Promise<Response> | Response;
  copyResponse?: Promise<Response> | Response;
  sectionsResponse?: Promise<Response> | Response;
  // Phase 2, Task 11: lets a test drive awards.json's own genuine 404 (the
  // ordinary, expected state until the first award is ever published)
  // without a second copy of this whole stub function.
  awardsResponse?: Promise<Response> | Response;
  // Task 5: publishing from /edit reuses publish.ts's own requestPublish/
  // trackPublish unchanged (already exhaustively covered against a fake
  // clock in publish.test.ts) -- these three overrides let a Task 5 test
  // drive a SPECIFIC publish outcome (a 409 conflict, say) without
  // reproducing that whole state machine's own test suite a second time
  // here. Defaults answer the fastest possible "published and live" path:
  // one 200 from POST /api/publish, one build-status poll already 'live',
  // one build-info read that already matches.
  publishResponse?: Promise<Response> | Response;
  buildStatusResponse?: Promise<Response> | Response;
  buildInfoResponse?: Promise<Response> | Response;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url === '/api/login') return new Response(null, { status: 204 });
      if (url === '/api/publish') {
        return overrides.publishResponse ?? new Response(JSON.stringify({ sha: 'new-commit-sha', publishId: 'p1' }), { status: 200 });
      }
      if (url.startsWith('/api/build-status')) {
        return (
          overrides.buildStatusResponse ??
          new Response(
            JSON.stringify({ state: 'live', deploymentUrl: null, commitUrl: 'https://example.com/commit/new-commit-sha' }),
            { status: 200 },
          )
        );
      }
      if (url === '/build-info.json') {
        return (
          overrides.buildInfoResponse ??
          new Response(JSON.stringify({ sha: 'new-commit-sha', builtAt: '2026-08-03T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('dishes.json')) return overrides.dishesResponse ?? contentResponse(DISHES, 'sha-dishes');
      if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
      if (url.includes('press.json')) return overrides.pressResponse ?? contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return overrides.sectionsResponse ?? contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return overrides.siteResponse ?? contentResponse(SITE, 'sha-site');
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return overrides.copyResponse ?? contentResponse(COPY, 'sha-copy');
      // Plan 7, Task 1: the tenth content file, joining CONTENT_FILES (and
      // therefore EditMode's own load effect) from this task onward -- see
      // that module's own comment. Empty, matching pages.json's own real
      // starting value, so every existing test in this file (none of which
      // is about pages) keeps seeing exactly the same "nothing wrong"
      // load outcome it did before this file existed.
      if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
      // Phase 2, Task 11: the eleventh content file, joining CONTENT_FILES
      // (and therefore EditMode's own blanket load effect) from this task
      // onward, the same way pages.json's own comment just above describes
      // for the tenth. Empty, matching that same precedent -- this page has
      // no Awards editing surface of its own (fields.ts's own comment on
      // why), so every existing test here, none of which is about awards,
      // keeps seeing the same "nothing wrong" load outcome it did before
      // this file existed.
      if (url.includes('awards.json')) return overrides.awardsResponse ?? contentResponse([], 'sha-awards');
      // Phase 3, Task 2 (pulled forward): the twelfth content file, joining
      // CONTENT_FILES (and therefore EditMode's own blanket load effect)
      // now that src/admin/content.ts registers it -- the same reason
      // pages.json and awards.json each needed a branch here when THEY
      // joined. Task 8's own `buildBundle` now reads this through `pick`
      // (review fix round 1), the same as every other file here -- but no
      // test in this file renders the Experiences section at all, because
      // none of the local `SECTIONS` fixtures above include an `experiences`
      // entry. The `pick` wiring itself is covered directly against
      // `buildBundle`, below ("review fix round 1: buildBundle reads
      // experiences.json through pick"), which needs no full render and so
      // needs no fetch stub at all. Empty here is simply "nothing to show,"
      // not a stand-in for real content -- this branch exists only to keep
      // the load effect from throwing "Could not load experiences.json"
      // over every test in this file, none of which is about experiences.
      if (url.includes('experiences.json')) return contentResponse([], 'sha-experiences');
      // Phase 5B, Task 3: the thirteenth content file, joining CONTENT_FILES
      // (and therefore EditMode's own blanket load effect) now that
      // src/admin/content.ts registers it -- the same reason pages.json,
      // awards.json and experiences.json each needed a branch here when THEY
      // joined. Empty, matching that same precedent: /edit renders no post
      // surface until Task 11, so no test in this file is about posts, and an
      // empty list keeps every existing case seeing the same "nothing wrong"
      // load outcome. Without this branch the stub THROWS, which EditMode
      // reads as a genuine load failure and paints "Could not load
      // posts.json" over every test in the file. The `pick` wiring itself is
      // covered directly against `buildBundle` at the end of this file.
      if (url.includes('posts.json')) return contentResponse([], 'sha-posts');
      throw new Error(`EditMode.test.tsx: unexpected fetch to ${url}${init ? ` (${init.method ?? 'GET'})` : ''}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Task 5's own tests are the first in this file to touch localStorage
  // (the draft-persistence PublishBar now brings into EditMode) -- cleared
  // after every test so one test's saved draft never leaks into the next.
  window.localStorage.clear();
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

// The owner's own report: "there is no way to reach /edit/manage from
// /edit." The dashboard is where nine of the ten content files are actually
// editable, and the only route to it was typing the URL by hand.
describe('EditMode: the dashboard is reachable from /edit', () => {
  // Mutation this guards: deleting the `<a href="/edit/manage">` from
  // EditMode.tsx -- confirmed red.
  it('renders a link to /edit/manage', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link).toHaveAttribute('href', '/edit/manage');
  });

  // Two properties jsdom CAN check about "visible on phone and desktop",
  // both of them class-level (it applies no CSS and evaluates no media
  // query, so the real proof is e2e/edit-dashboard-link.spec.ts, which
  // measures it at 390px and 1440px in real Chromium).
  //
  // Mutation this guards: adding `hidden md:inline` to that anchor --
  // confirmed red. The same tap-not-hover mandate every other affordance in
  // this codebase follows: a control that only exists above a breakpoint,
  // or only on hover, does not exist on the phone she actually uses.
  it('does not gate that link behind a breakpoint or a hover state', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    const className = screen.getByRole('link', { name: /dashboard/i }).className;
    expect(className).not.toMatch(/(^|\s)(hidden|invisible|opacity-0)(\s|$)/);
    expect(className).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    expect(className).not.toMatch(/(^|\s)group-hover:/);
  });

  // It must not be swallowed by the capture-phase guard that stops the real
  // page's own links firing (EditMode's `handleCaptureClick`). It sits
  // OUTSIDE the wrapper that guard is attached to, which is why no fifth
  // carve-out was needed -- this pins that placement rather than the
  // reasoning about it.
  //
  // Mutation this guards: moving the anchor inside the
  // `<div onClickCapture={handleCaptureClick}>` -- confirmed red, the guard
  // then cancels its default because it navigates off this page.
  it('is not cancelled by the guard that stops the real page\'s own links', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    const link = screen.getByRole('link', { name: /dashboard/i });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    // The assertion above is already the proof; what follows only silences a
    // side effect of it. Because the click's default was genuinely not
    // prevented, jsdom schedules a real navigation attempt for this
    // real-href anchor via its own `setTimeout(..., 0)`
    // (HTMLHyperlinkElementUtils-impl.js) -- still pending when this test
    // function returns, so it used to fire during whichever test ran next
    // and print "Not implemented: navigation" there instead of here. Draining
    // it with a same-macrotask wait, console.error suppressed only across
    // that wait, keeps the noise attributed to (and scoped to) the test that
    // actually causes it.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      errorSpy.mockRestore();
    }
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
  // production change, simply wrong: Fix 1 makes the 401'd file genuinely
  // retried on re-login, and reusing the SAME already-settled 401 Response
  // for that retry (the old fixture's `pressResponse: press.promise`, a
  // single deferred value handed back on every call) made the retry 401
  // again too, re-triggering logout and hanging the test forever -- the
  // "replayed 401 fixture re-triggers logout" case named in this review.
  // This version makes the two fixtures that matter -- the one file that
  // already loaded (copy.json) and the one that 401'd (story.json) --
  // return DIFFERENT content on a SECOND fetch, so "was it clobbered?" and
  // "was it refilled?" are both directly observable on screen, not inferred
  // from a comment.
  //
  // Phase 5B, Task 11: this used to 401 press.json and look for its Article
  // content re-appearing (BlogTeaser's own rendering of it). BlogTeaser is
  // unrouted now -- the section behind `press` is BlogSection.tsx, which
  // reads posts.json through usePosts, not press.json through this
  // registry -- so press.json is no longer rendered by anything EditMode
  // mounts and can no longer serve as this test's observable "was it
  // refilled" proof. dishes.json (FoodGallery's own dish names) takes over
  // that role; the per-file guard itself is generic over CONTENT_FILES and
  // was never press.json-specific. story.json was tried first and rejected:
  // OurStory.tsx (story-api.ts's fetchStory) has its own independent runtime
  // read of published content, same as posts.json's usePosts, so a
  // story.json call count observed here would be counting TWO different
  // fetchers, not one -- confirmed directly (the count came out 3, not 2).
  // dishes.json has no such second reader.
  it('a loaded file is never re-fetched after a re-login (no clobber); a 401\'d file IS retried and fills in (no permanent blank)', async () => {
    let copyCalls = 0;
    let dishesCalls = 0;
    // If copy.json were wrongly re-fetched after the re-login, THIS is what
    // would land on screen instead of the original reservations-label text.
    const CLOBBERED_COPY: Copy = { ...COPY, hero: { ...COPY.hero, reservationsLabel: 'CLOBBERED-IF-REFETCHED' } };
    const REAL_DISHES: Dish[] = [
      { id: 'after-relogin', name: 'Loaded After Re-Login', description: 'x', image: '/x.jpg', tags: [] },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/login') return new Response(null, { status: 204 });
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        // BlogSection's own runtime read (usePosts, not this registry) --
        // harmless here and not what this test is about; see this file's
        // shared stubFetch() for the same branch.
        if (url.includes('posts.json')) return contentResponse([], 'sha-posts');
        if (url.includes('copy.json')) {
          copyCalls += 1;
          return contentResponse(copyCalls === 1 ? COPY : CLOBBERED_COPY, 'sha-copy');
        }
        if (url.includes('dishes.json')) {
          dishesCalls += 1;
          return dishesCalls === 1 ? unauthorizedResponse() : contentResponse(REAL_DISHES, 'sha-dishes-2');
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
    expect(await screen.findByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    expect(copyCalls).toBe(1);

    // dishes.json 401'd -- the corrected notice appears (Fix 1's other
    // half: the old wording promised the page "will still be showing
    // exactly what it was", which is untrue for a file that hadn't loaded
    // yet).
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(await screen.findByText(/whatever has already loaded will stay exactly as it was.*whatever hasn't will load now/)).toBeInTheDocument();
    expect(screen.getByText(COPY.hero.reservationsLabel)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());

    // Half 1 -- not clobbered: copy.json was fetched exactly once, ever.
    // The button still shows the ORIGINAL text; the second fixture's text
    // never appears.
    expect(copyCalls).toBe(1);
    expect(screen.getByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    expect(screen.queryByText('CLOBBERED-IF-REFETCHED')).not.toBeInTheDocument();

    // Half 2 -- refilled: dishes.json WAS retried after the re-login, and
    // its real content is now on screen -- not permanently blank.
    expect(dishesCalls).toBe(2);
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
    expect(await screen.findByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
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

    // The rest of the page still renders -- e.g. the reservations label,
    // which depends only on copy.json (unaffected here).
    expect(await screen.findByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    // The failure is reported, naming the file...
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/press\.json/);
    // ...and the loading banner is gone, not stuck forever.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // Phase 2, Task 11: awards.json's own 404 is the one CONTENT_FILES entry
  // that can genuinely, ordinarily 404 -- no award has ever been published
  // -- and this page has no Awards editing surface to show an error ABOUT
  // (fields.ts's own comment). Before EditMode.tsx's own fix, this looked
  // exactly like the genuine failure the sibling test just above covers:
  // the SAME generic "Could not load" alert, for a file whose only fault is
  // not existing yet.
  //
  // Mutation-provable: deleting the `file === 'awards.json' && error
  // instanceof ContentNotFoundError` branch from EditMode.tsx's own load
  // effect turns this red on the first assertion, with an alert reading
  // "Could not load awards.json" where none should be.
  it("awards.json's own 404 (no award ever published) shows no error and does not stall the loading banner", async () => {
    stubFetch({ awardsResponse: new Response(JSON.stringify({ message: 'That file does not exist yet.' }), { status: 404 }) });

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The rest of the page still renders, same as any other file's own
    // independent load.
    expect(await screen.findByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    // Give every other load effect the same settling window the sibling
    // test above relies on implicitly (its own `findByRole('alert')` await)
    // -- here there is deliberately nothing to find, so this waits on the
    // loading banner clearing instead, the positive half of the same fact.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Fix round 1 review (Minor 1): the 404-is-fine branch above returned
  // without clearing a STALE fileErrors['awards.json'] left by an earlier,
  // genuine (non-404) attempt -- the success `.then()` branch a few lines up
  // already clears exactly this for every other file; this branch is
  // awards.json's own version of success and needs the identical clear, not
  // a special exemption from it. Without it, a transient failure (a real
  // 500, a network blip) followed by the ordinary 404 state leaves the
  // "Could not load awards.json" banner standing over what is, right now, a
  // perfectly fine empty state.
  //
  // press.json is what forces the retry here (a 401, the same re-login
  // mechanism the "a loaded file is never re-fetched..." test above already
  // uses) -- awards.json itself has no 401 branch, so its own two calls are
  // driven by call count alone: the first (real, on initial load) 500s: the
  // second (after re-login) 404s.
  it('a stale error on awards.json clears once a later attempt reads its true, empty (404) state', async () => {
    let awardsCalls = 0;
    let pressCalls = 0;
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
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        if (url.includes('experiences.json')) return contentResponse([], 'sha-experiences');
        // Phase 5B, Task 3, same reason as the shared stub above.
        if (url.includes('posts.json')) return contentResponse([], 'sha-posts');
        if (url.includes('press.json')) {
          pressCalls += 1;
          return pressCalls === 1 ? unauthorizedResponse() : contentResponse(PRESS, 'sha-press-2');
        }
        if (url.includes('awards.json')) {
          awardsCalls += 1;
          return awardsCalls === 1
            ? new Response(null, { status: 500 })
            : new Response(JSON.stringify({ message: 'That file does not exist yet.' }), { status: 404 });
        }
        throw new Error(`EditMode.test.tsx (stale awards error test): unexpected fetch to ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The real, first-attempt failure: a genuine 500, reported like any
    // other.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/awards\.json/);
    expect(awardsCalls).toBe(1);

    // press.json's 401 drives the same re-login cycle the sibling test
    // above already exercises.
    await screen.findByLabelText(/password/i);
    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());

    // awards.json is retried (it never registered on the failed first
    // attempt) and this time reads its true, empty 404 state -- and the
    // STALE banner from the earlier 500 is gone, not still standing over it.
    await waitFor(() => expect(awardsCalls).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('EditMode: the page\'s own links do not fire', () => {
  afterEach(() => {
    // jsdom has no navigator.sendBeacon by default; restore that natural
    // state between tests the same way Hero.test.tsx's own suite does.
    delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
  });

  // Owner request, 2026-08-17: the Reserve a Table button this test used to
  // click was removed from Hero.tsx -- see that commit's brief. There is no
  // remaining WhatsApp-opening control on the homepage for this describe
  // block's "the page's own links do not fire" concern to cover; the Maps
  // link and menu-download link tests below are unaffected and still prove
  // the same class of thing for the controls that do still exist.

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

  // Named in this task's own review finding as one of the two cases with no
  // coverage at all. BlogTeaser's "View all" is a <button onClick={() =>
  // navigate('/blogs')}>, not an anchor -- there is no `href` for
  // preventDefault to cancel, so the ONLY thing that stops it is
  // stopPropagation keeping this onClick from ever being dispatched. A real
  // <Routes> table (not just a bare <EditMode/>) is what makes "did it
  // navigate" observable: if the click had gone through, `/blogs` would
  // have replaced this tree with the sentinel below.
  // Phase 5B, Task 11: the homepage `press` section is BlogSection.tsx now,
  // and its "View all" is a real router `<Link to="/blog">` (an <a>, not a
  // <button> with an onClick navigate) -- see EditMode.tsx's own
  // handleCaptureClick comment for why an anchor whose pathname differs from
  // `/edit`'s own is still blocked, just by the anchor clause instead of by
  // "not an anchor at all."
  it('clicking BlogSection\'s "View all" does not navigate to /blog', async () => {
    stubFetch();
    render(
      <MemoryRouter initialEntries={['/edit']}>
        <Routes>
          <Route path="/edit" element={<EditMode />} />
          <Route path="/blog" element={<div>BLOG PAGE SENTINEL</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const viewAll = await screen.findByRole('link', { name: COPY.press.viewAll });
    expect(fireEvent.click(viewAll)).toBe(false);

    expect(screen.queryByText('BLOG PAGE SENTINEL')).not.toBeInTheDocument();
    // Still on /edit: a section untouched by the click (Hero, which reads
    // none of posts.json) is still right there.
    expect(screen.getByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
  });

  // The other case the same review finding names as uncovered: Drinks'
  // menu download is a genuine <a href={menu.file} download>, so the same
  // preventDefault proof the Maps-link test above uses applies here too --
  // a real 9-12MB PDF must never start downloading just because she tapped
  // near it while reading.
  it('clicking a menu download link does not download -- preventDefault fires on the anchor itself', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: MENUS[0].label });
    expect(fireEvent.click(link)).toBe(false);
  });
});

describe('EditMode: in-page navigation and page chrome are not blocked (post-review, Task 2 Step 4 finding)', () => {
  it('clicking an in-page "#" nav link is NOT prevented -- the section jump stays alive', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const [firstLink] = COPY.nav.links;
    const link = await screen.findByRole('link', { name: firstLink.label });
    expect(link).toHaveAttribute('href', firstLink.href);
    // fireEvent.click's own return value is `!event.defaultPrevented` --
    // `true` here is direct proof this anchor's native "#" jump was left
    // alone, the mirror image of the Maps-link test above.
    expect(fireEvent.click(link)).toBe(true);
  });

  it('clicking the hamburger toggles aria-expanded -- the mobile nav panel is not dead', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const hamburger = await screen.findByRole('button', { name: COPY.nav.menuLabel });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
  });

  // C1 review finding (Critical): proven in a real Chromium build serving
  // this exact route -- clicking the camera control on a real, rendered
  // photo gave `fileInputClicks: 0`, `clickWasDefaultPrevented: true`. This
  // test drives the SAME interaction the bug report used and every other
  // test in this file could not: a real `fireEvent.click` on the CONTROL
  // ITSELF (the visible `<label>`, not `fireEvent.change(input)` fired
  // directly against the input, which is what every EditableImage test --
  // and every other test in this file -- does instead, and which cannot
  // observe whether the click ever REACHED the input in the first place),
  // mounted INSIDE EditMode's own capture-phase guard (not EditableImage in
  // isolation, the way EditableImage.test.tsx renders it -- the guard this
  // bug lives in does not exist there at all). jsdom implements a real
  // browser's own label-forwards-a-click-to-its-control behaviour (confirmed
  // directly: a preventDefault()'d capture-phase click on a label suppresses
  // the forwarded click on its input here exactly as it did in the
  // reviewer's own Chromium run) -- which is exactly why `fireEvent.change`
  // could never have caught this: it skips the click path (and therefore
  // the guard) entirely, going straight to dispatching `change` on the
  // input as if the picker had already returned a file.
  it('the camera control on a real photo actually reaches its own file input -- C1: fireEvent.change alone could never prove this', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // The real, committed galleries.json's own first Atmosfera photo --
    // named explicitly by the review's own repro.
    const [firstAtmospherePhoto] = GALLERIES.atmosphere;
    const control = await screen.findByTitle(`Replace ${firstAtmospherePhoto.alt}`);
    expect(control.tagName).toBe('LABEL');
    const input = control.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const inputClickSpy = vi.fn();
    input.addEventListener('click', inputClickSpy);
    // `fireEvent.click`'s own return value is `!event.defaultPrevented` --
    // `true` here is what a fixed guard must produce (the mirror image of
    // the Maps-link test above, which asserts `false` for the click that
    // must stay blocked).
    expect(fireEvent.click(control)).toBe(true);
    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

});

// Plan 6's collage-move tests lived here: a move driven through
// CollageTile's own arrow buttons, published, and read back out of the real
// POST body. Both the buttons and the grid placement string they wrote are
// gone with the split tree -- there is no `className` on a collage photo to
// publish any more. What they were really proving about the PUBLISH path --
// that galleries.json rides the existing pipeline with no collage-specific
// code in publish.ts -- is proven unchanged by the photo-replacement tests
// further down this file, which write into the same registry entry through
// the same `registry.updateData`. The gestures that replace them (drag to
// swap, drag a divider) are the next tasks in this plan and get their own
// real-Chromium specs in e2e/, because jsdom cannot hit-test a drag.

describe('EditMode: one malformed content file does not take down the page', () => {
  it('dishes.json parsing to the wrong shape (an object, not an array) shows a per-section error, while the rest of the page still renders', async () => {
    // Valid JSON, wrong shape: content.ts's fetchContent only parses --
    // it has no runtime shape check (that module's own header comment names
    // this exact risk) -- so this reaches FoodGallery's `dishes.map(...)`
    // as a plain object, which throws "dishes.map is not a function".
    stubFetch({ dishesResponse: contentResponse({}, 'sha-dishes-bad') });

    // This test deliberately trips a real render error so SectionErrorBoundary
    // catches it -- React's dev-mode logging of the caught error (and
    // SectionErrorBoundary's own componentDidCatch, SectionErrorBoundary.tsx)
    // both go to console.error, and jsdom separately reports the same throw
    // via its virtualConsole (also routed to console.error, confirmed against
    // jsdom's own VirtualConsole.sendTo). Suppressed here, scoped to this one
    // test, because the failure itself is the point of the test, not a defect
    // to surface; the boundary firing is still proven below by real, on-screen
    // assertions -- silencing reporting, not behaviour.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MemoryRouter>
          <EditMode />
        </MemoryRouter>,
      );

      // The one broken section reports itself...
      expect(await screen.findByText(/could not show menu/i)).toBeInTheDocument();
      // ...while an unrelated section (Hero, which never touches dishes)
      // still rendered normally.
      expect(screen.getByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Post-review Fix 2 (Important): the review's own measured table found
  // `sections.json` uniquely different from every other malformed-file case
  // -- `document.body.textContent === ''`, total page loss, because
  // `bundle.sections.filter(...)` used to run directly in EditMode's own
  // render body, outside every SectionErrorBoundary.
  it('sections.json parsing to an object instead of an array shows a boundary fallback for the section list, not a blanked page', async () => {
    stubFetch({ sectionsResponse: contentResponse({}, 'sha-sections-bad') });

    // See the dishes.json test above for why console.error is suppressed
    // here: this test deliberately trips two real boundaries (Sections and
    // Navbar, both below), and both React's dev logging and jsdom's own
    // reporting of the underlying throw are noise, not signal, for what this
    // test proves.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
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
    } finally {
      errorSpy.mockRestore();
    }
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

    // Three boundaries fire at once here (SEO, Navigation, Footer) -- see
    // the dishes.json test's own comment above for why console.error is
    // suppressed rather than left to print each one's React + jsdom noise.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
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
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a malformed copy.json trips the Navigation and Footer boundaries -- SEO does not read copy.json at all, and the page still stands', async () => {
    stubFetch({ copyResponse: contentResponse({}, 'sha-copy-bad') });

    // Two boundaries fire here (Navigation, Footer) -- same suppression, same
    // reason, as the dishes.json test's own comment above.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
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
    } finally {
      errorSpy.mockRestore();
    }
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

    await screen.findByText(COPY.hero.reservationsLabel);
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

// Plan 5 Task 3, Step 4: text becomes writable, through
// registry.updateData -- never registry.register, whose own comment
// documents the false-conflict-on-second-publish it would reintroduce here.
// There is no PublishBar mounted inside EditMode yet (Task 5), so "wrote
// back through the registry" is proven the same way every other fact about
// what's currently on screen in this file is proven: by what's rendered,
// not by reaching into React internals.
describe('EditMode: committing a text edit writes it back and it appears on screen', () => {
  it('editing the reservations label and blurring replaces the displayed text with what she typed', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const field = await screen.findByText(COPY.hero.reservationsLabel);
    expect(field.getAttribute('data-editable-path')).toBe('hero.reservationsLabel');

    fireEvent.focus(field);
    field.textContent = 'Book Your Table Now';
    fireEvent.blur(field);

    expect(await screen.findByText('Book Your Table Now')).toBeInTheDocument();
    expect(screen.queryByText(COPY.hero.reservationsLabel)).not.toBeInTheDocument();
  });

  // EditMode.tsx's own `copyLoaded` guard (buildBundle): committing an edit
  // before copy.json has a registry entry would call registry.updateData
  // against a file with no entry yet -- a documented no-op (publish.ts's own
  // comment on `updateData`) that would silently discard whatever she typed
  // into a still-blank heading. Proven by holding copy.json's own fetch open
  // and checking no `[data-editable-path]` marker exists yet -- not by
  // reaching into buildBundle directly -- so this is a black-box proof of
  // what she'd actually see: nothing clickable-to-edit until there is
  // something real to edit.
  //
  // Mutation this guards: dropping the `copyLoaded ? <EditableText .../> :
  // value` branch in buildBundle's renderText (always rendering
  // EditableText) -- confirmed red by that exact change, which makes a
  // `[data-editable-path]` marker appear immediately, before copy.json ever
  // resolves.
  it('before copy.json has loaded, its text is plain and un-editable -- no contentEditable marker exists until it has', async () => {
    let resolveCopy: (value: Response) => void = () => {};
    const copyPromise = new Promise<Response>((resolve) => {
      resolveCopy = resolve;
    });
    stubFetch({ copyResponse: copyPromise });

    const { container } = render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // Something that does NOT depend on copy.json has already loaded,
    // proving the page is genuinely up (not just mid-initial-render) while
    // copy.json's own fetch is still held open.
    await screen.findByRole('navigation');
    expect(container.querySelectorAll('[data-editable-path]')).toHaveLength(0);

    resolveCopy(contentResponse(COPY, 'sha-copy'));
    await screen.findByText(COPY.hero.reservationsLabel);
    expect(container.querySelectorAll('[data-editable-path]').length).toBeGreaterThan(0);
  });
});

// I8 review finding (Important): Task 3/4 make emptying a field a
// first-class action, with no client-side validation anywhere on /edit --
// she could empty a heading, see a normal-looking page, hit Publish, and
// get a server-side refusal (a real 422) with no field highlighted at all.
// PublishBar's own `problems` prop (already the exact mechanism the
// dashboard's RecordForm/RecordList screens use, via useValidation) is now
// wired up here too -- informational only, per useValidation's own header
// comment ("never let this hook's result gate what a publish is ALLOWED to
// send"): the Publish button itself stays enabled, this only tells her
// sooner what a publish would already refuse.
describe('EditMode: I8 -- client-side validation surfaces a problem before she ever clicks Publish', () => {
  it('emptying the reservations label shows the validator\'s own message, without disabling Publish', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const field = await screen.findByText(COPY.hero.reservationsLabel);
    fireEvent.focus(field);
    field.textContent = '';
    fireEvent.blur(field);

    // useValidation's own 400ms debounce (useValidation.ts) -- findByText
    // polls until it fires rather than this test hardcoding a wait.
    expect(await screen.findByText('content/copy.json: "hero.reservationsLabel" must not be blank')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled();
  });
});

// M1 review fix: this file's own comment on `editValidationProblems` used
// to say sections.json "has no editing affordance on this page at all" --
// stale the moment Task 5 wired a template section's own heading/paragraph/
// item/fact text and photos up to /edit's real commit path. Without
// validating it here, blanking a template heading gave no advance warning
// at all -- she would only find out at Publish, from a raw 422.
describe('EditMode: M1 -- sections.json validation also surfaces here, now that a template section is editable in place', () => {
  it('blanking a template section\'s heading at /edit shows the validator\'s own message, before she ever clicks Publish', async () => {
    const sectionsWithTemplate: Section[] = [
      ...SECTIONS,
      { kind: 'template', id: 'promo', enabled: true, template: 'text', content: { heading: 'Original Heading', paragraphs: ['A paragraph.'] } },
    ];
    stubFetch({ sectionsResponse: contentResponse(sectionsWithTemplate, 'sha-sections') });
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { level: 2, name: 'Original Heading' });
    const field = heading.querySelector('[data-editable-path="sections.promo.content.heading"]')!;
    fireEvent.focus(field);
    field.textContent = '';
    fireEvent.blur(field);

    // useValidation's own 400ms debounce -- findByText polls until it fires.
    // Mutation this guards: dropping the `useValidation('sections.json', ...)`
    // call this fix adds -- confirmed red, this text never appears (the old
    // comment's claim that sections.json "has no editing affordance ... so
    // validating them here would only ever surface a problem she has no way
    // to act on" was itself stale -- she just acted on exactly one).
    expect(await screen.findByText('this section needs a heading')).toBeInTheDocument();
    // The edit above also makes sections.json genuinely dirty, so this is a
    // real "problems don't gate Publish" proof for this file too (I8's own
    // rule), not just a hardcoded-clean fixture that happens to pass.
    expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled();
  });
});

// Minor review finding: /edit correctly never offers a DASHBOARD draft for
// restore (drafts.ts's own per-surface separation -- they are different
// sessions), but until now nothing told her one exists at all, so she could
// sit on /edit with no idea unpublished dashboard work was one tab over.
describe('EditMode: Minor -- a pre-existing DASHBOARD draft is mentioned, never restored, here', () => {
  it('a dashboard draft on disk is mentioned as a plain sentence, and the edit-surface banner is not shown for it', async () => {
    saveDraft('dashboard', { 'dishes.json': { data: DISHES, savedAt: 1_000 } });
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/unpublished changes saved on the dashboard/i)).toBeInTheDocument();
    // Never a restore offer -- no Restore/Discard buttons for it.
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('with no dashboard draft on disk, nothing is said about the other surface', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await screen.findByText(COPY.hero.reservationsLabel);
    expect(screen.queryByText(/unpublished changes saved on the dashboard/i)).not.toBeInTheDocument();
  });
});

// Task 2's own re-login proof obligation landed here, undischarged (that
// task could only prove the PAGE survived a 401 -- there was no edit yet to
// survive). Driven the same way that task's own "a loaded file is never
// re-fetched after a re-login" test is: two counters, and a SECOND, visibly
// different fixture value behind the file that 401s, so "was copy.json
// clobbered" is directly observable on screen rather than inferred from a
// comment.
//
// Phase 5B, Task 11: the file that 401s here moved from press.json to
// dishes.json for the same reason as the sibling test above -- BlogTeaser
// (the only thing that ever rendered press.json's Article content) is
// unrouted now, so press.json can no longer prove "was it refilled" on
// screen. The per-file guard under test is generic over CONTENT_FILES.
// story.json was tried and rejected: OurStory.tsx's own fetchStory
// (story-api.ts) reads published content independently of this registry,
// the same way posts.json's usePosts does, so it is not a clean single
// counter either.
describe('EditMode: an edit survives a 401 mid-session -- Task 2\'s per-file fetch guard is what makes it hold', () => {
  it('committing an edit to copy.json, then a 401 on a DIFFERENT file, then logging back in -- the edit is still on screen, and copy.json was fetched exactly once, ever', async () => {
    let copyCalls = 0;
    let dishesCalls = 0;
    // What would land on screen instead if copy.json were wrongly
    // re-fetched after the re-login and clobbered her edit.
    const CLOBBERED_COPY: Copy = { ...COPY, hero: { ...COPY.hero, reservationsLabel: 'CLOBBERED-IF-REFETCHED' } };
    const REAL_DISHES: Dish[] = [
      { id: 'after-relogin', name: 'Loaded After Re-Login', description: 'x', image: '/x.jpg', tags: [] },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/login') return new Response(null, { status: 204 });
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        // BlogSection's own runtime read (usePosts, not this registry) --
        // harmless here and not what this test is about; see this file's
        // shared stubFetch() for the same branch.
        if (url.includes('posts.json')) return contentResponse([], 'sha-posts');
        if (url.includes('copy.json')) {
          copyCalls += 1;
          return contentResponse(copyCalls === 1 ? COPY : CLOBBERED_COPY, 'sha-copy');
        }
        if (url.includes('dishes.json')) {
          dishesCalls += 1;
          return dishesCalls === 1 ? unauthorizedResponse() : contentResponse(REAL_DISHES, 'sha-dishes-2');
        }
        throw new Error(`EditMode.test.tsx (edit-survives-401 test): unexpected fetch to ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // copy.json loaded on the first pass -- commit a real edit to it before
    // anything else happens.
    const field = await screen.findByText(COPY.hero.reservationsLabel);
    expect(copyCalls).toBe(1);
    fireEvent.focus(field);
    field.textContent = 'MY EDIT SURVIVES';
    fireEvent.blur(field);
    expect(await screen.findByText('MY EDIT SURVIVES')).toBeInTheDocument();

    // dishes.json 401'd -- the login overlay appears over the still-mounted
    // page, exactly as Task 2 proved; her edit is still right there beneath
    // it.
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByText('MY EDIT SURVIVES')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());

    // Not clobbered: copy.json was fetched exactly once, ever -- the
    // per-file guard (`if (entries[file] !== undefined) return;`,
    // EditMode.tsx) skipped it on the re-login pass because it already had
    // an entry (her edit). Her edit is still on screen; the clobbered
    // fixture's text never appears.
    expect(copyCalls).toBe(1);
    expect(screen.getByText('MY EDIT SURVIVES')).toBeInTheDocument();
    expect(screen.queryByText('CLOBBERED-IF-REFETCHED')).not.toBeInTheDocument();

    // And the file that genuinely 401'd was retried and filled in, matching
    // Task 2's own guarantee alongside this one.
    expect(dishesCalls).toBe(2);
    expect(await screen.findByText('Loaded After Re-Login')).toBeInTheDocument();
  });
});

// Task 3 review Finding C4: this is Plan 4's handover item 1 in a new
// costume -- "the registry owns the sha; a section must never pass one on
// an edit" -- and it is the one EditMode.tsx behaviour every other test in
// this file proves black-box, through the rendered page, that cannot be
// proven that way here. `register` and `updateData` produce an IDENTICALLY
// observable registry today (Task 3 alone has no `markPublished` caller yet
// to make a stale, re-passed sha visibly diverge from a fresh one -- that
// only arrives with Task 5's publish flow), so no on-screen assertion can
// tell them apart yet; a stub ContentRegistry, built directly against
// buildBundle (exported from EditMode.tsx for exactly this), is the only
// seam that can. Pinned now, ahead of Task 5, per that task's own note: this
// is what produced the false "Someone else published while you were editing"
// on a file's SECOND publish in a session, and it only starts biting once
// something is actually watching the sha `register` would clobber.
describe('Task 3 review Finding C4: committing a text edit calls registry.updateData, never registry.register', () => {
  it('editing and blurring an already-loaded copy.json leaf calls updateData exactly once, and never calls register at all', () => {
    const entries: ContentEntries = {
      'copy.json': { data: COPY, initial: COPY, sha: 'sha-copy' },
    };
    const register = vi.fn();
    const updateData = vi.fn();
    const registry: ContentRegistry = {
      register,
      updateData,
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle(entries, registry, vi.fn());
    render(<>{bundle.renderText('hero.reserveButton', COPY.hero.reserveButton)}</>);

    const field = screen.getByRole('textbox');
    fireEvent.focus(field);
    field.textContent = 'A Brand New Label';
    fireEvent.blur(field);

    expect(updateData).toHaveBeenCalledTimes(1);
    const [file, nextCopy] = updateData.mock.calls[0] as [string, Copy];
    expect(file).toBe('copy.json');
    expect(nextCopy.hero.reserveButton).toBe('A Brand New Label');
    // Mutation this guards: `commitText` calling
    // `registry.register('copy.json', setCopyText(copy, path, next), entry.sha)`
    // instead of `registry.updateData(...)` -- confirmed red.
    expect(register).not.toHaveBeenCalled();
  });
});

// Plan 7, Task 5, Step 1: the bug this exact double-registry technique
// caught -- confirmed directly, before this fix existed: editing a
// template section's own heading at /edit called `registry.updateData`
// with `'copy.json'`, UNCHANGED (setCopyText's own malformed-namespace
// guard silently no-ops on a path like `sections.promo.content.heading`,
// since `Copy` has no `sections` key at all) -- a template section's own
// text edit was being silently discarded, with no error and nothing on
// screen telling her it never happened. This test proves the fix: the
// SAME edit now calls updateData with `'sections.json'`, carrying the
// real updated section, and never touches copy.json at all.
describe('Plan 7, Task 5: a template section\'s own text edit commits to sections.json, not copy.json', () => {
  it('editing and blurring a template section\'s heading updates sections.json, leaving the bespoke sections and copy.json untouched', () => {
    const bespokeHero: Section = { kind: 'bespoke', id: 'hero', enabled: true };
    const templateSection: Section = {
      kind: 'template',
      id: 'promo',
      enabled: true,
      template: 'text',
      content: { heading: 'Old Heading', paragraphs: ['A paragraph.'] },
    };
    const sectionsData: Section[] = [bespokeHero, templateSection];
    const entries: ContentEntries = {
      'copy.json': { data: COPY, initial: COPY, sha: 'sha-copy' },
      'sections.json': { data: sectionsData, initial: sectionsData, sha: 'sha-sections' },
    };
    const register = vi.fn();
    const updateData = vi.fn();
    const registry: ContentRegistry = {
      register,
      updateData,
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle(entries, registry, vi.fn());
    render(<>{bundle.renderText('sections.promo.content.heading', 'Old Heading')}</>);

    const field = screen.getByRole('textbox');
    fireEvent.focus(field);
    field.textContent = 'New Heading';
    fireEvent.blur(field);

    expect(updateData).toHaveBeenCalledTimes(1);
    const [file, nextSections] = updateData.mock.calls[0] as [string, Section[]];
    expect(file).toBe('sections.json');
    expect(nextSections).toHaveLength(2);
    expect(nextSections[0]).toEqual(bespokeHero); // the bespoke sibling is untouched
    expect(nextSections[1]).toMatchObject({ id: 'promo', content: { heading: 'New Heading', paragraphs: ['A paragraph.'] } });
    // The mutation this specifically guards against: copy.json must never
    // be the file this edit lands in.
    expect(updateData).not.toHaveBeenCalledWith('copy.json', expect.anything());
    expect(register).not.toHaveBeenCalled();
  });

  it('a section path renders NON-editable text until sections.json has actually loaded, the same gate copy.json leaves already have', () => {
    const entries: ContentEntries = {
      'copy.json': { data: COPY, initial: COPY, sha: 'sha-copy' },
      // sections.json deliberately absent -- not yet loaded.
    };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };
    const bundle = buildBundle(entries, registry, vi.fn());
    render(<>{bundle.renderText('sections.promo.content.heading', 'Old Heading')}</>);
    // No contentEditable textbox -- the plain value passed straight through,
    // the identical "no affordance before there's somewhere real to write
    // it" behaviour copyLoaded already gives copy.json leaves.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Old Heading')).toBeInTheDocument();
  });
});

// Plan 5 Task 4, Step 2: the staged-file key must be an identity the stage
// does not mutate. Tested directly against `buildBundle`'s own `renderImage`
// (the same white-box seam Finding C4's own describe block above uses),
// with a real FakeXHR double driving the real upload pipeline through a
// real EditableImage -- only the STAGE ACCUMULATOR itself is a stand-in,
// mirroring staged.ts's own already-independently-tested `useStagedFiles`
// reducer contract (set on a non-null file, delete on null) rather than
// re-deriving a hook inside a non-component test body.
describe('Plan 5 Task 4, Step 2: staged photos are keyed on an identity the stage does not mutate', () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];
    method = '';
    url = '';
    status = 0;
    responseText = '';
    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sentForm: FormData | null = null;
    constructor() {
      FakeXHR.instances.push(this);
    }
    open() {}
    send(body: FormData) {
      this.sentForm = body;
    }
    respond(status: number, body: unknown) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload?.();
    }
  }

  function jpegFile(name: string): File {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    return new File([bytes], name, { type: 'image/jpeg' });
  }

  function makeStageAccumulator() {
    const files: Record<string, object> = {};
    const stage = (key: string, file: object | null) => {
      if (file === null) delete files[key];
      else files[key] = file;
    };
    return { files, stage };
  }

  function makeRegistry(): ContentRegistry {
    const entries: ContentEntries = {
      'galleries.json': { data: GALLERIES, initial: GALLERIES, sha: 'sha-galleries' },
    };
    return {
      register: vi.fn(),
      updateData: vi.fn((file, data) => {
        entries[file as keyof ContentEntries] = { data, initial: (entries[file as keyof ContentEntries] as { initial: unknown }).initial, sha: 'sha-galleries' } as never;
      }),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };
  }

  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Waits for a NEW instance specifically (length > the count BEFORE this
  // call), not merely "any instance exists" -- `FakeXHR.instances` is a
  // class-static array that keeps growing across MULTIPLE picks within one
  // test (the two-tile test below calls this twice), so "length > 0" is
  // already true starting with the SECOND call regardless of whether ITS
  // OWN xhr has been constructed yet. Confirmed directly: the naive
  // "length > 0" version raced under real load (the full suite, not this
  // file in isolation) and occasionally answered the second `respond()`
  // against the FIRST tile's already-settled xhr, silently starving the
  // second tile's own upload and losing one of the two staged entries the
  // test after it exists to prove.
  async function pickAndRespond(input: HTMLInputElement, name: string, contentPath: string) {
    const before = FakeXHR.instances.length;
    const file = jpegFile(name);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(FakeXHR.instances.length).toBeGreaterThan(before));
    const xhr = FakeXHR.instances[FakeXHR.instances.length - 1];
    xhr.respond(200, { path: `assets-source/x/${name}`, contentPath });
  }

  // Verified directly against the real, committed galleries.json (Task 4's
  // own brief: "verify this yourself before relying on it") -- five paths
  // shared between atmosphere and the collage, three between ourStory and
  // the collage, none shared between atmosphere and ourStory.
  it('the real galleries.json really does share five atmosphere/collage photos and three ourStory/collage ones', () => {
    const srcs = (list: { src: string }[]) => new Set(list.map((e) => e.src));
    const atmosphere = srcs(GALLERIES.atmosphere);
    const ourStory = srcs(GALLERIES.ourStory);
    const heroCollage = srcs(collagePhotos(GALLERIES.heroCollage!));
    expect([...atmosphere].filter((s) => heroCollage.has(s))).toHaveLength(5);
    expect([...ourStory].filter((s) => heroCollage.has(s))).toHaveLength(3);
    expect([...atmosphere].filter((s) => ourStory.has(s))).toHaveLength(0);
    // 'galleries.atmosphere.0' and COLLAGE_DINING_PATH are the exact targets
    // the two tests below drive -- pinned here so a future edit to
    // galleries.json that moves either fails THIS assertion first, loudly,
    // rather than silently making the tests below pass for the wrong reason.
    // The collage half is addressed by the photo's own ID, not by a position:
    // a swap moves a photo to a different box and takes its id with it, which
    // is exactly what makes this name survive one.
    expect(GALLERIES.atmosphere[0].src).toBe('/atmosphere/dining.webp');
    expect(findCollagePhoto(GALLERIES.heroCollage!, COLLAGE_DINING_ID)?.src).toBe('/atmosphere/dining.webp');
  });

  // Minor review finding: an earlier version of this test rendered
  // `bundle.renderImage(COLLAGE_DINING_PATH, { src: ... })` exactly
  // ONCE, with the SAME `src` prop across all three picks -- so it could
  // never tell path-keying (what the stage key is ACTUALLY built from,
  // EditMode.tsx's own `${stageFile}:${path}`) apart from a hypothetical
  // src-keyed alternative, since `src` never once changed in that test's
  // own DOM. On the real page it DOES change: `commitImage`'s own
  // `registry.updateData` writes the newly staged `contentPath` back into
  // galleries.json, so the NEXT render's `content.renderImage` call passes
  // a DIFFERENT `src` for the same slot. Re-rendering with the freshly
  // staged path between picks (below) reproduces that real sequence --
  // confirmed red against a src-keyed mutation (`stage(\`${stageFile}:${
  // imgProps.src}\`, ...)` in place of the real path-keyed call): three
  // DIFFERENT keys land in `files` instead of one, since `src` itself
  // changes on every restage.
  it('restaging the SAME row three times leaves exactly one staged file, even as its own src changes between picks (path-keyed, not src-keyed)', async () => {
    const { files, stage } = makeStageAccumulator();
    const registry = makeRegistry();
    const bundle = buildBundle(registry.getEntries(), registry, stage);
    const { container, rerender } = render(
      <>{bundle.renderImage(COLLAGE_DINING_PATH, { src: '/atmosphere/dining.webp', alt: 'Dining room' })}</>,
    );
    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;

    await pickAndRespond(input(), 'first.jpg', '/x/first.webp');
    await waitFor(() => expect(Object.keys(files)).toHaveLength(1));
    // What a real re-render sees next: PlaceGallery re-reads galleries.json
    // from the (now-updated) registry, and hands renderImage the SAME
    // path with a DIFFERENT src -- the just-staged contentPath.
    rerender(<>{bundle.renderImage(COLLAGE_DINING_PATH, { src: '/x/first.webp', alt: 'Dining room' })}</>);
    await pickAndRespond(input(), 'second.jpg', '/x/second.webp');
    rerender(<>{bundle.renderImage(COLLAGE_DINING_PATH, { src: '/x/second.webp', alt: 'Dining room' })}</>);
    await pickAndRespond(input(), 'third.jpg', '/x/third.webp');

    await waitFor(() => expect(Object.keys(files)).toHaveLength(1));
  });

  // The plan's own named repro: replacing the Atmosfera copy of
  // /atmosphere/dining.webp must not evict the staged bytes for the
  // hero-collage tile showing the same photo (a KEY collision would show
  // up here as one entry overwriting the other, or as one entry mutating
  // out from under the other's own key).
  it('the Atmosfera row and the hero-collage tile that share /atmosphere/dining.webp leave TWO staged files, under distinct keys', async () => {
    const { files, stage } = makeStageAccumulator();
    const registry = makeRegistry();
    const bundle = buildBundle(registry.getEntries(), registry, stage);
    const atmosphere = render(
      <>{bundle.renderImage('galleries.atmosphere.0', { src: '/atmosphere/dining.webp', alt: 'Atmosfera dining' })}</>,
    );
    const heroCollage = render(
      <>{bundle.renderImage(COLLAGE_DINING_PATH, { src: '/atmosphere/dining.webp', alt: 'Collage dining' })}</>,
    );
    const atmosphereInput = () => atmosphere.container.querySelector('input[type="file"]') as HTMLInputElement;
    const heroCollageInput = () => heroCollage.container.querySelector('input[type="file"]') as HTMLInputElement;

    await pickAndRespond(atmosphereInput(), 'atmosphere-new.jpg', '/x/atmosphere-new.webp');
    await waitFor(() => expect(Object.keys(files)).toHaveLength(1));

    // Merely staging the SECOND tile -- the plan's own "opening the second
    // picker destroys the first" repro -- must not evict the first entry.
    await pickAndRespond(heroCollageInput(), 'hero-new.jpg', '/x/hero-new.webp');

    await waitFor(() => expect(Object.keys(files)).toHaveLength(2));
    const keys = Object.keys(files);
    expect(new Set(keys).size).toBe(2);
    expect(keys.some((k) => k.includes('galleries.atmosphere.0'))).toBe(true);
    expect(keys.some((k) => k.includes(COLLAGE_DINING_PATH))).toBe(true);
  });
});

// Plan 5 Task 4: renderImage's write-back path (EditMode's own commitImage,
// mirroring commitText/setCopyText) for the SECOND path shape -- an
// id-keyed item (dishes/drinks/press), not a positional gallery index --
// and the two states that must NOT produce a real editing affordance at
// all: a path renderImage does not recognise, and a recognised path whose
// own content file has not loaded yet.
describe('Plan 5 Task 4: committing a replacement writes back into the right content file, by the right key', () => {
  const DISH_A: Dish = { id: 'margherita', name: 'Margherita', description: 'Tomato, basil.', image: '/food/margherita.webp', tags: [] };
  const DISH_B: Dish = { id: 'diavola', name: 'Diavola', description: 'Spicy salami.', image: '/food/diavola.webp', tags: [] };

  function makeRegistryWithDishes(): { registry: ContentRegistry; entries: ContentEntries } {
    const entries: ContentEntries = {
      'dishes.json': { data: [DISH_A, DISH_B], initial: [DISH_A, DISH_B], sha: 'sha-dishes' },
    };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn((file, data) => {
        entries[file as 'dishes.json'] = { data, initial: entries[file as 'dishes.json']!.initial, sha: 'sha-dishes' };
      }),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };
    return { registry, entries };
  }

  it('an item-shaped path (dishes.<id>.image) writes the new contentPath into exactly that dish, siblings untouched', () => {
    const { registry, entries } = makeRegistryWithDishes();
    const bundle = buildBundle(entries, registry, vi.fn());
    const element = bundle.renderImage('dishes.margherita.image', { src: DISH_A.image!, alt: DISH_A.name }) as React.ReactElement<{
      onReplace: (contentPath: string) => void;
    }>;
    // Reaching the prop directly (not simulating a real pick through the
    // DOM) is deliberate here -- this test's own job is the PATH RESOLUTION
    // and WRITE-BACK logic (which content file, which record), already
    // exercised end-to-end through a real upload by the gallery tests
    // above; re-driving a full XHR pick just to reach the identical
    // onReplace call would test the same upload pipeline twice for no
    // extra coverage of what THIS test actually checks.
    element.props.onReplace('/food/margherita-new.webp');

    expect(registry.updateData).toHaveBeenCalledWith('dishes.json', [
      { ...DISH_A, image: '/food/margherita-new.webp' },
      DISH_B,
    ]);
  });

  // The collage's own write-back, the shape that replaced Plan 6's
  // `heroCollage[index].src`: a photo is named by its ID, and the rewrite has
  // to find it wherever in the tree it currently sits. A positional write
  // would be indistinguishable from this one until she swaps two photos and
  // then replaces one.
  it('a collage path (galleries.heroCollage.<photo id>) rewrites exactly that photo in the tree, wherever it sits', () => {
    const galleries = JSON.parse(JSON.stringify(GALLERIES)) as Galleries;
    const entries: ContentEntries = { 'galleries.json': { data: galleries, initial: galleries, sha: 'sha-galleries' } };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };
    const bundle = buildBundle(entries, registry, vi.fn());
    const element = bundle.renderImage(COLLAGE_DINING_PATH, { src: '/atmosphere/dining.webp', alt: '' }) as React.ReactElement<{
      onReplace: (contentPath: string) => void;
    }>;
    element.props.onReplace('/atmosphere/dining-new.webp');

    expect(registry.updateData).toHaveBeenCalledTimes(1);
    const [file, next] = (registry.updateData as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Galleries];
    expect(file).toBe('galleries.json');
    // Exactly one photo changed, and it is the one the path named.
    expect(findCollagePhoto(next.heroCollage!, COLLAGE_DINING_ID)?.src).toBe('/atmosphere/dining-new.webp');
    const before = collagePhotos(galleries.heroCollage!);
    const after = collagePhotos(next.heroCollage!);
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(after.filter((p, i) => p.src !== before[i].src).map((p) => p.id)).toEqual([COLLAGE_DINING_ID]);
    // The tree's own shape is untouched: this is a photo replacement, not a
    // rearrangement.
    expect(next.atmosphere).toBe(galleries.atmosphere);
  });

  // `galleries.json` is deliberately ALSO marked loaded here (not just
  // dishes.json) -- otherwise this test would pass even if
  // resolveImageTarget wrongly matched 'hero.brick.webp' as some gallery
  // path, since an unloaded galleries.json would ALSO fall back to the
  // identity <img>, for the wrong reason (the loaded-gate, not the path
  // resolution this test actually names). Confirmed directly while writing
  // this file.
  it('an unrecognised path falls back to the identity <img>, exactly like the default bundle', () => {
    const { registry, entries } = makeRegistryWithDishes();
    entries['galleries.json'] = { data: GALLERIES, initial: GALLERIES, sha: 'sha-galleries' };
    const bundle = buildBundle(entries, registry, vi.fn());
    const { container } = render(<>{bundle.renderImage('hero.brick.webp', { src: '/hero/brick.webp', alt: '' })}</>);
    expect(container.querySelector('[data-editable-image-path]')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', '/hero/brick.webp');
  });

  // Mirrors EditableText's own `copyLoaded` gate (buildBundle): committing a
  // replacement before ITS OWN content file has a registry entry would call
  // registry.updateData against nothing -- a documented no-op that would
  // silently discard an upload she just made.
  it('a recognised path whose own content file has not loaded yet also falls back to the identity <img>', () => {
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => ({}),
      version: 0,
      markPublished: vi.fn(),
    };
    const bundle = buildBundle({}, registry, vi.fn());
    const { container } = render(<>{bundle.renderImage('dishes.margherita.image', { src: '/food/margherita.webp', alt: 'Margherita' })}</>);
    expect(container.querySelector('[data-editable-image-path]')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', '/food/margherita.webp');
  });
});

// Plan 7, Task 5, Step 1: a template section's own photo -- both shapes
// (an item list's `items.<i>.image`, a gallery's `images.<i>`) -- writes
// back into sections.json, mirroring the dishes.json test above exactly.
describe('Plan 7, Task 5: a template section\'s own photo replacement writes back into sections.json', () => {
  function makeRegistryWithSections(section: Section): { registry: ContentRegistry; entries: ContentEntries } {
    const data: Section[] = [{ kind: 'bespoke', id: 'hero', enabled: true }, section];
    const entries: ContentEntries = { 'sections.json': { data, initial: data, sha: 'sha-sections' } };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn((file, next) => {
        entries[file as 'sections.json'] = { data: next, initial: entries[file as 'sections.json']!.initial, sha: 'sha-sections' };
      }),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };
    return { registry, entries };
  }

  it('an item list section\'s items.<i>.image writes into exactly that item, siblings and the bespoke section untouched', () => {
    const section: Section = {
      kind: 'template',
      id: 'breads',
      enabled: true,
      template: 'itemList',
      content: {
        heading: 'Breads',
        items: [
          { image: '/food/old-focaccia.webp', name: 'Focaccia', description: 'd1' },
          { image: '/food/old-hummus.webp', name: 'Hummus', description: 'd2' },
        ],
      },
    };
    const { registry, entries } = makeRegistryWithSections(section);
    const bundle = buildBundle(entries, registry, vi.fn());
    const element = bundle.renderImage('sections.breads.content.items.1.image', {
      src: '/food/old-hummus.webp',
      alt: 'Hummus',
    }) as React.ReactElement<{ onReplace: (contentPath: string) => void }>;
    element.props.onReplace('/food/new-hummus.webp');

    expect(registry.updateData).toHaveBeenCalledWith('sections.json', [
      { kind: 'bespoke', id: 'hero', enabled: true },
      {
        ...section,
        content: {
          heading: 'Breads',
          items: [
            { image: '/food/old-focaccia.webp', name: 'Focaccia', description: 'd1' },
            { image: '/food/new-hummus.webp', name: 'Hummus', description: 'd2' },
          ],
        },
      },
    ]);
  });

  it('a gallery section\'s images.<i> writes into exactly that image\'s src, alt untouched', () => {
    const section: Section = {
      kind: 'template',
      id: 'partners',
      enabled: true,
      template: 'gallery',
      content: { heading: 'Partners', layout: 'grid', images: [{ src: '/press/old-logo.webp', alt: 'Partner logo' }] },
    };
    const { registry, entries } = makeRegistryWithSections(section);
    const bundle = buildBundle(entries, registry, vi.fn());
    const element = bundle.renderImage('sections.partners.content.images.0', {
      src: '/press/old-logo.webp',
      alt: 'Partner logo',
    }) as React.ReactElement<{ onReplace: (contentPath: string) => void }>;
    element.props.onReplace('/press/new-logo.webp');

    expect(registry.updateData).toHaveBeenCalledWith('sections.json', [
      { kind: 'bespoke', id: 'hero', enabled: true },
      { ...section, content: { heading: 'Partners', layout: 'grid', images: [{ src: '/press/new-logo.webp', alt: 'Partner logo' }] } },
    ]);
  });
});

// Plan 5 Task 5: publish from edit mode. Step 1 reuses PublishBar and
// publish.ts wholesale (already exhaustively covered by PublishBar.test.tsx
// and publish.test.ts) -- these tests exercise the WIRING specifically:
// that /edit's own Publish button really reaches a real edit, that it saves
// and clears under the 'edit' draft key and never the dashboard's, and that
// the self-conflict wording (Step 3) actually reaches the screen from here.
describe('Plan 5 Task 5: publishing from /edit', () => {
  // Owner request, 2026-08-17: this used to edit the Reserve a Table button
  // (`hero.reserveButton`), removed from Hero.tsx along with its in-place
  // affordance -- see that commit's brief. `hero.reservationsLabel` is the
  // next hero leaf over ("For reservations"), still in-place editable, and
  // every test below only needs SOME real committed edit to drive the
  // publish flow, not this specific one.
  async function editReservationsLabel() {
    const field = await screen.findByText(COPY.hero.reservationsLabel);
    fireEvent.focus(field);
    field.textContent = 'Call Us to Reserve';
    fireEvent.blur(field);
    return field;
  }

  // Mutation this guards: the "no draft survives a successful publish"
  // OUTCOME, not one single line -- PublishBar.tsx clears it two ways (an
  // explicit clearDraft(draftSurface) right after a 200, and its own
  // persistence effect separately clearing on the NEXT registry.version
  // bump once markPublished has left nothing dirty), and removing only the
  // first is masked by the second in this exact scenario. Confirmed red
  // only when BOTH are removed at once -- reported honestly rather than
  // claiming the single line alone is what this pins.
  it('editing and publishing from /edit succeeds through the real publish.ts pipeline, and clears the edit draft on success', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await editReservationsLabel();
    await waitFor(() => expect(loadDraft('edit')).not.toBeNull());

    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    expect(publishButton).not.toBeDisabled();
    fireEvent.click(publishButton);
    acceptPublishConfirm();

    expect(await screen.findByText('Your changes are live.')).toBeInTheDocument();
    expect(loadDraft('edit')).toBeNull();
  });

  // Plan 5 Task 5, Step 2, proven end-to-end (not just at drafts.ts's own
  // unit level): a pre-existing DASHBOARD draft must survive /edit loading,
  // editing, and saving its own draft.
  it("editing from /edit saves under the 'edit' key only -- a pre-existing dashboard draft is untouched", async () => {
    const dashboardDraft = { 'dishes.json': { data: DISHES, savedAt: 1_000 } };
    saveDraft('dashboard', dashboardDraft);

    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await editReservationsLabel();
    await waitFor(() => expect(loadDraft('edit')).not.toBeNull());

    expect(loadDraft('edit')).toEqual({ 'copy.json': expect.objectContaining({ data: expect.anything() }) });
    expect(loadDraft('dashboard')).toEqual(dashboardDraft);
  });

  // Plan 5 Task 5, Step 3 review finding: each tab holds its own baseSha, so
  // publishing from one tab makes another stale -- reads as a 409 here.
  // Verifies the actual on-screen wording no longer says "someone else",
  // reached through /edit's own real publish button, not just asserted
  // against PublishBar in isolation.
  it('a 409 (the self-conflict shape -- her own second tab publishing first) shows same-session wording, not "someone else"', async () => {
    stubFetch({ publishResponse: new Response(JSON.stringify({ message: 'stale baseSha' }), { status: 409 }) });
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await editReservationsLabel();
    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    fireEvent.click(publishButton);
    acceptPublishConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/This may already be published.*another tab or device, including one of your own/);
    expect(alert).not.toHaveTextContent(/someone else/i);
  });

  // ---------------------------------------------------------------------
  // The editing pause, from /edit's side. No <fieldset> here: it would also
  // disable NavBar's hamburger (the one navigation affordance this file
  // carves out for phones) and put the UA sheet's `min-inline-size:
  // min-content` against the real homepage's layout. Three targeted gates
  // in buildBundle instead, each falling back to a render path that already
  // exists. These are presence/attribute assertions rather than hit-tests,
  // which is why they belong here and need no browser: the affordances are
  // REMOVED while paused, not covered.
  describe('editing on /edit is paused while a publish request is in flight', () => {
    // Takes a real edit as far as the POST, and holds it there.
    async function publishAndHang() {
      stubFetch({ publishResponse: new Promise<Response>(() => {}) });
      render(
        <MemoryRouter>
          <EditMode />
        </MemoryRouter>,
      );
      await editReservationsLabel();
      fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
      acceptPublishConfirm();
    }

    it('text stops being editable while paused, and is editable at idle', async () => {
      stubFetch();
      const { unmount } = render(
        <MemoryRouter>
          <EditMode />
        </MemoryRouter>,
      );
      await screen.findByText(COPY.hero.reservationsLabel);
      expect(document.querySelector('[data-editable-path="hero.logoName"]')?.getAttribute('contenteditable')).toBe('true');
      unmount();
      vi.unstubAllGlobals();

      await publishAndHang();
      await waitFor(() =>
        expect(document.querySelector('[data-editable-path="hero.logoName"]')?.getAttribute('contenteditable')).toBe('false'),
      );
    });

    // The camera badge is the one that carries a correctness stake, not just
    // a cosmetic one: it is the entry point to the same-key re-stage race
    // that destroys an upload's bytes mid-publish.
    it('the photo-replace badge is gone while paused, and present at idle', async () => {
      stubFetch();
      const { unmount } = render(
        <MemoryRouter>
          <EditMode />
        </MemoryRouter>,
      );
      expect(await screen.findAllByLabelText(/^Replace /)).not.toHaveLength(0);
      unmount();
      vi.unstubAllGlobals();

      await publishAndHang();
      await waitFor(() => expect(screen.queryByLabelText(/^Replace /)).toBeNull());
    });

    // Plan 6's version of this test used CollageTile's own select toggle,
    // which the split tree deleted along with the grid placement it moved.
    // The collage's remaining affordance is the camera badge on every photo
    // box, and the property is the same one: the pause must take it off the
    // collage too, not only off the flat galleries.
    it("the collage photos' own replace control is gone while paused, and present at idle", async () => {
      stubFetch();
      const { unmount } = render(
        <MemoryRouter>
          <EditMode />
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(document.querySelectorAll('[data-editable-image-path^="galleries.heroCollage."]').length).toBeGreaterThan(0),
      );
      expect(
        [...document.querySelectorAll('[data-editable-image-path^="galleries.heroCollage."]')]
          .filter((el) => el.querySelector('[title^="Replace "]')).length,
      ).toBeGreaterThan(0);
      unmount();
      vi.unstubAllGlobals();

      await publishAndHang();
      await waitFor(() =>
        expect(
          [...document.querySelectorAll('[data-editable-image-path^="galleries.heroCollage."]')]
            .filter((el) => el.querySelector('[title^="Replace "]')).length,
        ).toBe(0),
      );
    });

    // On this surface the affordances vanish entirely, so the sentence is
    // not decoration -- without it the page reads as "my editing broke".
    it('names the pause in the status line she is already reading', async () => {
      await publishAndHang();
      expect(await screen.findByText('Publishing… editing on this page is paused for a moment.')).toBeInTheDocument();
    });

    // Review finding (Important). The pause used to swap EditableImage for a
    // bare <img>, which UNMOUNTS it -- destroying the local preview of a
    // photo she had picked seconds earlier and running the cleanup that
    // revokes its object URL. The <img> then fell back to the
    // content-supplied path, a derivative that only exists once the
    // Cloudflare build finishes minutes later, so the photo she had just
    // placed turned into a broken image the instant she confirmed the
    // publish -- and stayed broken after the pause lifted, because both the
    // object URL and the state holding it were already gone.
    //
    // Mutation this catches: EditMode.tsx's renderImage returning
    // `<img {...props} />` when `locked` (or EditableImage's own `locked`
    // branch dropping the preview from `src`).
    it('a photo she picked keeps its preview through the pause, and its object URL is never revoked', async () => {
      // A third local XHR fake, for the same scope reason the two above
      // give: each is declared inside its own describe callback.
      class FakeXHR {
        static instances: FakeXHR[] = [];
        status = 0;
        responseText = '';
        upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          FakeXHR.instances.push(this);
        }
        open() {}
        send() {}
        respond(status: number, body: unknown) {
          this.status = status;
          this.responseText = JSON.stringify(body);
          this.onload?.();
        }
      }
      vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      try {
        // The POST is held open, so the pause never lifts on its own.
        stubFetch({ publishResponse: new Promise<Response>(() => {}) });
        render(
          <MemoryRouter>
            <EditMode />
          </MemoryRouter>,
        );

        // Addressed by the collage photo's own ID, via the path EditableImage
        // already carries -- there is no positional tile index any more, and
        // an id is what survives a swap.
        const tileEl = (await waitFor(() => {
          const el = document.querySelector(`[data-editable-image-path="${COLLAGE_DINING_PATH}"]`);
          expect(el).not.toBeNull();
          return el;
        })) as HTMLElement;
        const input = within(tileEl).getByTitle('Replace this photo').querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, 'files', {
          value: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], 'new-scene.jpg', { type: 'image/jpeg' })],
          configurable: true,
        });
        fireEvent.change(input);
        await waitFor(() => expect(FakeXHR.instances.length).toBeGreaterThan(0));
        FakeXHR.instances[FakeXHR.instances.length - 1].respond(200, {
          path: 'assets-source/atmosphere/reviewer-abc123.jpg',
          // The derivative path -- what the <img> falls back to the moment
          // the preview is lost, and what does not exist on the site until
          // the Cloudflare build finishes two or three minutes later.
          contentPath: '/images/atmosphere/reviewer-abc123.webp',
        });

        // Queried off the DOCUMENT, never off a node captured earlier: the
        // failure being pinned is a REMOUNT, so any element reference taken
        // before the pause is exactly what a broken version would leave
        // detached and still passing.
        const previewImg = () => document.querySelector('img[src^="blob:"]');
        const unbuiltImg = () => document.querySelector('img[src="/images/atmosphere/reviewer-abc123.webp"]');
        await waitFor(() => expect(previewImg()).not.toBeNull());
        const previewSrc = previewImg()!.getAttribute('src')!;
        expect(unbuiltImg()).toBeNull();

        const publishButton = await screen.findByRole('button', { name: 'Publish' });
        await waitFor(() => expect(publishButton).not.toBeDisabled());
        fireEvent.click(publishButton);
        acceptPublishConfirm();

        // Non-vacuous: the pause really is on -- every camera badge on the
        // page has gone, exactly as it did before this fix.
        await waitFor(() => expect(document.querySelectorAll('[title^="Replace "]')).toHaveLength(0));

        // ...and the photo she is looking at is still the one she picked.
        expect(document.querySelector(`img[src="${previewSrc}"]`)).not.toBeNull();
        expect(unbuiltImg()).toBeNull();
        expect(revoke).not.toHaveBeenCalled();
      } finally {
        revoke.mockRestore();
      }
    });
  });

  // The confirmation is wired into PublishBar itself, not into either
  // caller -- so it cannot be live on one surface and missing on the
  // other. This test is what makes that structural fact checkable: gating
  // the confirm on `draftSurface === 'dashboard'` inside PublishBar leaves
  // the whole dashboard suite green and turns exactly this one red, which
  // is why it is worth having here as well as there.
  //
  // /edit is also the surface where the confirmation matters more, not
  // less: this Publish button sits at the top of the real homepage, and it
  // became reachable at all only once PublishBar's `offsetTop` prop cleared
  // that page's own fixed nav (e2e/publish-confirm.spec.ts).
  it('publishing from /edit goes through the same confirmation, and sends nothing until she accepts', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    await editReservationsLabel();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(screen.getByRole('dialog', { name: /publish/i })).toBeInTheDocument();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/publish')).toHaveLength(0);
  });

  // Task 5's own draft-restore offer for /edit (not required verbatim by
  // the plan's own text, but the natural completion of Step 1's "reuse
  // publish.ts, do not fork" applied to the SAME draft mechanism Plan 4
  // built this recovery flow for in the first place -- a draft saved but
  // never offered back would be strictly worse than not saving one at all).
  it('a pre-existing edit-mode draft is offered on load, never auto-applied, and Restore puts it on screen', async () => {
    const draftCopy: Copy = { ...COPY, hero: { ...COPY.hero, reservationsLabel: 'Restored From Draft' } };
    saveDraft('edit', { 'copy.json': { data: draftCopy, savedAt: 5_000 } });

    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // Never auto-applied: the server's own value is what's on screen first.
    expect(await screen.findByText(COPY.hero.reservationsLabel)).toBeInTheDocument();
    expect(screen.queryByText('Restored From Draft')).not.toBeInTheDocument();

    const banner = await screen.findByRole('alert', { name: '' });
    expect(within(banner).getByText(/unsaved changes/i)).toBeInTheDocument();

    // C2 review finding (Critical): the banner showing here (plain React
    // state) used to be consistent with the draft ALREADY having been
    // deleted from localStorage -- PublishBar's own persistence effect saw
    // a freshly-loaded, entirely clean registry (nothing has been restored
    // into it yet, "never auto-apply" is the whole point of asking first)
    // on its very first tick and read that indistinguishably from "nothing
    // to publish", clearing the very draft this banner is, at this exact
    // moment, still asking her about. One more reload before she answered
    // would have lost the work permanently, with the banner itself giving
    // no hint anything was wrong. Asserted HERE, between mount and her
    // decision -- not merely after Restore succeeds -- because that is
    // exactly the window the bug lived in.
    expect(loadDraft('edit')).not.toBeNull();

    fireEvent.click(within(banner).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Restored From Draft')).toBeInTheDocument();
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });

  // C2 review finding (Critical), the other half: even once the draft
  // itself survives (the test above), an offer she can never see is no
  // offer at all. Measured on the real page in a real browser: the banner
  // used to render as a SIBLING after `</PublishBar>` -- i.e. after the
  // entire homepage, Footer included -- six viewports below the fold on a
  // 4800px-tall page. jsdom computes no real layout (every element's own
  // geometry is always zero, the same limitation this file's sibling
  // EditableText.test.tsx/EditableImage.test.tsx already document for the
  // identical reason), so DOCUMENT ORDER is the checkable proxy here: for
  // two plain block-level elements with no absolute/fixed positioning
  // pulling either one out of normal flow (true of both the banner and the
  // real Footer component), appearing earlier in the DOM means rendering
  // higher on the page. `compareDocumentPosition` is what actually proves
  // "before", not merely "both exist somewhere".
  it('the draft banner renders ABOVE the real Footer, not after the entire homepage', async () => {
    saveDraft('edit', { 'copy.json': { data: COPY, savedAt: 5_000 } });
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const banner = await screen.findByRole('alert', { name: '' });
    const footer = document.querySelector('footer');
    expect(footer).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4): `footer` comes AFTER `banner` in the
    // document -- i.e. the banner is the earlier of the two.
    expect(banner.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Review finding (Minor). The C2 comment in EditMode.tsx went on saying
  // the banner was "the FIRST thing inside this bar's own children" for the
  // whole life of the /edit/manage link paragraph that was later inserted
  // ahead of it. Nothing failed, and nothing could: the test above pins only
  // the far end of the move (banner before Footer), and no test anywhere
  // asserted what PRECEDES the banner -- so the one written record of why
  // this placement matters was free to describe a position the element no
  // longer occupied, and a later edit reasoning from it ("it's already
  // first, I can safely insert above it") would have been reasoning from a
  // false premise.
  //
  // The comment now records the real order. This is what keeps it that way:
  // reordering these two blocks turns this red instead of quietly making
  // another sentence false. Order only, not adjacency -- a third thing
  // legitimately inserted between them is not a defect, and pinning
  // `nextElementSibling` would report one.
  it('the /edit/manage link comes before the draft banner, which is what the C2 comment records', async () => {
    saveDraft('edit', { 'copy.json': { data: COPY, savedAt: 5_000 } });
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    const banner = await screen.findByRole('alert', { name: '' });
    const link = screen.getByRole('link', { name: 'Open the dashboard' });

    expect(link.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Plan 9, Task 4: the collage editor is actually wired into /edit.
//
// CollageEditor.test.tsx checks what the editor DOES; this checks that /edit
// hands it to `buildBundle` at all, and that the one thing which cannot be
// checked from inside the editor -- how the capture-phase click guard treats
// its controls -- comes out right on the real page.
describe('EditMode: the hero collage is rearrangeable at /edit', () => {
  async function renderEdit() {
    stubFetch();
    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.querySelectorAll('[data-collage-photo-id]').length).toBeGreaterThan(0));
  }

  // Mutation this guards: dropping `collage` from the object EditMode passes
  // `buildBundle` as its fifth argument, so the bundle falls back to the
  // PUBLIC renderers -- a collage that still draws perfectly and cannot be
  // touched, which is exactly the failure mode that would otherwise ship
  // unnoticed.
  it('every one of the eleven photos is a box the editor owns, named by its own id', async () => {
    await renderEdit();
    const ids = [...document.querySelectorAll('[data-collage-photo-id]')].map((el) =>
      el.getAttribute('data-collage-photo-id'),
    );
    expect(ids).toEqual(collagePhotos(GALLERIES.heroCollage!).map((p) => p.id));
  });

  // The panel is rendered OUTSIDE the `onClickCapture` wrapper, which is why
  // it needs no carve-out. Mutation this guards: moving `{collage.panel}`
  // inside that wrapper -- the guard then cancels every button in it.
  it('the panel’s own buttons are not cancelled by the guard that stops the page’s links', async () => {
    await renderEdit();
    fireEvent.focusIn(document.querySelector('[data-collage-photo-id]') as HTMLElement);
    const button = screen.getByRole('button', { name: 'Swap this photo with another photo' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  // ...and the controls that genuinely are inside the page -- the "Swap
  // here" targets, which sit within a collage box -- survive it only because
  // of the fourth carve-out, whose producer this is. Mutation this guards:
  // deleting the `data-collage-control` branch from `handleCaptureClick` --
  // confirmed red; the button's click is then cancelled and the swap can
  // never happen from a tap.
  it('a control inside the collage survives that guard, via the marker its producer always sets', async () => {
    await renderEdit();
    fireEvent.focusIn(document.querySelector('[data-collage-photo-id]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Swap this photo with another photo' }));
    const targets = screen.getAllByRole('button', { name: 'Swap the selected photo into this box' });
    expect(targets).toHaveLength(10);
    expect(targets[0].closest('[data-collage-photo-id]')).not.toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    targets[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  // Mutation this guards: EditMode passing `NO_IMAGE_PREVIEWS` (or nothing)
  // instead of its own `useImagePreviews()` store -- the <img> then keeps
  // showing the content path while she is looking at a photo she just
  // picked, which is the defect previews.ts exists for.
  it('a photo she has just picked is previewed from the screen’s own store', async () => {
    class FakeXHR {
      static instances: FakeXHR[] = [];
      status = 0;
      responseText = '';
      upload: { onprogress: null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        FakeXHR.instances.push(this);
      }
      open() {}
      send() {}
      respond(status: number, body: unknown) {
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    await renderEdit();
    const box = document.querySelector(`[data-editable-image-path="${COLLAGE_DINING_PATH}"]`) as HTMLElement;
    const input = within(box).getByTitle('Replace this photo').querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], 'p.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(FakeXHR.instances.length).toBeGreaterThan(0));
    await waitFor(() => expect(within(box).getByRole('presentation', { hidden: true })).toHaveAttribute('src', expect.stringMatching(/^blob:/)));
  });
});

// Review fix round 1, Important 1: `buildBundle` used to hand
// `bundle.experiences` a hardcoded `EMPTY_EXPERIENCES` unconditionally, even
// once `experiences.json` had actually loaded into the registry -- so /edit's
// own Experiences.tsx (no empty guard, by design) always rendered the
// section's heading and intro over zero cards, while the live homepage
// showed six. The fix is the same `pick(entries, 'experiences.json',
// EMPTY_EXPERIENCES)` every other committed content file already goes
// through, a few lines above this file's own `pages`/`sections` cases -- this
// test proves it directly against `buildBundle`'s return value, the same
// "call buildBundle, read the field" shape this file's other direct
// buildBundle tests already use, rather than a full render (nothing about
// this fix is about markup; `Experiences.tsx` itself is unchanged).
describe('Phase 3, Task 8 review fix round 1: buildBundle reads experiences.json through pick', () => {
  const EXPERIENCES_DATA: Experience[] = [
    { id: 'catering', title: 'Catering', description: 'd', image: '/atmosphere/table.webp', link: '/catering', comingSoon: false },
    { id: 'retail', title: 'Retail', description: 'd', image: '/experiences/retail.webp', comingSoon: true },
  ];

  it('a loaded experiences.json flows through to bundle.experiences, not the empty fallback', () => {
    const entries: ContentEntries = {
      'experiences.json': { data: EXPERIENCES_DATA, initial: EXPERIENCES_DATA, sha: 'sha-experiences' },
    };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle(entries, registry, vi.fn());

    // Mutation this guards: reverting `experiences: pick(entries,
    // 'experiences.json', EMPTY_EXPERIENCES)` back to the hardcoded
    // `experiences: EMPTY_EXPERIENCES` -- confirmed red (`[]` !== the real
    // two-item array).
    expect(bundle.experiences).toEqual(EXPERIENCES_DATA);
  });

  it('before experiences.json has loaded, bundle.experiences is the empty fallback, not undefined or a crash', () => {
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => ({}),
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle({}, registry, vi.fn());

    expect(bundle.experiences).toEqual([]);
  });
});

// Phase 5B, Task 3: the same binding, for posts.json. `bundle.posts` was a
// hardcoded `EMPTY_POSTS` for the whole of 5A, which was honest only because
// /edit rendered no post surface at all; Task 11 gives it one, and an empty
// preview against real posts live is Phase 3's EMPTY_EXPERIENCES defect
// verbatim.
//
// Written as IDENTITY plus a non-zero length rather than `toEqual`, and that
// is the point of the case: reverting `pick` to `posts: EMPTY_POSTS` is
// caught, and so is a copy (`posts: [...pick(...)]`), which `toEqual` would
// pass. The length assertion is what stops a fixture of `[]` from making the
// identity check vacuous -- `[] toBe []` would be true of the fallback too if
// the fallback were the same reference, and a present-but-empty fixture is
// exactly the shape that makes an absence test unfalsifiable.
describe('Phase 5B, Task 3: buildBundle reads posts.json through pick', () => {
  const POSTS_DATA: Post[] = [
    {
      id: 'first',
      slug: 'first',
      type: 'story',
      title: 'A first post',
      date: '2026-08-01',
      excerpt: 'An excerpt.',
      image: '/press/hotelier.webp',
      blocks: [{ kind: 'paragraph', text: 'Words.' }],
    },
  ];

  it('a loaded posts.json flows through to bundle.posts by reference, not the empty fallback and not a copy', () => {
    const entries: ContentEntries = {
      'posts.json': { data: POSTS_DATA, initial: POSTS_DATA, sha: 'sha-posts' },
    };
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => entries,
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle(entries, registry, vi.fn());

    // Mutation this guards: reverting `posts: pick(entries, 'posts.json',
    // EMPTY_POSTS)` to the hardcoded `posts: EMPTY_POSTS` -- confirmed red.
    expect(bundle.posts.length).toBeGreaterThan(0);
    expect(bundle.posts).toBe(POSTS_DATA);
  });

  it('before posts.json has loaded, bundle.posts is the empty fallback, not undefined or a crash', () => {
    const registry: ContentRegistry = {
      register: vi.fn(),
      updateData: vi.fn(),
      getEntries: () => ({}),
      version: 0,
      markPublished: vi.fn(),
    };

    const bundle = buildBundle({}, registry, vi.fn());

    expect(bundle.posts).toEqual([]);
  });
});
