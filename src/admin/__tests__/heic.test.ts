import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectFormat } from '../../shared/image-format';
import { convertHeic } from '../heic';

// heic-to's real export is a several-hundred-KB WASM decoder that requires
// a browser Worker and a Canvas 2D context -- neither of which jsdom
// implements (confirmed directly: `new Worker(...)` throws
// "Worker is not defined" here, and jsdom's own `document.createElement
// ('canvas').getContext('2d')` returns null without the native `canvas`
// package, which this repo does not install). Mocked here so these tests
// exercise convertHeic's own logic -- does it detect by content, does it
// call heicTo with the right arguments, does it wrap and rename the
// result -- independent of whether a WASM decoder can run in this test
// environment at all. That the decoder genuinely converts real HEIC bytes
// to a real JPEG was verified separately, in an actual browser, against a
// real HEIC file (see this task's report); it is not and cannot be
// asserted by anything in this file.
const heicToMock = vi.fn();
vi.mock('heic-to', () => ({
  get heicTo() {
    return heicToMock;
  },
}));

afterEach(() => {
  heicToMock.mockReset();
});

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// The same minimal, real ISO-BMFF `ftyp` box fixture pattern used in
// worker/__tests__/upload.test.ts and
// src/shared/__tests__/image-format.test.ts -- duplicated here rather than
// imported, since it is a private fixture for this file's own File
// objects, not shared logic (see upload.test.ts's own comment on the same
// choice).
function isobmff(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
}

const HEIC_BYTES = isobmff('heic');
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...enc('JFIF')]);

// What heicToMock stands in for: some real, different-length JPEG bytes,
// so a test asserting the output actually came from the mock (not a
// pass-through of the original HEIC bytes under a new name) has something
// distinguishing to check.
const CONVERTED_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3, 4, 5, 6]);

describe('convertHeic', () => {
  it('passes a jpeg through untouched', async () => {
    const file = new File([JPEG_BYTES], 'a.jpg', { type: 'image/jpeg' });
    expect(await convertHeic(file)).toBe(file); // same object, no work done
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it('converts a heic file to jpeg and renames it', async () => {
    heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));

    const out = await convertHeic(new File([HEIC_BYTES], 'IMG_1234.HEIC'));

    expect(out.name).toBe('IMG_1234.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(detectFormat(new Uint8Array(await out.arrayBuffer()))).toBe('jpeg');
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(CONVERTED_JPEG_BYTES);
  });

  it('calls heicTo with the original file as the blob, targeting jpeg', async () => {
    heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));
    const file = new File([HEIC_BYTES], 'a.heic');

    await convertHeic(file);

    expect(heicToMock).toHaveBeenCalledTimes(1);
    const call = heicToMock.mock.calls[0][0];
    expect(call.blob).toBe(file);
    expect(call.type).toBe('image/jpeg');
  });

  it('detects by content, so a renamed heic is still converted', async () => {
    heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));

    const out = await convertHeic(new File([HEIC_BYTES], 'holiday.jpg'));

    expect(heicToMock).toHaveBeenCalledTimes(1);
    expect(out.name).toBe('holiday.jpg'); // already had a .jpg name
    expect(detectFormat(new Uint8Array(await out.arrayBuffer()))).toBe('jpeg');
  });

  // The other direction of the same rule: a .heic extension on bytes that
  // are not actually HEIC must not trigger a conversion. Broken on
  // purpose while writing this test (swapping detectFormat for a
  // `file.name.endsWith('.heic')` check) to confirm it goes red -- it did,
  // calling heicToMock once instead of zero times.
  it('does not convert a jpeg wearing a .heic extension', async () => {
    const file = new File([JPEG_BYTES], 'holiday.heic');

    const out = await convertHeic(file);

    expect(out).toBe(file);
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it('recognises the mif1 HEIF brand, not only heic', async () => {
    heicToMock.mockResolvedValue(new Blob([CONVERTED_JPEG_BYTES], { type: 'image/jpeg' }));

    await convertHeic(new File([isobmff('mif1')], 'IMG_0001.HEIC'));

    expect(heicToMock).toHaveBeenCalledTimes(1);
  });
});
