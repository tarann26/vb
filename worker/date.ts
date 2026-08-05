// Resolves "today" in the restaurant's own timezone, Asia/Kolkata (IST), not
// the caller's own clock. Cloudflare runs Workers in UTC; at 23:00 UTC on
// the 1st -- 04:30 IST on the 2nd -- a UTC comparison would still be filing
// a tap under the previous day. IST has no DST, so this needs no seasonal
// correction.
//
// One caller: the WhatsApp "Reserve a Table" tap counter (worker/index.ts's
// handleRecordWaTap/handleReadWaCounts), which keys its single KV value by
// IST date so the number the owner reads on the dashboard is bucketed by
// HER day, not by UTC's. This function used to live in
// src/content/publish.ts next to a scheduling predicate, shared with a
// build-time Vite plugin; both of those are gone, and the Worker is the only
// thing that still needs a date at all -- so it lives here, inside the one
// tsconfig project that uses it, rather than reaching across a project
// boundary into src/content/ for a string.
//
// Not a parameter the way a pure predicate would take one: this IS the
// clock-reading seam, and its own tests (worker/__tests__/date.test.ts) are
// the only place its actual output is read, under fake timers.
export function todayInKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
