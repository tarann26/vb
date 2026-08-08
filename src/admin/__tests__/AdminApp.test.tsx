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
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Every case mounts through this helper rather than `render(<AdminApp />)`
// directly -- see renderDashboard.tsx for why, and for what the route
// argument means. Each case is given the route of the AREA whose panel it
// asserts on: Menu (dishes, drinks, menus), Pages (pages, homepage
// sections), Story & Photos (galleries, our story, press) and Hours &
// Wording (opening hours, page copy).
import { markEveryAreaSeeded, renderDashboard } from './renderDashboard';
import { DISH_FIELDS } from '../fields';
import {
  COPY,
  DISHES,
  DRINKS,
  GALLERIES,
  MENUS,
  PRESS,
  SECTIONS,
  SITE,
  STORY,
  WA_RESPONSE,
  contentResponse,
  dish,
  stubFetch,
} from './dashboardFixtures';
import { collagePhotos } from '../../content/collage';
import type { Dish } from '../../content/types';
import { DRAFT_STORAGE_KEY, DRAFT_STAGED_COUNT_KEY, saveDraft } from '../drafts';
import { LOCK_TIMEOUT_MS } from '../PublishBar';

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

afterEach(() => {
  vi.unstubAllGlobals();
  // Task 10: PublishBar persists dirty content to localStorage on every
  // change (drafts.ts). Left uncleared, a dirty registration from one test
  // (staging a photo, editing a dish) would surface as an UNRELATED "you
  // have unsaved changes" restore banner at the very top of the next test's
  // render -- blocking every section (and PublishBar itself) from mounting
  // at all, since AdminApp deliberately never auto-restores.
  window.localStorage.clear();
});

describe('AdminApp: fetches each content file once logged in, loading state first', () => {
  it('shows a loading message before the fetch resolves, then the fetched dish', async () => {
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    renderDashboard('/edit/manage/menu');
    expect(await screen.findByText(/loading dishes/i)).toBeInTheDocument();
    // Not yet rendered -- the gate hasn't been released.
    expect(screen.queryByDisplayValue('Dish A')).not.toBeInTheDocument();

    gate.resolve(contentResponse(DISHES, 'sha-dishes'));
    expect(await screen.findByDisplayValue('Dish A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dish B')).toBeInTheDocument();
  });

  it('fetches and renders drinks and press independently of dishes', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    expect(await screen.findByDisplayValue('Drink X')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Drink Y')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Article P')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Article Q')).toBeInTheDocument();
  });

  // Every section starts folded now (CollapsibleSection.tsx), which would
  // have quietly hidden this message: a dishes.json that failed to load
  // looked exactly like a dishes.json she had simply not opened yet. The
  // header marker is the answer, and it is what this test now checks FIRST
  // -- the message itself still has to be there, one click away, which is
  // the second half.
  //
  // Mutation this guards: deleting the `hasProblem && !open` marker from
  // CollapsibleSection.tsx -- confirmed red on the first assertion, while
  // the rest of this test stays green, which is exactly the gap
  // default-folded opened.
  it('marks the folded section as needing attention, and shows the real message once opened', async () => {
    // This case is about a FOLDED panel, so it has to be a return visit:
    // on a first-ever visit the shell opens each area's first panel once,
    // and an open panel shows the real message rather than the marker.
    markEveryAreaSeeded();
    stubFetch(new Response(null, { status: 401 }));
    renderDashboard('/edit/manage/menu');
    expect(await screen.findByText(/needs attention/i)).toBeInTheDocument();

    const section = await dishesSection();
    expect(within(section).getByRole('alert')).toHaveTextContent(/could not load dishes/i);
    // ...and the marker goes once the message it stood in for is readable.
    expect(within(section).queryByText(/needs attention/i)).not.toBeInTheDocument();

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
  return sectionByHeading('Dishes');
}

// Finds a dashboard section by its heading AND opens it if it is folded.
//
// Every section starts folded now (CollapsibleSection.tsx), and folded means
// the `hidden` attribute on its content -- which is exactly what
// `getByRole`/`getAllByRole` refuse to match, by design: an element inside a
// `hidden` subtree is out of the accessibility tree, and a query that found
// it anyway would be claiming she can reach something she cannot. So a test
// that drives a control inside a section has to open that section first, the
// same as she does. Done here, once, rather than at each of the dozen call
// sites.
//
// Note what is NOT done here: nothing is unmounted or remounted by opening
// or folding a section (see CollapsibleSection.tsx's own comment on why that
// would overwrite her unpublished edits with the committed content), so
// `findByDisplayValue` and `findByText` -- neither of which filters on
// visibility -- keep working against a folded section, and several tests
// below deliberately still use them without opening anything.
async function sectionByHeading(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`"${name}" heading is not inside a <section>`);
  const toggle = within(section as HTMLElement).getByRole('button', { name });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Homepage sections');
    expect(within(section).getAllByText(/^(Hero|Our Story|Atmosfera|Menu|Drinks|Stories|Visit Us)$/)).toHaveLength(7);
  });

  it('reordering the real screen calls through to a genuine onReorder, visible in the rendered order', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Homepage sections');
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
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Homepage sections');
    await within(section).findByText('Hero');

    const heroToggle = within(section).getAllByLabelText('Shown on homepage')[0];
    expect(heroToggle).toBeDisabled();
    await user.click(heroToggle);
    expect(heroToggle).toBeChecked(); // unchanged
  });

  // Plan 7, Task 4: the real, mounted "Add a section" flow -- through the
  // genuine AdminApp render, not TemplateSectionList.test.tsx's own
  // isolated harness. Proves the wiring itself (fetch, registry, commit,
  // re-render) works end to end, which an isolated component test cannot.
  it('"Add a text section" on the real, mounted screen adds a template section beneath the seven bespoke ones', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Homepage sections');
    await within(section).findByText('Hero');

    await user.click(within(section).getByRole('button', { name: 'Add a text section' }));

    // A fresh template row appears, with its own "Edit" control -- absent
    // before the click (only the seven bespoke rows -- none of which show
    // "Edit" -- existed then).
    expect(within(section).getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });
});

describe('AdminApp: the real "Pages" screen', () => {
  it('fetches pages.json and offers "Add a page"', async () => {
    stubFetch();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Pages');
    expect(within(section).getByRole('button', { name: 'Add a page' })).toBeInTheDocument();
  });

  it('"Add a page" on the real, mounted screen adds a page row she can then open and edit', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Pages');

    await user.click(within(section).getByRole('button', { name: 'Add a page' }));
    await user.click(within(section).getByRole('button', { name: 'Edit' }));

    expect(within(section).getByLabelText('Page name')).toBeInTheDocument();
    expect(within(section).getByLabelText('Web address')).toBeInTheDocument();
  });
});

// Task 7: site.json's own real, mounted "Opening hours" screen.
describe('AdminApp: the real "Opening hours" screen', () => {
  it('fetches site.json and renders its hours row', async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Opening hours');
    expect(within(section).getByDisplayValue('12:00')).toBeInTheDocument();
    expect(within(section).getByDisplayValue('23:00')).toBeInTheDocument();
  });

  it('a past-midnight close, entered on the real screen, produces no validation problem', async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Opening hours');
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
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Opening hours');
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
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menus');
    expect(await within(section).findByDisplayValue('Food Menu')).toBeInTheDocument();
    expect(within(section).getByDisplayValue('Drinks Menu')).toBeInTheDocument();
  });

  it('renders Galleries, prefilled with real atmosphere/ourStory alt text and one row per collage photo', async () => {
    stubFetch();
    renderDashboard('/edit/manage/story');
    const section = await sectionByHeading('Galleries');
    expect(await within(section).findByDisplayValue(GALLERIES.atmosphere[0].alt)).toBeInTheDocument();
    expect(within(section).getByDisplayValue(GALLERIES.ourStory[0].alt)).toBeInTheDocument();
    // The collage's grid-placement string is gone, and with it the read-only
    // "Layout position" field this used to count. What is left per photo is
    // the one thing this screen still does for the collage: replace it.
    const photos = collagePhotos(GALLERIES.heroCollage!);
    expect(photos.length).toBeGreaterThan(0);
    // One PhotoField per collage photo, on top of the atmosphere and
    // ourStory rows this screen already renders.
    const pickers = within(section).getAllByLabelText('Photo');
    expect(pickers.length).toBe(GALLERIES.atmosphere.length + GALLERIES.ourStory.length + photos.length);
  });

  it('renders Our Story, prefilled with the real heading and first paragraph', async () => {
    stubFetch();
    renderDashboard('/edit/manage/story');
    const section = await sectionByHeading('Our Story');
    expect(await within(section).findByDisplayValue(STORY.heading)).toBeInTheDocument();
    expect(within(section).getByDisplayValue(STORY.paragraphs[0])).toBeInTheDocument();
  });

  it('renders Page copy, grouped by section, with the real footer hours heading value', async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Page copy');
    expect(await within(section).findByDisplayValue(COPY.footer.hoursHeading)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Footer' })).toBeInTheDocument();
  });

  // The brief's own explicit requirement: footer.followLabel's U+00A0 must
  // render VISIBLY -- a marker, not a raw space -- so she can see it exists
  // at all, since an ordinary space looks IDENTICAL in the browser.
  it("shows footer.followLabel's non-breaking space as a visible marker, not an invisible raw space", async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
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
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    renderDashboard('/edit/manage/story');

    // The rest of the dashboard is unaffected -- proven by reaching real,
    // interactive content in sections that have NOTHING to do with
    // galleries.json.
    await screen.findByDisplayValue('Dish A');
    expect(screen.getByDisplayValue('Drink X')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Article P')).toBeInTheDocument();
    // Queried by display value rather than through `sectionByHeading`,
    // deliberately: Menus lives in a different AREA from Galleries, and
    // role queries do not reach into a hidden one. "Food Menu" is unique
    // on this page and is the same evidence -- menus.json loaded and
    // rendered -- without the query needing that area to be on screen.
    expect(await screen.findByDisplayValue('Food Menu')).toBeInTheDocument();

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
    renderDashboard('/edit/manage/menu');

    const dSection = await dishesSection();
    await within(dSection).findByDisplayValue('Dish A');
    // Nothing staged or edited yet -- checked only once the page has
    // actually finished its initial (async) render, not in the "checking
    // session" gap right after `render`, where nothing meaningful is on
    // screen yet.
    expect(screen.getByText('No changes to publish yet.')).toBeInTheDocument();
    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    // Staging the photo both stages its bytes AND writes the dish's own
    // `image` field to the new contentPath -- one edited section, one
    // staged file.
    await screen.findByText('1 section edited, 1 file staged — ready to publish.');

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

    // Two of each, not one -- the drink's own staged photo did not overwrite
    // the dish's. If AdminApp's ArraySection instances shared one KEY
    // (rather than each prefixing with its own `file` name and item id), the
    // second stage would collide with the first and the count would stay at
    // one.
    await screen.findByText('2 sections edited, 2 files staged — ready to publish.');
  });
});

// The staged-photo precedence, driven through a REAL pick rather than a
// hand-set preview store. This is the case that says the whole preview
// plumbing -- AdminApp -> ManageShell -> the area -> RecordList ->
// RecordForm -> Field -> PhotoField, and back out to the row's Thumbnail --
// is actually connected end to end.
//
// Why it matters at all: PhotoField optimistically writes the eventual
// published contentPath into the record the instant an upload stages, and
// nothing lives at that path until the build finishes minutes later. Without
// precedence, the row she just picked a photo for shows a broken image for
// those minutes -- the exact anxiety this redesign exists to remove.
describe('AdminApp: a photo she has just picked wins over the content path in the row thumbnail', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the row's thumbnail shows the object URL, not the path with no file behind it yet", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    const section = await dishesSection();
    await within(section).findByDisplayValue('Dish A');
    const row = within(section).getByDisplayValue('Dish A').closest('li') as HTMLElement;
    // Non-vacuous: before the pick it really is showing the committed path.
    expect(row.querySelector('[data-thumbnail]')).toHaveAttribute('src', '/food/a.webp');

    const dishPhotoInput = within(section).getAllByLabelText(DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, {
      path: 'assets-source/food/aaa111aaa111.jpg',
      contentPath: '/food/aaa111aaa111.webp',
    });

    // The record's own field really was rewritten to the optimistic path...
    await waitFor(() => expect(screen.getByText(/1 file staged/)).toBeInTheDocument());
    // ...and the thumbnail is showing the blob anyway.
    // Mutation this guards: drop the staged precedence in Thumbnail -- the
    // src flips back to '/food/aaa111aaa111.webp' and this goes red.
    await waitFor(() => {
      const src = row.querySelector('[data-thumbnail]')?.getAttribute('src') ?? '';
      expect(src.startsWith('blob:')).toBe(true);
    });
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
    renderDashboard('/edit/manage/menu');
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
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menus');
    await within(section).findByDisplayValue('Food Menu');

    const pdfInput = within(section).getAllByLabelText('PDF file')[0];
    await user.upload(pdfInput, pdfFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });

    // menus.json's OWN `file` field is unchanged (same name -> same path,
    // by design -- worker/upload.ts's own menuAssetPath), which is exactly
    // the shape that makes the collector the ONLY place proof this actually
    // happened can live -- no "section edited" in the summary at all, only
    // the staged file (Task 10's own carried requirement 3).
    await screen.findByText('1 file staged — ready to publish.');
    expect(within(section).getByDisplayValue('Food Menu')).toBeInTheDocument();
  });
});

// Critical review finding, reproduced through the real upload chain and the
// real draft store -- not a hand-built draft fixture: she stages a photo
// (drafts.ts's own case for why this exists: iOS evicting a backgrounded
// tab), the tab dies before Publish ever runs, she reloads, is offered the
// draft, clicks Restore, and publishes. Proven end to end that the fix
// (publish.ts's dirtyDraftMap) holds at every step: the SAVED draft never
// carried the dangling reference in the first place, Restore lands on the
// committed photo, and an unrelated edit made in the SAME record survives
// untouched. Also the first end-to-end proof of I6's DRAFT_STAGED_COUNT_KEY
// wiring -- unit-tested at both ends (drafts.test.ts) but never through the
// real write (PublishBar's persistence effect) and read (AdminApp's own
// restore banner) it connects.
describe('AdminApp: Critical review fix -- a restored draft cannot publish a photo reference whose bytes are gone', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchWithPublish() {
    const publishBodies: { files: { path: string; content: string; encoding: string }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/publish') {
          publishBodies.push(JSON.parse(String(init?.body)) as { files: { path: string; content: string; encoding: string }[] });
          return new Response(JSON.stringify({ sha: 'commit-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.startsWith('/api/build-status')) {
          return new Response(JSON.stringify({ state: 'live', deploymentUrl: null, commitUrl: 'https://c' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url === '/build-info.json') {
          return new Response(JSON.stringify({ sha: 'commit-1', builtAt: 'now' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        throw new Error(`AdminApp.test.tsx: unexpected fetch to ${url}`);
      }),
    );
    return publishBodies;
  }

  it('stage a photo, edit the name, lose the tab, reload -- the banner names the lost photo, and Restore + Publish carries the ORIGINAL image with the name edit intact', async () => {
    stubFetchWithPublish();
    const user = userEvent.setup();
    const { unmount } = renderDashboard('/edit/manage/menu');

    const dSection = await dishesSection();
    const nameInput = await within(dSection).findByDisplayValue('Dish A');
    await user.clear(nameInput);
    await user.type(nameInput, 'Dish A Edited');

    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    await screen.findByText('1 section edited, 1 file staged — ready to publish.');

    // The draft (and the real staged count, I6's own wiring) is persisted
    // BEFORE the tab ever dies.
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_STAGED_COUNT_KEY)).toBe('1'));

    // The tab dies -- staged.ts's in-memory collector (unmount) goes with
    // it; localStorage does not.
    unmount();

    // She reloads: a fresh AdminApp, a fresh (empty) staged-files collector,
    // against the SAME, unchanged server content.
    const publishBodies = stubFetchWithPublish();
    renderDashboard('/edit/manage/menu');

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/you have unsaved changes/i);
    // I6: the real wiring, not a hand-passed prop -- this is the sentence
    // DRAFT_STAGED_COUNT_KEY's own value (read back by AdminApp on this
    // fresh mount) actually produces.
    expect(banner).toHaveTextContent("A photo or PDF you picked in that session wasn't saved and will need to be picked again.");

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    const restoredSection = await dishesSection();
    await within(restoredSection).findByDisplayValue('Dish A Edited'); // the unrelated edit survived the scrub

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    const dishesFile = publishBodies[0].files.find((f) => f.path === 'src/content/dishes.json');
    expect(dishesFile).toBeDefined();
    const publishedDishes = JSON.parse(dishesFile!.content) as Dish[];
    // The ORIGINAL committed image -- never the staged contentPath, whose
    // bytes died with the tab. Skipping the scrub in dirtyDraftMap would
    // instead publish '/food/aaa111aaa111.webp' here, with zero staged
    // bytes behind it -- a broken image live, reported as a success.
    expect(publishedDishes.find((d) => d.id === 'a')?.image).toBe('/food/a.webp');
    expect(publishedDishes.find((d) => d.id === 'a')?.name).toBe('Dish A Edited');
    // No staged bytes were sent either -- there was nothing left to send.
    expect(publishBodies[0].files.some((f) => f.path.startsWith('assets-source/'))).toBe(false);
  });
});

describe('AdminApp: Task 10 -- a reload mid-edit offers to restore the draft', () => {
  const DRAFT = {
    'dishes.json': { data: [dish('a', 'Dish A (restored)'), dish('b', 'Dish B')], savedAt: Date.now() },
  };

  it('a draft already in localStorage shows the banner, and blocks every section from mounting until she decides', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(DRAFT));
    stubFetch();
    renderDashboard('/edit/manage/menu');

    expect(await screen.findByRole('alert')).toHaveTextContent(/you have unsaved changes from/i);
    // Never auto-apply: nothing below the banner has mounted at all yet --
    // not even the PLAIN, unmodified server data, let alone the draft.
    expect(screen.queryByRole('heading', { name: 'Dishes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('Restore seeds the section with the DRAFT value, not the freshly-fetched server value', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(DRAFT));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(await screen.findByDisplayValue('Dish A (restored)')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Dish A')).not.toBeInTheDocument();
    // The registry's OWN baseline still tracks the server's real sha/value
    // (registerLoaded's own contract) -- proven indirectly: the restored
    // record reads as an unsaved change ready to publish, not as already
    // clean.
    expect(screen.getByText(/section.* edited/)).toBeInTheDocument();
  });

  it('Discard clears the draft and loads the real, unmodified server value', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(DRAFT));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(await screen.findByDisplayValue('Dish A')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Dish A (restored)')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(screen.getByText('No changes to publish yet.')).toBeInTheDocument();
  });

  it('no draft in localStorage -- the dashboard renders normally, banner absent', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByDisplayValue('Dish A');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// Review finding (Critical): a 401 mid-edit -- the session's own 7-day
// token expiring, or Publish itself catching a stale cookie -- must not
// destroy the very edit "your changes will still be here" just promised was
// safe. Reproduced end to end: edit a dish, the edit is dirty and persisted,
// Publish answers 401, she logs back in on the SAME page (AdminApp itself
// never unmounts -- logOut only swaps the returned JSX to <Login>) -- and
// without re-arming the draft check on this SECOND transition into 'in',
// every section silently remounts with the clean server value and
// PublishBar's own persistence effect deletes the very draft that was still
// sitting there, un-cleared, the whole time.
describe('AdminApp: Task 10 review fix -- a 401 mid-edit does not destroy the draft on re-login', () => {
  function stubFetchWithLoginAndPublish() {
    let publishCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/login') return new Response(null, { status: 204 });
        if (url === '/api/publish') {
          publishCalls += 1;
          return new Response(JSON.stringify({ message: 'Not authenticated.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        throw new Error(`AdminApp.test.tsx: unexpected fetch to ${url}`);
      }),
    );
    return () => publishCalls;
  }

  it('edit -> Publish -> 401 -> log back in on the same page -> the draft is offered, not silently gone', async () => {
    const getPublishCalls = stubFetchWithLoginAndPublish();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    const dishNameInput = await screen.findByDisplayValue('Dish A');
    await user.clear(dishNameInput);
    await user.type(dishNameInput, 'Dish A Edited');
    // The edit is real and persisted before she ever clicks Publish.
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    expect(await screen.findByText("You've been signed out. Log in and your changes will still be here.")).toBeInTheDocument();
    expect(getPublishCalls()).toBe(1);

    // Still logged out at this exact moment -- the draft must already have
    // survived the 401 itself (handlePublish never clears it on this path).
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();

    // Log back in, on the SAME page -- no reload.
    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    // The banner, not the bare dashboard with the server's clean value --
    // and NOT silently deleted out from under her.
    expect(await screen.findByRole('alert')).toHaveTextContent(/you have unsaved changes/i);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(screen.queryByDisplayValue('Dish A Edited')).not.toBeInTheDocument(); // still gated -- never auto-applied

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByDisplayValue('Dish A Edited')).toBeInTheDocument();
  });

  // Minor review finding: the SAME banner also warns about staged
  // PHOTOS/PDFs "not saved, will need to be picked again" -- true for a
  // genuine reload (staged.ts's own in-memory collector really is gone),
  // false here: AdminApp never unmounts on an in-page 401, so the exact
  // same collector instance she staged into is still holding the bytes
  // when the banner is offered again.
  it('a photo staged before the 401 is NOT reported as lost -- its bytes are still in memory and still publish correctly', async () => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    const getPublishCalls = stubFetchWithLoginAndPublish();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');

    const dSection = await dishesSection();
    await within(dSection).findByDisplayValue('Dish A');
    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    await screen.findByText('1 section edited, 1 file staged — ready to publish.');

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    expect(await screen.findByText("You've been signed out. Log in and your changes will still be here.")).toBeInTheDocument();
    expect(getPublishCalls()).toBe(1);

    await user.type(screen.getByLabelText(/password/i), 'whatever-the-real-password-is');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/you have unsaved changes/i);
    // The wrong sentence, named exactly: mutating the fix back to the bare
    // `pendingStagedCount` fires this assertion.
    expect(banner).not.toHaveTextContent(/picked again/i);
  });
});

// Minor review finding: the dashboard correctly never offers an /edit
// draft for restore here (drafts.ts's own per-surface separation -- they
// are different sessions, and this screen must never apply the OTHER
// one's draft), but until now nothing told her one exists at all -- the
// reciprocal of EditMode.tsx's own identical note.
describe('AdminApp: Minor -- a pre-existing /edit draft is mentioned, never restored, here', () => {
  it('an /edit draft on disk is mentioned as a plain sentence, and the dashboard offers nothing to restore for it', async () => {
    saveDraft('edit', { 'dishes.json': { data: DISHES, savedAt: 1_000 } });
    stubFetch();
    renderDashboard('/edit/manage/menu');

    expect(await screen.findByText(/unpublished changes saved on the live-page editor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('with no /edit draft on disk, nothing is said about the other surface', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');

    await screen.findByRole('heading', { name: 'Via Bianca Dashboard' });
    expect(screen.queryByText(/unpublished changes saved on the live-page editor/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The editing pause, from the dashboard's side. PublishBar decides when it is
// on; AdminApp applies it as one <fieldset disabled> around every section.
// These tests assert against a REAL section input rather than the fieldset
// element, because the fieldset is only interesting if the native disabled
// cascade actually reaches the controls underneath it.
describe('AdminApp: editing is paused while a publish request is in flight', () => {
  // A publish that never comes back -- the whole point is to observe the
  // window while the POST is still open.
  function stubFetchWithPublish(publish: () => Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/publish') return publish();
        if (url.startsWith('/api/build-status')) {
          return new Response(JSON.stringify({ state: 'queued', deploymentUrl: null, commitUrl: 'https://c' }), { status: 200 });
        }
        if (url === '/build-info.json') return new Response(JSON.stringify({ sha: 'x', builtAt: 'now' }), { status: 200 });
        if (url.includes('dishes.json')) return contentResponse(DISHES, 'sha-dishes');
        if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
        if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
        if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
        if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        throw new Error(`AdminApp.test.tsx: unexpected fetch to ${url}`);
      }),
    );
  }

  // Dirties dishes.json through the real UI and takes the publish as far as
  // the POST, returning the Dish A name input to assert against.
  async function publishAndGetDishInput(user: ReturnType<typeof userEvent.setup>) {
    renderDashboard('/edit/manage/menu');
    const input = await screen.findByDisplayValue('Dish A');
    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    return input as HTMLInputElement;
  }

  it('a real section input is disabled, and refuses typing, while the POST is open', async () => {
    const user = userEvent.setup();
    stubFetchWithPublish(() => new Promise<Response>(() => {}));
    const input = await publishAndGetDishInput(user);

    await waitFor(() => expect(input).toBeDisabled());
    const before = input.value;
    await user.type(input, 'nope');
    expect(input.value).toBe(before);
  });

  // Review finding (Minor): the pause tests all asserted `toBeDisabled()` on
  // an input and never the FEEDBACK, so dropping `aria-busy` and the 0.6
  // opacity left the whole section going dead-but-normal-looking during a
  // publish -- controls stopping without dimming, and no busy signal for a
  // screen reader at all. AdminApp's own comment argues at length that the
  // opacity is what says "this area is busy" as one thing, and that
  // per-control disabled styling was rejected in its favour; this is what
  // makes that argument checkable.
  //
  // Mutation this guards: replacing the fieldset's style/aria-busy with
  // `style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}`.
  it('the whole section dims and reports itself busy, not just dead', async () => {
    const user = userEvent.setup();
    stubFetchWithPublish(() => new Promise<Response>(() => {}));
    renderDashboard('/edit/manage/menu');
    const input = (await screen.findByDisplayValue('Dish A')) as HTMLInputElement;
    const fieldset = input.closest('fieldset')!;

    // Non-vacuous: neither signal is on before the publish starts.
    expect(fieldset).not.toHaveAttribute('aria-busy', 'true');
    expect(fieldset.style.opacity).toBe('');

    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));

    await waitFor(() => expect(fieldset).toHaveAttribute('aria-busy', 'true'));
    expect(fieldset.style.opacity).toBe('0.6');

    // ...and both come back off with the pause.
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(fieldset).not.toHaveAttribute('aria-busy', 'true');
    expect(fieldset.style.opacity).toBe('');
  });

  // Review finding (Minor). The pause is about EDITING, and folding a
  // section is not editing -- it is how she navigates a ten-section page.
  // Until the fieldset moved inside CollapsibleSection, every fold toggle
  // was a form control inside the disabled fieldset and went inert for the
  // whole request, up to the 60s PublishBar cap. That is worse than merely
  // annoying, because it is precisely when a section has something to say:
  // a file that fails its own load while folded renders CollapsibleSection's
  // "Something in this section needs attention — open it to see" under the
  // heading, and the heading it names refused to open.
  //
  // `not.toBeDisabled()` and a real `user.click` both, deliberately: jest-dom
  // resolves the fieldset ancestor, and userEvent honours the disabled state
  // the way a real tap does, so the click assertion fails on the regression
  // even if someone teaches the toggle to look enabled. (`fireEvent.click`
  // would NOT catch it -- it bypasses the check and flips the state
  // regardless, which is how this stayed invisible.)
  it('a section heading still folds while the POST is open -- it is navigation, not editing', async () => {
    const user = userEvent.setup();
    // A return visit, so Dishes genuinely starts folded -- the "non-vacuous"
    // step below depends on it (see markEveryAreaSeeded).
    markEveryAreaSeeded();
    stubFetchWithPublish(() => new Promise<Response>(() => {}));
    renderDashboard('/edit/manage/menu');
    const input = (await screen.findByDisplayValue('Dish A')) as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'Dishes' });

    // Non-vacuous: it starts folded and opens normally with no publish in
    // flight, so the assertion below is about the lock and nothing else.
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(input).toBeDisabled());

    expect(toggle).not.toBeDisabled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // The failure path the whole design turns on: every terminal state must
  // release the pause on its own, with no bookkeeping to forget.
  it('a 409 releases it -- she is never stranded behind a failed publish', async () => {
    const user = userEvent.setup();
    stubFetchWithPublish(async () => new Response(JSON.stringify({ message: 'stale' }), { status: 409 }));
    const input = await publishAndGetDishInput(user);

    await screen.findByText(/This may already be published/);
    expect(input).not.toBeDisabled();
  });

  // The deliberate scope limit. The build poll can run for ten minutes on a
  // flaky connection while the commit is already live; freezing the page for
  // that would be a worse failure than the confusion it prevents.
  it('the build-poll window does NOT pause anything, even though the bar still says Publishing…', async () => {
    const user = userEvent.setup();
    stubFetchWithPublish(async () => new Response(JSON.stringify({ sha: 'commit-1' }), { status: 200 }));
    const input = await publishAndGetDishInput(user);

    await screen.findByText('Publishing… waiting for the build to start.');
    expect(input).not.toBeDisabled();
  });

  // `requestPublish` has no timeout and cannot be aborted, so the pause has
  // to be able to fail open. This is her manual way out.
  it('"Keep editing" releases the editors without letting a second publish race the first', async () => {
    const user = userEvent.setup();
    stubFetchWithPublish(() => new Promise<Response>(() => {}));
    const input = await publishAndGetDishInput(user);
    await waitFor(() => expect(input).toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(input).not.toBeDisabled();
    // Still in flight, still reported, and still not publishable again.
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
  });

  // The automatic way out, for a request that simply never returns -- a
  // phone that lost signal partway through a large upload.
  it('the pause lifts itself after the cap, with the request still open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      stubFetchWithPublish(() => new Promise<Response>(() => {}));
      const input = await publishAndGetDishInput(user);
      await waitFor(() => expect(input).toBeDisabled());

      await act(async () => {
        vi.advanceTimersByTime(LOCK_TIMEOUT_MS);
      });

      expect(input).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
