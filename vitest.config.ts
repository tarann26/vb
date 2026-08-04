import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deliberate decision (worker plan, Task 3 Step 6): a single jsdom project,
// not a workspace with a separate Node-environment project for `worker/`.
// There was no `include` here before this task, so `worker/__tests__/*.test.ts`
// (starting in Task 4) is picked up by Vitest's default glob and runs under
// this same jsdom environment as everything else in src/.
//
// Why jsdom rather than splitting worker/ into a `node` project: every later
// task in the worker plan that names a concrete environment gap already
// writes its tests and its comments assuming jsdom is what worker/ tests run
// under -- e.g. Task 4's auth tests avoid `crypto.subtle.timingSafeEqual`
// specifically because it is "undefined in this repo's jsdom test
// environment", and Task 9/10 name jsdom's missing `Blob.prototype
// .arrayBuffer/.text/.stream` and missing `navigator.sendBeacon` the same
// way. Splitting worker/ into a Node project now would falsify those
// premises for whoever implements those tasks next (Node's own WebCrypto
// `subtle` also has no `timingSafeEqual` -- it is a Cloudflare-only
// extension, present in neither environment -- but the DOM-shaped gaps
// above are jsdom-specific and would silently disappear under Node).
//
// What that means concretely for anything under worker/__tests__/, run in
// this same jsdom + Node (Vitest always runs on Node) process:
//   Present: fetch, Request, Response, Headers, URL, TextEncoder/Decoder,
//     btoa/atob, structuredClone, crypto.getRandomValues, and
//     crypto.subtle's standard methods (digest, importKey, deriveBits,
//     deriveKey, sign, verify) -- these come from Node itself, not jsdom,
//     so they are present regardless of the `environment` setting.
//   Present but workerd does NOT have them: window, document, navigator,
//     localStorage and the rest of jsdom's browser globals. Real Workers
//     code must not rely on these being present -- if a worker/ test passes
//     only because `window` exists, that is a false pass, not coverage.
//   Absent, needs a workaround: crypto.subtle.timingSafeEqual (Cloudflare-only;
//     Task 4 hand-rolls a timing-safe compare instead of using it),
//     Blob.prototype.arrayBuffer/.text/.stream (Task 9 polyfills these in
//     src/test/setup.ts), navigator.sendBeacon (Task 10 tests against an
//     explicitly-deleted global, since jsdom never defines it -- that is its
//     natural state, not a stub to add).
//   Not real at all, type-only: KVNamespace, ExecutionContext,
//     ScheduledController and the rest of @cloudflare/workers-types have no
//     runtime shape here -- worker tests build their own fake KV/env objects
//     rather than importing anything from workers-types at runtime.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // I-B: `e2e/**` (playwright.config.ts's own testDir) uses Playwright's
    // own `test`/`expect`, not Vitest's -- Vitest's default include glob
    // (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) is not scoped to src/, so it
    // picks up `e2e/collage-hit-test.spec.ts` too and fails hard trying to
    // run it under the wrong test runner ("Playwright Test did not expect
    // test.describe() to be called here"). Excluded here rather than
    // renamed off the `.spec.ts` pattern, so it keeps the name convention
    // Playwright itself documents.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
