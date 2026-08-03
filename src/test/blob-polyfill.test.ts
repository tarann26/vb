import { describe, expect, it } from 'vitest';

// jsdom's Blob has no .arrayBuffer(), .text() or .stream() at all -- see
// this file's setup.ts for why all three are polyfilled there (a
// FileReader-backed implementation, after a Response-based shortcut
// turned out to silently return the wrong bytes rather than throw).
//
// src/admin/__tests__/heic.test.ts exercises .arrayBuffer() thoroughly
// (convertHeic's own detection logic depends on it), but nothing else in
// this suite calls .text() or .stream() -- so, on its own, that coverage
// says nothing about whether those two members of the same polyfill
// actually work. This file closes that gap directly, against the
// polyfill's own contract, independent of any particular caller.
describe('Blob/File polyfills (src/test/setup.ts)', () => {
  it('text() returns the real decoded content, not a placeholder', async () => {
    const blob = new Blob(['hola, mondo -- éàü'], { type: 'text/plain' });
    expect(await blob.text()).toBe('hola, mondo -- éàü');
  });

  it('stream() yields the real bytes through a standard reader', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const file = new File([bytes], 'a.bin');

    const reader = file.stream().getReader();
    const { value, done } = await reader.read();

    expect(done).toBe(false);
    expect(value).toBeInstanceOf(Uint8Array);
    expect(Array.from(value as Uint8Array)).toEqual(Array.from(bytes));
  });
});
