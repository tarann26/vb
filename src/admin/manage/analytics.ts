// The judgements behind the four Numbers cards, as pure functions.
//
// Every one of these is a sentence a person will read and act on, and every
// one of them is arguable -- what counts as "busier", how much history is
// enough to say anything at all, whether a path she has never seen before
// should be shown raw or hidden. A function is the only honest place to put
// a judgement, and it is the only shape a table test can reach.
import type { AnalyticsPayload } from '../../shared/analytics-payload';

// ---------------------------------------------------------------------------
// When counting started. TWO dates, because two different things started on
// two different days and one card names each of them.
//
// TAPS have been counted since the day the Reserve a Table counter shipped.
// That number is a KV total with no expiry and it has been accumulating,
// honestly, since this date.
export const TAP_COUNTING_STARTED_ON = '2026-08-07';

// VISITS have been counted only since the Web Analytics token was unified.
// Until then the beacon on the page and the token the Worker queries were
// two DIFFERENT Cloudflare sites, both bound to a zone that has since been
// deleted -- so the panel was reading a dataset the page never wrote to.
// Repointing both at one new token reset the dataset this panel reads to
// zero, and that reset was accepted rather than treated as a fault.
//
// This constant was the whole of backlog item 1. ONE date was doing TWO
// jobs, so the screen told her there was a week and a half of visit history
// on a dataset that was hours old, and "not enough data yet" read as her
// website being broken rather than as the panel being new. Note which
// direction the bug ran: the old value was RIGHT about taps and WRONG about
// visits, which is why setting the single constant to the new date would
// have moved the defect rather than closed it.
export const VISIT_COUNTING_STARTED_ON = '2026-08-18';

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
//
// No default argument, deliberately. A default is what let ONE date serve
// two meanings for eleven days without anything on screen looking wrong:
// every call site now has to say which thing it is dating, and tsc refuses a
// call that does not.
export function formatCountingStartedOn(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// Every card's heading. Here rather than in the component because the
// skeleton state has to show the REAL headings while it loads -- never a bare
// spinner -- and because a test asserting "every heading is on screen during
// the wait" should quote one list.
//
// ONE ENTRY PER CARD THAT EXISTS. Both the jsdom wait test and
// e2e/dashboard-sections.spec.ts walk Object.values() and require each one to
// be on screen, so a heading added ahead of its card is a red suite rather
// than a quiet inconsistency -- which is the behaviour worth keeping.
export const CARD_HEADINGS = {
  a: 'How many visits, and how many tapped Reserve a Table?',
  b: 'Which pages did people look at?',
  c: 'Where did people come from?',
  d: 'Busier or quieter than usual?',
  // The hero graphic, and the only heading that is a plain noun -- it is the
  // one thing on the screen a reader understands before reading a word of it.
  trend: 'Visits over time',
  // "Your own links", not "campaigns". She places the links; the word
  // campaign is the industry's, not hers, and the card directly above this
  // one already answers "where did people come from?" about somebody else's
  // website. The two headings have to be tellable apart at a glance.
  campaigns: 'Which of your own links brought people?',
  // The ONE conditional card on this panel. `payload.hourly` is null whenever
  // the question cannot be answered -- at year grain the archive holds one row
  // per month and an hour is not recoverable from it -- and the card is then
  // absent rather than empty. So this heading is on screen while the answer is
  // still being fetched, and again once it arrives as anything but null; the
  // sweeps that walk Object.values() here see it in both.
  hours: 'When are people looking?',
} as const;

// The chart says where its line begins rather than beginning at an
// unexplained zero, and it says whether any month in it is partial. Three
// different things are true in three different states and the sentence is
// different in each.
//
// TWO DATES, NOT ONE, AND THEY ARE DIFFERENT QUESTIONS. `chartStartsOn` is
// the first point actually DRAWN, which the selected range decides.
// `recordStartsOn` is the earliest bucket the archive HOLDS, which nothing on
// the screen decides. They are equal only while the record is shorter than
// the range -- and the archive's first night backfills ninety days against a
// default range of thirty, so they stop being equal on day two and never
// coincide again.
//
// Printing the record's start above a thirty-day chart is what this used to
// do: "This chart begins on 22 May 2026, when the record started", over a
// line beginning on 20 July. She cannot then tell a quiet thirty days from a
// quiet ninety, which is the one thing this chart exists to show her. So the
// sentence claims each date for what it actually is, and the second clause --
// "when the record started" -- is printed ONLY when the record really does
// start there.
//
// Both are 'YYYY-MM-DD' at day grain and 'YYYY-MM' at month grain, and
// formatCountingStartedOn cannot read the second -- it needs a day number and
// returns the raw string when there is not one, which would print "2026-06"
// to a reader who has never seen an ISO date. So the shape decides the
// formatter, exactly as it does in seriesLabel below.
export function trendCaption(
  grain: 'day' | 'month',
  chartStartsOn: string | null,
  recordStartsOn: string | null,
  hasPartialMonth: boolean,
): string {
  if (chartStartsOn === null) {
    return 'This chart fills in from today onwards. It cannot reach back before now.';
  }
  const say = (date: string): string => (grain === 'month' ? seriesLabel(date, true) : formatCountingStartedOn(date));
  // A plain string comparison, which is what ISO dates are for. Anything the
  // archive holds that is older than the first drawn point means the record
  // reaches further back than the range does.
  const reachesFurther = recordStartsOn !== null && recordStartsOn < chartStartsOn;
  const opening = reachesFurther
    ? `This chart begins on ${say(chartStartsOn)}. The record itself goes back to ${say(recordStartsOn)}.`
    : `This chart begins on ${say(chartStartsOn)}, when the record started. It cannot reach back before that.`;
  if (grain !== 'month' || !hasPartialMonth) return opening;
  // The spec's explicit requirement: the first year of the by-year view IS a
  // partial year, and the panel says so rather than drawing a misleading
  // column. The month is DRAWN -- an omitted month is a gap she cannot see.
  return `${opening} Months marked * are not complete.`;
}

// `date` is 'YYYY-MM' at month grain and 'YYYY-MM-DD' at day grain, and
// formatCountingStartedOn would mangle the first. One function, two shapes,
// so the label is built where the shape is known -- and the ASTERISK lives
// here rather than in the component, because the rule "a partial month is
// marked" is a copy decision and belongs beside the sentence that explains
// it.
export function seriesLabel(date: string, complete: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  const named = MONTHS[(month ?? 1) - 1] ?? date;
  const label = day === undefined ? `${named} ${String(year)}` : `${String(day)} ${named}`;
  return complete ? label : `${label}*`;
}

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
  } tapped Reserve a Table since ${formatCountingStartedOn(TAP_COUNTING_STARTED_ON)}.`;
}

// ---------------------------------------------------------------------------
// Cards B and C at year grain.
//
// The yearly archive holds monthly TOTALS and nothing else -- no per-page
// breakdown and no referrer breakdown, because a rollup row is one number per
// month per metric and neither list can be reconstructed from it. So at that
// range both cards have nothing to draw, and their usual
// "Nothing to rank yet — this fills in once people start visiting" is FALSE
// there: it says nobody visited, when what happened is that nobody kept the
// breakdown. Telling those two apart is the distinction this whole panel
// exists to make, so the year case gets its own sentence and names the way
// back to the answer she wanted.
export function archiveSentence(): string {
  return 'Pages and links are not kept in the yearly archive — choose 90 days or less to see them.';
}

// ---------------------------------------------------------------------------
// The campaign card: which of HER links brought people.

// Shown while there is nothing to count, which is the state this card ships
// in and the most useful thing on the screen that day. "Nothing yet" alone
// would leave her with no way to discover what the card wants, and until she
// has pasted a tagged link somewhere there is nothing in the world for the
// endpoint to record. The empty state is therefore the deliverable, not a
// placeholder.
export function campaignHowTo(site: string): string {
  return `Add ?utm_source= and one of these words to the end of your web address, then paste that instead of the plain one. For example: ${site}/?utm_source=instagram`;
}

// What this card cannot tell her, ON the card rather than assumed. Both
// directions are named because both are real: the same person on a phone and
// a laptop is two arrivals, and someone whose browser refuses the write is
// none.
//
// AND WHICH DAYS IT COUNTED, which is the third thing and the one a whole-
// branch review found (finding 5). Under one "Last 30 days" pill this card
// counts a window that INCLUDES today while the visits and taps beside it stop
// at yesterday -- Cloudflare's figures for today do not exist yet, and this
// card's rows are our own and do. Both behaviours are right; the pill above
// them cannot say so, so the card does. This is the one card she can check by
// hand -- she pastes a link, taps it, and looks -- and today's arrivals had
// better be in the number she is looking at.
export const CAMPAIGN_CAVEAT =
  'Counted once per person arriving, not once per page they read, and today so far is included — the visitor numbers above stop at yesterday. It cannot tell that the same person came back on a different phone, and it misses anyone whose browser blocks it.';

// A tag is not a referrer, and this card sits directly below one that says
// "Instagram" meaning something different. Without this line the two read as
// a contradiction and she has no way to tell which to believe.
export const CAMPAIGN_VS_REFERRER =
  'This is not the same as the card above. That one says which website someone clicked from; this one says which of your own links they clicked.';
