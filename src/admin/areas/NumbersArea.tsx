// The Numbers area: how many people visited, which pages they looked at,
// where they came from, and whether this week was busier than last.
//
// ONE request behind every card. One loading state, one error state -- not a
// route per card and not a spinner per card. The window each number covers is
// stated in the copy; there is no date picker and no export.
//
// ---------------------------------------------------------------------------
// THE `active` PROP IS NOT COSMETIC.
// ---------------------------------------------------------------------------
// Every area on this dashboard is mounted from the first render and hidden
// with the `hidden` attribute rather than unmounted (see ManageShell), so
// there is no mount event to hang a fetch on: mounting is not visiting.
// `IntersectionObserver` is no help either -- it does not fire for an
// element inside a hidden ancestor, and it does not exist in jsdom at all.
// So the one signal that means "she is looking at this" has to be passed in,
// and a ref latch makes the request fire on the first render where it is
// true and never again for that range in that session. A Cloudflare API call
// on every dashboard load, for a screen she may not open, is not free and is
// not needed.
//
// The latch is a SET of ranges rather than a boolean, because the screen now
// has four possible answers instead of one. What it guarantees is unchanged:
// a range she has never chosen is never requested, so a dashboard load still
// costs nothing here.
//
// ---------------------------------------------------------------------------
// EVERY CARD'S EMPTY STATE IS THE STATE IT SHIPS IN.
// ---------------------------------------------------------------------------
// The dataset was empty the day this was written and will stay near-empty
// for a week or two. So the zero state was designed first, and it has to
// read as TOO EARLY rather than as BROKEN -- that distinction is the whole
// difference between her trusting this screen and deciding it does not work.
// A separate grey empty message inside every card, stacked one above
// another, reads as several things wrong rather than one thing early, which
// is why the framing sits ONCE at the top and the cards below it are muted
// rather than each re-explaining the same thing.
import React, { useEffect, useRef, useState } from 'react';
import {
  AI_TRAFFIC_CAVEAT,
  CAMPAIGN_CAVEAT,
  CAMPAIGN_EMPTY,
  CAMPAIGN_LINK_HOWTO,
  CAMPAIGN_VS_REFERRER,
  CARD_HEADINGS,
  COPY_REFUSED,
  TAP_COUNTING_STARTED_ON,
  VISIT_COUNTING_STARTED_ON,
  archiveSentence,
  campaignLinkRows,
  copiedSentence,
  formatCountingStartedOn,
  labelForPath,
  noVisitsYetSentence,
  ratioSentence,
  tapsSentence,
  trendCaption,
  visitsSentence,
  weekSentence,
} from '../manage/analytics';
import type { CampaignLinkRow, PageNaming } from '../manage/analytics';
import TrendChart from '../manage/TrendChart';
import HoursChart from '../manage/HoursChart';
import BarList from '../manage/BarList';
import StatCard from '../manage/StatCard';
import RangeControl from '../manage/RangeControl';
import { changeBetween, previousWindowIsCounted } from '../manage/comparison';
import { DEFAULT_RANGE, isAnalyticsPayload } from '../../shared/analytics-payload';
import type { AnalyticsFailureReason, AnalyticsPayload, AnalyticsRange } from '../../shared/analytics-payload';
import type { ContentRegistry } from '../publish';
import type { Page, SiteContent } from '../../content/types';

export interface NumbersAreaProps {
  active: boolean;
  // Read only for pages.json, so Card B can turn `/catering` into the name
  // she gave that page. The Pages area fetches it on first load -- every
  // area mounts at once -- so by the time she opens Numbers it is there; if
  // it is not, `labelForPath` falls back to the raw path, which is honest.
  registry: ContentRegistry;
  // Injected by tests only. Defaulted inside the component rather than in
  // the parameter list: `fetchImpl = fetch` captures the global UNBOUND, and
  // a browser's `window.fetch` invoked with an undefined `this` throws
  // "Illegal invocation" -- which the catch below would then report as
  // "couldn't reach the visitor numbers", for a request that was never made.
  fetchImpl?: typeof fetch;
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; payload: AnalyticsPayload }
  | { kind: 'error'; reason: AnalyticsFailureReason };

// The two error sentences are DIFFERENT on purpose: they need different
// human actions -- wait, versus fix a token -- and an undifferentiated
// "something went wrong" would have her retrying forever against a
// permission that will never grant itself.
function errorSentence(reason: AnalyticsFailureReason): string {
  return reason === 'unreachable'
    ? "Couldn't reach the visitor numbers just now."
    : "The visitor numbers aren't connected yet.";
}

// The shape guard used to live HERE, as a private copy. It moved to
// src/shared/analytics-payload.ts, beside the type it checks: the module that
// DEFINES the shape is the module that decides whether a body has it, and the
// Worker's own tests can then assert that what it emits passes the same guard
// this screen applies -- a real end-to-end claim rather than two hopes
// pointing at each other.
async function loadAnalytics(range: AnalyticsRange, fetchImpl?: typeof fetch): Promise<Outcome> {
  // Wrapped rather than passed as a bare reference -- see `fetchImpl`'s own
  // prop comment on why `fetch` detached from its global throws.
  const request = fetchImpl ?? ((input: RequestInfo | URL) => fetch(input));
  try {
    // One of four words, never a number of days. The Worker's whole load
    // control is one Cache API entry per range, so an unbounded parameter
    // here would be an unbounded number of upstream calls; `AnalyticsRange`
    // is what makes that impossible to type by accident.
    const response = await request(`/api/analytics?range=${range}`);
    if (response.ok) {
      const body: unknown = await response.json();
      if (!isAnalyticsPayload(body)) return { kind: 'error', reason: 'upstream-error' };
      return { kind: 'ok', payload: body };
    }
    const body = (await response.json().catch(() => ({}))) as { reason?: AnalyticsFailureReason };
    return { kind: 'error', reason: body.reason ?? 'upstream-error' };
  } catch {
    return { kind: 'error', reason: 'unreachable' };
  }
}

// The address the copied links point at, from the site's OWN configuration
// (site.json's `seo.url`) rather than from the address bar.
//
// This used to be `window.location.origin`, which was right for an EXAMPLE
// sentence and is wrong for a link she is about to paste into her Instagram
// bio. The dashboard is reachable on any host that serves it -- a Pages
// preview deployment, a staging domain, a machine on her desk -- and a link
// built from that host works for exactly as long as that deployment does. The
// committed value is the restaurant's real address, is the same string
// sitemap.xml and every canonical tag already use, and does not depend on
// where she happened to open /edit.
//
// The fallback is the location, unchanged, for the window before site.json has
// loaded (every area mounts at once, so it is short) and for a registry that
// somehow has no entry: same origin as this dashboard is the closest true
// answer available, and it is what the sentence this replaces always used.
function siteOrigin(registry: ContentRegistry): string {
  const data = registry.getEntries()['site.json']?.data as SiteContent | undefined;
  const url = data?.seo?.url;
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : window.location.origin;
}

function pagesFromRegistry(registry: ContentRegistry): PageNaming[] {
  const entry = registry.getEntries()['pages.json'];
  const data = entry?.data;
  if (!Array.isArray(data)) return [];
  return (data as Page[])
    .filter((page) => typeof page?.slug === 'string' && typeof page?.name === 'string')
    .map((page) => ({ slug: page.slug, name: page.name }));
}

const CARD = "mb-4 rounded border border-brand/30 bg-white p-4 font-['Montserrat']";
const CARD_TITLE = "mb-2 font-['Montserrat'] text-sm uppercase tracking-wide text-accent";

const NumbersArea: React.FC<NumbersAreaProps> = ({ active, registry, fetchImpl }) => {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_RANGE);
  // LATCHED, never read straight off the current answer, and the difference is
  // a control that forgets what she just pressed.
  //
  // `yearAvailable` lives on the payload, so reading it off `outcome` makes it
  // false for as long as `outcome` is `loading` -- which is exactly the window
  // that opens the instant she presses "By year". RangeControl filters the
  // pill row on it, so the button she just pressed unmounted under her finger:
  // for up to ten seconds on a cold Worker the row showed three buttons with
  // NONE pressed, and a keyboard user's focus fell to document.body because
  // the focused element had been removed.
  //
  // Once true it stays true for the session. The archive only ever grows, so
  // there is no state in which the answer legitimately goes back to false
  // while she is looking at the screen -- and if a year request errors, she
  // must still be left with a pill claiming the range she is reading.
  const [yearEverAvailable, setYearEverAvailable] = useState(false);
  // Which ranges this session has already asked the Worker for. The single
  // boolean this replaces was right for a screen with one answer and is wrong
  // for one with four -- but the ORIGINAL guarantee it existed for is kept
  // exactly: a dashboard load never costs a Cloudflare call for a screen she
  // does not open, because a range she has not chosen is still never
  // requested.
  const requestedRef = useRef<Set<AnalyticsRange>>(new Set());
  // The answer each range gave, kept so that returning to a range she has
  // already seen paints ITS numbers rather than leaving the previous range's
  // numbers under the newly pressed pill. That specific mismatch -- the pill
  // says 90 days and the figures are the 30-day ones -- is the failure this
  // whole per-range design exists to prevent, and not re-asking without also
  // remembering is how it arrives through the front end instead of through
  // the cache key.
  //
  // Deliberately NOT re-fetched on a return visit: the ten-minute Cache API
  // entry behind this route means a second request would usually hand back
  // the same body anyway. Which is also why what goes IN here is guarded --
  // see `receive`. Whatever is stored under a range is shown for that range
  // for the rest of the session, with no further chance to notice it is the
  // wrong body.
  const answersRef = useRef<Map<AnalyticsRange, Outcome>>(new Map());
  // The range she is looking at RIGHT NOW, readable from inside a promise
  // that was started under a different one. The captured `range` in an effect
  // closure is the range that request was FOR, which is exactly the wrong
  // thing to compare a late answer against.
  const rangeRef = useRef<AnalyticsRange>(range);
  rangeRef.current = range;
  // Whether this component is still on screen, rather than a `cancelled`
  // flag scoped to one effect run -- and that distinction is load-bearing
  // under React's StrictMode, which mounts, unmounts and remounts every
  // component in development. With a per-run flag, the FIRST run starts the
  // one request the latch allows and its cleanup then discards the answer,
  // while the second run returns early because the latch is already set:
  // the screen sits on "Loading…" forever. Measured in a real browser, not
  // reasoned about -- it is exactly what the e2e case for this screen
  // caught.
  const mountedRef = useRef(true);
  // The public address every copyable link is built on. See siteOrigin above
  // for why it is the committed one and not the one in the address bar.
  const site = siteOrigin(registry);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Records the answer against the range it was asked for, and paints it only
  // if she is still looking at that range.
  //
  // TWO different refusals live here and they are not interchangeable.
  //
  // The first: a body whose OWN echoed range is not the range this call asked
  // for was served under the wrong cache key. It answers no question this
  // screen asked, so it is neither painted NOR recorded -- and the recording
  // half is the load-bearing one. The memory below is replayed every time she
  // opens this area, so a body that was kept after being refused is handed
  // back to her the moment she clicks away and returns, under the very pill
  // that refused it: 7 days' figures beneath a pressed "Last 90 days". That
  // is the exact mismatch `AnalyticsPayload.range` was put in the contract to
  // expose, arriving one click later instead of straight away. The area nav
  // is not disabled while a range loads, so that click is always available.
  //
  // The second: a body that IS the answer to what it was asked, for a range
  // she has since moved off. Tapping 7 days and then 90 days quickly would
  // otherwise paint the 7-day answer under the 90-day pill. That one is kept
  // -- it is a true answer for its own range, and returning to that range
  // should paint it -- and simply not painted now.
  //
  // NO TEST CAN REDDEN THAT SECOND LINE TODAY, and it stays anyway. Removing
  // it leaves all 48 cases green, because nothing this component does can put
  // two requests in flight at once: every path that starts one sets `loading`
  // first, `loading` is what disables the pills, and the only path out of
  // `loading` is that same request answering. So `asked` and `rangeRef` agree
  // for as long as the pills honour `disabled`. Two cases pin `disabled`
  // ("cannot be pressed while a request is in flight", "starts no second
  // request while the first is still out"), and this line is what stops a
  // number appearing under the wrong pill on the day one of them is relaxed.
  // Recorded in report-T22-23.md as a surviving mutation rather than left for
  // a reader to mistake for covered code.
  function receive(asked: AnalyticsRange, next: Outcome) {
    if (!mountedRef.current) return;
    if (next.kind === 'ok' && next.payload.range !== asked) return;
    answersRef.current.set(asked, next);
    // Set BEFORE the "she has moved off this range" return below: an answer
    // for a range she is no longer looking at is still a true answer about
    // whether the archive holds anything, and the pill it governs is on
    // screen either way.
    if (next.kind === 'ok' && next.payload.yearAvailable) setYearEverAvailable(true);
    if (next.kind === 'ok' && next.payload.range !== rangeRef.current) return;
    setOutcome(next);
  }

  useEffect(() => {
    if (!active) return;
    // Replayed as recorded, with no second look at what it says. That is safe
    // for exactly one reason: `receive` above is the only writer, and it
    // refuses to record a body whose own echoed range is not the one it was
    // asked for. Re-checking here instead of there would leave the bad body
    // in the map for some later reader to find; checking in BOTH places would
    // add a branch no test could ever redden. The invariant belongs at the
    // write.
    const answered = answersRef.current.get(range);
    if (answered !== undefined) {
      setOutcome(answered);
      return;
    }
    if (requestedRef.current.has(range)) {
      setOutcome({ kind: 'loading' });
      return;
    }
    requestedRef.current.add(range);
    setOutcome({ kind: 'loading' });
    void loadAnalytics(range, fetchImpl).then((next) => {
      receive(range, next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, range]);

  function retry() {
    setOutcome({ kind: 'loading' });
    const asked = range;
    void loadAnalytics(asked, fetchImpl).then((next) => {
      receive(asked, next);
    });
  }

  return (
    <section className="mb-10">
      <h2 className="mb-2 font-['Montserrat'] text-lg uppercase tracking-wide text-ink">Numbers</h2>
      {/* Said once, quietly. Her own editing sessions are tracked pageloads
          -- the beacon is on index.html and the SPA rewrite serves it for
          /edit and every /edit/manage route -- so they are excluded at the
          query, and this is the line that stops her wondering why the
          numbers look low. */}
      {/* The darker grey, and it is not a taste change. This is the ONE line
          on this panel that sits directly on the shell's cream rather than
          inside a white card, and the lighter grey measures 4.44:1 there
          against 4.83:1 on white -- under AA, on the sentence that stops her
          wondering why the numbers look low. Found by the sweep in
          e2e/brand-contrast.spec.ts, which is what that sweep is for, and it
          costs the stylesheet nothing because this panel already paints its
          empty states in the darker grey. */}
      <p className="mb-4 font-['Montserrat'] text-xs text-gray-600">
        Your own editing visits aren&rsquo;t counted.
      </p>

      {/* Above the error branch as well as the cards, so a range that fails
          still leaves her a way back to one that did not. */}
      <RangeControl
        value={range}
        onChange={setRange}
        disabled={outcome.kind === 'loading'}
        // The latch, plus the range she is actually reading. The second term
        // is not redundant: a year request that ERRORS leaves the latch
        // wherever it was, and a pressed pill she cannot see is a screen with
        // no state on it.
        yearAvailable={yearEverAvailable || range === 'year'}
      />

      {outcome.kind === 'error' ? (
        <div className={CARD} role="alert">
          <p className="text-sm text-ink">{errorSentence(outcome.reason)}</p>
          {outcome.reason === 'unreachable' && (
            // `type="button"`, and that is not cosmetic: this renders inside
            // the single <form> PublishBar's own button submits, where a
            // bare <button> defaults to type="submit" and would become a
            // second Publish trigger.
            <button
              type="button"
              onClick={retry}
              className="mt-2 rounded border border-brand px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-accent transition hover:bg-brand hover:text-ink"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          {outcome.kind === 'ok' && outcome.payload.visits === 0 && (
            <div className="mb-4 rounded border border-brand/30 bg-[#f7f5f0] p-4 font-['Montserrat'] text-sm text-ink">
              <p className="font-semibold">
                Visitor counting started on {formatCountingStartedOn(VISIT_COUNTING_STARTED_ON)}.
              </p>
              <p className="mt-1 text-gray-600">
                There isn&rsquo;t enough data yet — this fills in over the next week or two. Nothing is wrong with your
                website.
              </p>
            </div>
          )}
          {/* Every skeleton card shows its REAL heading from the first paint
              -- never a bare spinner and never one spinner per card. The
              first tap in any session waits on a Worker call with a
              ten-second timeout, so it will show something before it shows
              numbers. */}
          <CardA outcome={outcome} />
          <TrendCard outcome={outcome} />
          <CardB outcome={outcome} pages={pagesFromRegistry(registry)} />
          <CardC outcome={outcome} />
          {/* Directly under Card C, and the adjacency IS the design: the two
              cards that could be read as contradicting each other sit
              together, with the sentence that tells them apart between
              them. */}
          <CampaignCard outcome={outcome} site={site} />
          <HoursCard outcome={outcome} />
          <CardD outcome={outcome} />
        </>
      )}
    </section>
  );
};

function Skeleton() {
  return <p className="text-sm text-gray-400">Loading…</p>;
}

// `data-card` on every card wrapper, so e2e/ has a hook that is not a class
// name. A browser assertion written against a utility class breaks the moment
// the drawing is restyled, and it is forbidden in this project's spec files
// for that reason.
const CardA: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD} data-card="a">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.a}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : outcome.payload.visits === 0 ? (
      // ONE card state, not two numbers. Taps come from KV and have been
      // accumulating since the counter shipped, so before the beacon lands
      // the honest render is a real number beside a zero inside a layout
      // built for comparing them -- which is the definition of "this screen
      // is broken".
      <p className="text-sm text-ink">{noVisitsYetSentence(outcome.payload.bookingTaps.total)}</p>
    ) : (
      <>
        {/* Each card is told whether ITS OWN measure was being counted for
            the whole of the period it is dividing by. The two dates are
            eleven days apart and the ranges are up to ninety days long, so
            there is a stretch where the taps comparison is honest and the
            visits one is not -- one flag for both would have to pick which
            card to be wrong on. See comparison.ts for the arithmetic. */}
        <div className="flex flex-wrap gap-6">
          <StatCard
            label="Visits"
            value={visitsSentence(outcome.payload.visits)}
            change={changeBetween(
              outcome.payload.visits,
              outcome.payload.visitsPrevious,
              previousWindowIsCounted(Date.now(), outcome.payload.windowDays, VISIT_COUNTING_STARTED_ON),
            )}
            unit="visits"
          />
          <StatCard
            label="Reserve a Table"
            value={tapsSentence(outcome.payload.bookingTaps.total)}
            change={changeBetween(
              outcome.payload.bookingTaps.total,
              outcome.payload.tapsPrevious,
              previousWindowIsCounted(Date.now(), outcome.payload.bookingTaps.days, TAP_COUNTING_STARTED_ON),
            )}
            unit="taps"
          />
        </div>
        {ratioSentence(outcome.payload) !== null && (
          <p className="mt-2 text-sm text-ink">{ratioSentence(outcome.payload)}</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Taps are a lower bound, not a count — some are never recorded. Visits are an estimate.
        </p>
      </>
    )}
  </div>
);

const TrendCard: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD} data-card="trend">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.trend}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <>
        <TrendChart series={outcome.payload.series} grain={outcome.payload.seriesGrain} />
        <p className="mt-2 text-xs text-gray-500">
          {trendCaption(
            outcome.payload.seriesGrain,
            // The first point DRAWN, taken from the same array the chart is
            // handed, so the sentence and the line cannot name different
            // days. `seriesStartsOn` is the archive's earliest bucket, which
            // is the OTHER claim in that sentence and not this one.
            outcome.payload.series[0]?.date ?? null,
            outcome.payload.seriesStartsOn,
            outcome.payload.series.some((point) => !point.complete),
          )}
        </p>
      </>
    )}
  </div>
);

const CardB: React.FC<{ outcome: Outcome; pages: PageNaming[] }> = ({ outcome, pages }) => (
  <div className={CARD} data-card="b">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.b}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : /* Before the emptiness check, never after it: at year grain the list
           is empty for a reason that has nothing to do with visitors, and the
           usual sentence would say nobody came. */
    outcome.payload.range === 'year' ? (
      <p className="text-sm text-gray-600">{archiveSentence()}</p>
    ) : outcome.payload.byPath.length === 0 ? (
      <p className="text-sm text-gray-600">Nothing to rank yet — this fills in once people start visiting.</p>
    ) : (
      <BarList
        ordered
        rows={outcome.payload.byPath.map((row) => ({
          // row.path arrives already normalised by the Worker (no query
          // string, no trailing slash) -- that is what makes it a stable
          // React key here and what stops a tagged arrival at
          // /catering?utm_source=instagram splitting into its own row now
          // that tagged links exist.
          key: row.path,
          label: labelForPath(row.path, pages),
          value: row.visits,
        }))}
      />
    )}
  </div>
);

const CardC: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD} data-card="c">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.c}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <>
        {outcome.payload.range === 'year' ? (
          // Same reason as Card B: the rollup keeps monthly totals, and a
          // referrer cannot be recovered from a total.
          <p className="text-sm text-gray-600">{archiveSentence()}</p>
        ) : outcome.payload.byReferer.length === 0 ? (
          // "No referrers yet" used the exact word this copy exists to avoid.
          <p className="text-sm text-gray-600">
            Nothing yet — this will show whether people found you through Instagram, Google, or by typing your address
            in.
          </p>
        ) : (
          <BarList
            ordered={false}
            rows={outcome.payload.byReferer.map((bucket) => ({
              key: `${bucket.kind}:${bucket.host ?? ''}`,
              label: bucket.label,
              sub: bucket.host ?? undefined,
              value: bucket.visits,
            }))}
          />
        )}
        {/* On THIS card as well as the campaign card below, because both of
            them can show an AI row and neither of them can count one
            properly. A row that is absent says nothing at all on its own, so
            the sentence is here whether or not the row is. */}
        <p className="mt-2 text-xs text-gray-500">{AI_TRAFFIC_CAVEAT}</p>
      </>
    )}
  </div>
);

// The Retry button's own string, minus its margin, so the Copy buttons cost
// the stylesheet nothing: every utility in it already had a rule in the sheet
// before this card existed.
const COPY_BUTTON =
  "rounded border border-brand px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-accent transition hover:bg-brand hover:text-ink";

// THE POINT OF THIS WHOLE CARD: four finished links and four Copy buttons.
//
// There is no field to type in, no menu to pick a source from and nothing to
// spell, because the person using this has never typed a query parameter and
// must never have to. She copies the row that matches where she is about to
// paste it.
//
// WHAT HAPPENS WHEN THE CLIPBOARD REFUSES, which is a thing browsers really
// do -- an insecure context has no `navigator.clipboard` at all, and
// `writeText` rejects on a page that has lost focus or a permission that was
// never granted:
//
//   * The link is TEXT on the page, selectable with a finger or a mouse, so
//     there is always a way through without the button. It is not inside an
//     input, not `select-none`, not clipped.
//   * The message says what actually happened. A button that reports "Copied!"
//     into a clipboard that refused it is how she pastes last week's link into
//     her Instagram bio and never finds out.
//
// The whole attempt sits inside one try: a missing `navigator.clipboard`
// throws where it is read rather than rejecting, and both failures mean the
// same thing to her, so both land on the same sentence.
const CampaignLinks: React.FC<{ site: string }> = ({ site }) => {
  // ONE message for the list rather than a state per row: two rows cannot be
  // copied at once, and four live regions on one card is four things a screen
  // reader has to be told about for the sake of one event.
  const [note, setNote] = useState('');

  async function copy(row: CampaignLinkRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(row.url);
      // AFTER the await resolves, never beside the call. Setting it first is
      // exactly the claim this card must not make.
      setNote(copiedSentence(row.label));
    } catch {
      setNote(COPY_REFUSED);
    }
  }

  return (
    <div className="mt-3" data-links="campaigns">
      <p className="text-xs text-gray-600">{CAMPAIGN_LINK_HOWTO}</p>
      <ul className="mt-2 space-y-2">
        {campaignLinkRows(site).map((row) => (
          <li key={row.source} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink">{row.label}</span>
            {/* `break-all`, because this is the one string on the panel that
                cannot be reflowed at a space: at 390px a full link is wider
                than the card, and a card that pushes the page sideways is
                what e2e/numbers-visuals.spec.ts already refuses. */}
            <code data-link={row.source} className="min-w-0 flex-1 break-all text-xs text-gray-600">
              {row.url}
            </code>
            {/* `type="button"` for the reason the Retry button above states:
                this renders inside the single <form> PublishBar submits, and a
                bare <button> would be a second Publish trigger.
                The accessible name names the ROW -- four buttons all called
                "Copy" is one control repeated four times to anybody not
                looking at the screen. */}
            <button type="button" aria-label={`Copy your ${row.label}`} onClick={() => void copy(row)} className={COPY_BUTTON}>
              Copy
            </button>
          </li>
        ))}
      </ul>
      {/* Empty until something has actually happened, and a live region either
          way so the answer reaches somebody who cannot see the row. */}
      <p role="status" className="mt-2 text-xs text-gray-600">
        {note}
      </p>
    </div>
  );
};

// The one card on this panel fed by our OWN rows rather than by Cloudflare,
// which is why its numbers are exact and say so nowhere -- exactness is the
// absence of the word "about", not a claim to be made.
//
// The LINKS are the deliverable, and they are on the card in every state. The
// version this replaces printed a sentence telling her to append
// `?utm_source=` and one of six words to her own web address by hand, plus the
// list of words it would accept -- so the card's usefulness rested on her
// typing a URL correctly, and every typo was punished silently by counting the
// arrival as somebody else's link. Nothing here asks her to type anything now.
const CampaignCard: React.FC<{ outcome: Outcome; site: string }> = ({ outcome, site }) => (
  <div className={CARD} data-card="campaigns">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.campaigns}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <>
        {outcome.payload.campaigns.length === 0 ? (
          <p className="text-sm text-gray-600">{CAMPAIGN_EMPTY}</p>
        ) : (
          <BarList
            ordered={false}
            rows={outcome.payload.campaigns.map((row) => ({
              // row.label, never row.source. The machine value is the same
              // string the referrer card already shows as a bucket, and two
              // rows reading "instagram" on one screen meaning two different
              // things is the collision this whole card is written around.
              key: row.source,
              label: row.label,
              value: row.arrivals,
            }))}
          />
        )}
        <CampaignLinks site={site} />
        {/* All three sentences render in BOTH states, because the confusion
            each one prevents exists in both. */}
        <p className="mt-2 text-xs text-gray-500">{CAMPAIGN_VS_REFERRER}</p>
        <p className="mt-1 text-xs text-gray-500">{CAMPAIGN_CAVEAT}</p>
        <p className="mt-1 text-xs text-gray-500">{AI_TRAFFIC_CAVEAT}</p>
      </>
    )}
  </div>
);

// `hourly === null` means THIS SITE CANNOT ANSWER THAT QUESTION, and the card
// is then absent. An empty array is a different thing entirely -- a real,
// drawable answer reading "nobody yet" -- so a length check here would delete
// the card on the quietest week of the year, which is the week she would most
// want to look at it.
//
// The heading still shows while the answer is on its way, like every other
// card on this panel: until the body arrives there is no null to react to, and
// a skeleton with its real heading is what the rest of this screen does.
const HoursCard: React.FC<{ outcome: Outcome }> = ({ outcome }) => {
  // Three states, and `undefined` is the third: not answered YET, which is
  // what every other card on this panel draws as a skeleton under its real
  // heading. `null` is the answer "never", and only that one removes the card.
  const cells = outcome.kind === 'ok' ? outcome.payload.hourly : undefined;
  if (cells === null) return null;
  return (
    <div className={CARD} data-card="hours">
      <h3 className={CARD_TITLE}>{CARD_HEADINGS.hours}</h3>
      {cells === undefined ? (
        <Skeleton />
      ) : (
        <>
          <HoursChart cells={cells} />
          <p className="mt-2 text-xs text-gray-500">Indian time. Darker means busier. Visits are an estimate.</p>
        </>
      )}
    </div>
  );
};

const CardD: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD} data-card="d">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.d}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <p className="text-sm text-ink">
        {weekSentence(outcome.payload.thisWeekVisits, outcome.payload.priorWeekVisits)}
      </p>
    )}
  </div>
);

export default NumbersArea;
