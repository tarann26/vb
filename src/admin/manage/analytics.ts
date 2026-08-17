// The judgements behind the four Numbers cards, as pure functions.
//
// Every one of these is a sentence a person will read and act on, and every
// one of them is arguable -- what counts as "busier", how much history is
// enough to say anything at all, whether a path she has never seen before
// should be shown raw or hidden. A function is the only honest place to put
// a judgement, and it is the only shape a table test can reach.
import type { AnalyticsPayload } from '../../shared/analytics-payload';

// ---------------------------------------------------------------------------
// When counting started.
//
// The ONE real source for this date. It is the day the Cloudflare Web
// Analytics beacon was hand-placed in index.html -- before that commit the
// beacon was not on the page at all (auto-install never reached
// Pages-served responses), so the dataset is genuinely empty before it, not
// merely quiet.
//
// It is never a hand-typed literal in any card's copy: every sentence that
// names a date formats THIS constant. A date typed into a string is a date
// that drifts from the day the beacon actually shipped, silently, the first
// time anything here is reworded.
export const COUNTING_STARTED_ON = '2026-08-07';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// "7 August 2026". Written out rather than through `toLocaleDateString`,
// which would render this differently depending on the machine's locale --
// including as "8/7/2026", which in India reads as the 8th of July.
export function formatCountingStartedOn(iso: string = COUNTING_STARTED_ON): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// The four headings. Here rather than in the component because the skeleton
// state has to show the REAL headings while it loads -- never a bare spinner
// -- and because a test asserting "all four headings are on screen during
// the wait" should quote one list.
export const CARD_HEADINGS = {
  a: 'How many visits, and how many tapped Reserve a Table?',
  b: 'Which pages did people look at?',
  c: 'Where did people come from?',
  d: 'Busier or quieter than usual?',
} as const;

// ---------------------------------------------------------------------------
// Card B: a path, as a page she would recognise.
//
// The whole point of the card. A ranked list of raw URL paths tells her
// nothing about whether catering or cheeseboards is landing.
export interface PageNaming {
  slug: string;
  name: string;
}

export function labelForPath(path: string, pages: PageNaming[]): string {
  // 1. Strip any query string and any trailing slash, except for `/` itself,
  //    so `/catering?utm_source=ig`, `/catering/` and `/catering` are one
  //    row rather than three.
  const withoutQuery = path.split('?')[0].split('#')[0];
  const normalised = withoutQuery === '/' ? '/' : withoutQuery.replace(/\/+$/, '') || '/';

  // 2. The paths that are pages without being in pages.json.
  if (normalised === '/') return 'Homepage';
  // Review fix (Minor #6, Phase 5 Task 8): /blogs -> 'Press' predates the
  // blog model and stays for historical rows (a real visit still landed
  // there before this task's own 301 in public/_redirects started
  // intercepting it at the edge). /blog and /blog/<slug> are its sibling
  // orphan -- exactly the class already caught in editable-paths.ts for the
  // SAME route change -- real traffic now lands there and had no entry at
  // all, so it fell through to rule 4's raw-path fallback.
  if (normalised === '/blogs') return 'Press';
  if (normalised === '/blog') return 'Blog';
  if (normalised.startsWith('/blog/')) return 'Blog post';

  // 3. A leading-slash match against a page she created.
  const page = pages.find((candidate) => `/${candidate.slug}` === normalised);
  if (page) return page.name;

  // 4. No match: the raw path, unchanged. Honest, and it is how she would
  //    notice a page she forgot she made -- or an /edit path leaking past
  //    the Worker's own exclusion, which is the signal that the numbers on
  //    Card A are wrong too.
  return normalised;
}

// ---------------------------------------------------------------------------
// Card D: busier or quieter than usual.

// Stated as the comparator so a test author cannot write it two ways: a
// change of EXACTLY +0.15 is busier and exactly -0.15 is quieter; anything
// strictly between is about the same. A small restaurant's week-to-week
// traffic moves several percent on noise alone, and a card that shouts
// "busier!" at +4% teaches her to ignore it.
export const WEEK_CHANGE_THRESHOLD = 0.15;

// ONE guard rail, not two. A 3-visit week followed by a 6-visit week is
// +100% and means nothing.
//
// The earlier "and 14 days of data" condition is deliberately absent: a
// query over a fixed 14-day window returns totals and cannot tell you the
// beacon only started three days ago, so it had no implementation and
// therefore no possible test. The counting-started banner above the cards
// carries the "it is early" message that condition was reaching for.
export const MIN_PRIOR_WEEK_VISITS = 20;

export type WeekVerdict = 'busier' | 'quieter' | 'same' | 'not-enough-history';

export function weekVerdict(thisWeekVisits: number, priorWeekVisits: number): WeekVerdict {
  if (priorWeekVisits < MIN_PRIOR_WEEK_VISITS) return 'not-enough-history';
  const change = (thisWeekVisits - priorWeekVisits) / priorWeekVisits;
  if (change >= WEEK_CHANGE_THRESHOLD) return 'busier';
  if (change <= -WEEK_CHANGE_THRESHOLD) return 'quieter';
  return 'same';
}

// One sentence. No chart -- the owner's stated requirement is plain words
// rather than something to interpret.
export function weekSentence(thisWeekVisits: number, priorWeekVisits: number): string {
  switch (weekVerdict(thisWeekVisits, priorWeekVisits)) {
    case 'not-enough-history':
      return 'Not enough history yet — this needs two full weeks to compare.';
    case 'busier':
      return `Busier than the week before — ${count(thisWeekVisits)} visits, up from ${count(priorWeekVisits)}.`;
    case 'quieter':
      return `Quieter than the week before — ${count(thisWeekVisits)} visits, down from ${count(priorWeekVisits)}.`;
    case 'same':
      return `About the same as the week before — ${count(thisWeekVisits)} visits.`;
  }
}

// ---------------------------------------------------------------------------
// Card A: visits, taps, and the relationship between them.

function count(value: number): string {
  return value.toLocaleString('en-IN');
}

// "about", always. `rumPageloadEventsAdaptiveGroups` is an adaptive, sampled
// dataset, so the number is an estimate and says so.
export function visitsSentence(visits: number): string {
  return `about ${count(visits)} ${visits === 1 ? 'visit' : 'visits'}`;
}

// "at least", always, and never the word "bookings". The tap counter is
// origin-checked, rate-limited, capped per day and delivered by
// fire-and-forget sendBeacon; its own response carries `lowerBound: true`
// specifically so this screen cannot forget.
export function tapsSentence(total: number): string {
  return `at least ${count(total)} tapped Reserve a Table`;
}

// Below this, "N days of data" is not enough to put two series beside each
// other and call the result a rate.
const MIN_DAYS_FOR_RATIO = 7;

// "About 1 in 8 visits ended in a tap on Reserve a Table."
//
// Not "13.1%": a decimal implies a precision that a sampled estimate divided
// by a self-declared lower bound does not have, and a bare percentage gives
// her no anchor for whether it is good.
//
// Returns null rather than a placeholder when it cannot be said. Not "0%",
// not an em dash, and certainly not NaN -- the row is simply absent.
export function ratioSentence(payload: AnalyticsPayload): string | null {
  const taps = payload.bookingTaps.total;
  if (payload.visits <= 0 || taps <= 0) return null;
  // The two numbers must cover comparable windows. `days` is what the body
  // actually reports, so this is checkable; what it cannot know is how long
  // the beacon has been running, which is the counting-started banner's job.
  if (payload.windowDays < MIN_DAYS_FOR_RATIO || payload.bookingTaps.days < MIN_DAYS_FOR_RATIO) return null;
  const oneIn = Math.max(1, Math.round(payload.visits / taps));
  return `About 1 in ${count(oneIn)} visits ended in a tap on Reserve a Table.`;
}

// The launch state, and the one this screen will be in for a while: taps
// have been accumulating since the counter shipped, visits have not started
// at all. Laying a real number beside a zero inside a layout built for
// comparing them is the definition of "this screen is broken", so the card
// says it once instead.
export function noVisitsYetSentence(taps: number): string {
  return `We haven't started counting visits yet. ${count(taps)} ${
    taps === 1 ? 'person has' : 'people have'
  } tapped Reserve a Table since ${formatCountingStartedOn()}.`;
}
