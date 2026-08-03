import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia. Components that read motion/contrast
// preferences (e.g. usePrefersReducedMotion) need a default so tests that
// don't care about the preference can render without stubbing it themselves.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom (25.0.1) implements its own Blob/File classes -- distinct from
// Node's global Blob that fetch/Request/Response use (see vitest.config.ts
// on why those come from Node, not jsdom) -- and jsdom's Blob has no
// .arrayBuffer(), .text() or .stream() at all: `typeof
// Blob.prototype.arrayBuffer` reads "undefined" under this exact jsdom
// version, confirmed directly rather than assumed. Task 9's
// src/admin/heic.ts reads a picked File's bytes to detect its real format
// before deciding whether to convert it, so its tests need these to work.
//
// The tempting shortcut -- `new Response(blob).arrayBuffer()`, since
// Response *is* real here -- looks like it works (it resolves, doesn't
// throw) but is silently wrong: Node's Response constructor brand-checks
// its body against Node's *own* Blob class, jsdom's Blob fails that check,
// and Response falls back to stringifying the body with `String(blob)` --
// producing the 13-character string "[object File]" as the "bytes"
// instead of the file's actual content, for every input, every time. A
// test written against that shortcut would never catch it: `.arrayBuffer()`
// never rejects, it just lies. Found by direct measurement (logging the
// resulting byteLength and content), not inferred.
//
// jsdom's own FileReader, unlike its Blob, *is* fully implemented and reads
// the same internal byte buffer a real browser's would -- so these three
// delegate to it instead. Slower than a native implementation; irrelevant
// for tests that never touch a file large enough to notice.
function readBlobAs<T>(blob: Blob, read: (reader: FileReader, blob: Blob) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader, blob);
  });
}

if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return readBlobAs<ArrayBuffer>(this, (reader, blob) => reader.readAsArrayBuffer(blob));
  };
}

if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return readBlobAs<string>(this, (reader, blob) => reader.readAsText(blob));
  };
}

// jsdom does not implement URL.createObjectURL/revokeObjectURL at all --
// `typeof URL.createObjectURL` reads "undefined" under this exact jsdom
// version, confirmed directly the same way as the Blob gaps above.
// src/admin/PhotoField.tsx (Task 5) is the first real caller: it previews a
// picked photo locally, before the upload it started even resolves, via an
// object URL. A fake-but-internally-consistent stand-in (each call returns
// a distinct `blob:` string; revoking is a no-op) is enough for a test to
// assert an <img src> actually got wired up to something derived from the
// picked file, without this repo needing a real blob store behind it.
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  let objectUrlCounter = 0;
  URL.createObjectURL = () => `blob:mock-${++objectUrlCounter}`;
  URL.revokeObjectURL = () => {};
}

if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
  // No FileReader.readAsStream equivalent to delegate to -- built from the
  // .arrayBuffer() polyfill above instead, which is defined by the time
  // this ever runs (assignment order, both in this same block).
  Blob.prototype.stream = function stream(this: Blob): ReadableStream<Uint8Array> {
    // Read via `this` out here, in a real function where `this` is valid,
    // and hand the resulting promise (not `this` itself) into the nested
    // arrow function below -- avoids aliasing `this` to a local variable,
    // which @typescript-eslint/no-this-alias (rightly) flags.
    const bytes = this.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(await bytes);
        controller.close();
      },
    });
  };
}
