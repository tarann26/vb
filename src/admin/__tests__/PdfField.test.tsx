import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PdfField, { type StagedMenuPdf } from '../PdfField';
import type { ValidationProblem } from '../../content/validate';

// A hand-built double for XMLHttpRequest.upload.onprogress -- neither fetch
// nor jsdom's XHR support it. Identical shape to PhotoField.test.tsx's own
// FakeXHR (worker/__tests__/githubStub.ts's `fetch` stub, applied to XHR
// instead): a fake with enough surface for the code under test, plus
// test-only helper methods to drive it from outside.
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

// A real, complete PDF's own shape -- header at byte 0, `%%EOF` trailer at
// the end -- matching worker/__tests__/upload.test.ts's own PDF_BYTES
// fixture. This component never inspects the bytes itself (the Worker is
// the one authority on what a valid PDF looks like -- see this component's
// own comment on why `name` isn't re-validated client-side either), so the
// exact content only matters for the base64 round-trip assertions below.
const PDF_BYTES = new Uint8Array([...enc('%PDF-1.4\n'), ...enc('1 0 obj\n<< >>\nendobj\n'), ...enc('%%EOF')]);

// Built with `type: 'application/pdf'` explicitly -- not cosmetic.
// @testing-library/user-event's `upload` filters a dropped file against the
// input's own `accept="application/pdf"` before it ever reaches this
// component's onChange handler, and a File built with no `type` at all
// fails that filter silently: `input.files` ends up empty and no upload is
// ever attempted, which looks like a broken component for a completely
// different reason.
function pdfFile(name = 'menu.pdf'): File {
  return new File([PDF_BYTES], name, { type: 'application/pdf' });
}

async function base64Of(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes]);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function renderField(overrides: Partial<Parameters<typeof PdfField>[0]> = {}) {
  const onChange = vi.fn();
  const onStaged = vi.fn();
  render(
    <PdfField
      id="menu-food-file"
      label="Food menu PDF"
      name="food-menu"
      value={null}
      onChange={onChange}
      onStaged={onStaged}
      problems={[]}
      {...overrides}
    />,
  );
  return { onChange, onStaged };
}

describe('PdfField', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a labelled file input, with help text as its accessible description', () => {
    renderField({ help: 'The downloadable food menu.' });
    expect(screen.getByLabelText('Food menu PDF')).toHaveAccessibleDescription('The downloadable food menu.');
  });

  it('shows the existing value as text before anything is picked', () => {
    renderField({ value: '/menus/food-menu.pdf' });
    expect(screen.getByText(/Current file/)).toHaveTextContent('/menus/food-menu.pdf');
  });

  it('shows nothing about a current file when there is none yet', () => {
    renderField({ value: null });
    expect(screen.queryByText(/Current file/)).not.toBeInTheDocument();
  });

  describe('a successful upload', () => {
    it('POSTs to /api/upload?stage=1 with category=menu, the name prop, and the picked file', async () => {
      const user = userEvent.setup();
      renderField({ name: 'drinks-menu' });
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      const xhr = FakeXHR.instances[0];
      expect(xhr.method).toBe('POST');
      expect(xhr.url).toBe('/api/upload?stage=1');
      expect(xhr.sentForm?.get('category')).toBe('menu');
      expect(xhr.sentForm?.get('name')).toBe('drinks-menu');
      expect((xhr.sentForm?.get('file') as File).name).toBe('menu.pdf');
    });

    it('reports upload progress through an aria-live status region', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      // FakeXHR's progress() is a direct function call, not a real DOM
      // event -- React never sees it as "user-driven", so the resulting
      // setState needs an explicit act() the way userEvent's own helpers
      // already provide for a real event.
      act(() => FakeXHR.instances[0].progress(50, 100));
      expect(await screen.findByRole('status')).toHaveTextContent('50%');
    });

    it('disables the input while uploading, and re-enables it once staged', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(screen.getByLabelText('Food menu PDF')).toBeDisabled();

      FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });
      await waitFor(() => expect(screen.getByLabelText('Food menu PDF')).not.toBeDisabled());
    });

    it('calls onChange with the /menus/<name>.pdf value (never the repository path) once staging succeeds', async () => {
      const user = userEvent.setup();
      const { onChange } = renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith('/menus/food-menu.pdf'));
    });

    it('calls onStaged with the base64 bytes of the exact file it uploaded, ready for a later publish', async () => {
      const user = userEvent.setup();
      const { onStaged } = renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });

      const expectedContent = await base64Of(PDF_BYTES);
      await waitFor(() =>
        expect(onStaged).toHaveBeenCalledWith({
          path: 'public/menus/food-menu.pdf',
          file: '/menus/food-menu.pdf',
          content: expectedContent,
          encoding: 'base64',
        } satisfies StagedMenuPdf),
      );
    });

    it('shows a staged confirmation once the upload succeeds', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });
      expect(await screen.findByText(/Uploaded/)).toBeInTheDocument();
    });
  });

  describe('failure and retry', () => {
    it('shows the server-provided message on a non-2xx response, as an alert, and does not call onChange/onStaged', async () => {
      const user = userEvent.setup();
      const { onChange, onStaged } = renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].respond(400, { message: 'This PDF looks incomplete or corrupted. Try uploading it again.' });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This PDF looks incomplete or corrupted. Try uploading it again.',
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(onStaged).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.any(String) }));
    });

    it('shows a connection message on a network error (xhr.onerror)', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));

      FakeXHR.instances[0].fail();

      expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    });

    it('shows a timeout message on xhr.ontimeout, and sets a 120-second timeout on the request', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(FakeXHR.instances[0].timeout).toBe(120_000);

      FakeXHR.instances[0].timeoutOut();

      expect(await screen.findByRole('alert')).toHaveTextContent(/taking too long/i);
    });

    it('offers a Retry button only after a failure, not during a normal upload', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

      FakeXHR.instances[0].fail();
      expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    // The path is a stable, chosen name (menuAssetPath, worker/upload.ts),
    // not content-addressed -- unlike PhotoField's own Retry comment, that
    // is not why resubmitting is safe here. It's safe because Retry sends
    // the identical File it already held, so a dropped connection can be
    // retried without asking her to re-pick the PDF.
    it('Retry resubmits the exact same file, without asking her to re-pick', async () => {
      const user = userEvent.setup();
      renderField();
      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile());
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].fail();

      const retryButton = await screen.findByRole('button', { name: 'Retry' });
      await user.click(retryButton);

      await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
      expect(FakeXHR.instances[1].sentForm?.get('file')).toBe(FakeXHR.instances[0].sentForm?.get('file'));

      FakeXHR.instances[1].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });
      expect(await screen.findByText(/Uploaded/)).toBeInTheDocument();
    });
  });

  describe('a new pick invalidates whatever was previously staged for this field', () => {
    it('calls onStaged(null) as soon as a second pick starts, before its own upload resolves', async () => {
      const user = userEvent.setup();
      const { onStaged } = renderField();

      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile('first.pdf'));
      await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].respond(200, { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf' });
      await waitFor(() =>
        expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ path: 'public/menus/food-menu.pdf' })),
      );

      await user.upload(screen.getByLabelText('Food menu PDF'), pdfFile('second.pdf'));
      // Told the moment the second pick starts, regardless of whether ITS
      // OWN upload has resolved yet -- a caller collecting staged uploads
      // must drop the first one as soon as it is superseded, not only once
      // a replacement is ready.
      await waitFor(() => expect(onStaged).toHaveBeenLastCalledWith(null));
    });
  });

  it('renders every problem message, associated with the field', () => {
    const problems: ValidationProblem[] = [{ field: 'file', message: 'a menu PDF is required' }];
    renderField({ problems });
    expect(screen.getByLabelText('Food menu PDF')).toHaveAccessibleDescription('a menu PDF is required');
  });
});
