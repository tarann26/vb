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
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminApp from '../AdminApp';
import { DISH_FIELDS } from '../fields';
import type { Article, Dish, Drink } from '../../content/types';

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
// matching how the real GET /api/content calls actually behave (three
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
