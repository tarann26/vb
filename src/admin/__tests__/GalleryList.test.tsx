import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryList from '../GalleryList';
import { GALLERY_IMAGE_FIELDS } from '../fields';
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
  // Deliberately NOT real Tailwind grid-placement utility text (galleries.json's
  // own real heroCollage entries use actual grid-column/row utility classes)
  // -- this file is a real .tsx source Tailwind's own content scan DOES walk (unlike
  // galleries.json itself, which the brief is explicit it does not), so a
  // fixture that reproduced those class names verbatim would make this
  // TEST FILE the thing that newly satisfies Tailwind's scan for a utility
  // this project's own known, deliberately-unfixed defect says is missing
  // from the real shipped CSS (see this task's own report) -- confirmed
  // directly: an earlier version of this fixture used real grid utility
  // class text and added a new rule to the built CSS that a real
  // before/after diff caught. What this test actually needs is only "some
  // opaque string", never edited here -- these two values prove that.
  heroCollage: [
    { src: '/hero/scene.webp', className: 'layout-slot-a' },
    { src: '/hero/farfalle1.webp', className: 'layout-slot-b' },
  ],
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

  it('shows heroCollage as read-only layout positions, not an editable text field', () => {
    renderList();
    const positions = screen.getAllByLabelText('Layout position');
    expect(positions).toHaveLength(2);
    positions.forEach((el) => expect(el).toBeDisabled());
    expect((positions[0] as HTMLInputElement).value).toBe('layout-slot-a');
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

  it('Hero collage can be reordered but never added to or removed from -- every entry there is developer-placed', () => {
    renderList();
    // Reorder IS offered (two rows, so the first has a down button and the
    // second has an up one) --
    expect(screen.getByRole('button', { name: 'Move Hero collage photo 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Hero collage photo 2 up' })).toBeInTheDocument();
    // -- but there is no way to add a new slot or remove an existing one.
    expect(screen.queryByRole('button', { name: /^Remove Hero collage/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add.*collage/i })).not.toBeInTheDocument();
  });
});

// Task 9's own wiring, proven through a REAL upload -- GALLERY_IMAGE_FIELDS.src
// is never actually used for rendering (fields.ts's own comment explains
// why one unchanging category can't serve both lists); this is what proves
// GalleryList really does supply the right one itself, per list.
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
    await waitFor(() =>
      expect(stage).toHaveBeenCalledWith(
        'galleries.json:ourStory:0:src',
        expect.objectContaining({ path: 'assets-source/our_story/ddd444ddd444.jpg', encoding: 'base64' } as Partial<StagedFile>),
      ),
    );
  });

  it("Hero collage's photo picker uploads under category 'hero'", async () => {
    const user = userEvent.setup();
    renderList();
    const photoInputs = screen.getAllByLabelText('Photo');
    // atmosphere (2) + ourStory (1) = 3 rows before heroCollage's own first row.
    await user.upload(photoInputs[3], jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('hero');
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
});
