// Coverage for `ArraySection`, the ~90 lines inside AdminApp.tsx that fetch
// a content file, render its loading/error/loaded states, and wire
// RecordList's onChange/onAdd/onRemove/onReorder -- none of which any other
// test file exercises. `App.test.tsx` only reaches the logged-OUT screen
// (it stubs GET /api/wa as a 401, deliberately, per its own comment); the
// round-trip tests in useValidation.test.tsx render `RecordList` directly
// through hand-built harness components that never mount `AdminApp` or
// `ArraySection` at all. A broken Remove button, or a fetch error that
// never surfaces, would ship with nothing here to catch it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminApp from '../AdminApp';
import { DISH_FIELDS } from '../fields';
import type { Article, Dish, Drink, Section, SiteContent } from '../../content/types';

function dish(id: string, name: string): Dish {
  return { id, name, description: `${name}, described.`, image: `/food/${id}.webp`, tags: [] };
}
function drink(id: string, name: string): Drink {
  return { id, name, description: `${name}, described.`, category: 'cocktail', image: null };
}
function article(id: string, title: string): Article {
  return { id, title, publication: 'Times', date: '2026-01-01', excerpt: 'An excerpt.', url: null, image: `/press/${id}.webp` };
}

const DISHES = [dish('a', 'Dish A'), dish('b', 'Dish B')];
const DRINKS = [drink('x', 'Drink X'), drink('y', 'Drink Y')];
const PRESS = [article('p', 'Article P'), article('q', 'Article Q')];
const SECTIONS: Section[] = [
  { id: 'hero', enabled: true },
  { id: 'ourStory', enabled: true },
  { id: 'atmosphere', enabled: true },
  { id: 'food', enabled: true },
  { id: 'drinks', enabled: true },
  { id: 'press', enabled: true },
  { id: 'visit', enabled: true },
];
const SITE: SiteContent = {
  name: 'Via Bianca',
  tagline: 'Pastificio & Ristorante',
  strapline: 'Sip Italiano',
  address: { street: '1 Test Street', locality: 'Delhi', postalCode: '110048', country: 'IN' },
  phones: ['+91 00000 00000'],
  whatsapp: { number: '910000000000', prefilledMessage: 'Hi' },
  socials: { instagram: 'https://instagram.com/test', linkedin: null },
  hours: [{ days: ['Mo', 'Tu'], opens: '12:00', closes: '23:00' }],
  seo: { title: 'Via Bianca', description: 'An Italian kitchen', keywords: 'italian', ogImage: '/og.jpg', url: 'https://example.com', locale: 'en_IN' },
  copyrightYear: 2026,
};

const WA_RESPONSE = () =>
  new Response(JSON.stringify({ lowerBound: true }), { status: 200, headers: { 'content-type': 'application/json' } });

function contentResponse(data: unknown, sha: string): Response {
  return new Response(JSON.stringify({ content: JSON.stringify(data), sha }));
}

// A promise this test controls the resolution of, so a fetch handler can be
// made to hang deliberately -- the only reliable way to observe a loading
// state that would otherwise resolve within the same microtask tick a
// stubbed `fetch` always does, and so never be visible to `findBy`'s
// polling at all.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// `dishesResponse` is a Promise, not a Response, precisely so a caller can
// gate it with `deferred()` above; every other file resolves immediately,
// matching how the real GET /api/content calls actually behave (five
// independent requests, not sequenced).
function stubFetch(dishesResponse: Promise<Response> | Response = contentResponse(DISHES, 'sha-dishes')) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url.includes('dishes.json')) return dishesResponse;
      if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
      if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
      throw new Error(`AdminApp.test.tsx: unexpected fetch to ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminApp: fetches each content file once logged in, loading state first', () => {
  it('shows a loading message before the fetch resolves, then the fetched dish', async () => {
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    render(<AdminApp />);
    expect(await screen.findByText(/loading dishes/i)).toBeInTheDocument();
    // Not yet rendered -- the gate hasn't been released.
    expect(screen.queryByDisplayValue('Dish A')).not.toBeInTheDocument();

    gate.resolve(contentResponse(DISHES, 'sha-dishes'));
    expect(await screen.findByDisplayValue('Dish A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dish B')).toBeInTheDocument();
  });

  it('fetches and renders drinks and press independently of dishes', async () => {
    stubFetch();
    render(<AdminApp />);
    expect(await screen.findByDisplayValue('Drink X')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Drink Y')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Article P')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Article Q')).toBeInTheDocument();
  });

  it('shows a retrievable error message, not a blank section, when a fetch fails', async () => {
    stubFetch(new Response(null, { status: 401 }));
    render(<AdminApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load dishes/i);
    // The other two sections are unaffected by one file's failure.
    expect(await screen.findByDisplayValue('Drink X')).toBeInTheDocument();
  });
});

// Scoped to the Dishes <section> specifically, not the whole page --
// DISH_FIELDS.name and DRINK_FIELDS.name share the identical accessible
// label ("Name"), so `getAllByLabelText(DISH_FIELDS.name.label)` against
// the WHOLE rendered AdminApp collects both dishes' AND drinks' name
// inputs together (confirmed directly: the unscoped version of this file
// intermittently counted 4, not 2, depending on which of the three
// sections' independent fetches happened to resolve first). Every real
// content section shares this risk (`image` is "Photo" on all three types
// too), not just dishes/drinks' "Name" -- scoping by section is what a
// single-content-type harness (useValidation.test.tsx's DishesHarness)
// never had to do, because it only ever rendered one RecordList.
async function dishesSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Dishes' });
  const section = heading.closest('section');
  if (!section) throw new Error('Dishes heading is not inside a <section>');
  return section as HTMLElement;
}

describe('AdminApp: Add, Remove and Reorder, exercised through the real component', () => {
  it('"Add a dish" appends one new, blank row -- not a third copy of an existing one', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const section = await dishesSection();
    await within(section).findByDisplayValue('Dish A');

    expect(within(section).getAllByLabelText(DISH_FIELDS.name.label)).toHaveLength(2);
    await user.click(within(section).getByRole('button', { name: 'Add a dish' }));

    const nameInputs = within(section).getAllByLabelText(DISH_FIELDS.name.label);
    expect(nameInputs).toHaveLength(3);
    expect(nameInputs[2]).toHaveValue('');
  });

  it('"Remove Dish A" drops only that record, leaving Dish B intact', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const section = await dishesSection();
    await within(section).findByDisplayValue('Dish A');

    await user.click(within(section).getByRole('button', { name: 'Remove Dish A' }));

    expect(within(section).queryByDisplayValue('Dish A')).not.toBeInTheDocument();
    expect(within(section).getByDisplayValue('Dish B')).toBeInTheDocument();
    expect(within(section).getAllByLabelText(DISH_FIELDS.name.label)).toHaveLength(1);
  });

  it('"Move Dish A down" swaps the two dishes, each with its own values intact', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const section = await dishesSection();
    await within(section).findByDisplayValue('Dish A');

    await user.click(within(section).getByRole('button', { name: 'Move Dish A down' }));

    const nameInputs = within(section).getAllByLabelText(DISH_FIELDS.name.label);
    expect(nameInputs.map((el) => (el as HTMLInputElement).value)).toEqual(['Dish B', 'Dish A']);
  });
});

// Task 7: sections.json's own real, mounted screen -- neither SectionList's
// own test file (props supplied by hand) nor useValidation.test.tsx's
// SectionsHarness (built for RecordList, before SectionList existed) proves
// the actual fetch -> SectionsSection -> SectionList wiring this task adds.
describe('AdminApp: the real "Homepage sections" screen', () => {
  it('fetches sections.json and renders all seven, in the order the file gave them', async () => {
    stubFetch();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Homepage sections' });
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getAllByText(/^(Hero|Our Story|Atmosfera|Menu|Drinks|Stories|Visit Us)$/)).toHaveLength(7);
  });

  it('reordering the real screen calls through to a genuine onReorder, visible in the rendered order', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Homepage sections' });
    const section = heading.closest('section') as HTMLElement;
    await within(section).findByText('Hero');

    await user.click(within(section).getByRole('button', { name: 'Move Hero down' }));

    const HUMAN_NAMES = ['Hero', 'Our Story', 'Atmosfera', 'Menu', 'Drinks', 'Stories', 'Visit Us'];
    const namesInOrder = within(section)
      .getAllByRole('listitem')
      .map((li) => HUMAN_NAMES.find((name) => li.textContent?.startsWith(name)));
    expect(namesInOrder.slice(0, 2)).toEqual(['Our Story', 'Hero']);
  });

  it('hero cannot be unchecked from the real, mounted screen', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Homepage sections' });
    const section = heading.closest('section') as HTMLElement;
    await within(section).findByText('Hero');

    const heroToggle = within(section).getAllByLabelText('Shown on homepage')[0];
    expect(heroToggle).toBeDisabled();
    await user.click(heroToggle);
    expect(heroToggle).toBeChecked(); // unchanged
  });
});

// Task 7: site.json's own real, mounted "Opening hours" screen.
describe('AdminApp: the real "Opening hours" screen', () => {
  it('fetches site.json and renders its hours row', async () => {
    stubFetch();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Opening hours' });
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByDisplayValue('12:00')).toBeInTheDocument();
    expect(within(section).getByDisplayValue('23:00')).toBeInTheDocument();
  });

  it('a past-midnight close, entered on the real screen, produces no validation problem', async () => {
    stubFetch();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Opening hours' });
    const section = heading.closest('section') as HTMLElement;
    await within(section).findByDisplayValue('23:00');

    const closesInput = within(section).getByDisplayValue('23:00');
    fireEvent.change(closesInput, { target: { value: '00:30' } });

    // The debounced whole-file validation (useValidation, 400ms) has to
    // actually settle before this assertion means anything -- checking
    // immediately would trivially pass (nothing has validated yet either
    // way), which is exactly the kind of test that cannot fail this
    // project's own standing rule warns about. `act(async () => ...)`
    // around the real wait is what keeps the resulting state update inside
    // React's own act boundary, rather than a bare `setTimeout` firing it
    // unobserved. A "closes must be after opens" rule, if one were ever
    // added, would surface here as a role="alert" once this resolves.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
  });

  // Proves the wait above is actually long enough for the debounce to have
  // settled, rather than the "no alert" assertion happening to pass because
  // nothing had validated yet either way -- the identical wait, on a
  // genuinely malformed edit, DOES surface a role="alert" through the same
  // real fetch -> HoursSection -> HoursField -> RecordForm wiring.
  it('(companion to the above) a malformed opens time on the real screen DOES surface an alert after the same wait', async () => {
    stubFetch();
    render(<AdminApp />);
    const heading = await screen.findByRole('heading', { name: 'Opening hours' });
    const section = heading.closest('section') as HTMLElement;
    await within(section).findByDisplayValue('12:00');

    const opensInput = within(section).getByDisplayValue('12:00');
    fireEvent.change(opensInput, { target: { value: 'not-a-time' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(within(section).getByRole('alert')).toHaveTextContent(/invalid "opens" time/);
  });
});
