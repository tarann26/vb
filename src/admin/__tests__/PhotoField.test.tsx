import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoField, { MAX_STAGED_PHOTOS_PER_PUBLISH, MAX_STAGED_PHOTO_BYTES, type StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

// Mocked for the identical reason src/admin/__tests__/heic.test.ts mocks it:
// heic-to's real export is a several-hundred-KB WASM decoder that needs a
// browser Worker and a Canvas 2D context, neither of which jsdom
// implements. This is what proves PhotoField is the "first real caller" of
// convertHeic the task's brief describes -- if this mock is never invoked,
// PhotoField never actually called convertHeic at all.
const heicToMock = vi.fn();
vi.mock('heic-to', () => ({
  get heicTo() {
    return heicToMock;
  },
}));

// A hand-built double for the one browser API this component needs that
// neither fetch nor jsdom's own (nonexistent, in this jsdom version) XHR
// support: XMLHttpRequest.upload.onprogress. Mirrors the shape
// worker/__tests__/githubStub.ts takes for `fetch` -- a fake with enough
// surface for the code under test, plus test-only helper methods
// (`respond`/`progress`/`fail`/`timeoutOut`) to drive it from outside.
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
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  fail() {
    this.onerror?.();
  }
  timeoutOut() {
    this.ontimeout?.();
  }
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...enc('JFIF')]);
const CONVERTED_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3, 4, 5, 6]);

function isobmff(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
}
const HEIC_BYTES = isobmff('heic');

// Every HEIC fixture File below is built with `type: 'image/heic'`
// explicitly -- not cosmetic. `userEvent.upload` filters a dropped file
// against the input's own `accept="image/*"` BEFORE it ever reaches this
// component's onChange handler (@testing-library/user-event's own
// `isAcceptableFile`), and a File built with no `type` at all (the
// default) fails that filter silently: `input.files` ends up empty, no
// conversion is ever attempted, and `heicToMock` is never called -- which
// looks exactly like convertHeic not being wired up, for a completely
// different reason. A real HEIC picked from an iPhone's photo library
// reports this MIME type anyway, so this is also just realistic.

function jpegFile(name = 'photo.jpg'): File {
  return new File([JPEG_BYTES], name, { type: 'image/jpeg' });
}

async function base64Of(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes]);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function renderField(overrides: Partial<Parameters<typeof PhotoField>[0]> = {}) {
  const onChange = vi.fn();
  const onStaged = vi.fn();
  const { container } = render(
    <PhotoField
      id="dish-image"
      label="Photo"
      category="food"
      value={null}
      onChange={onChange}
      onStaged={onStaged}
      problems={[]}
      {...overrides}
    />,
  );
  // Not `screen.getByRole('img')`: an <img alt=""> (this component's
  // preview, deliberately decorative) resolves to role "presentation", not
  // "img" -- a plain DOM query is what actually finds it.
  const preview = () => container.querySelector('img');
  return { onChange, onStaged, preview };
}

describe('PhotoField', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    heicToMock.mockReset();
  });

  it('renders a labelled file input, with help text as its accessible description', () => {
    renderField({ help: 'A photo of the dish.' });
    expect(screen.getByLabelText('Photo')).toHaveAccessibleDescription('A photo of the dish.');
  });

  it('shows the existing value as a preview image before anything is picked', () => {
    const { preview } = renderField({ value: '/food/existing.webp' });
    expect(preview()).toHaveAttribute('src', '/food/existing.webp');
  });

  describe('a successful upload', () => {
    it('POSTs to /api/upload?stage=1 with the category and the picked file', async () => {
      const user = userEvent.setup();
      renderField({ category: 'hero' });
      await user.upload(screen.getByLabelText('Photo'), jpegFile());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      const xhr = FakeXHR.instances[0];
      expect(xhr.method).toBe('POST');
      expect(xhr.url).toBe('/api/upload?stage=1');
      expect(xhr.sentForm?.get('category')).toBe('hero');
      expect((xhr.sentForm?.get('file') as File).name).toBe('photo.jpg');
    });

    it('reports upload progress through an aria-live status region', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      // FakeXHR's own progress() call is a direct function call, not a real
      // DOM event -- React never sees it as "user-driven", so the resulting
      // setState needs an explicit act() the way userEvent's own helpers
      // already provide for a real event.
      act(() => FakeXHR.instances[0].progress(50, 100));
      expect(await screen.findByRole('status')).toHaveTextContent('50%');
    });

    it('disables the input while converting/uploading, and re-enables it once staged', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(screen.getByLabelText('Photo')).toBeDisabled();

      FakeXHR.instances[0].respond(200, { path: 'assets-source/food/abc123abc123.jpg', contentPath: '/food/abc123abc123.webp' });
      await waitFor(() => expect(screen.getByLabelText('Photo')).not.toBeDisabled());
    });

    it('calls onChange with contentPath (never the raw assets-source path) once staging succeeds', async () => {
      const user = userEvent.setup();
      const { onChange } = renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(200, {
        path: 'assets-source/food/abc123abc123.jpg',
        contentPath: '/food/abc123abc123.webp',
      });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith('/food/abc123abc123.webp'));
    });

    it('calls onStaged with the base64 bytes of the exact file it uploaded, ready for a later publish', async () => {
      const user = userEvent.setup();
      const { onStaged } = renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(200, {
        path: 'assets-source/food/abc123abc123.jpg',
        contentPath: '/food/abc123abc123.webp',
      });

      const expectedContent = await base64Of(JPEG_BYTES);
      await waitFor(() =>
        expect(onStaged).toHaveBeenCalledWith({
          path: 'assets-source/food/abc123abc123.jpg',
          contentPath: '/food/abc123abc123.webp',
          content: expectedContent,
          encoding: 'base64',
        } satisfies StagedPhoto),
      );
    });

    it('shows a staged confirmation and previews the picked photo locally, not the eventual (not-yet-live) contentPath', async () => {
      const user = userEvent.setup();
      const { preview } = renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      // The preview is wired up as soon as the file is ready to upload,
      // before the server has answered at all.
      expect(preview()).toHaveAttribute('src', expect.stringMatching(/^blob:/));

      FakeXHR.instances[0].respond(200, { path: 'assets-source/food/x.jpg', contentPath: '/food/x.webp' });
      expect(await screen.findByText(/Uploaded/)).toBeInTheDocument();
      // Still the local preview, never the freshly-returned contentPath --
      // nothing is live at that path until a publish and a rebuild happen.
      expect(preview()).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    });
  });

  describe('HEIC: the first real caller of convertHeic', () => {
    it('converts a HEIC file before uploading it, and sends the converted JPEG bytes, not the original HEIC ones', async () => {
      heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));
      const user = userEvent.setup();
      renderField();

      await user.upload(screen.getByLabelText('Photo'), new File([HEIC_BYTES], 'IMG_0001.HEIC', { type: 'image/heic' }));

      // convertHeic's own dynamic `import('heic-to')` (see heic.ts) crosses
      // a real module-resolution boundary, not just a microtask -- waitFor
      // rather than asserting immediately after `user.upload` resolves.
      await waitFor(() => expect(heicToMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      const uploaded = FakeXHR.instances[0].sentForm?.get('file') as File;
      expect(uploaded.name).toBe('IMG_0001.jpg');
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(CONVERTED_JPEG_BYTES);
    });

    // A HEIC conversion failure (a dropped WASM fetch, an undecodable file)
    // must not leave the field stuck on "Converting photo..." with an
    // unhandled promise rejection nobody awaits -- it needs to become the
    // same visible, recoverable error state a failed upload does.
    it('surfaces a convertHeic failure as a retryable error, instead of hanging', async () => {
      heicToMock.mockRejectedValue(new Error('the WASM decoder failed to load'));
      const user = userEvent.setup();
      renderField();

      await user.upload(screen.getByLabelText('Photo'), new File([HEIC_BYTES], 'IMG_0001.HEIC', { type: 'image/heic' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('the WASM decoder failed to load');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(FakeXHR.instances).toHaveLength(0); // never even reached the upload step
    });

    it('does not call convertHeic a second time for an ordinary JPEG', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(heicToMock).not.toHaveBeenCalled();
    });
  });

  describe('failure and retry', () => {
    it('shows the server-provided message on a non-2xx response, as an alert, and does not call onChange/onStaged', async () => {
      const user = userEvent.setup();
      const { onChange, onStaged } = renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(400, { message: 'This photo is HEIC. Convert it before upload.' });

      expect(await screen.findByRole('alert')).toHaveTextContent('This photo is HEIC. Convert it before upload.');
      expect(onChange).not.toHaveBeenCalled();
      expect(onStaged).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.any(String) }));
    });

    it('shows a connection message on a network error (xhr.onerror)', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].fail();

      expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    });

    it('shows a timeout message on xhr.ontimeout, and sets a 120-second timeout on the request', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(FakeXHR.instances[0].timeout).toBe(120_000);

      FakeXHR.instances[0].timeoutOut();

      expect(await screen.findByRole('alert')).toHaveTextContent(/taking too long/i);
    });

    it('offers a Retry button only after a failure, not during a normal upload', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), jpegFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

      FakeXHR.instances[0].fail();
      expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    // The path is content-addressed (uploadPath, worker/upload.ts), so
    // resubmitting the identical bytes after a dropped connection is a
    // genuine no-op on the eventual publish, not a second photo. Proven
    // here by resubmitting the SAME File object, not merely one with equal
    // bytes -- Retry must not ask her to re-pick or re-convert.
    it('Retry resubmits the exact same (already-converted) file, without asking her to re-pick', async () => {
      heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Photo'), new File([HEIC_BYTES], 'IMG_0001.HEIC', { type: 'image/heic' }));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].fail();

      const retryButton = await screen.findByRole('button', { name: 'Retry' });
      await user.click(retryButton);

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
      expect(heicToMock).toHaveBeenCalledTimes(1); // not converted again
      expect(FakeXHR.instances[1].sentForm?.get('file')).toBe(FakeXHR.instances[0].sentForm?.get('file'));

      FakeXHR.instances[1].respond(200, { path: 'assets-source/food/y.jpg', contentPath: '/food/y.webp' });
      expect(await screen.findByText(/Uploaded/)).toBeInTheDocument();
    });
  });

  describe('a new pick invalidates whatever was previously staged for this field', () => {
    it('calls onStaged(null) as soon as a second pick starts, before its own upload resolves', async () => {
      const user = userEvent.setup();
      const { onStaged } = renderField();

      await user.upload(screen.getByLabelText('Photo'), jpegFile('first.jpg'));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].respond(200, { path: 'assets-source/food/a.jpg', contentPath: '/food/a.webp' });
      await waitFor(() => expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ path: 'assets-source/food/a.jpg' })));

      await user.upload(screen.getByLabelText('Photo'), jpegFile('second.jpg'));
      // Told the moment the second pick starts, regardless of whether ITS
      // OWN upload has resolved yet -- a caller collecting staged photos
      // must drop the first one as soon as it is superseded, not only once
      // a replacement is ready.
      await waitFor(() => expect(onStaged).toHaveBeenLastCalledWith(null));
    });
  });

  // A weak-but-worthwhile pin: this number is policy (see the constant's
  // own comment for the arithmetic), not derived from anything a test could
  // recompute independently -- this just guards against it silently
  // changing.
  it('MAX_STAGED_PHOTOS_PER_PUBLISH is 8, per the base64/subrequest arithmetic in its own comment', () => {
    expect(MAX_STAGED_PHOTOS_PER_PUBLISH).toBe(8);
  });

  // Review finding: MAX_STAGED_PHOTOS_PER_PUBLISH's own "8 * 5MB" arithmetic
  // was aspirational until something actually enforced 5MB per photo --
  // worker/upload.ts's real ceiling is 25MB, so 8 legitimately-sized photos
  // could have been 8 * 25MB * 4/3 ~= 267MB, over Cloudflare's own
  // request-body limit. This describe block proves PhotoField itself is
  // that enforcement.
  describe('a per-photo size cap makes the 8-photo arithmetic real (review fix)', () => {
    it('pins the cap at 5MB', () => {
      expect(MAX_STAGED_PHOTO_BYTES).toBe(5 * 1024 * 1024);
    });

    it('rejects a photo over the cap before ever making a network request', async () => {
      const user = userEvent.setup();
      const { onChange, onStaged } = renderField();
      const oversized = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });

      await user.upload(screen.getByLabelText('Photo'), oversized);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('5.00MB'); // the limit, stated in the message
      expect(alert).toHaveTextContent(/too large|must be under|smaller/i);
      expect(FakeXHR.instances).toHaveLength(0);
      expect(onChange).not.toHaveBeenCalled();
      expect(onStaged).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.any(String) }));
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('a photo AT the cap is not rejected (the boundary is inclusive)', async () => {
      const user = userEvent.setup();
      renderField();
      const atLimit = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES)], 'at-limit.jpg', { type: 'image/jpeg' });

      await user.upload(screen.getByLabelText('Photo'), atLimit);

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // The check re-runs on Retry, not just on the initial pick -- a naive
    // implementation checked size only in handlePick and let Retry (which
    // calls `upload` directly with the already-held File) bypass it.
    it('Retry on an oversized photo reports the same rejection again, not a network attempt', async () => {
      const user = userEvent.setup();
      renderField();
      const oversized = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });
      await user.upload(screen.getByLabelText('Photo'), oversized);
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('5.00MB');
      expect(FakeXHR.instances).toHaveLength(0);
    });
  });

  it('renders every problem message, associated with the field', () => {
    const problems: ValidationProblem[] = [{ field: 'image', message: 'a photo is required' }];
    renderField({ problems });
    expect(screen.getByLabelText('Photo')).toHaveAccessibleDescription('a photo is required');
  });
});
