import type { Plugin } from 'vite';
import { isPublished } from '../src/content/publish';

// The three content files that carry a `publishAt` field (see
// src/content/types.ts: Dish, Drink, Article). Matched by suffix on Vite's
// resolved module id, which is POSIX-style (forward slashes) regardless of
// the host OS, so a plain string suffix is enough -- no path-normalizing
// needed.
const TARGET_SUFFIXES = [
  '/src/content/dishes.json',
  '/src/content/drinks.json',
  '/src/content/press.json',
];

function isTargetContentFile(id: string): boolean {
  return TARGET_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

// Content JSON is always an array of objects (`Dish[]`, `Drink[]`,
// `Article[]`) -- shape.test.ts's non-blank-field checks already assume
// this for every other field those types declare. This narrows only the
// one shape `isPublished` needs; a `publishAt` present but not a string
// still reaches it and is rejected there (the regex test fails on the
// coerced value), so nothing unchecked slips through silently.
function asPublishable(item: unknown, file: string): { publishAt?: string } {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`${file}: expected an array of objects, found ${JSON.stringify(item)}`);
  }
  return item as { publishAt?: string };
}

// Resolves "today" in the restaurant's own timezone, Asia/Kolkata (IST),
// not the build machine's. Cloudflare builds in UTC; at 23:00 UTC on the
// 1st -- 04:30 IST on the 2nd -- a UTC comparison would still withhold
// content dated the 2nd. IST has no DST, so this needs no seasonal
// correction.
//
// Publish granularity is the cadence of the next scheduled rebuild (the
// cron job from Plan 3), not midnight: an item dated "today" goes live at
// the next build that happens to run on or after that date, not the
// instant the clock ticks over.
//
// Exported (not module-private) purely so
// plugins/__tests__/filter-unpublished.test.ts can verify the IST
// resolution itself under fake timers -- `filterUnpublishedJson`'s own
// tests all take `today` as a parameter and so cannot exercise this
// function's body at all; nothing else in the suite would have caught a
// regression here (confirmed: swapping the body to plain
// `new Date().toISOString().slice(0, 10)` -- i.e. UTC, the exact bug this
// function exists to avoid -- left every other gate green).
export function todayInKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

// Pure: takes `today` as a parameter instead of reading the clock, so it
// can be unit-tested at the one interesting boundary without stubbing
// global Date/Intl state (see plugins/__tests__/filter-unpublished.test.ts,
// the only place this ever runs, since the plugin below is `apply: 'build'`
// only). Returns `null` when `id` isn't one of the three target files,
// matching Vite's own convention for "this transform hook has nothing to
// do with this module".
export function filterUnpublishedJson(id: string, code: string, today: string): string | null {
  if (!isTargetContentFile(id)) return null;
  const parsed: unknown = JSON.parse(code);
  if (!Array.isArray(parsed)) return null;
  const items: unknown[] = parsed;
  const filtered = items.filter((item) => isPublished(asPublishable(item, id), today));
  return JSON.stringify(filtered);
}

// Filters future-dated dishes, drinks and press articles out of the
// production bundle entirely -- not hidden by CSS, not filtered in the
// browser, absent from the shipped JavaScript. See
// .superpowers/sdd/2026-08-02-plan-2-content-model/task-4-brief.md for why
// this has to live here rather than in src/content/index.ts: that module is
// bundled into the browser, so a filter there would still ship the
// unpublished names inside the JS, just hidden from the rendered DOM.
//
// `apply: 'build'` only: the dev server and Vitest never see this plugin
// (Vitest loads vitest.config.ts, a wholly separate Vite config that never
// imports this file at all), so the deploy gate -- `test:deploy`, run
// before every build -- never depends on the wall clock. A clock-dependent
// suite would mean an unrelated content edit could be blocked by a date
// boundary crossing overnight; keeping this build-only rules that out.
//
// `enforce: 'pre'` runs this before Vite's own built-in JSON plugin
// converts the file to an ES module, so `code` here is still raw JSON text
// -- confirmed directly against the real hook input, not assumed: without
// `enforce: 'pre'`, `code` arrives as `export default {...}` JS source, and
// filtering that would be string surgery instead of a JSON.parse/stringify
// round trip.
//
// Residual channel this plugin does NOT close: a withheld item's `image`
// path (e.g. "/food/idk1.webp") still ships. `public/` is copied into
// `dist/` verbatim by Vite -- this plugin only ever touches the three JSON
// files, never the filesystem copy -- so the photo for an unannounced dish
// is still fetchable at a guessable URL even though its name and
// description are genuinely absent from the JS. Harmless today because
// today's filenames are generic (`idk1.webp`, `pizza1.webp`, ...), but it
// becomes a real leak the moment a file is named after the dish itself
// (e.g. `truffle-special.webp`). Whoever wires Plan 3's upload UI should
// see this before assuming "scheduled" means "invisible everywhere".
export default function filterUnpublished(): Plugin {
  return {
    name: 'filter-unpublished',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const result = filterUnpublishedJson(id, code, todayInKolkata());
      if (result === null) return null;
      return { code: result, map: null };
    },
  };
}
