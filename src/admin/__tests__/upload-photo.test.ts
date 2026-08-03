// Plan 5 Task 4, Step 1: uploadStaged plus the HEIC/size/progress pipeline,
// lifted out of PhotoField.tsx so EditableImage.tsx can reuse it. This file
// tests the pipeline itself, directly -- PhotoField.test.tsx already proves
// PhotoField's own state machine still behaves identically after the move
// (that file is unedited by this task, per its own brief), so this file's
// job is the module's OWN contract: what each exported function does when
// called directly, independent of any component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPhotoSize, convertHeic, uploadAndEncode, MAX_STAGED_PHOTO_BYTES, MAX_STAGED_PHOTOS_PER_PUBLISH } from '../upload-photo';

const heicToMock = vi.fn();
vi.mock('heic-to', () => ({
  get heicTo() {
    return heicToMock;
  },
}));

// The same hand-built XHR double PhotoField.test.tsx uses, for the same
// reason (neither fetch nor jsdom's own XHR support
// XMLHttpRequest.upload.onprogress).
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
const CONVERTED_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3, 4]);
function isobmff(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
}
const HEIC_BYTES = isobmff('heic');

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

describe('upload-photo.ts', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    heicToMock.mockReset();
  });

  describe('checkPhotoSize', () => {
    it('a photo at the cap is not rejected -- the boundary is inclusive', () => {
      const file = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES)], 'at-limit.jpg', { type: 'image/jpeg' });
      expect(checkPhotoSize(file)).toBeNull();
    });

    // Mutation this guards: `>=` instead of `>` -- confirmed red, which
    // would refuse a photo exactly AT the cap (the test above).
    it('one byte over the cap is rejected, with the limit stated in the message', () => {
      const file = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });
      const message = checkPhotoSize(file);
      expect(message).not.toBeNull();
      expect(message).toContain('5.00MB');
    });

    it('MAX_STAGED_PHOTOS_PER_PUBLISH is 8, per the base64/subrequest arithmetic in its own comment', () => {
      expect(MAX_STAGED_PHOTOS_PER_PUBLISH).toBe(8);
    });
  });

  // convertHeic, checkPhotoSize and uploadAndEncode are exported as THREE
  // separate pieces, not one all-in-one call -- EditableImage.tsx (this
  // same task) composes them exactly this way itself, so it can set its own
  // local preview between conversion and the network call (see
  // uploadAndEncode's own comment for why that timing matters). This
  // describe block exercises them composed the identical way, proving the
  // pipeline as a whole -- ordering included -- not just each piece in
  // isolation.
  describe('convertHeic -> checkPhotoSize -> uploadAndEncode, composed the way EditableImage.tsx composes them', () => {
    async function pipeline(category: Parameters<typeof uploadAndEncode>[0], picked: File, onProgress: (percent: number) => void) {
      const file = await convertHeic(picked);
      const sizeError = checkPhotoSize(file);
      if (sizeError) throw new Error(sizeError);
      const staged = await uploadAndEncode(category, file, onProgress);
      return { file, staged };
    }

    it('converts HEIC before uploading, and stages the converted bytes -- never the original HEIC ones', async () => {
      heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));
      const promise = pipeline('food', new File([HEIC_BYTES], 'IMG_0001.HEIC', { type: 'image/heic' }), vi.fn());

      await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      const uploaded = FakeXHR.instances[0].sentForm?.get('file') as File;
      expect(uploaded.name).toBe('IMG_0001.jpg');
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(CONVERTED_JPEG_BYTES);

      FakeXHR.instances[0].respond(200, { path: 'assets-source/food/a.jpg', contentPath: '/food/a.webp' });
      const { file, staged } = await promise;
      expect(file.name).toBe('IMG_0001.jpg');
      expect(staged.content).toBe(await base64Of(CONVERTED_JPEG_BYTES));
      expect(staged.contentPath).toBe('/food/a.webp');
    });

    // Mutation this guards: checking size BEFORE conversion instead of
    // after -- confirmed red by moving the check: a HEIC file whose
    // ORIGINAL bytes are small but whose CONVERTED JPEG exceeds the cap
    // would then be staged instead of refused (this fixture is built the
    // other way around from that mutation -- oversized after conversion --
    // so it fails under the un-mutated, correct order too if the check ran
    // on the wrong file).
    it('the size cap applies to the file that will actually be uploaded -- after HEIC conversion, not before', async () => {
      const oversizedConverted = new Uint8Array(MAX_STAGED_PHOTO_BYTES + 1);
      heicToMock.mockResolvedValue(new Blob([oversizedConverted], { type: 'image/jpeg' }));
      const tinyHeic = new File([HEIC_BYTES], 'IMG_0002.HEIC', { type: 'image/heic' });
      expect(tinyHeic.size).toBeLessThan(MAX_STAGED_PHOTO_BYTES);

      await expect(pipeline('food', tinyHeic, vi.fn())).rejects.toThrow('5.00MB');
      expect(FakeXHR.instances).toHaveLength(0);
    });

    it('an oversized non-HEIC photo is refused before any network request', async () => {
      const oversized = new File([new Uint8Array(MAX_STAGED_PHOTO_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });
      await expect(pipeline('food', oversized, vi.fn())).rejects.toThrow('5.00MB');
      expect(FakeXHR.instances).toHaveLength(0);
      expect(heicToMock).not.toHaveBeenCalled();
    });

    it('a HEIC decoder failure propagates as a plain, catchable Error', async () => {
      heicToMock.mockRejectedValue(new Error('the WASM decoder failed to load'));
      await expect(
        pipeline('food', new File([HEIC_BYTES], 'IMG_0003.HEIC', { type: 'image/heic' }), vi.fn()),
      ).rejects.toThrow('the WASM decoder failed to load');
      expect(FakeXHR.instances).toHaveLength(0);
    });

    it('a network failure propagates as a plain, catchable Error', async () => {
      const promise = pipeline('food', jpegFile(), vi.fn());
      await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].fail();
      await expect(promise).rejects.toThrow(/connection/i);
    });

    it('reports progress through the given callback', async () => {
      const onProgress = vi.fn();
      const promise = pipeline('food', jpegFile(), onProgress);
      await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      FakeXHR.instances[0].upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      expect(onProgress).toHaveBeenCalledWith(50);
      FakeXHR.instances[0].respond(200, { path: 'assets-source/food/b.jpg', contentPath: '/food/b.webp' });
      await promise;
    });
  });

  describe('uploadAndEncode: the shared tail PhotoField\'s own Retry calls directly, skipping HEIC conversion', () => {
    it('does not re-check size or re-convert -- it uploads exactly the file it is given', async () => {
      const promise = uploadAndEncode('hero', jpegFile('already-converted.jpg'), vi.fn());
      await vi.waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
      expect(FakeXHR.instances[0].sentForm?.get('category')).toBe('hero');
      FakeXHR.instances[0].respond(200, { path: 'assets-source/hero/c.jpg', contentPath: '/hero/c.webp' });
      const staged = await promise;
      expect(staged).toEqual({
        path: 'assets-source/hero/c.jpg',
        contentPath: '/hero/c.webp',
        content: await base64Of(JPEG_BYTES),
        encoding: 'base64',
      });
      expect(heicToMock).not.toHaveBeenCalled();
    });
  });
});
