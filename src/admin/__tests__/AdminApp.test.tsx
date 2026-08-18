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
import { LOCKUP_ACCESSIBLE_NAME } from '../manage/brand';
import { PANELS } from '../manage/areas';
import { DISH_FIELDS, MENU_FIELDS } from '../fields';
import {
  COPY,
  DISHES,
  DRINKS,
  EXPERIENCES,
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
import type { Dish, Page, Post, StoryContent } from '../../content/types';
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
    // Not yet rendered -- the gate hasn't been released. A row now shows the
    // record's name as plain row text (Task 3's list+editor redesign), not
    // a prefilled input -- the editor holding that input isn't mounted at
    // all until she opens the row.
    expect(screen.queryByText('Dish A')).not.toBeInTheDocument();

    gate.resolve(contentResponse(DISHES, 'sha-dishes'));
    expect(await screen.findByText('Dish A')).toBeInTheDocument();
    expect(screen.getByText('Dish B')).toBeInTheDocument();
  });

  it('fetches and renders drinks and press independently of dishes', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    expect(await screen.findByText('Drink X')).toBeInTheDocument();
    expect(screen.getByText('Drink Y')).toBeInTheDocument();
    expect(await screen.findByText('Article P')).toBeInTheDocument();
    expect(screen.getByText('Article Q')).toBeInTheDocument();
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
    expect(await screen.findByText('Drink X')).toBeInTheDocument();
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

// Every content file plus a `/api/publish` that keeps what it was sent, so a
// case can read the request body rather than only the screen. The two describes
// below both need it -- one to prove a photo reached the right block, one to
// prove her typing reached the wire -- so it is written once here rather than a
// fourth time inside a describe. `posts` is a parameter because one of those
// two starts from committed posts and the other from a restored draft over an
// empty file.
function stubFetchCapturingPublish(posts: unknown = []) {
  const publishBodies: { files: { path: string; content: string; encoding: string }[] }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url === '/api/publish') {
        publishBodies.push(JSON.parse(String(init?.body)) as { files: { path: string; content: string; encoding: string }[] });
        return new Response(JSON.stringify({ sha: 'commit-1', publishId: 'p1' }), { status: 200, headers: { 'content-type': 'application/json' } });
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
      if (url.includes('posts.json')) return contentResponse(posts, 'sha-posts');
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

// The Posts panel, loaded and open, without one role-and-name sweep over the
// shell. `sectionByHeading` above is fine for a case that mounts and asserts,
// but it POLLS `findByRole('heading', { name })` -- a whole-document
// accessible-name computation every 50ms -- and a case that then does two
// uploads and a publish on top of that is exactly the shape that starves the
// render it is waiting for. Measured: this case failed once in eight runs
// under 24 burners at a 5000ms budget with `sectionByHeading`, and eight in
// eight green with this, the budget untouched.
//
// The wait is `#section-panel-posts button`, which is cheap (one indexed
// selector, no name computation) and honest: the panel body renders one `<p>`
// and no controls while it is loading, and no body at all if the boundary
// caught something. `[data-panel]` alone would prove nothing -- every area
// mounts from the first render and stays mounted.
async function openPostsPanel(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector('#section-panel-posts button')).not.toBeNull();
  });
  // Folded on arrival: the shell opens an area's FIRST panel, which in Story &
  // Photos is Galleries. She opens this one, so this does too.
  const toggle = document.querySelector<HTMLElement>('[data-panel="posts"] button[aria-expanded="false"]');
  if (toggle !== null) await user.click(toggle);
  return document.getElementById('section-panel-posts') as HTMLElement;
}

// A whole-PANEL `getByLabelText` is what has now nearly refused a production
// deploy twice from this one file. The mechanics are written out in full in
// the long note above the "Experiences" case below; the short version is
// that jsdom 25 resolves `input.labels` by walking the entire document, and
// `label.control` walks it again per label, so ONE such query costs
// (elements in the container x elements in the document). Measured here:
// 265ms against the About panel, 981ms against the Galleries panel.
//
// These two helpers are the cure at the call site. Neither of them gives up
// the label -> control association -- that is the thing these tests are
// supposed to prove, because it is how Bani finds a field at all. They just
// stop paying for it across a panel when the answer can only live in one
// small block.
//
// `fieldBlock` finds the ONE <div> that Field.tsx (and PhotoField.tsx, which
// renders its own identical shell) wraps around a single field's <label>,
// its control and its error region. Finding it by the label's TEXT is a
// plain string match over the panel with no `.labels` resolution anywhere,
// and a `getByLabelText` scoped to the returned block then sweeps four
// elements instead of four hundred: 265ms becomes ~2ms.
//
// It is deliberately strict about uniqueness -- two fields sharing a label
// inside one panel would make "the block" meaningless, so it throws rather
// than picking one.
function fieldBlock(container: HTMLElement, label: string): HTMLElement {
  const labels = within(container).getAllByText(label, { selector: 'label' });
  if (labels.length !== 1) {
    throw new Error(`expected exactly one "${label}" field in this panel, found ${labels.length}`);
  }
  const block = labels[0].parentElement;
  if (!block) throw new Error(`the "${label}" label is not inside a field block`);
  return block;
}

// `photoPickers` is for the one case that genuinely has to count EVERY photo
// field in a panel, where scoping to a block is not available. It reads the
// same association from the control's side instead: each PhotoField renders
// `<input type="file" id={id}>` alongside its own `<label for={id}>` in the
// same block, so an id/`for` match plus the label's text proves exactly what
// `getAllByLabelText` proves -- and costs one indexed selector match per
// control rather than a document walk per element in the panel.
function photoPickers(container: HTMLElement, label: string): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) => {
    const own = input.parentElement?.querySelector('label');
    return own?.htmlFor === input.id && own?.textContent?.trim() === label;
  });
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
  // Task 3's redesign: Remove is gone from the row (D8 -- delete lives
  // inside the editor and asks once), and Add opens the editor on the
  // record it just added (D3/the brief's own `onAdd` contract) rather than
  // leaving a third inline form on the page. Rows are counted by
  // `data-item-row`, ItemList's own row marker, since there is no more
  // per-row `Remove <name>` button to count instead.
  it('"Add a dish" appends one new, blank row -- not a third copy of an existing one', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await dishesSection();
    await within(section).findByText('Dish A');

    const rowCount = () => section.querySelectorAll('[data-item-row]').length;
    expect(rowCount()).toBe(2);
    await user.click(within(section).getByRole('button', { name: 'Add a dish' }));
    expect(rowCount()).toBe(3);

    // The appended row is the BLANK one, opened automatically in its own
    // editor -- Add and Edit are one surface, so there is no separate "new
    // item" form to drift from the edit form. MenuArea's `itemLabel` falls
    // back to "Untitled dish" exactly when `name` is ''.
    expect(await screen.findByRole('dialog', { name: 'Untitled dish' })).toBeInTheDocument();
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveValue('');
  });

  it('"Remove Dish A" drops only that record, leaving Dish B intact', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await dishesSection();
    await within(section).findByText('Dish A');

    await user.click(within(section).getByRole('button', { name: 'Dish A' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Dish A' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete dish a' }));

    expect(within(section).queryByText('Dish A')).not.toBeInTheDocument();
    expect(within(section).getByText('Dish B')).toBeInTheDocument();
    expect(section.querySelectorAll('[data-item-row]')).toHaveLength(1);
  });

  it('"Move Dish A down" swaps the two dishes, each with its own values intact', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await dishesSection();
    await within(section).findByText('Dish A');

    await user.click(within(section).getByRole('button', { name: 'Move Dish A down' }));

    const names = within(section)
      .getAllByText(/^Dish [AB]$/)
      .map((el) => el.textContent);
    expect(names).toEqual(['Dish B', 'Dish A']);
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
  // Task 3's redesign mounts a record's fields only while its OWN editor is
  // open, and each panel's RecordList owns its `openId` independently -- so
  // Dishes' and Drinks' editors can be open at once, which is exactly what
  // this describe block needs to still prove the id-namespacing guarantee
  // it was written for.
  it('every id on the fully-rendered page is unique -- confirmed by counting every id, not just spot-checking one', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const dSection = await dishesSection();
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByText('Drink X');
    await user.click(within(drSection).getByRole('button', { name: 'Drink X' }));
    await screen.findByDisplayValue('Dish A');
    await screen.findByDisplayValue('Drink X');
    // Review finding (fix round 1): Press lives in a different AREA (Story &
    // Photos), hidden -- not unmounted -- while this route is Menu. Its own
    // row is still findable by TEXT (`findByText`, unlike `getByRole`, does
    // not filter on the `hidden` attribute -- this file's own header comment
    // on `sectionByHeading`), and a raw `fireEvent.click` on the row button
    // it wraps opens its editor regardless, same as the folded-panel case
    // above does. Without opening it, a press-vs-dishes id collision (the
    // exact defect `scope` exists to prevent) would go uncaught here, since
    // an unopened record renders no ids of its own at all.
    const pressRowButton = (await screen.findByText('Article P')).closest('button') as HTMLElement;
    fireEvent.click(pressRowButton);
    await screen.findByDisplayValue('Article P');

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    const counts = new Map<string, number>();
    ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    const duplicated = Array.from(counts.entries()).filter(([, count]) => count > 1);
    expect(duplicated).toEqual([]);
  });

  it('Dishes\' and Drinks\' own Photo fields have DIFFERENT ids, namespaced by file', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const dSection = await dishesSection();
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByText('Drink X');
    await user.click(within(drSection).getByRole('button', { name: 'Drink X' }));

    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    const drinkPhotoInput = screen.getByRole('dialog', { name: 'Drink X' }).querySelector('input[type="file"]') as HTMLInputElement;
    expect(dishPhotoInput.id).toBe('dishes-field-image-0');
    expect(drinkPhotoInput.id).toBe('drinks-field-image-0');
    expect(dishPhotoInput.id).not.toBe(drinkPhotoInput.id);
  });

  it('clicking the "Photo" label under Drinks focuses the DRINK\'s own input, never the dish\'s', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const dSection = await dishesSection();
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByText('Drink X');
    await user.click(within(drSection).getByRole('button', { name: 'Drink X' }));

    const dishPhotoInput = within(dSection).getAllByLabelText(DISH_FIELDS.image.label)[0];
    const drinkDialog = screen.getByRole('dialog', { name: 'Drink X' });
    const drinkPhotoLabel = within(drinkDialog).getAllByText('Photo')[0];
    await user.click(drinkPhotoLabel);

    const drinkPhotoInput = drinkDialog.querySelector('input[type="file"]') as HTMLInputElement;
    expect(document.activeElement).toBe(drinkPhotoInput);
    expect(document.activeElement).not.toBe(dishPhotoInput);
  });
});

describe('AdminApp: the real "Homepage sections" screen', () => {
  it('fetches sections.json and renders all eight, in the order the file gave them', async () => {
    stubFetch();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('What shows on the homepage');
    expect(within(section).getAllByText(/^(Hero|About|Atmosfera|Menu|Drinks|Blog|Awards|Visit Us)$/)).toHaveLength(8);
  });

  it('reordering the real screen calls through to a genuine onReorder, visible in the rendered order', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('What shows on the homepage');
    await within(section).findByText('Hero');

    await user.click(within(section).getByRole('button', { name: 'Move Hero down' }));

    const HUMAN_NAMES = ['Hero', 'About', 'Atmosfera', 'Menu', 'Drinks', 'Blog', 'Awards', 'Visit Us'];
    const namesInOrder = within(section)
      .getAllByRole('listitem')
      .map((li) => HUMAN_NAMES.find((name) => li.textContent?.startsWith(name)));
    expect(namesInOrder.slice(0, 2)).toEqual(['About', 'Hero']);
  });

  it('hero cannot be unchecked from the real, mounted screen', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('What shows on the homepage');
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
  it('"Add a text section" on the real, mounted screen adds a template section beneath the eight bespoke ones', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('What shows on the homepage');
    await within(section).findByText('Hero');

    await user.click(within(section).getByRole('button', { name: 'Add a text section' }));

    // A fresh template row appears, with its own "Edit" control -- absent
    // before the click (only the eight bespoke rows -- none of which show
    // "Edit" -- existed then).
    expect(within(section).getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });
});

describe('AdminApp: the real "Pages" screen', () => {
  // Phase 3, Task 8: "Add a page" was removed deliberately -- PageList.tsx's
  // own comment where the button used to sit explains why. Proven on the
  // real, mounted screen, not only in PageList.test.tsx's own isolated
  // harness, so a regression that restores the button anywhere in the real
  // render tree still fails here.
  it('offers no "Add a page" control anywhere on the real, mounted screen', async () => {
    stubFetch();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Pages');
    await waitFor(() => expect(within(section).queryByText(/^Loading/)).not.toBeInTheDocument());
    expect(within(section).queryByRole('button', { name: /add a page/i })).not.toBeInTheDocument();
  });

  // Review fix round 1, Important 2: the two tests this replaced ("fetches
  // pages.json and offers 'Add a page'" / "'Add a page' … adds a page row
  // she can then open and edit") drove the real, mounted PageList end to
  // end -- and their replacements did not restore that coverage, since the
  // shared `dashboardFixtures` stub answers pages.json with `[]`, leaving
  // nothing in the Pages panel for a positive assertion to reach. Proven
  // directly: with `PageList` mutated to return `null`, this file's other
  // 44 tests all stayed green (see the report's own mutation log).
  //
  // This test supplies real pages through its own local fetch stub (the
  // same "malformed content file" pattern above uses, not the shared
  // `stubFetch`, since that helper only lets a caller override dishes.json)
  // so the real, mounted Pages panel has real rows to assert on -- the
  // count of "Edit" buttons pins the fetched pages.json data actually
  // reaching PageList, and clicking one open still reveals the same fields
  // the removed test checked.
  it('fetches pages.json and renders one row per real page, each of them editable', async () => {
    const PAGES: Page[] = [
      {
        slug: 'catering',
        name: 'Catering',
        inNav: true,
        enabled: true,
        seo: { title: 'Catering | Via Bianca', description: 'Bespoke catering.' },
        sections: [],
      },
      {
        slug: 'cheeseboards',
        name: 'Cheeseboards',
        inNav: true,
        enabled: true,
        seo: { title: 'Cheeseboards | Via Bianca', description: 'Our cheeseboards.' },
        sections: [],
      },
    ];
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
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse(PAGES, 'sha-pages');
        if (url.includes('awards.json')) return contentResponse([], 'sha-awards');
        if (url.includes('experiences.json')) return contentResponse(EXPERIENCES, 'sha-experiences');
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Pages');

    // Mutation this guards: `PageList` returning `null` (or `items.map`
    // never running) -- confirmed red, both assertions below.
    const rows = await within(section).findAllByRole('button', { name: /^(Catering|Cheeseboards)$/ });
    expect(rows).toHaveLength(2);
    expect(within(section).getByText('Catering')).toBeInTheDocument();
    expect(within(section).getByText('Cheeseboards')).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Catering' }));
    expect(within(section).getByLabelText('Page name')).toHaveValue('Catering');
    expect(within(section).getByLabelText('Web address')).toHaveValue('catering');
  });
});

// ---------------------------------------------------------------------------
// A NOTE ON WHY THIS CASE COUNTS ROWS RATHER THAN `getAllByLabelText`.
//
// It is not style. This case, written the obvious way, cost 2.5s of a 5s
// budget on an idle machine and TIMED OUT under `npm run test:deploy` --
// which packs the surviving files onto workers differently from `npm test`,
// so the same work lands on a busier core. That refused a production deploy.
//
// What it was actually spending the time on is nothing asynchronous. It is
// two synchronous `getAllByLabelText` sweeps, ~650ms EACH, measured. The
// cause is jsdom 25's label resolution, and it is quadratic in the size of
// the whole mounted document:
//
//   * `getAllByLabelText` reads `.labels` on every element in its container.
//   * jsdom builds `input.labels` (helpers/form-controls.js) by iterating
//     the ENTIRE document tree from the root and reading `.control` on
//     every node it passes.
//   * `HTMLLabelElement.control` (nodes/HTMLLabelElement-impl.js) resolves
//     a `for=` attribute by iterating the ENTIRE document tree AGAIN,
//     comparing `id` attributes -- there is no id index in that path.
//
// So one `.labels` read costs (document nodes x labels-with-`for`) node
// visits. This dashboard has ~1170 elements and 172 `label[for]`, because
// ManageShell deliberately mounts all five areas at once and keeps them
// mounted (see its own header comment -- unmounting an area would re-fetch
// and overwrite her unpublished edits, which is a far worse bug than a slow
// test). Measured: ~600ms per sweep scoped to one section, ~3400ms scoped
// to the whole screen. jsdom caches the resulting live NodeList per element
// but invalidates it on any DOM mutation, so the sweep before the click and
// the sweep after it BOTH pay in full.
//
// The rewrite below asserts strictly more than the original did -- a new
// ROW, named as the blank one, with a blank Title on that row -- and costs
// ~390ms instead of ~1650ms, because the only label query left is scoped to
// a single <li> instead of the whole section. The timeout was NOT raised.
//
// The same pattern is still present elsewhere in this file (the "Add a
// dish" case is ~2.3s for the same reason). Left alone deliberately: they
// pass, and `npm run gate` now runs `test:deploy` itself, so the next one to
// tip over is caught before a push rather than by Cloudflare.
// ---------------------------------------------------------------------------
describe('AdminApp: the real "Experiences" screen', () => {
  it('"Add a coming-soon item" on the real, mounted screen adds an item she can then edit', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/pages');
    const section = await sectionByHeading('Experiences');
    await within(section).findByText('Catering');

    const rowCount = () => section.querySelectorAll('[data-item-row]').length;
    const before = rowCount();
    await user.click(within(section).getByRole('button', { name: 'Add a coming-soon item' }));
    expect(rowCount()).toBe(before + 1);

    // The appended row is the BLANK one, opened automatically in its own
    // editor -- not a copy of an existing item: `itemLabel` falls back to
    // "Untitled item" exactly when `title` is ''.
    expect(await screen.findByRole('dialog', { name: 'Untitled item' })).toBeInTheDocument();
    // ...and it is a real, editable field of hers, reached the way she
    // reaches it -- by its label.
    expect(screen.getByLabelText('Title')).toHaveValue('');
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
  it('renders Menus, listing both real menu labels, each opening its own editor on real values', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menu PDFs');
    // Task 4: a menu's label is now the row's own name (ItemList), not a
    // prefilled input -- the editor holding that input isn't mounted at
    // all until the row is opened.
    expect(await within(section).findByText('Food Menu')).toBeInTheDocument();
    expect(within(section).getByText('Drinks Menu')).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Food Menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Food Menu' });
    expect(within(dialog).getByLabelText(MENU_FIELDS.label.label)).toHaveValue('Food Menu');
    expect(within(dialog).getByLabelText(MENU_FIELDS.id.label)).toHaveValue('food');
  });

  it('renders Galleries, listing real atmosphere/ourStory rows by alt text and one row per collage photo', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    const section = await sectionByHeading('Galleries');
    // Task 5: a row's own fields (PhotoField included) only mount once its
    // editor is open -- what's provable with none open is that the real
    // content produced the right ROWS, correctly named.
    expect(await within(section).findByText(GALLERIES.atmosphere[0].alt)).toBeInTheDocument();
    expect(within(section).getByText(GALLERIES.ourStory[0].alt)).toBeInTheDocument();

    // The collage's grid-placement string is gone, and with it the read-only
    // "Layout position" field this used to count. What is left per photo is
    // the one thing this screen still does for the collage: replace it.
    const photos = collagePhotos(GALLERIES.heroCollage!);
    expect(photos.length).toBeGreaterThan(0);
    // One row per atmosphere/ourStory image, plus one per collage photo --
    // counted through `[data-item-row]` (ItemList's own row marker), rather
    // than a `getAllByLabelText('Photo')` sweep: that query only ever finds
    // ONE PhotoField at a time now (only the open row's own fields mount),
    // so it can no longer stand in for the row count at all.
    expect(section.querySelectorAll('[data-item-row]')).toHaveLength(
      GALLERIES.atmosphere.length + GALLERIES.ourStory.length + photos.length,
    );

    // And opening one really does show the real value, not just a row named
    // right by coincidence.
    await user.click(within(section).getByRole('button', { name: GALLERIES.atmosphere[0].alt }));
    const dialog = await screen.findByRole('dialog', { name: GALLERIES.atmosphere[0].alt });
    expect(within(dialog).getByLabelText('Photo')).toBeInTheDocument();
  });

  it('renders About, prefilled with the real heading and first paragraph', async () => {
    stubFetch();
    renderDashboard('/edit/manage/story');
    const section = await sectionByHeading('About');
    expect(await within(section).findByDisplayValue(STORY.heading)).toBeInTheDocument();
    expect(within(section).getByDisplayValue(STORY.paragraphs[0])).toBeInTheDocument();
  });

  it('renders Page copy, grouped by section, with the real footer hours heading value', async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Words on the site');
    expect(await within(section).findByDisplayValue(COPY.footer.hoursHeading)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Footer' })).toBeInTheDocument();
  });

  // The brief's own explicit requirement: footer.followLabel's U+00A0 must
  // render VISIBLY -- a marker, not a raw space -- so she can see it exists
  // at all, since an ordinary space looks IDENTICAL in the browser.
  it("shows footer.followLabel's non-breaking space as a visible marker, not an invisible raw space", async () => {
    stubFetch();
    renderDashboard('/edit/manage/details');
    const section = await sectionByHeading('Words on the site');
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

    // This test deliberately trips GalleryList's own SectionErrorBoundary --
    // React's dev-mode logging of the caught error, SectionErrorBoundary's
    // own componentDidCatch (SectionErrorBoundary.tsx), and jsdom's separate
    // reporting of the same underlying throw (routed to console.error too,
    // confirmed against jsdom's own VirtualConsole.sendTo) are all noise for
    // what this test proves, not signal. Suppressed here, scoped to this one
    // test; the boundary firing is still proven below by real, on-screen
    // assertions -- silencing reporting, not behaviour.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderDashboard('/edit/manage/story');

      // The rest of the dashboard is unaffected -- proven by reaching real,
      // interactive content in sections that have NOTHING to do with
      // galleries.json.
      await screen.findByText('Dish A');
      expect(screen.getByText('Drink X')).toBeInTheDocument();
      expect(screen.getByText('Article P')).toBeInTheDocument();
      // Queried by TEXT rather than through `sectionByHeading`, deliberately:
      // Menus lives in a different AREA from Galleries, and role queries do
      // not reach into a hidden one. "Food Menu" is unique on this page and
      // is the same evidence -- menus.json loaded and rendered -- without the
      // query needing that area to be on screen. Not `findByDisplayValue`:
      // Task 4 moved a menu's label out to its row's own name (ItemList),
      // which renders with no editor open, so `findByText` is what still
      // finds it here.
      expect(await screen.findByText('Food Menu')).toBeInTheDocument();

      // Galleries itself shows a named, recognizable fallback instead of
      // silently vanishing or crashing the page.
      expect(await screen.findByText(/Could not show Galleries/)).toHaveAttribute('role', 'alert');
      expect(screen.queryByRole('heading', { name: 'Galleries' })).not.toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
    }
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
    await within(dSection).findByText('Dish A');
    // Nothing staged or edited yet -- checked only once the page has
    // actually finished its initial (async) render, not in the "checking
    // session" gap right after `render`, where nothing meaningful is on
    // screen yet.
    expect(screen.getByText('No changes to publish yet.')).toBeInTheDocument();
    // A record's own fields (its PhotoField included) only mount once her
    // editor is open (Task 3's list+editor redesign) -- open Dish A's row
    // before reaching for its photo input.
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    // `photoPickers`, not a whole-panel `getAllByLabelText`: the association
    // proven is identical -- `<label for>` against the control's own id, read
    // from the control's side -- and it costs one indexed selector match per
    // file input instead of a `.labels` document walk per element in the
    // panel. See that helper's own comment. This case had two such sweeps.
    const dishPhotoInput = photoPickers(dSection, DISH_FIELDS.image.label)[0];
    await user.upload(dishPhotoInput, jpegFile('dish.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    // Staging the photo both stages its bytes AND writes the dish's own
    // `image` field to the new contentPath -- one edited section, one
    // staged file.
    await screen.findByText('1 section edited, 1 file staged — ready to publish.');

    const drSection = await sectionByHeading('Drinks');
    await within(drSection).findByText('Drink X');
    await user.click(within(drSection).getByRole('button', { name: 'Drink X' }));
    // Scoping to the Drinks panel is what makes this the DRINK's own input
    // rather than whichever section happens to render first -- sound because
    // RecordForm's `idFor` takes a per-file `scope` (see the "no duplicate DOM
    // ids" describe block below, and AdminApp.tsx's own comment on why), so
    // Dishes' and Drinks' first record no longer share `id="field-image-0"`.
    // `photoPickers` reads exactly that id/`for` pair, which is the same
    // association a label sweep resolves and the reason this gives nothing up.
    const drinkPhotoInput = photoPickers(drSection, 'Photo')[0];
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
    await within(section).findByText('Dish A');
    const row = within(section).getByRole('button', { name: 'Dish A' }).closest('li') as HTMLElement;
    // Non-vacuous: before the pick it really is showing the committed path.
    expect(row.querySelector('[data-thumbnail]')).toHaveAttribute('src', '/food/a.webp');

    // A record's own fields (its PhotoField included) only mount once her
    // editor is open (Task 3's list+editor redesign) -- opening it here is
    // what makes the upload below possible at all. The row's own thumbnail,
    // asserted below, lives OUTSIDE that editor and is proven to update
    // anyway -- it reads the shared preview store directly, not anything
    // local to the open editor.
    await user.click(within(row).getByRole('button', { name: 'Dish A' }));
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
    const section = await sectionByHeading('Menu PDFs');
    await within(section).findByText('Food Menu');
    await user.click(within(section).getByRole('button', { name: 'Food Menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Food Menu' });

    const pdfInput = within(dialog).getByLabelText('PDF file');
    await user.upload(pdfInput, pdfFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('name')).toBe('food-menu');
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('menu');
  });

  it('a completed same-name replacement still grows the staged-file count -- the bytes really are collected, not dropped on the floor', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menu PDFs');
    await within(section).findByText('Food Menu');
    await user.click(within(section).getByRole('button', { name: 'Food Menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Food Menu' });

    const pdfInput = within(dialog).getByLabelText('PDF file');
    await user.upload(pdfInput, pdfFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });

    // menus.json's OWN `file` field is unchanged (same name -> same path,
    // by design -- worker/upload.ts's own menuAssetPath), which is exactly
    // the shape that makes the collector the ONLY place proof this actually
    // happened can live -- no "section edited" in the summary at all, only
    // the staged file (Task 10's own carried requirement 3).
    await screen.findByText('1 file staged — ready to publish.');
    expect(within(dialog).getByLabelText(MENU_FIELDS.label.label)).toHaveValue('Food Menu');
  });
});

// Task 4's own new coverage: the list/editor split for Menu PDFs, and the
// three defects the brief's mutation table names explicitly.
describe('AdminApp: Menu PDFs -- the list/editor split (Task 4)', () => {
  it('renaming a menu leaves its editor open', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menu PDFs');
    await within(section).findByText('Food Menu');
    await user.click(within(section).getByRole('button', { name: 'Food Menu' }));

    const idInput = within(screen.getByRole('dialog')).getByLabelText(MENU_FIELDS.id.label);
    await user.clear(idInput);
    await user.type(idInput, 'street-food');

    // Still open, on the SAME record -- not closed by the id change that
    // relocated the record this editor is tracking by id.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText(MENU_FIELDS.id.label)).toHaveValue('street-food');
  });

  it('with the editor closed, a problem on the second menu is still on screen', async () => {
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
        if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
        // The second menu's label is blank -- a real validateMenus problem,
        // with no editor open to place it on a field.
        if (url.includes('menus.json'))
          return contentResponse(
            [
              { id: 'food', label: 'Food Menu', file: '/menus/food-menu.pdf' },
              { id: 'drinks', label: '', file: '/menus/drinks-menu.pdf' },
            ],
            'sha-menus',
          );
        if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
        if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
        if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menu PDFs');
    // Nothing here opens a row: the blank-label problem on the second menu
    // must reach the list-level banner with no editor open at all.
    expect(await within(section).findByRole('alert')).toBeInTheDocument();
  });

  it('menus.json has no add path -- the list offers no Add button', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    const section = await sectionByHeading('Menu PDFs');
    await within(section).findByText('Food Menu');
    expect(within(section).queryByRole('button', { name: /^Add/ })).toBeNull();
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
          return new Response(JSON.stringify({ sha: 'commit-1', publishId: 'p1' }), { status: 200, headers: { 'content-type': 'application/json' } });
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
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    const nameInput = await screen.findByDisplayValue('Dish A');
    await user.clear(nameInput);
    await user.type(nameInput, 'Dish A Edited');

    const dishPhotoInput = photoPickers(dSection, DISH_FIELDS.image.label)[0];
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
    await within(restoredSection).findByText('Dish A Edited'); // the unrelated edit survived the scrub
    await user.click(within(restoredSection).getByRole('button', { name: 'Dish A Edited' }));
    expect(await screen.findByDisplayValue('Dish A Edited')).toBeInTheDocument();

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

    expect(await screen.findByText('Dish A (restored)')).toBeInTheDocument();
    expect(screen.queryByText('Dish A')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dish A (restored)' }));
    expect(await screen.findByDisplayValue('Dish A (restored)')).toBeInTheDocument();
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

    expect(await screen.findByText('Dish A')).toBeInTheDocument();
    expect(screen.queryByText('Dish A (restored)')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(screen.getByText('No changes to publish yet.')).toBeInTheDocument();
  });

  it('no draft in localStorage -- the dashboard renders normally, banner absent', async () => {
    stubFetch();
    renderDashboard('/edit/manage/menu');
    await screen.findByText('Dish A');
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

    const dSection = await dishesSection();
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
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
    expect(screen.queryByText('Dish A Edited')).not.toBeInTheDocument(); // still gated -- never auto-applied

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    const restoredSection = await dishesSection();
    await within(restoredSection).findByText('Dish A Edited');
    await user.click(within(restoredSection).getByRole('button', { name: 'Dish A Edited' }));
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
    await within(dSection).findByText('Dish A');
    await user.click(within(dSection).getByRole('button', { name: 'Dish A' }));
    const dishPhotoInput = photoPickers(dSection, DISH_FIELDS.image.label)[0];
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

    await screen.findByRole('heading', { name: LOCKUP_ACCESSIBLE_NAME });
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
  // the POST, returning the Dish A name input to assert against. Opens Dish
  // A's own row first -- its fields only mount once its editor is open
  // (Task 3's list+editor redesign).
  async function openDishAInput(): Promise<HTMLInputElement> {
    const row = await screen.findByRole('button', { name: 'Dish A' });
    fireEvent.click(row);
    return (await screen.findByDisplayValue('Dish A')) as HTMLInputElement;
  }

  async function publishAndGetDishInput(user: ReturnType<typeof userEvent.setup>) {
    renderDashboard('/edit/manage/menu');
    const input = await openDishAInput();
    await user.type(input, '!');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    return input;
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
    const input = await openDishAInput();
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
    // The row (and its own editor, once opened) stay in the DOM even while
    // the panel is folded -- CollapsibleSection only toggles `hidden` on the
    // content div, it never unmounts anything (see this file's own header
    // comment on `sectionByHeading`). `getByText`, unlike `getByRole`, does
    // not filter on that attribute, so the row can still be found and
    // clicked before the fold is ever opened -- exactly how the
    // pre-redesign version of this test obtained its (also then-hidden)
    // Name input.
    const rowButton = (await screen.findByText('Dish A')).closest('button') as HTMLElement;
    fireEvent.click(rowButton);
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
    stubFetchWithPublish(async () => new Response(JSON.stringify({ sha: 'commit-1', publishId: 'p1' }), { status: 200 }));
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

// Phase 4, Task 4 review: Task 1's own review found the gap this task
// exists to close. An /edit draft saved BEFORE story.json grew a `chef`
// byline restores through registerLoaded's own unchecked
// `draftEntry.data as ContentTypeMap[K]` cast (register-loaded.ts) with NO
// `chef` key at all, which validateStory (src/content/validate.ts) reports
// as four required `chef.*` problems through its own `asRecord()` fallback
// -- but before this task, nothing in the dashboard rendered a field any of
// those four problems could attach to. Her only way out was Discard, losing
// whatever ELSE she had changed in the same draft.
//
// Reproduced end to end, through the real dashboard: a stale draft missing
// `chef` restores without crashing the panel (StoryForm's own defended
// `chef` fallback -- an earlier version of this fix read `value.chef.name`
// straight off the possibly-`chef`-less value and threw during render,
// which SectionErrorBoundary would have caught, taking the WHOLE About
// panel down, heading and paragraphs included -- confirmed directly against
// that unguarded version before this test existed), shows all four problems
// on the new fields, and filling every one of them in -- including a real
// photo upload through the same staged-file chain every other photo field
// uses -- clears every one and lets the draft actually publish.
describe('AdminApp: Phase 4 review fix -- a stale /edit draft missing `chef` is fixable, not a dead end', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restoring a pre-chef draft shows all four problems on their own fields, and filling them in clears every one and publishes', async () => {
    const publishBodies: { files: { path: string; content: string; encoding: string }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/wa') return WA_RESPONSE();
        if (url === '/api/publish') {
          publishBodies.push(JSON.parse(String(init?.body)) as { files: { path: string; content: string; encoding: string }[] });
          return new Response(JSON.stringify({ sha: 'commit-1', publishId: 'p1' }), { status: 200, headers: { 'content-type': 'application/json' } });
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

    // The pre-chef draft shape: story.json's OWN heading/paragraphs
    // untouched, no `chef` key at all -- exactly what a draft saved before
    // Task 1 landed would still have sitting in localStorage today.
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        'story.json': { data: { heading: STORY.heading, paragraphs: STORY.paragraphs }, savedAt: Date.now() },
      }),
    );

    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    await user.click(await screen.findByRole('button', { name: 'Restore' }));

    const section = await sectionByHeading('About');

    // Every label query below is scoped to the one field block it can
    // possibly be answered by, not to this whole panel -- see fieldBlock's
    // own comment. Written the obvious way, this case did SIX whole-panel
    // `getByLabelText` sweeps at ~265ms each and ran at 4.4s of the 5000ms
    // budget on an idle machine, which timed out under
    // `npm run test:deploy` and refused a production build.
    const nameField = fieldBlock(section, 'Your name');
    const roleField = fieldBlock(section, 'What you are');
    const portraitField = fieldBlock(section, 'Your photo');
    const portraitAltField = fieldBlock(section, 'Description of your photo');

    // Does not crash: the heading she already had is still there, and the
    // four new fields render, empty, rather than the whole panel
    // disappearing behind SectionErrorBoundary.
    expect(within(section).getByDisplayValue(STORY.heading)).toBeInTheDocument();
    expect(within(nameField).getByLabelText('Your name')).toHaveValue('');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    // All four, each on its OWN field -- not swept into the paragraph
    // banner (StoryForm's own `chef.` banner filter). Asserted INSIDE each
    // field's own block, which is what makes "on its own field" a claim
    // rather than a hope: the panel-wide version this replaces would have
    // passed just as happily with all four messages sitting in the banner.
    expect(within(nameField).getByText('the About section needs your name')).toBeInTheDocument();
    expect(
      within(roleField).getByText('the About section needs a short line saying who you are, e.g. "Chef and owner"'),
    ).toBeInTheDocument();
    expect(within(portraitField).getByText('the About section needs a photo of you')).toBeInTheDocument();
    expect(
      within(portraitAltField).getByText('your photo needs a short description, for people using a screen reader'),
    ).toBeInTheDocument();

    // She fills every one in -- three ordinary fields, then a real photo
    // upload through the same staged-file chain every other photo field
    // uses.
    await user.type(within(nameField).getByLabelText('Your name'), 'Kamalika Anand');
    await user.type(within(roleField).getByLabelText('What you are'), 'Chef and owner');
    await user.type(within(portraitAltField).getByLabelText('Description of your photo'), 'Chef Kamalika Anand');

    const portraitInput = within(portraitField).getByLabelText('Your photo');
    await user.upload(portraitInput, jpegFile('kamalika.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/team/kamalika.jpg', contentPath: '/team/kamalika.webp' });
    // Re-read through the label on every poll, exactly as before -- what is
    // gone is the whole-panel sweep this used to pay on every one of them
    // (~830ms across the poll loop, measured). React keeps the block's <div>
    // across re-renders, so the scope stays valid while the field inside it
    // goes from disabled to enabled.
    await waitFor(() => expect(within(portraitField).getByLabelText('Your photo')).not.toBeDisabled());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    // No chef problem survives -- she is no longer stuck, and Discard is no
    // longer her only way out. Deliberately still scoped to the WHOLE panel,
    // not to the four blocks above: "gone from its own field" would also be
    // true of a message that merely moved into the paragraph banner, and
    // that is not gone. `queryByText` resolves no labels, so the panel-wide
    // scope costs nothing here.
    expect(within(section).queryByText(/the About section needs your name/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/needs a short line saying who you are/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/needs a photo of you/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/needs a short description/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    const storyFile = publishBodies[0].files.find((f) => f.path === 'src/content/story.json');
    expect(storyFile).toBeDefined();
    const publishedStory = JSON.parse(storyFile!.content) as StoryContent;
    expect(publishedStory.chef).toEqual({
      name: 'Kamalika Anand',
      role: 'Chef and owner',
      portrait: '/team/kamalika.webp',
      portraitAlt: 'Chef Kamalika Anand',
    });
  });
});

// Ruled in by Task 8's review and proven here rather than in BlockList.test.tsx,
// because the claim is about what LEAVES THE BROWSER: a photo she picked, a
// block she then moved, and one publish request that has to carry both halves
// in agreement. Only the whole chain can say that -- PhotoField's upload,
// BlockList's keys, the collector every panel shares (staged.ts), and
// buildPublishRequest assembling the body.
//
// What used to happen, reproduced step for step below: the staged photo was
// filed under the block's POSITION, so moving the block left the bytes behind
// at the old position; the next photo picked there superseded them (the
// collector drops whatever sits at a key the instant a new pick starts, which
// is right and is the whole point of that contract); and the publish went out
// naming a photo no file was ever sent for. Live, that is a broken image in
// her post. On the next build it is an asset-existence failure that refuses
// every publish after it until somebody edits the JSON by hand. Reported to
// her as a success, both times.
describe('AdminApp: a photo picked for one block, and then that block moved', () => {
  const POST_WITH_TWO_PHOTOS = [
    {
      id: 'post-1',
      slug: 'the-tielle',
      type: 'recipe',
      title: 'The tielle',
      date: '2026-03-04',
      excerpt: 'A pie from Sète, by way of a bread oven.',
      image: '/press/hotelier.webp',
      blocks: [
        { kind: 'image', src: '', alt: 'The tielle, sliced', caption: '' },
        { kind: 'image', src: '', alt: 'The bread oven', caption: '' },
      ],
    },
  ];

  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });


  it('publishes the photo on the block she put it on, with the bytes for BOTH photos in the same request', async () => {
    const publishBodies = stubFetchCapturingPublish(POST_WITH_TWO_PHOTOS);
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');

    const section = await openPostsPanel(user);

    // Each block found by the description SHE typed into it, never by
    // position -- position is the thing under test, so a query that used one
    // would be assuming the answer. `closest('li')` lands on the BLOCK's own
    // item, which is nested inside the post's.
    //
    // A plain value scan rather than `getByDisplayValue`, and it is called
    // four times: what it gives up is the nice failure message, what it saves
    // is four Testing Library sweeps in a case that already spends its budget
    // on two uploads and a publish.
    const blockOf = (description: string): HTMLElement => {
      const input = [...section.querySelectorAll<HTMLInputElement>('input')].find(
        (candidate) => candidate.value === description,
      );
      expect(input, `no field on this panel holds "${description}"`).toBeDefined();
      return (input as HTMLInputElement).closest('li') as HTMLElement;
    };

    async function pickPhotoIn(block: HTMLElement, file: string, contentPath: string): Promise<void> {
      const before = FakeXHR.instances.length;
      const picker = block.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(picker, jpegFile(file));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(before + 1));
      FakeXHR.instances[before].respond(200, { path: `assets-source/posts/${file}`, contentPath });
      // Scoped to this block, so a confirmation left over on a DIFFERENT
      // block cannot answer for this one -- which is exactly the confusion
      // this whole case is about.
      await waitFor(() => expect(within(block).getByText(/Uploaded/)).toBeInTheDocument());
    }

    // A photo for the tielle, which is the first block.
    await pickPhotoIn(blockOf('The tielle, sliced'), 'tielle.jpg', '/posts/tielle.webp');
    // She moves it under the oven -- one gesture with the drag handle in a
    // real browser, one click here, the same reorder either way (the buttons
    // are not the lesser path; they are the only path on her phone).
    await user.click(within(section).getByRole('button', { name: 'Move Photo block 1 down' }));
    // ...and then a photo for the oven, which is now the first block.
    await pickPhotoIn(blockOf('The bread oven'), 'oven.jpg', '/posts/oven.webp');

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));

    const sent = publishBodies[0].files;
    const postsFile = sent.find((f) => f.path === 'src/content/posts.json');
    expect(postsFile).toBeDefined();
    const publishedBlocks = (JSON.parse(postsFile!.content) as Post[])[0].blocks as unknown as {
      alt: string;
      src: string;
    }[];
    // Her order, and her pairing: the oven first because she moved it there,
    // each block naming the photo she picked FOR IT.
    expect(publishedBlocks.map((block) => [block.alt, block.src])).toEqual([
      ['The bread oven', '/posts/oven.webp'],
      ['The tielle, sliced', '/posts/tielle.webp'],
    ]);

    // And the bytes for both, in this same request. This is the assertion the
    // defect failed: `assets-source/posts/tielle.jpg` was absent, because the
    // oven's pick had superseded the tielle's photo at the position it used to
    // occupy -- while posts.json above went on naming it. Asserted as the
    // whole set rather than two `toContain`s, so a THIRD, orphaned copy staged
    // under a name nothing refers to would fail here too.
    expect(sent.filter((f) => f.path.startsWith('assets-source/')).map((f) => f.path).sort()).toEqual([
      'assets-source/posts/oven.jpg',
      'assets-source/posts/tielle.jpg',
    ]);
  });
});

// The Phase 4 defect, tested rather than asserted. A draft saved before this
// feature existed restores through registerLoaded's unchecked
// `draftEntry.data as ContentTypeMap[K]` cast (sections/register-loaded.ts),
// so the shapes below are what the dashboard genuinely gets handed -- not
// hypotheticals. The only error boundary between a panel and the page is
// per-SECTION, so an unguarded read does not leave her one broken field: it
// takes the heading down with the panel, and she cannot even find the thing
// that is wrong.
describe('a draft saved before the block editor existed', () => {
  // The literal SectionErrorBoundary.tsx renders, with this panel's own name
  // in it -- read off that component rather than described, because a
  // `queryByText` of a message that is merely LIKE the real one finds nothing
  // either way and passes vacuously.
  const SECTION_ERROR_BOUNDARY_MESSAGE = `Could not show ${PANELS.posts.heading} — something in this file's content confused this page. The rest of the dashboard is unaffected; try reloading.`;

  // Three genuinely different pre-5B shapes, and none of them uses a
  // present-but-empty stand-in for an absent key -- `blocks: []` is a
  // DIFFERENT state from no `blocks` key, and this project has twice made the
  // mistake of testing absence with emptiness.
  const NO_POSTS_ENTRY = {
    'dishes.json': { data: DISHES, savedAt: Date.now() },
  };
  const POST_WITH_NO_BLOCKS_KEY = {
    'posts.json': {
      data: [{ id: 'stale-1', slug: 'a-stale-post', type: 'story', title: 'A stale post', date: '2026-01-02', excerpt: 'A stale excerpt.', image: '/press/hotelier.webp' }],
      savedAt: Date.now(),
    },
  };
  const BLOCK_WITH_NO_TEXT_KEY = {
    'posts.json': {
      data: [{ id: 'stale-2', slug: 'another-stale-post', type: 'story', title: 'Another stale post', date: '2026-01-02', excerpt: 'A stale excerpt.', image: '/press/hotelier.webp', blocks: [{ kind: 'paragraph' }] }],
      savedAt: Date.now(),
    },
  };

  // What "the posts panel finished" actually looks like in the DOM, and why it
  // is not the `[data-panel="posts"]` wait this task's brief prescribed:
  // EVERY area mounts from the first render and stays mounted (ManageShell,
  // and CollapsibleSection.tsx's own comment says so in as many words), so
  // `[data-panel="posts"]` is already in the document on every route before
  // any fetch resolves. A wait on it is a wait on nothing at all -- it would
  // have passed against a panel that never loaded and against a panel that
  // crashed.
  //
  // A button inside the panel body is the honest signal: while the section is
  // loading it renders one `<p>` and no controls, and a section the boundary
  // caught renders no panel body at all. Cheap on purpose -- one indexed
  // selector, no role sweep, no label resolution -- because a poll that costs
  // a `getComputedStyle` walk over this shell starves the render it is waiting
  // for, which is what failed a Cloudflare build from this file.
  //
  // The boundary's own message is part of the CONDITION rather than only of
  // the assertions below: a crashed panel would otherwise sit here until the
  // wait timed out and report "expected null not to be null", which says
  // nothing about what went wrong. This way the wait ends promptly and the
  // assertion that follows names the real failure.
  async function postsPanelSettled(): Promise<void> {
    await waitFor(() => {
      expect(
        document.querySelector('#section-panel-posts button') ?? screen.queryByText(SECTION_ERROR_BOUNDARY_MESSAGE),
      ).not.toBeNull();
    });
  }

  it.each([
    ['a draft with no posts.json entry at all', NO_POSTS_ENTRY],
    ['a post with no blocks key', POST_WITH_NO_BLOCKS_KEY],
    ['a paragraph block with no text key', BLOCK_WITH_NO_TEXT_KEY],
  ])('%s restores without taking the panel down', async (_name, draft) => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');

    await user.click(await screen.findByRole('button', { name: /^Restore/ }));
    await postsPanelSettled();

    // The heading survives. That is the whole Phase 4 lesson in one
    // assertion: the crash there took the heading, so she could not find the
    // section that was broken.
    expect(screen.getByRole('heading', { name: PANELS.posts.heading })).toBeInTheDocument();
    // And the panel body is really there, not replaced by the boundary's
    // fallback -- SectionErrorBoundary renders its own message, so asserting
    // the heading alone would pass on a caught crash.
    const panel = document.getElementById('section-panel-posts');
    expect(panel).not.toBeNull();
    expect(screen.queryByText(SECTION_ERROR_BOUNDARY_MESSAGE)).toBeNull();
    // The panel's own first control, which a caught crash cannot satisfy and a
    // renamed boundary message cannot fake. `hidden: true` because this panel
    // is folded on arrival (the shell opens an area's FIRST panel, which here
    // is Galleries) -- a crash inside a folded panel throws just the same, so
    // the case is about the crash rather than about what she is looking at.
    expect(within(panel as HTMLElement).getByRole('button', { name: 'Add a post', hidden: true })).toBeInTheDocument();
  });

  it('every problem in a stale post lands on its own field, never as one banner', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(BLOCK_WITH_NO_TEXT_KEY));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    await user.click(await screen.findByRole('button', { name: /^Restore/ }));
    await postsPanelSettled();
    const panel = await openPostsPanel(user);

    // The block's own field carries the block's own problem, by
    // aria-describedby -- the association she actually depends on, not merely
    // the message being somewhere on the page. Scoped to the one field block
    // it can be answered by (fieldBlock's own comment), because a
    // whole-panel label sweep here is what has twice nearly refused a deploy.
    const box = await waitFor(() => within(fieldBlock(panel, 'Words')).getByLabelText('Words'));
    await waitFor(() => expect(box.getAttribute('aria-describedby')).not.toBeNull());
    const describedBy = box.getAttribute('aria-describedby') as string;
    expect(document.getElementById(describedBy.split(' ').pop() as string)).toHaveTextContent(/needs some words/);
  });

  it('filling in what is missing lets her publish', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(BLOCK_WITH_NO_TEXT_KEY));
    const publishBodies = stubFetchCapturingPublish();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    await user.click(await screen.findByRole('button', { name: /^Restore/ }));
    await postsPanelSettled();
    const panel = await openPostsPanel(user);

    // The problem is on screen BEFORE she fixes it, and this is not
    // scene-setting: a wait for a message to go away is satisfied by a message
    // that never arrived. Without this line, lengthening the validation
    // debounce to ten times its real value leaves this case green -- measured,
    // not supposed.
    await waitFor(() => expect(within(panel).getByText(/needs some words/)).toBeInTheDocument());

    await user.type(within(fieldBlock(panel, 'Words')).getByLabelText('Words'), 'A real paragraph.');

    // The publish path is what "she could not get stuck" actually means: not
    // that the screen rendered, but that the work can leave the browser. The
    // validation debounce is 400ms, so this waits for the problem to CLEAR
    // rather than for a fixed time.
    await waitFor(
      () => {
        expect(within(panel).queryByText(/needs some words/)).toBeNull();
      },
      { timeout: 2000 },
    );
    // Nothing left on this panel claiming anything needs fixing, which is the
    // count summary going away entirely rather than one message going quiet.
    expect(within(panel).queryByText(/still needs fixing|still need fixing/)).toBeNull();

    // And the work really leaves the browser. Review measured the assertion
    // that used to stand here -- `expect(Publish).toBeEnabled()` -- and it
    // passes with the problem still on screen and nothing fixed, because
    // nothing about validation gates that button
    // (PublishBar.tsx's `disabled={!isDirty || busy || tooManyStaged}`, and
    // PostList.tsx says so outright). So the button is CLICKED, and what is
    // asserted is the paragraph she typed arriving in the request body.
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    const postsFile = publishBodies[0].files.find((file) => file.path === 'src/content/posts.json');
    expect(postsFile).toBeDefined();
    const published = JSON.parse(postsFile!.content) as Post[];
    expect(published).toHaveLength(1);
    const publishedBlocks = published[0].blocks as unknown as { text: string }[];
    expect(publishedBlocks.map((published) => published.text)).toEqual(['A real paragraph.']);
  });
});
