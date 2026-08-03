// Coverage for EditMode.tsx (Plan 5 Task 2): the /edit route renders the
// real public homepage components with content fetched live from the
// Worker, a login overlay that survives a mid-session 401 without
// unmounting anything, and a capture-phase click guard so the page's own
// links (WhatsApp + the beacon, "View all", a menu download, the Maps
// link) cannot fire while she is just reading the page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// `pressResponse` is a Promise, not a Response, precisely so a caller can
// gate it with `deferred()` above and control exactly when it settles --
// every other file resolves immediately, matching how nine independent
// GET /api/content calls actually behave (not sequenced against one another).
function stubFetch(overrides: { dishesResponse?: Promise<Response> | Response; pressResponse?: Promise<Response> | Response } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url === '/api/login') return new Response(null, { status: 204 });
      if (url.includes('dishes.json')) return overrides.dishesResponse ?? contentResponse(DISHES, 'sha-dishes');
      if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
      if (url.includes('press.json')) return overrides.pressResponse ?? contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
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
  it('a file that 401s after others already rendered shows the login overlay on top -- the rest of the page, and its already-loaded content, stays exactly as it was, and survives a re-login', async () => {
    const press = deferred<Response>();
    stubFetch({ pressResponse: press.promise });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <EditMode />
      </MemoryRouter>,
    );

    // copy.json (one of the eight files that resolve immediately) is
    // already on screen -- the reserve button's own live text.
    const marker = await screen.findByRole('button', { name: COPY.hero.reserveButton });
    expect(marker).toBeInTheDocument();

    // Now the ninth file (press.json) comes back 401 -- a real Response,
    // through the real fetchContent path, not a manually-invoked logOut().
    press.resolve(unauthorizedResponse());

    // The login overlay appears...
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();

    // ...but the page underneath never unmounted: the marker is still
    // there, in the SAME render, not reloaded from scratch.
    expect(screen.getByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();

    // Log back in, on the same page.
    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    // The overlay is gone, and the marker survived the whole round trip
    // untouched -- nothing re-fetched it, so a since-changed mock response
    // could never have overwritten it either.
    await waitFor(() => expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: COPY.hero.reserveButton })).toBeInTheDocument();
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
});
