// Resolves "today" in the restaurant's own timezone, Asia/Kolkata (IST), not
// the caller's own clock. Cloudflare runs Workers in UTC; at 23:00 UTC on
// the 1st -- 04:30 IST on the 2nd -- a UTC comparison would still be filing
// a tap under the previous day. IST has no DST, so this needs no seasonal
// correction.
//
// TWO callers now, in two different runtimes, which is why this lives in
// src/shared/ rather than in worker/ where it started:
//
//   - The WhatsApp "Reserve a Table" tap counter (worker/index.ts's
//     handleRecordWaTap/handleReadWaCounts, and worker/analytics.ts), which
//     keys its single KV value by IST date so the number the owner reads on
//     the dashboard is bucketed by HER day, not by UTC's.
//   - `blankPost` (src/admin/areas/PostsArea.tsx), which pre-fills a new
//     post's "Published on" with today. The browser's own clock is not UTC,
//     but it is not the restaurant's either: she can add a post from a phone
//     in any timezone, and the review that found this had the ORIGINAL
//     `new Date().toISOString().slice(0, 10)` pre-filling YESTERDAY for the
//     five and a half hours between midnight and 05:30 IST -- exactly when a
//     chef writes up the evening service. Nothing on screen would have said
//     so: the validator accepts any well-formed date.
//
// Moved rather than copied, deliberately. A second timezone helper beside
// this one is how the next caller gets it wrong again, and this file's own
// history is the argument: it was in src/content/publish.ts before it was in
// worker/, and it has never once needed to be two functions. src/shared/ is
// the directory both tsconfig projects already compile (upload-categories.ts,
// base64.ts, image-format.ts, derivative-path.ts all live here for the same
// reason), so neither caller reaches across a project boundary for it.
//
// Not a parameter the way a pure predicate would take one: this IS the
// clock-reading seam, and its own tests (src/shared/__tests__/date.test.ts)
// are the only place its actual output is read under fake timers.
export function todayInKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
