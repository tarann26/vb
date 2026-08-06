// Plan 5 Task 4: EditableImage.tsx renders exactly what the public
// component renders (same props), with a persistent overlay control -- not
// a hover reveal, the same tap-not-hover mandate EditableText.test.tsx's own
// header comment already documents for text. Uses the same FakeXHR double
// PhotoField.test.tsx and upload-photo.test.ts both use, for the identical
// reason: neither fetch nor jsdom's own XHR implements
// XMLHttpRequest.upload.onprogress.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import EditableImage from '../EditableImage';
import type { EditableImageProps } from '../EditableImage';
import type { StagedPhoto } from '../upload-photo';

const heicToMock = vi.fn();
vi.mock('heic-to', () => ({
  get heicTo() {
    return heicToMock;
  },
}));

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
  fail() {
    this.onerror?.();
  }
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...enc('JFIF')]);
function jpegFile(name = 'photo.jpg'): File {
  return new File([JPEG_BYTES], name, { type: 'image/jpeg' });
}

// The preview is owned by the SCREEN now, not by EditableImage (see
// src/admin/previews.ts for why: a swap unmounts the box, and a preview held
// inside the component died with it). Every test here therefore renders it
// through a tiny owner that does exactly what `useImagePreviews` does for
// /edit -- which makes these tests check the real path rather than a
// component-local shortcut that no longer exists.
function PreviewOwner(props: Omit<EditableImageProps, 'previewUrl' | 'onPreview'>) {
  const [url, setUrl] = useState<string | null>(null);
  return <EditableImage {...props} previewUrl={url} onPreview={setUrl} />;
}

function renderImage(overrides: Partial<EditableImageProps> = {}) {
  const onStaged = vi.fn();
  const onReplace = vi.fn();
  const { container } = render(
    <PreviewOwner
      path="galleries.heroCollage.5"
      category="hero"
      src="/atmosphere/dining.webp"
      alt="The dining room"
      className="w-full h-full object-cover"
      onStaged={onStaged}
      onReplace={onReplace}
      {...overrides}
    />,
  );
  const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;
  const img = () => container.querySelector('img') as HTMLImageElement;
  return { container, onStaged, onReplace, input, img };
}

describe('EditableImage', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    heicToMock.mockReset();
  });

  it('renders the img with exactly the props it was given, unchanged', () => {
    const { img } = renderImage();
    expect(img()).toHaveAttribute('src', '/atmosphere/dining.webp');
    expect(img()).toHaveAttribute('alt', 'The dining room');
    expect(img()).toHaveClass('w-full', 'h-full', 'object-cover');
  });

  it('carries the renderImage path so a reached-path check (mirroring EditableText\'s data-editable-path) can find it', () => {
    const { container } = renderImage({ path: 'dishes.margherita.image' });
    expect(container.querySelector('[data-editable-image-path="dishes.margherita.image"]')).not.toBeNull();
  });

  // The repair for "Our Story's photos are invisible at /edit". jsdom has no
  // layout engine, so nothing here can measure a collapsed box -- what IS
  // checkable here, and is the whole mechanism, is WHICH element carries the
  // classes the parent lays out by. e2e/our-story-carousel.spec.ts measures
  // the real boxes in real Chromium; these pin the class plumbing that makes
  // those measurements come out right, and fail far faster.
  describe('the wrapper is laid out as the image would have been (flex/grid parents size THIS element, not the img)', () => {
    function wrapperOf(className: string, overrides: Partial<Parameters<typeof EditableImage>[0]> = {}): HTMLElement {
      const { container } = renderImage({ className, ...overrides });
      return container.querySelector('[data-editable-image-path]') as HTMLElement;
    }

    // Every distinct className shape the eight real `content.renderImage`
    // call sites pass today, copied verbatim from those files -- not a
    // hand-invented fixture. The first row is OurStory.tsx's, the one that
    // was actually broken on the live site.
    const REAL_CALL_SITES: { site: string; className: string; layout: string[]; visualOnly: string[] }[] = [
      {
        site: 'OurStory.tsx (flex carousel track -- the reported bug)',
        className: 'w-full flex-shrink-0 object-cover h-[400px]',
        layout: ['w-full', 'flex-shrink-0', 'h-[400px]'],
        visualOnly: ['object-cover'],
      },
      {
        site: 'PlaceGallery.tsx / GallerySection.tsx carousel',
        className: 'w-full h-full object-cover',
        layout: ['w-full', 'h-full'],
        visualOnly: ['object-cover'],
      },
      {
        site: 'Hero.tsx collage tile',
        className: 'w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity duration-500',
        layout: ['w-full', 'h-full'],
        // `opacity-90` in particular must NOT reach the wrapper: an opacity
        // below 1 makes an element a stacking context, which would trap the
        // camera badge's own z-20 inside it and re-open the hit-testing bug
        // CONTROL_LABEL_CLASSNAME's comment records.
        visualOnly: ['object-cover', 'opacity-90', 'hover:opacity-100', 'transition-opacity', 'duration-500'],
      },
      {
        site: 'FoodGallery / Drinks / BlogTeaser / BlogsPage / ItemListSection',
        className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
        layout: ['w-full', 'h-full'],
        visualOnly: ['object-cover', 'group-hover:scale-110', 'transition-transform', 'duration-500'],
      },
      {
        site: "GallerySection.tsx layout: 'grid' (logo row -- the second flex-parent instance)",
        className: 'max-h-full max-w-full object-contain',
        layout: ['max-h-full', 'max-w-full'],
        visualOnly: ['object-contain'],
      },
    ];

    // Mutation this guards: `className={wrapper}` (EditableImage.tsx, both
    // the locked and unlocked returns) reverted to
    // `className={WRAPPER_CLASSNAME}` -- i.e. the pre-repair component.
    // Confirmed red on every row below.
    REAL_CALL_SITES.forEach(({ site, className, layout, visualOnly }) => {
      it(`copies the layout classes, and only those, up from ${site}`, () => {
        const wrapper = wrapperOf(className);
        layout.forEach((token) => expect(wrapper.className.split(' ')).toContain(token));
        visualOnly.forEach((token) => expect(wrapper.className.split(' ')).not.toContain(token));
        // Still the badge's containing block, and now a real box for the
        // copied sizing to actually apply to (width/height do not apply to a
        // non-replaced inline element at all).
        expect(wrapper.className.split(' ')).toContain('relative');
        expect(wrapper.className.split(' ')).toContain('inline-block');
      });

      // Mutation this guards: making the copy a MOVE (deleting the layout
      // classes from `imgProps.className` on the way past) -- confirmed red,
      // the image then has nothing left to fill the wrapper with.
      it(`leaves ${site}'s own img className completely untouched`, () => {
        const { container } = renderImage({ className });
        expect((container.querySelector('img') as HTMLImageElement).className).toBe(className);
      });
    });

    // Mutation this guards: dropping the `layout.length === 0` early return,
    // so every wrapper gains `inline-block` unconditionally -- confirmed red.
    // A call site that never had this problem must not acquire a new box.
    it('an image with no layout class at all leaves the wrapper exactly as it was', () => {
      expect(wrapperOf('rounded-full shadow').className).toBe('relative');
    });

    it('an image with no className at all leaves the wrapper exactly as it was', () => {
      const { container } = render(
        <EditableImage
          path="galleries.ourStory.0"
          category="our_story"
          src="/x.webp"
          alt="x"
          onStaged={() => {}}
          onReplace={() => {}}
          previewUrl={null}
          onPreview={() => {}}
        />,
      );
      expect((container.querySelector('[data-editable-image-path]') as HTMLElement).className).toBe('relative');
    });

    // Mutation this guards: `if (base.startsWith('!')) base = base.slice(1)`
    // deleted from baseUtility -- confirmed red on `!h-full` below.
    it('recognises a layout class through responsive/state variants and an important marker', () => {
      const classes = wrapperOf('md:w-1/2 -mt-2 !h-full focus:max-h-4 hover:bg-white').className.split(' ');
      expect(classes).toContain('md:w-1/2');
      expect(classes).toContain('!h-full');
      expect(classes).toContain('focus:max-h-4');
      // A margin is laid out by the parent too, but copying it (rather than
      // moving it) would double the gap -- see LAYOUT_UTILITY_PREFIXES.
      expect(classes).not.toContain('-mt-2');
      expect(classes).not.toContain('hover:bg-white');
    });

    // Mutation this guards: replacing baseUtility's bracket-aware scan with
    // a plain `token.split(':').pop()` -- confirmed red on the data-type
    // hint below, Tailwind's own documented syntax for an arbitrary value
    // whose type the scanner cannot infer. The naive form splits at the
    // colon INSIDE the brackets, comes back with `var(--slide)]`, and drops
    // a real width off the wrapper.
    it("recognises a layout class whose arbitrary value carries Tailwind's own data-type hint", () => {
      const classes = wrapperOf('md:w-[length:var(--slide)] object-cover').className.split(' ');
      expect(classes).toContain('md:w-[length:var(--slide)]');
      expect(classes).not.toContain('object-cover');
    });

    // The pause must not undo the repair: `locked` returns from a different
    // branch of this component, and an earlier draft updated only the other
    // one -- so a publish in flight would have collapsed the carousel again
    // for exactly as long as it lasted.
    // Mutation this guards: reverting ONLY the locked return's `className`
    // to `WRAPPER_CLASSNAME` -- confirmed red here and green everywhere else
    // in this file.
    it('keeps the wrapper laid out while a publish is in flight (locked)', () => {
      const classes = wrapperOf('w-full flex-shrink-0 object-cover h-[400px]', { locked: true }).className.split(' ');
      expect(classes).toContain('w-full');
      expect(classes).toContain('flex-shrink-0');
      expect(classes).toContain('h-[400px]');
      expect(classes).toContain('inline-block');
    });
  });

  describe('tap, not hover -- the affordance is persistently visible', () => {
    // jsdom applies no real CSS -- checked at the source level, the same
    // established pattern EditableText.test.tsx's own identical describe
    // block uses for the identical reason.
    //
    // Mutation this guards: adding a `hover:opacity-100`/`opacity-0` pair to
    // either control className -- confirmed red against that exact string.
    it('neither control className carries a hover: variant or a hidden-by-default utility', () => {
      const source = readFileSync('src/admin/EditableImage.tsx', 'utf8');
      const classNames = [...source.matchAll(/_CLASSNAME =\s*\n?\s*'([^']*)'/g)].map((m) => m[1]);
      expect(classNames.length).toBeGreaterThan(0);
      classNames.forEach((className) => {
        expect(className).not.toMatch(/\bhover:/);
        expect(className).not.toMatch(/\b(opacity-0|invisible|hidden)\b/);
      });
      // And a real, persistent visual marker IS there unconditionally.
      expect(classNames.some((c) => c.includes('absolute'))).toBe(true);
    });

    // At a 390px viewport (the spec's own named case: 16 hero-collage tiles
    // at ~60px each) -- picking a file needs no prior hover/pointer-enter
    // event, only the change a real tap-then-choose produces.
    it('at a 390px viewport, picking a file (no prior hover) starts the upload', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });

      const { input } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true, writable: true });
    });
  });

  describe('a successful pick', () => {
    // Drains the pipeline all the way to a real response before finishing --
    // an un-awaited pick left running past the end of a test still holds a
    // live XHR (FakeXHR's own `respond`/`fail` are the only things that
    // ever settle it) that can construct a NEXT XMLHttpRequest instance
    // after a LATER test's own `beforeEach` has already reset
    // `FakeXHR.instances`, silently inflating that later test's own count.
    // Confirmed directly while writing this file.
    it('calls onStaged(null) immediately, before the upload resolves', async () => {
      const { input, onStaged } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());
      expect(onStaged).toHaveBeenCalledWith(null);

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].respond(200, { path: 'assets-source/hero/z.jpg', contentPath: '/hero/z.webp' });
      await waitFor(() => expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ contentPath: '/hero/z.webp' })));
    });

    it('calls onStaged with the staged bytes and onReplace with contentPath once the upload succeeds', async () => {
      const { input, onStaged, onReplace } = renderImage({ category: 'atmosphere', path: 'galleries.atmosphere.0' });
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('atmosphere');
      FakeXHR.instances[0].respond(200, { path: 'assets-source/atmosphere/x.jpg', contentPath: '/atmosphere/x.webp' });

      await waitFor(() =>
        expect(onStaged).toHaveBeenCalledWith(
          expect.objectContaining({ contentPath: '/atmosphere/x.webp', encoding: 'base64' } satisfies Partial<StagedPhoto>),
        ),
      );
      expect(onReplace).toHaveBeenCalledWith('/atmosphere/x.webp');
    });

    it('previews the picked photo locally, not the eventual (not-yet-live) contentPath', async () => {
      const { input, img } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(img()).toHaveAttribute('src', expect.stringMatching(/^blob:/));

      FakeXHR.instances[0].respond(200, { path: 'assets-source/hero/y.jpg', contentPath: '/hero/y.webp' });
      await waitFor(() => expect(img()).toHaveAttribute('src', expect.stringMatching(/^blob:/)));
    });

    it('reports upload progress through an aria-live status region', async () => {
      const { input } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      // A direct function call, not a real DOM event (see this file's own
      // header comment) -- React never sees it as user-driven, so the
      // resulting setState needs an explicit act(), the same reason
      // PhotoField.test.tsx's own identical progress test does.
      act(() => FakeXHR.instances[0].upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 }));
      expect(await screen.findByRole('status')).toHaveTextContent('50%');
    });
  });

  describe('a failed pick', () => {
    it('shows the server-provided message as an alert, and does not call onReplace', async () => {
      const { input, onReplace } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].respond(400, { message: 'This photo is HEIC. Convert it before upload.' });

      expect(await screen.findByRole('alert')).toHaveTextContent('This photo is HEIC. Convert it before upload.');
      expect(onReplace).not.toHaveBeenCalled();
    });

    it('a network failure shows a connection message, and the field remains pickable again', async () => {
      const { input } = renderImage();
      const file = jpegFile();
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].fail();

      expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
      expect(input()).not.toBeDisabled();
    });

    it('an oversized photo is refused before any network request', async () => {
      const { input, onReplace } = renderImage();
      const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(input(), 'files', { value: [oversized], configurable: true });
      fireEvent.change(input());

      expect(await screen.findByRole('alert')).toHaveTextContent('5.00MB');
      expect(FakeXHR.instances).toHaveLength(0);
      expect(onReplace).not.toHaveBeenCalled();
    });
  });

  describe('HEIC: the pipeline reused from PhotoField (Plan 5 Task 4, Step 1)', () => {
    it('converts a HEIC file before uploading it', async () => {
      const CONVERTED = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3]);
      heicToMock.mockResolvedValue(new Blob([CONVERTED], { type: 'image/jpeg' }));
      function isobmff(brand: string): Uint8Array {
        return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
      }
      const { input } = renderImage();
      const file = new File([isobmff('heic')], 'IMG_0001.HEIC', { type: 'image/heic' });
      Object.defineProperty(input(), 'files', { value: [file], configurable: true });
      fireEvent.change(input());

      await waitFor(() => expect(heicToMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      const uploaded = FakeXHR.instances[0].sentForm?.get('file') as File;
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(CONVERTED);
    });
  });
});
