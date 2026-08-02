import { describe, it, expect } from 'vitest';
import { detectFormat } from '../image-format';

// enc/pad/riff/isobmff are fixture builders, not the thing under test --
// each mirrors a real container's byte layout closely enough that a bug in
// detectFormat's offsets would show up here the same way it would against a
// real file.

// Returns a Uint8Array directly (not a plain array) so it can be passed
// straight to detectFormat, and is still spreadable with `...enc(...)` for
// building a magic-bytes array by hand.
function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Pads a magic-bytes array out to at least `length` bytes with trailing
// zeroes. Proves detectFormat matches on a *prefix*, not an exact-length
// buffer -- a real file is never exactly as long as its magic bytes.
function pad(bytes: number[], length = 16): Uint8Array {
  const out = new Uint8Array(Math.max(length, bytes.length));
  out.set(bytes);
  return out;
}

// A RIFF container: 'RIFF' + 4 bytes of chunk size (unused by detectFormat,
// left as zero) + a 4-byte form type at offset 8 ('WEBP' or, for the
// negative case, 'WAVE').
function riff(formType: string): Uint8Array {
  return new Uint8Array([...enc('RIFF'), 0, 0, 0, 0, ...enc(formType)]);
}

// An ISO-BMFF `ftyp` box: 4 bytes of box size (unused, left as a plausible
// value) + 'ftyp' at offset 4 + a 4-byte major brand at offset 8 + 4 bytes
// of minor version (unused, zero). Real HEIC/AVIF files carry more after
// this (a list of compatible brands), which detectFormat never reads.
function isobmff(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand), 0, 0, 0, 0]);
}

describe('detectFormat', () => {
  it.each([
    ['jpeg', [0xff, 0xd8, 0xff]],
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['gif', [...enc('GIF89a')]],
    ['gif', [...enc('GIF87a')]],
    ['tiff', [0x49, 0x49, 0x2a, 0x00]],
    ['tiff', [0x4d, 0x4d, 0x00, 0x2a]],
  ] as const)('detects %s', (expected, magic) => {
    expect(detectFormat(pad([...magic]))).toBe(expected);
  });

  it('detects webp from RIFF at 0 and WEBP at 8', () => {
    expect(detectFormat(riff('WEBP'))).toBe('webp');
  });

  it('does not call a wav file webp', () => {
    expect(detectFormat(riff('WAVE'))).toBeNull();
  });

  // HEIC and AVIF share an ISO-BMFF container and differ only by brand at
  // bytes 8-11 -- see image-format.ts's own comment on why getting this
  // wrong in either direction is the most consequential bug this file can
  // contain. This is the single thing the entire iPhone upload story rests
  // on: Task 6's route rejects HEIC by name, and Task 9's browser-side
  // conversion branches on it.
  it('distinguishes heic from avif by brand, not by container', () => {
    expect(detectFormat(isobmff('heic'))).toBe('heic');
    expect(detectFormat(isobmff('mif1'))).toBe('heic'); // iPhone also emits this
    expect(detectFormat(isobmff('avif'))).toBe('avif');
  });

  // A brand this function has never heard of, in an otherwise well-formed
  // ISO-BMFF ftyp box -- proves the brand check is a positive allowlist
  // (heic/mif1/avif only), not "any ftyp box that isn't obviously wrong".
  it('does not guess a format for an unrecognized ISO-BMFF brand', () => {
    expect(detectFormat(isobmff('mp41'))).toBeNull();
  });

  it('returns null for a PDF rather than guessing', () => {
    expect(detectFormat(enc('%PDF-1.7'))).toBeNull();
  });

  it('returns null for an empty file', () => {
    expect(detectFormat(new Uint8Array(0))).toBeNull();
  });

  it('returns null for a truncated header', () => {
    expect(detectFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  // Deliberately NOT tested here: "ignores a lying filename". detectFormat
  // takes only `bytes` -- there is no filename parameter to lie in the
  // first place, so a test claiming this property would just be a
  // duplicate of the plain-bytes cases above, asserting nothing new. An
  // earlier draft of this plan shipped exactly that dead test; the real
  // property (a multipart upload's declared filename is never trusted)
  // belongs, and is tested, at the route level -- see
  // worker/__tests__/upload.test.ts.
});
