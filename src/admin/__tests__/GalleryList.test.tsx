import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryList from '../GalleryList';
import { GALLERY_IMAGE_FIELDS } from '../fields';
import { useStagedFiles } from '../staged';
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
  // need to be non-trivial about the flattening this screen does.
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

describe('GalleryList: renders all three lists, prefilled', () => {
  it('shows every atmosphere and ourStory photo as a preview, and every alt text', () => {
    renderList();
    const alts = screen.getAllByLabelText(GALLERY_IMAGE_FIELDS.alt.label);
    expect(alts.map((el) => (el as HTMLInputElement).value)).toEqual(['The dining room', 'The bar', 'Cutting pasta by hand']);
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
  // document order, offering exactly one action: replace it.
  it('shows one row per collage photo, in document order, with no layout field at all', () => {
    renderList();
    expect(screen.queryByLabelText('Layout position')).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Hero collage' });
    const wrapper = heading.closest('div');
    if (!wrapper) throw new Error('Hero collage heading is not inside a <div>');
    const previews = within(wrapper).getAllByRole('presentation') as HTMLImageElement[];
    expect(previews.map((img) => img.getAttribute('src'))).toEqual(['/hero/scene.webp', '/hero/farfalle1.webp']);
  });
});

// The collage's own write path, which the two tests above only prove RENDERS.
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

  it('reports the whole tree with only the chosen photo\'s src changed, siblings and sizes untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const photoInputs = screen.getAllByLabelText('Photo');
    // atmosphere (2) + ourStory (1) = 3 rows before the collage's first
    // photo; its SECOND photo is the one this drives, so a write that always
    // hits index 0 of the flattened list is caught too.
    await user.upload(photoInputs[4], jpegFile());
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
  it("editing atmosphere[0]'s alt reports { ...GALLERIES, atmosphere: [...] }", () => {
    const { onChange } = renderList();
    const alts = screen.getAllByLabelText(GALLERY_IMAGE_FIELDS.alt.label);
    fireEvent.change(alts[0], { target: { value: 'Updated caption' } });
    expect(onChange).toHaveBeenCalledWith({
      ...GALLERIES,
      atmosphere: [{ ...GALLERIES.atmosphere[0], alt: 'Updated caption' }, GALLERIES.atmosphere[1]],
    });
  });
});

describe('GalleryList: add, remove, and reorder -- atmosphere and ourStory only, never heroCollage', () => {
  it('"Add an atmosphere photo" appends one blank row to atmosphere only', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Add an atmosphere photo' }));
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [...GALLERIES.atmosphere, { src: '', alt: '' }] });
  });

  it('"Remove Atmosphere photo 1" drops only that row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Remove Atmosphere photo 1' }));
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [GALLERIES.atmosphere[1]] });
  });

  it('"Move Atmosphere photo 1 down" swaps the two atmosphere rows', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Atmosphere photo 1 down' }));
    expect(onChange).toHaveBeenCalledWith({ ...GALLERIES, atmosphere: [GALLERIES.atmosphere[1], GALLERIES.atmosphere[0]] });
  });

  // An anchored name-pattern check (`/^Remove Hero collage/`,
  // `/^Add.*collage/i`) can't actually catch a working Add/Remove pair
  // named anything else (e.g. a plain "Delete photo 1", or "Add a hero
  // photo" with no literal "collage" in it) -- an EXHAUSTIVE count of every
  // button this section renders, compared against the exact accessible
  // names expected, is what a rename or a differently-worded new button
  // can't slip past.
  it('Hero collage offers no add, no remove and no reorder -- arranging it happens on the collage itself', () => {
    renderList();
    const heading = screen.getByRole('heading', { name: 'Hero collage' });
    // Named `wrapper`, not the more obvious variable name here: this
    // null-guard needs a negation check on it, and an exclamation mark
    // sitting directly against the word this task's own report already
    // flags as a real Tailwind utility is ALSO that utility's
    // important-modifier syntax -- Tailwind's content scan does not parse
    // JS, so it reads that negation the same way it would read a class
    // list. Confirmed directly (the review's own near-miss discipline,
    // applied here too): the more obvious spelling added a new rule (and
    // five breakpoint variants of it) to the built CSS.
    const wrapper = heading.closest('div');
    if (!wrapper) throw new Error('Hero collage heading is not inside a <div>');
    // An exhaustive count of every button this section renders, not an
    // anchored name pattern: a pattern like /^Remove Hero collage/ cannot
    // catch a working Add/Remove pair named anything else (a plain "Delete
    // photo 1", say), where a count of ALL of them can't be slipped past by
    // a rename or a differently-worded new control. PhotoField's own picker
    // is a <label> wrapping a file input, not a button, so a correct render
    // of this section has no buttons in it at all -- and the file inputs
    // below are what proves that is because there is nothing else to click,
    // not because the section failed to render.
    expect(within(wrapper).queryAllByRole('button')).toEqual([]);
    expect(within(wrapper).getAllByLabelText('Photo')).toHaveLength(2);
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
    const photoInputs = screen.getAllByLabelText('Photo');
    await user.upload(photoInputs[0], jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('atmosphere');
  });

  it("ourStory's photo picker uploads under category 'our_story', and stages under a galleries.json-prefixed key with real bytes", async () => {
    const user = userEvent.setup();
    const { stage } = renderList();
    const photoInputs = screen.getAllByLabelText('Photo');
    // atmosphere has two rows (indices 0-1); ourStory's own single row is
    // index 2 in DOM order.
    await user.upload(photoInputs[2], jpegFile());
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
    const photoInputs = screen.getAllByLabelText('Photo');
    // atmosphere (2) + ourStory (1) = 3 rows before heroCollage's own first row.
    await user.upload(photoInputs[3], jpegFile());
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
    const firstUpload = screen.getAllByLabelText('Photo')[0];
    await user.upload(firstUpload, jpegFile('first.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/aaa111aaa111.jpg', contentPath: '/atmosphere/aaa111aaa111.webp' });
    await waitFor(() => expect(screen.getByTestId('staged-keys')).toHaveTextContent('galleries.json:atmosphere:row-0:src'));

    // 2. Reorder: "Move Atmosphere photo 1 down" -- the record (and its new
    // contentPath) moves to index 1; row 2's own '/atmosphere/bar.webp' is
    // now at index 0.
    await user.click(screen.getByRole('button', { name: 'Move Atmosphere photo 1 down' }));

    // 3. Stage a DIFFERENT photo on the row now at index 0 (the row whose
    // OWN src is '/atmosphere/bar.webp').
    const secondUpload = screen.getAllByLabelText('Photo')[0];
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

    const upload = screen.getAllByLabelText('Photo')[0]; // Atmosphere photo 1
    await user.upload(upload, jpegFile('first.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/aaa111aaa111.jpg', contentPath: '/atmosphere/aaa111aaa111.webp' });
    await waitFor(() => expect(screen.getByTestId('staged-keys')).toHaveTextContent('galleries.json:atmosphere:row-0:src'));

    // Pick AGAIN on the SAME row, on-screen position unchanged -- no
    // reorder in between, the exact case index-of-src-keying missed.
    await user.upload(screen.getAllByLabelText('Photo')[0], jpegFile('second.jpg'));
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

describe('GalleryList: a malformed row\'s own message attaches to that row only', () => {
  it('a blank alt on ourStory[0] shows up there, not on atmosphere, and not the top-level banner', () => {
    const withBlankAlt: Galleries = { ...GALLERIES, ourStory: [{ src: '/our_story/cut.webp', alt: '' }] };
    const problems = validateContent('galleries.json', withBlankAlt);
    expect(problems).toEqual([{ field: 'ourStory[0].alt', message: 'ourStory[0] needs alt text' }]);

    render(<GalleryList value={withBlankAlt} onChange={vi.fn()} problems={problems} stage={vi.fn()} />);
    expect(screen.queryByRole('alert', { name: 'Problems with Our Story' })).not.toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    // ourStory's own row is the third <li> (two atmosphere rows first).
    expect(within(rows[2]).getByText('ourStory[0] needs alt text')).toBeInTheDocument();
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
