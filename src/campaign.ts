// A tagged arrival, counted ONCE PER ARRIVAL and never once per page.
//
// This is the single most likely place for the Numbers panel to report a
// number four or five times too high, and three things stop it:
//
//   * The tag is in the URL only on ARRIVAL. This site is a single-page app,
//     so moving from the homepage to a post is a router transition -- no new
//     document, no new query string, and this module is never consulted
//     again. Ordinary browsing cannot re-count.
//   * The call site is MODULE SCOPE in main.tsx, not an effect. React's
//     StrictMode mounts, unmounts and remounts every component under
//     `npm run dev`, which is what Playwright drives; an effect that fires
//     this would fire it twice on every developer's machine and in every
//     browser test.
//   * A REFRESH does re-send the same URL, so the browser is asked to
//     remember, for this tab only, that this arrival was already recorded.
//     sessionStorage, cleared when the tab closes. Not a cookie, not an
//     identifier, and it cannot follow anyone between visits.
//
// THE MARK IS WRITTEN BEFORE ANYTHING IS SENT. That ordering is a second,
// independent guard against the StrictMode double-fire above: if this is ever
// moved into an effect by a future edit, marking first makes the second
// invocation a no-op instead of a second row. Send-then-mark would be correct
// today and wrong the moment somebody moves the call, and the failure would
// be a doubled number rather than an error.
//
// The value stored is the TAG AS WRITTEN, not a flag and not the bucket it is
// counted under: two different tagged links opened in the same tab are two
// different arrivals and both should count, and a bare boolean would silently
// drop the second.
//
// The bucket cannot do that job, which is what it used to be asked to do.
// normalizeSource collapses everything outside the four preset sources (and
// the AI one nobody places) to the single string `other`, so marking with the
// bucket made
// `?utm_source=partner-a` and then `?utm_source=partner-b` in one tab ONE
// arrival -- the exact case this comment claims is two. The mark is now the
// tag itself (case and surrounding space folded, so one link is still one
// link), while the value SENT is still the bucket, which is what bounds the
// column to a committed list.
import { campaignTag, normalizeSource } from './shared/campaign-sources';

export const ARRIVAL_STORAGE_KEY = 'vb:arrival:v1';

export function arrivalToRecord(
  pathname: string,
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): string | null {
  // Her own editing sessions are never campaign arrivals. The same
  // path-segment boundary worker/analytics.ts's isExcludedPath uses applies,
  // so a future public page whose slug begins with those four letters is not
  // silently exempted.
  if (pathname === '/edit' || pathname.startsWith('/edit/')) return null;

  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('utm_source');
  } catch {
    return null;
  }
  // AN UNTAGGED VISIT WRITES NOTHING. Ordinary traffic costs this site zero
  // requests and zero rows, which is what keeps the write path small enough
  // to reason about at all.
  if (raw === null || raw.trim() === '') return null;
  const source = normalizeSource(raw);
  const mark = campaignTag(raw);

  try {
    if (storage.getItem(ARRIVAL_STORAGE_KEY) === mark) return null;
    storage.setItem(ARRIVAL_STORAGE_KEY, mark);
  } catch {
    // Private browsing, or storage that has no room left. The honest choice
    // is to count the arrival and accept that a refresh in this tab may count
    // it twice: the alternative drops a real arrival every time, which biases
    // the card downward permanently rather than upward occasionally. The
    // card's own caveat says the count is imperfect in both directions.
    return source;
  }
  return source;
}

// The only impure export, and it is deliberately tiny: everything worth
// testing is above it.
//
// `fetch` with `keepalive`, NOT navigator.sendBeacon, and the reason is what
// has to be PROVEN about this path rather than a preference. A beacon returns
// a boolean, page.route cannot see it, and page.on('request') cannot reason
// about it; this returns a promise a test can observe, a route can intercept,
// and a `.catch` can swallow. `keepalive` gives the same
// survives-a-navigation property a beacon has. Nothing awaits it, so nothing
// about the page waits for it, and the rejection is swallowed because a
// counter that costs the restaurant a customer is worse than no counter --
// the principle Hero.tsx already states for the tap counter.
export function recordArrivalIfTagged(): void {
  try {
    const source = arrivalToRecord(window.location.pathname, window.location.search, window.sessionStorage);
    if (source === null) return;
    void fetch('/api/campaign', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }).catch(() => {});
  } catch {
    // Nothing here may reach the page.
  }
}
