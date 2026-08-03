// Coverage for `ArraySection`, the ~90 lines inside AdminApp.tsx that fetch
// a content file, render its loading/error/loaded states, and wire
// RecordList's onChange/onAdd/onRemove/onReorder -- none of which any other
// test file exercises. `App.test.tsx` only reaches the logged-OUT screen
// (it stubs GET /api/wa as a 401, deliberately, per its own comment); the
// round-trip tests in useValidation.test.tsx render `RecordList` directly
// through hand-built harness components that never mount `AdminApp` or
// `ArraySection` at all. A broken Remove button, or a fetch error that
// never surfaces, would ship with nothing here to catch it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminApp from '../AdminApp';
import { DISH_FIELDS } from '../fields';
import type { Article, Copy, Dish, Drink, Galleries, MenuFile, Section, SiteContent, StoryContent } from '../../content/types';
// The real, committed files -- not hand-typed fixtures -- for galleries.json,
// menus.json, story.json and copy.json specifically: each one has real
// structural rules (assertCopy's nav.links shape and non-blank sweep,
// validateGalleries' non-empty lists, MENU_FILE_NAME's own path shape) that
// a hand-typed fixture would have to reproduce by hand and could easily get
// subtly wrong. Reusing the real files is the same choice
// useValidation.test.tsx's own REAL_DISHES already makes, for the identical
// reason (see that file's own comment).
import galleriesJson from '../../content/galleries.json';
import menusJson from '../../content/menus.json';
import storyJson from '../../content/story.json';
import copyJson from '../../content/copy.json';

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

const GALLERIES = galleriesJson as Galleries;
const MENUS = menusJson as MenuFile[];
const STORY = storyJson as StoryContent;
const COPY = copyJson as Copy;

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
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
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

async function sectionByHeading(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`"${name}" heading is not inside a <section>`);
  return section as HTMLElement;
}

// The identical fake XHR double PhotoField.test.tsx/PdfField.test.tsx each
// define -- needed here for Task 9's own wiring tests, which have to prove
// a REAL upload reaches the shared collector through the whole real chain,
// not a synthetic stand-in for it.
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  sentForm: FormData | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.sentForm = body;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function jpegFile(name = 'photo.jpg'): File {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...new TextEncoder().encode('JFIF')]);
  return new File([bytes], name, { type: 'image/jpeg' });
}

function pdfFile(name = 'menu.pdf'): File {
  const bytes = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...new TextEncoder().encode('%%EOF')]);
  return new File([bytes], name, { type: 'application/pdf' });
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
// Review finding (Task 9): RecordForm's own `idFor` had no per-file
// namespace, so Dishes' and Drinks' own first record BOTH produced
// `id="field-image-0"`, `id="field-name-0"`, etc. -- confirmed by the review
// to be more than cosmetic: clicking the "Photo" label under Drinks, in a
// real browser, focuses the DISH's own file input instead (`<label for>`
// resolves via `document.getElementById`, which isn't scoped by container
// and always returns the FIRST match in the whole document). Fixed by
// threading an optional `scope` prop (each ArraySection's own `file`, minus
// ".json") from AdminApp through RecordList into RecordForm's own `idFor`.
describe("AdminApp: no duplicate DOM ids across sibling sections -- a label click reaches its OWN section's input", () => {
  it('every id on the fully-rendered page is unique -- confirmed by counting every id, not just spot-checking one', async () => {
    stubFetch();
    render(<AdminApp />);
    await screen.findByDisplayValue('Dish A');
    await screen.findByDisplayValue('Drink X');
    await screen.findByDisplayValue('Article P');

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    const counts = new Map<string, number>();
    ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    const duplicated = Array.from(counts.entries()).filter(([, count]) => count > 1);
    expect(duplicated).toEqual([]);
  });

  it('Dishes\' and Drinks\' own Photo fields have DIFFERENT ids, namespaced by file', async () => {
    stubFetch();
    render(<AdminApp />);
    const dSection = await dishesSection();
    await within(dSection).findByDisplayValue('Dish A');
    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByDisplayValue('Drink X');

    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    const drinkPhotoInput = drSection.querySelector('input[type="file"]') as HTMLInputElement;
    expect(dishPhotoInput.id).toBe('dishes-field-image-0');
    expect(drinkPhotoInput.id).toBe('drinks-field-image-0');
    expect(dishPhotoInput.id).not.toBe(drinkPhotoInput.id);
  });

  it('clicking the "Photo" label under Drinks focuses the DRINK\'s own input, never the dish\'s', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const dSection = await dishesSection();
    await within(dSection).findByDisplayValue('Dish A');
    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByDisplayValue('Drink X');

    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    const drinkPhotoLabel = within(drSection).getAllByText('Photo')[0];
    await user.click(drinkPhotoLabel);

    const drinkPhotoInput = drSection.querySelector('input[type="file"]') as HTMLInputElement;
    expect(document.activeElement).toBe(drinkPhotoInput);
    expect(document.activeElement).not.toBe(dishPhotoInput);
  });
});

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

// Task 9's four new screens, each fetched and rendered through the real
// component -- the same "not just built in isolation" bar the Sections/
// Hours describe blocks above already hold this file to.
describe('AdminApp: the new prose, gallery, menus and copy screens all render, fetched independently', () => {
  it('renders Menus, prefilled with both real menu labels', async () => {
    stubFetch();
    render(<AdminApp />);
    const section = await sectionByHeading('Menus');
    expect(await within(section).findByDisplayValue('Food Menu')).toBeInTheDocument();
    expect(within(section).getByDisplayValue('Drinks Menu')).toBeInTheDocument();
  });

  it('renders Galleries, prefilled with real atmosphere/ourStory alt text and read-only heroCollage positions', async () => {
    stubFetch();
    render(<AdminApp />);
    const section = await sectionByHeading('Galleries');
    expect(await within(section).findByDisplayValue(GALLERIES.atmosphere[0].alt)).toBeInTheDocument();
    expect(within(section).getByDisplayValue(GALLERIES.ourStory[0].alt)).toBeInTheDocument();
    const positions = within(section).getAllByLabelText('Layout position');
    expect(positions.length).toBe(GALLERIES.heroCollage.length);
    expect(positions[0]).toBeDisabled();
  });

  it('renders Our Story, prefilled with the real heading and first paragraph', async () => {
    stubFetch();
    render(<AdminApp />);
    const section = await sectionByHeading('Our Story');
    expect(await within(section).findByDisplayValue(STORY.heading)).toBeInTheDocument();
    expect(within(section).getByDisplayValue(STORY.paragraphs[0])).toBeInTheDocument();
  });

  it('renders Page copy, grouped by section, with the real footer hours heading value', async () => {
    stubFetch();
    render(<AdminApp />);
    const section = await sectionByHeading('Page copy');
    expect(await within(section).findByDisplayValue(COPY.footer.hoursHeading)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Footer' })).toBeInTheDocument();
  });

  // The brief's own explicit requirement: footer.followLabel's U+00A0 must
  // render VISIBLY -- a marker, not a raw space -- so she can see it exists
  // at all, since an ordinary space looks IDENTICAL in the browser.
  it("shows footer.followLabel's non-breaking space as a visible marker, not an invisible raw space", async () => {
    stubFetch();
    render(<AdminApp />);
    const section = await sectionByHeading('Page copy');
    await within(section).findByDisplayValue(COPY.footer.hoursHeading);
    expect(within(section).getByText(/Shown with its non-breaking space marked:/)).toHaveTextContent('␣');
  });
});

// Important review finding (Task 9): every section here reads a whole
// content file through fetchContent's own unchecked
// `JSON.parse(...) as ContentTypeMap[K]` with no runtime guard --
// confirmed directly that a malformed galleries.json, story.json or
// menus.json throws mid-render and, absent a boundary here, takes down the
// ENTIRE admin page (main.tsx's ErrorBoundary is the only one in this app,
// wrapping the whole SPA). Each section is now wrapped in its own
// SectionErrorBoundary; this proves ONE bad file costs ONE section, not the
// whole page.
describe('AdminApp: a malformed content file costs one section, not the whole dashboard', () => {
  it('a galleries.json missing every list still lets Dishes/Drinks/Press render normally, with only Galleries showing a fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        // Malformed: none of the three lists GalleryList.tsx's own
        // `.map`/`.length` calls assume exist -- the exact shape a
        // hand-edited or half-written galleries.json could reach.
        if (url.includes('galleries.json')) return contentResponse({}, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    render(<AdminApp />);

    // The rest of the dashboard is unaffected -- proven by reaching real,
    // interactive content in sections that have NOTHING to do with
    // galleries.json.
    await screen.findByDisplayValue('Dish A');
    expect(screen.getByDisplayValue('Drink X')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Article P')).toBeInTheDocument();
    const menusSection = await sectionByHeading('Menus');
    expect(within(menusSection).getByDisplayValue('Food Menu')).toBeInTheDocument();

    // Galleries itself shows a named, recognizable fallback instead of
    // silently vanishing or crashing the page.
    expect(await screen.findByText(/Could not show Galleries/)).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('heading', { name: 'Galleries' })).not.toBeInTheDocument();
  });
});

// The two "risky" wirings, proven end-to-end through the REAL, fully
// assembled AdminApp -- not RecordList/GalleryList in isolation, which only
// prove their OWN link in the chain. This is what the brief calls "verify
// the wirings specifically": both must reach ONE shared collector, and a
// same-name PDF replacement must carry real bytes, not silently do nothing.
describe("AdminApp: Task 9's wiring, proven end-to-end -- staged photos across DIFFERENT records reach ONE shared collector", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('staging a photo on a dish, then a DIFFERENT photo on a drink, grows the same staged-file count -- neither replaces the other', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);

    const dSection = await dishesSection();
    await within(dSection).findByDisplayValue('Dish A');
    // Nothing staged yet -- checked only once the page has actually
    // finished its initial (async) render, not in the "checking session"
    // gap right after `render`, where nothing meaningful is on screen yet.
    expect(screen.getByText(/nothing you change below is saved anywhere\.$/)).toBeInTheDocument();
    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    await screen.findByText(/1 file is staged and waiting for it\.$/);

    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByDisplayValue('Drink X');
    // `getAllByLabelText` is safe here now that RecordForm's `idFor` takes
    // a per-file `scope` (see the "no duplicate DOM ids" describe block
    // below, and AdminApp.tsx's own comment on why) -- Dishes' and Drinks'
    // own first record no longer share `id="field-image-0"`, so this
    // resolves to the DRINK's own input, not whichever section happens to
    // render first in the document.
    const drinkPhotoInput = within(drSection).getAllByLabelText('Photo')[0];
    await user.upload(drinkPhotoInput, jpegFile('drink.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    FakeXHR.instances[1].respond(200, { path: 'assets-source/mocktails/bbb222bbb222.jpg', contentPath: '/mocktails/bbb222bbb222.webp' });

    // Two, not one -- the drink's own staged photo did not overwrite the
    // dish's. If AdminApp's ArraySection instances shared one KEY (rather
    // than each prefixing with its own `file` name and item id), the second
    // stage would collide with the first and the count would stay at 1.
    await screen.findByText(/2 files are staged and waiting for it\.$/);
  });
});

describe("AdminApp: Task 9's wiring -- replacing a menu PDF under the SAME name carries real bytes, not a silent no-op", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads under the CURRENT file's own stem (\"food-menu\"), not the record's `id` (\"food\") -- so it overwrites the same live path", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const section = await sectionByHeading('Menus');
    await within(section).findByDisplayValue('Food Menu');

    const pdfInput = within(section).getAllByLabelText('PDF file')[0];
    await user.upload(pdfInput, pdfFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('name')).toBe('food-menu');
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('menu');
  });

  it('a completed same-name replacement still grows the staged-file count -- the bytes really are collected, not dropped on the floor', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<AdminApp />);
    const section = await sectionByHeading('Menus');
    await within(section).findByDisplayValue('Food Menu');

    const pdfInput = within(section).getAllByLabelText('PDF file')[0];
    await user.upload(pdfInput, pdfFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });

    // menus.json's OWN `file` field is unchanged (same name -> same path,
    // by design -- worker/upload.ts's own menuAssetPath), which is exactly
    // the shape that makes the collector the ONLY place proof this actually
    // happened can live.
    await screen.findByText(/1 file is staged and waiting for it\.$/);
    expect(within(section).getByDisplayValue('Food Menu')).toBeInTheDocument();
  });
});
