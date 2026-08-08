// The shell: routing, mount-and-hide, the draft gate, and the one-time
// first-panel seed.
//
// Everything about LAYOUT -- whether the sidebar is really visible at 1440
// and really absent at 390, whether five rows fit a 390x844 viewport without
// scrolling, whether anything is painted over anything else -- is in
// e2e/dashboard-sections.spec.ts instead. jsdom has no layout engine: every
// element measures zero and no media query evaluates, so a breakpoint
// mistake is invisible here by construction.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { markEveryAreaSeeded, renderDashboard } from '../../__tests__/renderDashboard';
import { DISHES, stubFetch } from '../../__tests__/dashboardFixtures';
import { AREAS, PANELS } from '../areas';
import { AREA_SEEDED_KEY_PREFIX, SECTION_OPEN_KEY_PREFIX, saveSectionOpen } from '../../open-sections';
import { DRAFT_STORAGE_KEY, saveDraft } from '../../drafts';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function contentFetchCount(file: string): number {
  const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter((call) => String(call[0]).includes(file)).length;
}

// The sidebar exists only at the wide branch, so a test that navigates by
// clicking has to be a wide one. That is not a workaround: on a phone the
// only route between two areas IS home -> area, which the drill-down case
// below exercises separately.
async function clickArea(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(within(screen.getByRole('navigation', { name: 'Areas' })).getByRole('link', { name: new RegExp(`^${label}`) }));
}

// ---------------------------------------------------------------------------
describe('areas mount once and stay mounted', () => {
  // The single most important case in this file. Written against seams that
  // exist: the registry is built by a hook inside AdminApp and nothing
  // outside it can spy on `register`, so "assert register was not called
  // again" is unwritable, and the tempting fix would spy on something the
  // component never calls through. What IS observable is the network and the
  // input.
  it('navigating away and back does not re-fetch, and does not lose the edit in between', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu', { wide: true });

    const dishName = await screen.findByDisplayValue('Dish A');
    await user.clear(dishName);
    await user.type(dishName, 'Dish A Edited');
    expect(contentFetchCount('dishes.json')).toBe(1);

    await clickArea(user, 'Pages');
    await screen.findByRole('heading', { name: 'Pages' });
    await clickArea(user, 'Menu');
    await screen.findByRole('heading', { name: 'Dishes' });

    // Mutation this guards: replace the `hidden` toggle with conditional
    // rendering. Both assertions go red -- the remount re-fetches, and
    // registerLoaded writes the clean SERVER value over her edit.
    expect(contentFetchCount('dishes.json')).toBe(1);
    expect(screen.getByDisplayValue('Dish A Edited')).toBeInTheDocument();
  });

  it('hides the four inactive areas with the hidden ATTRIBUTE, not a class', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByRole('heading', { name: 'Dishes' });

    // The container holding a visible area's panels, and the four holding
    // the rest. jsdom loads no CSS, so `getByRole`'s refusal to look inside
    // a hidden subtree -- which every visibility assertion below rides on --
    // only works for the attribute. The real-browser half of this claim (a
    // display utility on the same element silently defeating the user-agent
    // rule) is in the e2e spec.
    const dishesPanel = document.getElementById('section-panel-dishes');
    const container = dishesPanel?.closest('div[hidden], div:not([hidden])');
    expect(container).not.toBeNull();

    const hiddenContainers = Array.from(document.querySelectorAll('div[hidden]'));
    expect(hiddenContainers.length).toBeGreaterThan(0);
    hiddenContainers.forEach((el) => {
      expect(el.hasAttribute('hidden')).toBe(true);
      // No display-setting utility on the element carrying it.
      expect(el.className).not.toMatch(/(^|\s)(block|flex|grid|inline|inline-block|inline-flex|contents|table)(\s|$)/);
    });
  });
});

// ---------------------------------------------------------------------------
describe.each([
  { label: 'laptop', wide: true },
  { label: 'phone', wide: false },
])('routing ($label)', ({ wide }) => {
  it('each area URL shows its own panel headings and hides every other area', async () => {
    stubFetch();
    renderDashboard('/edit/manage/story', { wide });

    await screen.findByRole('heading', { name: 'Galleries' });
    expect(screen.getByRole('heading', { name: 'Our Story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Press' })).toBeInTheDocument();
    // Menu's, Pages' and Hours & Wording's panels are mounted but hidden, so
    // a role query -- which is what a screen reader and the tab order both
    // see -- does not reach them.
    ['Dishes', 'Drinks', 'Menus', 'Pages', 'Opening hours', 'Page copy'].forEach((heading) => {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });
  });

  it('a slug that matches no area shows the not-found screen, inside the shell, with the nav still there', async () => {
    stubFetch();
    renderDashboard('/edit/manage/not-a-thing', { wide });

    expect(await screen.findByRole('heading', { name: /isn’t here/ })).toBeInTheDocument();
    // Not a redirect to Menu, and not the public 404: the shell is up and
    // every area is one tap away.
    expect(screen.getByRole('navigation', { name: 'Areas' })).toBeInTheDocument();
    AREAS.forEach((area) => {
      expect(
        within(screen.getByRole('navigation', { name: 'Areas' })).getByRole('link', {
          name: new RegExp(`^${area.label}`),
        }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Dishes' })).not.toBeInTheDocument();
  });

  it.each(['/edit/manage', '/edit/manage/'])('the bare URL %s resolves by width', async (route) => {
    stubFetch();
    renderDashboard(route, { wide });

    if (wide) {
      // There is no home screen on a laptop -- the sidebar IS the home,
      // permanently -- so the bare URL redirects to the first area.
      await screen.findByRole('heading', { name: 'Dishes' });
      expect(screen.getByRole('navigation', { name: 'Areas' })).toBeInTheDocument();
    } else {
      expect(await screen.findByRole('heading', { name: /What would you like to change/ })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Dishes' })).not.toBeInTheDocument();
    }
  });

  it('the publish bar is on every screen, the bare URL included', async () => {
    stubFetch();
    renderDashboard('/edit/manage', { wide });
    expect(await screen.findByText('No changes to publish yet.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the phone drill-down', () => {
  it('home -> area -> back returns to home, through real links and not history.back()', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage');

    await screen.findByRole('heading', { name: /What would you like to change/ });
    await clickArea(user, 'Menu');

    await screen.findByRole('heading', { name: 'Dishes' });
    // No sidebar on a phone area screen; a back control instead.
    expect(screen.queryByRole('navigation', { name: 'Areas' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /All areas/ }));
    expect(await screen.findByRole('heading', { name: /What would you like to change/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the draft gate is structural, not layout', () => {
  const DRAFT = { 'dishes.json': { data: DISHES, savedAt: Date.now() } };

  it('blocks every area AND the publish bar until she answers', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(DRAFT));
    stubFetch();
    renderDashboard('/edit/manage/menu');

    expect(await screen.findByRole('alert')).toHaveTextContent(/you have unsaved changes/i);
    AREAS.flatMap((area) => area.panelIds).forEach((id) => {
      expect(screen.queryByRole('heading', { name: PANELS[id].heading })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Areas' })).not.toBeInTheDocument();
  });

  // The failure the gate exists for, stated as a fact about storage rather
  // than about the screen: if the areas mounted first, each would fetch,
  // registerLoaded would register the clean server value, the dirty map
  // would come back empty, and PublishBar's persistence effect would reach
  // clearDraft() -- permanently deleting the thing she was about to be
  // offered.
  it('leaves the draft in localStorage while it is still being offered', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(DRAFT));
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByRole('alert');

    // Long enough for every area's load effect to have resolved and for
    // PublishBar's persistence effect to have run, had either been mounted.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('the cross-surface /edit draft notice lives in the shell', () => {
  it('is still there after navigating to another area', async () => {
    saveDraft('edit', { 'dishes.json': { data: DISHES, savedAt: 1000 } });
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu', { wide: true });

    await screen.findByText(/unpublished changes saved on the live-page editor/i);
    await clickArea(user, 'Numbers');
    expect(screen.getByText(/unpublished changes saved on the live-page editor/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('a publish in flight pauses editing, never navigation', () => {
  it('the nav links have no disabled ancestor, and a click still changes the route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        // Never returns: the whole point is to observe the window while the
        // POST is still open.
        if (url === '/api/publish') return new Promise<Response>(() => {});
        if (url.includes('dishes.json')) {
          return new Response(JSON.stringify({ content: JSON.stringify(DISHES), sha: 'sha-dishes' }));
        }
        return new Response(JSON.stringify({ content: '[]', sha: 'sha' }));
      }),
    );
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu', { wide: true });

    const input = (await screen.findByDisplayValue('Dish A')) as HTMLInputElement;
    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(input).toBeDisabled());

    const nav = screen.getByRole('navigation', { name: 'Areas' });
    const numbers = within(nav).getByRole('link', { name: /^Numbers/ });
    // Structurally safe today (the nav is <a>, and the native disabled
    // cascade reaches form controls only) -- but structural safety is not a
    // reason to leave it unpinned. Mutation this guards: wrap the shell in a
    // disabled fieldset.
    expect(numbers.closest('[disabled], [aria-disabled="true"]')).toBeNull();

    await user.click(numbers);
    expect(await screen.findByRole('heading', { name: 'Numbers' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('an area that throws does not take the shell with it', () => {
  it('leaves the nav, all five items and the other areas reachable', async () => {
    // A galleries.json with none of the lists GalleryList's own .map/.length
    // calls assume -- the same malformed shape the per-panel boundary test
    // uses, which throws mid-render inside the Story & Photos area.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('galleries.json')) return new Response(JSON.stringify({ content: '{}', sha: 'sha' }));
        if (url.includes('dishes.json')) {
          return new Response(JSON.stringify({ content: JSON.stringify(DISHES), sha: 'sha-dishes' }));
        }
        return new Response(JSON.stringify({ content: '[]', sha: 'sha' }));
      }),
    );
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story', { wide: true });

    expect(await screen.findByText(/Could not show Galleries/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Areas' });
    AREAS.forEach((area) => {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${area.label}`) })).toBeInTheDocument();
    });

    await clickArea(user, 'Menu');
    expect(await screen.findByRole('heading', { name: 'Dishes' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the first panel of each area opens by itself, exactly once', () => {
  it('on a first-ever visit, opens the first panel and leaves the rest folded', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByRole('heading', { name: 'Dishes' });

    expect(screen.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Drinks' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(`${AREA_SEEDED_KEY_PREFIX}menu`)).toBe('1');
  });

  // The reason this needed its own key rather than a `defaultOpen` prop:
  // saveSectionOpen REMOVES the key when a panel is closed, so "never
  // opened" and "deliberately closed" are the same stored state, and a naive
  // default would re-open the one panel she keeps closing on every reload.
  //
  // Mutation this guards: drop the hasSeededArea check.
  it('once seeded, a panel she closed stays closed', async () => {
    markEveryAreaSeeded();
    saveSectionOpen('dishes', false);
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByRole('heading', { name: 'Dishes' });

    expect(screen.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}dishes`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('every button on this screen declares its type', () => {
  // PublishBar is one <form> wrapping the whole shell, and a bare <button>
  // inside a form defaults to type="submit" -- which here means a second
  // Publish trigger. Every control the shell brings inside that form has to
  // say what it is.
  it('no button is left to default to submit', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu', { wide: true });
    await screen.findByRole('heading', { name: 'Dishes' });

    const untyped = Array.from(document.querySelectorAll('button')).filter((b) => !b.hasAttribute('type'));
    expect(untyped.map((b) => b.textContent)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('the status strip is on every screen', () => {
  // A loop over AREAS plus the two screens that are NOT areas, because the
  // not-found screen is exactly where a header element gets dropped.
  const SCREENS = [
    ...AREAS.map((area) => ({ label: area.label, route: `/edit/manage/${area.slug}` })),
    { label: 'the phone home', route: '/edit/manage' },
    { label: 'the not-found screen', route: '/edit/manage/not-a-thing' },
  ];

  describe.each([
    { label: 'laptop', wide: true },
    { label: 'phone', wide: false },
  ])('at $label width', ({ wide }) => {
    it.each(SCREENS)('is present on $label', async ({ route }) => {
      stubFetch();
      renderDashboard(route, { wide });
      expect(await screen.findByLabelText('Site status')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
describe('a button the shell brought inside the publish form', () => {
  // PublishBar is a single <form> and now wraps the whole shell, so a bare
  // <button> anywhere inside it defaults to type="submit" and becomes a
  // second Publish trigger. The Numbers Retry button is the first one this
  // redesign adds; this is the case that would catch the next.
  it('clicking analytics Retry does not open the publish confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        if (url === '/api/analytics') {
          return new Response(JSON.stringify({ reason: 'unreachable', message: 'nope' }), { status: 502 });
        }
        return new Response(JSON.stringify({ content: '[]', sha: 'sha' }));
      }),
    );
    const user = userEvent.setup();
    renderDashboard('/edit/manage/numbers', { wide: true });

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(screen.queryByText('Publish these changes to the live site?')).not.toBeInTheDocument();
    // And it really is still on the Numbers screen, not somewhere else.
    expect(screen.getByRole('heading', { name: 'Numbers' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the nav says which area needs attention, and which has unsaved work', () => {
  // CollapsibleSection's own decision #2 exists because "a dishes.json that
  // would not load looked exactly like a dishes.json she had simply not
  // opened yet". This redesign adds a SECOND level of hiding, so a failed
  // copy.json raises its marker inside a container she cannot see while she
  // is in Menu. This is the second-level answer to it.
  it('marks the area a failed load happened in, from the other side of the shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        // Only copy.json fails. It lives in Hours & Wording, and the test
        // sits on Menu -- so the message itself is inside a hidden
        // container the whole time.
        if (url.includes('copy.json')) return new Response('nope', { status: 500 });
        if (url.includes('dishes.json')) {
          return new Response(JSON.stringify({ content: JSON.stringify(DISHES), sha: 'sha-dishes' }));
        }
        return new Response(JSON.stringify({ content: '[]', sha: 'sha' }));
      }),
    );
    renderDashboard('/edit/manage/menu', { wide: true });

    const nav = await screen.findByRole('navigation', { name: 'Areas' });
    expect(
      await within(nav).findByRole('img', { name: 'Hours & Wording needs attention' }),
    ).toBeInTheDocument();
    // And the message really is out of reach from here, which is the whole
    // reason the marker exists. Queried through the container rather than
    // through `queryByText`, which ignores visibility entirely: the message
    // IS in the document, inside a hidden area, which is exactly the
    // problem.
    const message = screen.getByText(/Could not load page copy/);
    expect(message.closest('[data-area]')).toHaveAttribute('hidden');
    expect(message.closest('[data-area]')).toHaveAttribute('data-area', 'details');
    // No other area is marked.
    expect(within(nav).queryByRole('img', { name: 'Menu needs attention' })).not.toBeInTheDocument();

    // Mutation this guards: narrow the observer to `childList` on direct
    // children only -- a problem raised several levels down inside a panel
    // stops marking its area and this goes red.
  });

  it('marks the area holding unsaved work, with a DIFFERENT marker', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu', { wide: true });

    const nav = await screen.findByRole('navigation', { name: 'Areas' });
    // Non-vacuous: nothing is marked before she types.
    expect(within(nav).queryByRole('img', { name: /unpublished changes/ })).not.toBeInTheDocument();

    const dishName = await screen.findByDisplayValue('Dish A');
    await user.type(dishName, '!');

    expect(await within(nav).findByRole('img', { name: 'Menu has unpublished changes' })).toBeInTheDocument();
    expect(within(nav).queryByRole('img', { name: 'Pages has unpublished changes' })).not.toBeInTheDocument();
  });

  // Two different signals. Reading either as the other is worse than showing
  // neither, so they are told apart by name and not by colour alone.
  //
  // Mutation this guards: render the same element for both -- the two
  // accessible names collapse into one and this goes red.
  it('the two markers are distinguishable by name, not only by colour', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu', { wide: true });

    const dishName = await screen.findByDisplayValue('Dish A');
    await user.clear(dishName);

    const nav = await screen.findByRole('navigation', { name: 'Areas' });
    // An empty dish name is a real validation problem AND an unsaved change,
    // so both markers land on the same area at once.
    expect(await within(nav).findByRole('img', { name: 'Menu needs attention' })).toBeInTheDocument();
    expect(within(nav).getByRole('img', { name: 'Menu has unpublished changes' })).toBeInTheDocument();
  });

  it('shows both markers on the phone home list too', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    const dishName = await screen.findByDisplayValue('Dish A');
    await user.type(dishName, '!');

    // Back to the home list, where the same nav renders as rows.
    await user.click(screen.getByRole('link', { name: /All areas/ }));
    const nav = await screen.findByRole('navigation', { name: 'Areas' });
    expect(within(nav).getByRole('img', { name: 'Menu has unpublished changes' })).toBeInTheDocument();
  });
});
