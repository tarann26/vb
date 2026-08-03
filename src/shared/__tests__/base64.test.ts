import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../base64';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('bytesToBase64', () => {
  it('encodes empty input as an empty string', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('round-trips arbitrary bytes through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128]);
    const decoded = atob(bytesToBase64(bytes));
    const back = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });

  it('matches a known encoding for readable text', () => {
    expect(bytesToBase64(enc('hello world'))).toBe(btoa('hello world'));
  });

  // The chunking exists specifically so a large input never hits
  // `String.fromCharCode(...bytes)`'s call-stack-argument limit -- proven
  // here by encoding something well past the CHUNK boundary (0x8000) and
  // confirming the result still round-trips exactly, not just that it
  // returns without throwing.
  it('round-trips bytes spanning several chunk boundaries (2.5x CHUNK)', () => {
    const size = 0x8000 * 2 + 1234;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const decoded = atob(bytesToBase64(bytes));
    expect(decoded.length).toBe(size);
    const back = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });

  it('encodes a byte right at the chunk boundary correctly, not dropped or duplicated', () => {
    const size = 0x8000 + 1;
    const bytes = new Uint8Array(size).fill(7);
    bytes[0x8000 - 1] = 1;
    bytes[0x8000] = 2;
    const decoded = atob(bytesToBase64(bytes));
    const back = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});
