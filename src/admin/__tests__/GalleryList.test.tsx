import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryList from '../GalleryList';
import { GALLERY_IMAGE_FIELDS } from '../fields';
import { useStagedFiles } from '../staged';
import { useImagePreviews } from '../previews';
import { validateContent } from '../../content/validate';
import type { Galleries } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';
import type { StagedFile } from '../staged';

// The identical fake XHR double PhotoField.test.tsx defines -- needed here
// to prove GalleryList's own PhotoField usage is wired to a real category
// and a real collector, not merely rendered.
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

const GALLERIES: Galleries = {
  atmosphere: [
    { src: '/atmosphere/dining.webp', alt: 'The dining room' },
    { src: '/atmosphere/bar.webp', alt: 'The bar' },
  ],
  ourStory: [{ src: '/our_story/cut.webp', alt: 'Cutting pasta by hand' }],
  // The collage is a tree now, not a list -- two photos side by side is the
  // smallest one that still has a split in it, which is what these tests
  // need to be non-trivial about the flattening this screen does. Both
  // photos carry a blank alt deliberately -- this screen has never edited a
  // collage photo's alt text, so their ROW NAME (Task 5) is the same
  // fallback string for both, and several cases below have to find them by
  // position rather than by name for exactly that reason.
  heroCollage: {
    kind: 'split',
    id: 'root',
    direction: 'row',
    children: [
      { kind: 'photo', id: 'photo-a', src: '/hero/scene.webp', alt: '' },
      { kind: 'photo', id: 'photo-b', src: '/hero/farfalle1.webp', alt: '' },
    ],
    sizes: [1, 1],
  },
};

function renderList(overrides: Partial<Parameters<typeof GalleryList>[0]> = {}) {
  const onChange = vi.fn();
  const stage = vi.fn();
  render(<GalleryList value={GALLERIES} onChange={onChange} problems={[]} stage={stage} {...overrides} />);
  return { onChange, stage };
}

// Finds the Hero collage list's own wrapper <div> -- every collage-scoped
// query below is scoped to this, since photo-a and photo-b share the same
// fallback row name and an unscoped query would collide with nothing (no
// other row shares that name) but is still the right discipline to keep.
function collageWrapper(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Hero collage' });
  const wrapper = heading.closest('div');
  if (!wrapper) throw new Error('Hero collage heading is not inside a <div>');
  return wrapper as HTMLElement;
}

describe('GalleryList: renders all three lists, prefilled', () => {
  // Task 5: a record's fields (PhotoField, the alt Field) only mount while
  // its own editor is open -- what is left un-opened is the row itself, so
  // this case now proves the row's own NAME is the real alt text (rather
  // than an input's display value) and the row's own thumbnail is the real
  // photo, neither of which needs an editor open at all.
  it('shows every atmosphere and ourStory row named by its alt text, with the current photo in its thumbnail', () => {
    renderList();
    expect(screen.getByText('The dining room')).toBeInTheDocument();
    expect(screen.getByText('The bar')).toBeInTheDocument();
    expect(screen.getByText('Cutting pasta by hand')).toBeInTheDocument();
    const previews = screen.getAllByRole('presentation') as HTMLImageElement[];
    expect(previews.map((img) => img.src)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/atmosphere/dining.webp'),
        expect.stringContaining('/atmosphere/bar.webp'),
        expect.stringContaining('/our_story/cut.webp'),
      ]),
    );
  });

  // The collage's grid-placement string is gone, and with it the read-only
  // "Layout position" field this screen used to show beside every collage
  // photo. What is left is one row per photo, flattened out of the tree in
  // document order, offering exactly one action: open it and replace it.
  it('lists collage photos in document order, each opening its own editor on the right photo, with no layout field at all', async () => {
    const user = userEvent.setup();
    renderList();
    expect(screen.queryByLabelText('Layout position')).toBeNull();

    const wrapper = collageWrapper();
    const rowIds = within(wrapper)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-item-row'));
    expect(rowIds).toEqual(['photo-a', 'photo-b']);

    const rowButtons = within(wrapper).getAllByRole('button');
    expect(rowButtons).toHaveLength(2);
    await user.click(rowButtons[1]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('presentation')).toHaveAttribute('src', '/hero/farfalle1.webp');
  });
});

// The collage's own write path, which the test above only proves RENDERS.
// Driven through the real PhotoField upload rather than by reaching into a
// prop: `onChange` is what actually reaches the registry, and a screen that
// lists the photos but writes back the wrong one (or nothing at all) looks
// identical until it is published.
describe('GalleryList: replacing a collage photo rewrites exactly that photo in the tree', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the whole tree with only the chosen photo's src changed, siblings and sizes untouched", async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const wrapper = collageWrapper();
    const rowButtons = within(wrapper).getAllByRole('button');
    // The collage's SECOND photo is the one this drives, so a write that
    // always hits index 0 of the flattened list is caught too.
    await user.click(rowButtons[1]);
    const photoInput = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/hero/aaa111.jpg', contentPath: '/hero/aaa111.webp' });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Galleries;
    expect(next.heroCollage).toEqual({
      kind: 'split',
      id: 'root',
      direction: 'row',
      children: [
        { kind: 'photo', id: 'photo-a', src: '/hero/scene.webp', alt: '' },
        { kind: 'photo', id: 'photo-b', src: '/hero/aaa111.webp', alt: '' },
      ],
      sizes: [1, 1],
    });
    // The other two lists are handed back at their prior object identity --
    // the "spread the touched level only" contract every write path here keeps.
    expect(next.atmosphere).toBe(GALLERIES.atmosphere);
    expect(next.ourStory).toBe(GALLERIES.ourStory);
  });
});

describe('GalleryList: editing alt text reports the whole Galleries object, only that leaf changed', () => {
  it("editing atmosphere[0]'s alt reports { ...GALLERIES, atmosphere: [...] }", async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    const altInput = within(screen.getByRole('dialog')).getByLabelText(GALLERY_IMAGE_FIELDS.alt.label);
    fireEvent.change(altInput, { target: { value: 'Updated caption' } });
    expect(onChange).toHaveBeenCalledWith({
      ...GALLERIES,
      atmosphere: [{ ...GALLERIES.atmosphere[0], alt: 'Updated caption' }, GALLERIES.atmosphere[1]],
    });
  });
});

describe('GalleryList: add, remove, and reorder -- atmosphere and ourStory only, never heroCollage', () => {
  it('"Add an atmosphere photo" appends one blank row to atmosphere only, rendered ABOVE the existing rows', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    // Position, not just presence: Task 2's own rule for ItemList's Add
    // button, re-proven here now that GalleryList renders through it too.
    const addButton = screen.getByRole('button', { name: 'Add an atmosphere photo' });
    const firstRow = document.querySelector('[data-item-row]');
    expect(firstRow).not.toBeNull();
    expect(addButton.compareDocumentPosition(firstRow as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(addButton);
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [...GALLERIES.atmosphere, { src: '', alt: '' }] });
  });

  // D8: delete lives inside the editor and asks once -- the row itself
  // carries no Remove button any more.
  it('opening a row and confirming "Remove Atmosphere photo 1" drops only that row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Atmosphere photo 1' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove atmosphere photo 1' }));
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [GALLERIES.atmosphere[1]] });
  });

  // ItemList generates "Move {row.name} up/down" from the row's own name --
  // the alt text now, not a fixed "Atmosphere photo N" -- so this is the
  // renamed control the brief's own mapping calls for, keeping the same
  // two-position assertion.
  it('"Move The dining room down" swaps the two atmosphere rows', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move The dining room down' }));
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [GALLERIES.atmosphere[1], GALLERIES.atmosphere[0]] });
  });

  // An EXHAUSTIVE count of every button this section renders, not an
  // anchored name pattern: a pattern like /^Remove Hero collage/ cannot
  // catch a working Add/Remove pair named anything else. With no editor
  // open, the only two buttons in this list are the two rows themselves --
  // Add, Remove and reorder all live one level down, inside an editor this
  // list never opens on its own.
  it('Hero collage offers no add, no remove and no reorder -- arranging it happens on the collage itself', () => {
    renderList();
    const wrapper = collageWrapper();
    expect(within(wrapper).getAllByRole('button')).toHaveLength(2);
    expect(within(wrapper).queryAllByLabelText('Photo')).toHaveLength(0);
  });

  // A screen that silently offers less than it used to reads as broken. This
  // one says where the missing controls went instead.
  it('says where arranging the collage actually happens, rather than silently offering less', () => {
    renderList();
    expect(screen.getByText(/the collage is arranged there/i)).toBeInTheDocument();
  });
});

// Task 9's own wiring, proven through a REAL upload -- GALLERY_IMAGE_FIELDS
// has no `src` entry at all (fields.ts's own comment explains why: one
// unchanging category can't serve both lists, and a wrong one sitting there
// unused was a real landmine); this is what proves GalleryList really does
// supply the right category itself, per list, entirely outside that
// descriptor.
describe("GalleryList: Task 9's collector wiring -- src stages through PhotoField with the right category and a real, list-scoped key", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("atmosphere's photo picker uploads under category 'atmosphere'", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    const photoInput = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('atmosphere');
  });

  it("ourStory's photo picker uploads under category 'our_story', and stages under a galleries.json-prefixed key with real bytes", async () => {
    const user = userEvent.setup();
    const { stage } = renderList();
    await user.click(screen.getByRole('button', { name: 'Cutting pasta by hand' }));
    const photoInput = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('our_story');

    FakeXHR.instances[0].respond(200, { path: 'assets-source/our_story/ddd444ddd444.jpg', contentPath: '/our_story/ddd444ddd444.webp' });
    // Keyed on the row's own client-only identity (GalleryList.tsx's own
    // useRowIds -- "row-0", ourStory's first and only row here), not its
    // array index or its mutable `src` -- see that file's own comment on why
    // either of those silently evicts or orphans a different stage.
    // Not `expect.any(String)`/no content check at all: this test's own
    // name claims "real bytes" -- `''` would satisfy a bare presence check
    // and is exactly the defect a missing collector produces (a path that
    // looks right, no bytes behind it).
    await waitFor(() =>
      expect(stage).toHaveBeenCalledWith(
        'galleries.json:ourStory:row-0:src',
        expect.objectContaining({
          path: 'assets-source/our_story/ddd444ddd444.jpg',
          encoding: 'base64',
          content: expect.stringMatching(/^[A-Za-z0-9+/=]{8,}$/),
        } as Partial<StagedFile>),
      ),
    );
  });

  it("Hero collage's photo picker uploads under category 'hero', and stages under a galleries.json-prefixed key with real bytes", async () => {
    const user = userEvent.setup();
    const { stage } = renderList();
    const wrapper = collageWrapper();
    const rowButtons = within(wrapper).getAllByRole('button');
    await user.click(rowButtons[0]); // photo-a, the collage's first row.
    const photoInput = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('hero');

    // Review finding: without this response and the assertion below, the
    // XHR never resolves, `onStaged` never fires, and NOTHING here would
    // notice `stage` being disconnected entirely -- confirmed directly,
    // deleting GalleryList.tsx's own heroCollage `onStaged` prop left every
    // test in this file (including the version of this one that stopped at
    // the `category` assertion above) green. "The highest-visibility photos
    // on the site" had the least-protected wiring for exactly that reason.
    FakeXHR.instances[0].respond(200, { path: 'assets-source/hero/eee555eee555.jpg', contentPath: '/hero/eee555eee555.webp' });
    await waitFor(() =>
      expect(stage).toHaveBeenCalledWith(
        'galleries.json:heroCollage:photo-a:src',
        expect.objectContaining({
          path: 'assets-source/hero/eee555eee555.jpg',
          encoding: 'base64',
          content: expect.stringMatching(/^[A-Za-z0-9+/=]{8,}$/),
        } as Partial<StagedFile>),
      ),
    );
  });
});

// The Critical review finding, reproduced exactly and then proven fixed:
// stage a photo on row 1, reorder, stage a DIFFERENT photo on the row now
// occupying row 1's old position -- with index-keying, the second stage
// silently evicts the first (same key, `...:0:src`, before either row's
// own `src` is consulted). A real `useStagedFiles()` is used here, not a
// spy, because the defect is specifically about what survives in the
// COLLECTOR across two sequential stages -- a spy only proves each
// individual call's arguments, not whether an earlier entry got clobbered.
function GalleryHarness({ initial }: { initial: Galleries }) {
  const [value, setValue] = useState(initial);
  const { files, stage } = useStagedFiles();
  return (
    <>
      <GalleryList value={value} onChange={setValue} problems={[]} stage={stage} />
      <p data-testid="staged-keys">{Object.keys(files).sort().join('|')}</p>
    </>
  );
}

describe('GalleryList: reordering between two stages does not evict the earlier one (Critical fix)', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stage -> reorder -> stage keeps BOTH photos' bytes in the collector", async () => {
    const user = userEvent.setup();
    render(<GalleryHarness initial={GALLERIES} />);

    // 1. Stage a photo on Atmosphere photo 1 (src '/atmosphere/dining.webp').
    // A record's fields only mount while its own editor is open -- opening
    // it here is what makes the upload possible at all.
    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    const firstUpload = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(firstUpload, jpegFile('first.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/aaa111aaa111.jpg', contentPath: '/atmosphere/aaa111aaa111.webp' });
    await waitFor(() => expect(screen.getByTestId('staged-keys')).toHaveTextContent('galleries.json:atmosphere:row-0:src'));

    // 2. Close (Move lives on the row itself, not inside the editor -- a
    // real reorder happens with the editor shut) and reorder: "Move The
    // dining room down" -- the record (and its new contentPath) moves to
    // index 1; row 2's own '/atmosphere/bar.webp' is now at index 0.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Move The dining room down' }));

    // 3. Stage a DIFFERENT photo on the row now at index 0 -- the row whose
    // OWN alt is "The bar".
    await user.click(screen.getByRole('button', { name: 'The bar' }));
    const secondUpload = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(secondUpload, jpegFile('second.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    FakeXHR.instances[1].respond(200, { path: 'assets-source/atmosphere/bbb222bbb222.jpg', contentPath: '/atmosphere/bbb222bbb222.webp' });

    // Both keys present -- the first stage's bytes were NOT evicted by the
    // second. Under the old index-keyed scheme both stages would have
    // collided on `galleries.json:atmosphere:0:src`, and this assertion
    // would see only ONE key. row-0 is dining (staged first, before the
    // reorder); row-1 is bar (staged second, after moving to index 0) --
    // useRowIds assigns both eagerly, in array order, at first render.
    await waitFor(() => {
      const keys = screen.getByTestId('staged-keys').textContent?.split('|') ?? [];
      expect(keys).toEqual(
        expect.arrayContaining(['galleries.json:atmosphere:row-0:src', 'galleries.json:atmosphere:row-1:src']),
      );
      expect(keys).toHaveLength(2);
    });
  });
});

// Important review finding, reproduced exactly and then proven fixed:
// keying on `item.src` (the fix Task 9 shipped for the reorder-eviction
// Critical above) is not enough on its own -- restaging the SAME row
// computes its own eviction key from the row's post-first-pick `src`,
// which was never the key the first pick was actually staged under.
// Measured against the real dashboard: 4 picks on one row left 3 staged
// files (2 of them dead weight), and 8 picks permanently disabled Publish
// with no control anywhere to remove one.
describe('GalleryList: restaging the SAME row does not orphan the earlier upload (Important fix)', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picking a second photo on the same row evicts the first pick -- exactly ONE staged entry survives, not two', async () => {
    const user = userEvent.setup();
    render(<GalleryHarness initial={GALLERIES} />);

    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    const dialog = screen.getByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Photo'), jpegFile('first.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/aaa111aaa111.jpg', contentPath: '/atmosphere/aaa111aaa111.webp' });
    await waitFor(() => expect(screen.getByTestId('staged-keys')).toHaveTextContent('galleries.json:atmosphere:row-0:src'));

    // Pick AGAIN on the SAME row, editor still open the whole time -- no
    // close/reopen and no reorder in between, the exact case
    // index-of-src-keying missed. D3 (the editor holds no buffer) is why
    // this is even possible: every keystroke -- and every stage -- commits
    // immediately, so the dialog never needs to be re-opened to see it.
    await user.upload(within(dialog).getByLabelText('Photo'), jpegFile('second.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    FakeXHR.instances[1].respond(200, { path: 'assets-source/atmosphere/ccc333ccc333.jpg', contentPath: '/atmosphere/ccc333ccc333.webp' });

    await waitFor(() => {
      const keys = screen.getByTestId('staged-keys').textContent?.split('|').filter(Boolean) ?? [];
      // Exactly one entry for this row -- the FIRST pick's bytes were
      // evicted by the second, not left behind as an orphan counting
      // against MAX_STAGED_PHOTOS_PER_PUBLISH. Reverting GalleryList.tsx's
      // stage key back to `item.src` fires this assertion: it sees TWO
      // keys, the dangling `.../aaa111aaa111.webp:src` alongside the new
      // one.
      expect(keys).toEqual(['galleries.json:atmosphere:row-0:src']);
    });
  });
});

describe('GalleryList: an EMPTY atmosphere list still surfaces the real validator\'s own message', () => {
  it('shows "atmosphere needs at least one image" in that list\'s own banner', () => {
    const empty: Galleries = { ...GALLERIES, atmosphere: [] };
    const problems = validateContent('galleries.json', empty);
    expect(problems.some((p) => p.field === 'atmosphere')).toBe(true);
    render(<GalleryList value={empty} onChange={vi.fn()} problems={problems} stage={vi.fn()} />);
    expect(screen.getByRole('alert', { name: 'Problems with Atmosphere' })).toHaveTextContent('atmosphere needs at least one image');
  });
});

// D4: with an editor closed, nine of ten records' fields (here, every
// record's) are unmounted and their own `role="alert"` messages with them --
// so every list carries a list-level banner of every problem its open editor
// (there is none, here) is not showing, plus a per-row "needs attention"
// marker. The partition is by reference (shown/banner), never both places,
// never neither -- RecordForm.tsx's own guarantee, applied to this screen.
describe('GalleryList: closing an editor must not hide a validation problem (D4)', () => {
  it("with every editor closed, a blank alt on ourStory[0] shows up in About's own banner, not on atmosphere, and the row itself still marks needing attention", () => {
    const withBlankAlt: Galleries = { ...GALLERIES, ourStory: [{ src: '/our_story/cut.webp', alt: '' }] };
    const problems = validateContent('galleries.json', withBlankAlt);
    expect(problems).toEqual([{ field: 'ourStory[0].alt', message: 'ourStory[0] needs alt text' }]);

    render(<GalleryList value={withBlankAlt} onChange={vi.fn()} problems={problems} stage={vi.fn()} />);
    expect(screen.queryByRole('alert', { name: 'Problems with Atmosphere' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Problems with About' })).toHaveTextContent('ourStory[0] needs alt text');
    // The per-row half of the same partition: the row is still findable and
    // still openable, marked rather than hidden.
    const row = screen.getByRole('button', { name: /Photo with no description yet needs attention/ });
    expect(row).toBeInTheDocument();
  });

  it('a problem naming a row index past the end of what is rendered still surfaces, in that list\'s banner', () => {
    const problems: ValidationProblem[] = [{ field: 'atmosphere[9].alt', message: 'a stale problem for a row no longer here' }];
    render(<GalleryList value={GALLERIES} onChange={vi.fn()} problems={problems} stage={vi.fn()} />);
    expect(screen.getByRole('alert', { name: 'Problems with Atmosphere' })).toHaveTextContent('a stale problem for a row no longer here');
  });

  // I6 review finding: `[9]` above is far past GALLERIES.atmosphere's own
  // length (2) -- it can't tell `item.index >= itemCount` apart from
  // `item.index > itemCount`, since both are true for either. `[2]` -- one
  // past the LAST real row -- is the one index that separates them.
  it('a problem at the EXACT boundary index (itemCount itself) still surfaces, not only ones far past it', () => {
    const problems: ValidationProblem[] = [{ field: 'atmosphere[2].alt', message: 'a boundary problem for a row no longer here' }];
    render(<GalleryList value={GALLERIES} onChange={vi.fn()} problems={problems} stage={vi.fn()} />);
    expect(screen.getByRole('alert', { name: 'Problems with Atmosphere' })).toHaveTextContent('a boundary problem for a row no longer here');
  });
});

// Task 5's own new coverage: the one shared open key across all three lists.
describe('GalleryList: one open key for all three lists (Task 5)', () => {
  it('opening an Our Story photo closes the Atmosphere one', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'The dining room' }));
    expect(screen.getByRole('dialog', { name: 'The dining room' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cutting pasta by hand' }));
    expect(screen.queryByRole('dialog', { name: 'The dining room' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cutting pasta by hand' })).toBeInTheDocument();
    // Never two dialogs at once -- each one claims aria-modal, and a second
    // would trap focus inside the first.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('a photo with no description still has a row you can click', async () => {
    const user = userEvent.setup();
    const noAlt: Galleries = { ...GALLERIES, atmosphere: [{ src: '/atmosphere/dining.webp', alt: '' }, GALLERIES.atmosphere[1]] };
    render(<GalleryList value={noAlt} onChange={vi.fn()} problems={[]} stage={vi.fn()} />);
    // Scoped to the Atmosphere list specifically: the hero collage's own two
    // rows share this identical fallback name in the fixture (their own alt
    // is blank too), so an unscoped query would be ambiguous.
    const heading = screen.getByRole('heading', { name: 'Atmosphere' });
    const wrapper = heading.closest('div') as HTMLElement;
    await user.click(within(wrapper).getByRole('button', { name: 'Photo with no description yet' }));
    expect(screen.getByRole('dialog', { name: 'Photo with no description yet' })).toBeInTheDocument();
  });
});

// The photo she picked shows on the row she picked it for -- driven through
// a real preview store, not a stub, since the defect this proves is about
// which KEY the row's own Thumbnail reads, not merely that PhotoField calls
// `previews.set` at all (PhotoField.test.tsx already covers that in
// isolation).
function GalleryPreviewHarness({ initial }: { initial: Galleries }) {
  const [value, setValue] = useState(initial);
  const previews = useImagePreviews();
  return <GalleryList value={value} onChange={setValue} problems={[]} stage={vi.fn()} previews={previews} />;
}

describe('GalleryList: the photo she picked shows on the row she picked it for (Task 5)', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("staging a photo on Atmosphere photo 1 updates THAT row's own thumbnail to the object URL, leaving the other row's untouched", async () => {
    const user = userEvent.setup();
    render(<GalleryPreviewHarness initial={GALLERIES} />);

    const row = screen.getByText('The dining room').closest('li') as HTMLElement;
    const otherRow = screen.getByText('The bar').closest('li') as HTMLElement;
    // Non-vacuous: before the pick it really is showing the committed path.
    expect(row.querySelector('[data-thumbnail]')).toHaveAttribute('src', '/atmosphere/dining.webp');

    await user.click(within(row).getByRole('button', { name: 'The dining room' }));
    const photoInput = within(screen.getByRole('dialog')).getByLabelText('Photo');
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/aaa111.jpg', contentPath: '/atmosphere/aaa111.webp' });

    // Mutation this guards: key the row's Thumbnail off the wrong prefix (or
    // off `item.src` instead of `rowIdFor`) -- the object URL either never
    // shows here or shows on the wrong row.
    await waitFor(() => {
      const src = row.querySelector('[data-thumbnail]')?.getAttribute('src') ?? '';
      expect(src.startsWith('blob:')).toBe(true);
    });
    expect(otherRow.querySelector('[data-thumbnail]')).toHaveAttribute('src', '/atmosphere/bar.webp');
  });
});
