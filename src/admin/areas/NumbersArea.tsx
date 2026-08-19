// The Numbers area: how many people visited, which pages they looked at,
// where they came from, and whether this week was busier than last.
//
// ONE request behind four cards. One loading state, one error state, four
// cards -- not four routes and not four spinners. Windows are fixed and
// stated in the copy; there is no date picker, no chart and no export.
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
// true and never again in that session. A Cloudflare API call on every
// dashboard load, for a screen she may not open, is not free and is not
// needed.
//
// ---------------------------------------------------------------------------
// EVERY CARD'S EMPTY STATE IS THE STATE IT SHIPS IN.
// ---------------------------------------------------------------------------
// The dataset was empty the day this was written and will stay near-empty
// for a week or two. So the zero state was designed first, and it has to
// read as TOO EARLY rather than as BROKEN -- that distinction is the whole
// difference between her trusting this screen and deciding it does not work.
// Four independent grey empty messages stacked vertically read as four
// things wrong, not one thing early, which is why the framing sits ONCE at
// the top and the cards below it are muted rather than each re-explaining
// the same thing.
import React, { useEffect, useRef, useState } from 'react';
import {
  CARD_HEADINGS,
  VISIT_COUNTING_STARTED_ON,
  formatCountingStartedOn,
  labelForPath,
  noVisitsYetSentence,
  ratioSentence,
  tapsSentence,
  visitsSentence,
  weekSentence,
} from '../manage/analytics';
import type { PageNaming } from '../manage/analytics';
import { isAnalyticsPayload } from '../../shared/analytics-payload';
import type { AnalyticsFailureReason, AnalyticsPayload } from '../../shared/analytics-payload';
import type { ContentRegistry } from '../publish';
import type { Page } from '../../content/types';

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
async function loadAnalytics(fetchImpl?: typeof fetch): Promise<Outcome> {
  // Wrapped rather than passed as a bare reference -- see `fetchImpl`'s own
  // prop comment on why `fetch` detached from its global throws.
  const request = fetchImpl ?? ((input: RequestInfo | URL) => fetch(input));
  try {
    const response = await request('/api/analytics');
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
  // Fired once per session, on the first render where `active` is true. A
  // plain `useEffect` keyed on `active` would re-fire every time she came
  // back to this screen.
  const requestedRef = useRef(false);
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
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || requestedRef.current) return;
    requestedRef.current = true;
    setOutcome({ kind: 'loading' });
    void loadAnalytics(fetchImpl).then((next) => {
      if (mountedRef.current) setOutcome(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function retry() {
    setOutcome({ kind: 'loading' });
    void loadAnalytics(fetchImpl).then((next) => {
      if (mountedRef.current) setOutcome(next);
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
      <p className="mb-4 font-['Montserrat'] text-xs text-gray-500">
        Your own editing visits aren&rsquo;t counted.
      </p>

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
          {/* Four skeleton cards with their REAL headings already visible --
              never a bare spinner and never four spinners. The first tap in
              any session waits on a Worker call with a ten-second timeout,
              so it will show something before it shows numbers. */}
          <CardA outcome={outcome} />
          <CardB outcome={outcome} pages={pagesFromRegistry(registry)} />
          <CardC outcome={outcome} />
          <CardD outcome={outcome} />
        </>
      )}
    </section>
  );
};

function Skeleton() {
  return <p className="text-sm text-gray-400">Loading…</p>;
}

const CardA: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD}>
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
        <div className="flex flex-wrap gap-6">
          <p className="text-sm text-ink">{visitsSentence(outcome.payload.visits)}</p>
          <p className="text-sm text-ink">{tapsSentence(outcome.payload.bookingTaps.total)}</p>
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

const CardB: React.FC<{ outcome: Outcome; pages: PageNaming[] }> = ({ outcome, pages }) => (
  <div className={CARD}>
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.b}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : outcome.payload.byPath.length === 0 ? (
      <p className="text-sm text-gray-600">Nothing to rank yet — this fills in once people start visiting.</p>
    ) : (
      <ol className="text-sm text-ink">
        {outcome.payload.byPath.map((row) => (
          <li key={row.path} className="flex justify-between gap-4 border-b border-gray-100 py-1 last:border-0">
            <span>{labelForPath(row.path, pages)}</span>
            <span className="text-gray-500">{row.visits.toLocaleString('en-IN')}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
);

const CardC: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD}>
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.c}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : outcome.payload.byReferer.length === 0 ? (
      // "No referrers yet" used the exact word this copy exists to avoid.
      <p className="text-sm text-gray-600">
        Nothing yet — this will show whether people found you through Instagram, Google, or by typing your address in.
      </p>
    ) : (
      <ul className="text-sm text-ink">
        {outcome.payload.byReferer.map((bucket) => (
          <li
            key={`${bucket.kind}:${bucket.host ?? ''}`}
            className="flex justify-between gap-4 border-b border-gray-100 py-1 last:border-0"
          >
            <span>
              {bucket.label}
              {bucket.host !== null && <span className="ml-2 text-xs text-gray-500">{bucket.host}</span>}
            </span>
            <span className="text-gray-500">{bucket.visits.toLocaleString('en-IN')}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const CardD: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD}>
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
