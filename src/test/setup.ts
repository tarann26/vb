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

// Node 22+ ships its own native, unflagged `localStorage` global backed by a
// file `--localstorage-file` selects -- with no valid file configured (the
// default for a plain `vitest run`), every method on it is `undefined`
// rather than a working Storage. Confirmed directly under this exact
// toolchain (Vitest 2.1.9, jsdom 25.0.1, Node 25): `typeof window
// .localStorage.setItem` reads "undefined", with a "`--localstorage-file`
// was provided without a valid path" warning printed the moment anything
// touches it -- Node's own global is shadowing jsdom's real implementation
// here, not jsdom lacking one (jsdom itself implements localStorage fully).
// src/admin/drafts.ts (Task 10) is the first real caller of localStorage in
// this codebase; a plain in-memory Storage stand-in is enough for its tests
// -- persistence across an actual page load is exactly what a unit test
// can't exercise regardless of which implementation backs it -- the same
// "fake but internally consistent" posture as this file's own
// URL.createObjectURL stand-in above.
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
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
