// One horizontal strip under the lockup, on every area, on the phone home
// and on the not-found screen, at both widths. Three signals and one link,
// and nothing else -- this is a strip, not a dashboard.
//
// It exists because of the second half of the owner's report: the Manage
// screen "says nothing about the state of things -- whether the site is up,
// when it last published, whether she has work sitting unsaved". All three
// of those signals already existed in this codebase and none of them were
// ever surfaced.
//
// ---------------------------------------------------------------------------
// WHAT IT POLLS, AND WHY IT IS NOT /api/build-status.
// ---------------------------------------------------------------------------
// /build-info.json is a ~60-byte static asset Vite stamps on every
// SUCCESSFUL build and public/_headers serves `no-store`: no Worker
// invocation, no KV, no rate limiter, no Cloudflare API call.
// /api/build-status is none of those things -- it makes a real Cloudflare
// REST call per request -- and PublishBar already polls it, correctly, with
// backoff and a timeout, during and after a publish. A second poller against
// it would double that cost to re-derive a state already rendered three
// inches away.
//
// ---------------------------------------------------------------------------
// THE GREEN PILL THAT WAS WITHDRAWN.
// ---------------------------------------------------------------------------
// A plain "Site is live" light whose only evidence is "a fetch from this
// origin succeeded" is a light wired to a switch that is always on: if the
// origin were not serving, the dashboard she is looking at would not have
// rendered either. It would say "Site is live" through a failed build and
// through a JS error that blanked the public homepage, and a
// permanently-green indicator is worse than none because it teaches her to
// ignore the strip.
//
// `builtAt` moves ONLY on a successful build, so it is a signal that can be
// false, and that is what this strip says "live" from. The failure it can
// actually report -- a publish that completed five minutes ago whose build
// never landed -- is the one she needs and the one a green pill could never
// give.
import React, { useEffect, useRef, useState } from 'react';
import { fetchBuildInfo } from '../publish';
import type { BuildInfoOutcome } from '../publish';
import { stripSummary } from '../publish-summary';
import { lastPublishedText, livenessText, viewSiteLabel } from './status-copy';
import type { ContentFileName } from '../content';
import type { PublishPhase } from '../PublishBar';

const POLL_INTERVAL_MS = 60_000;

const IN_FLIGHT_PHASES: ReadonlySet<PublishPhase> = new Set<PublishPhase>(['publishing', 'polling', 'confirming']);

export interface StatusStripProps {
  dirtyFiles: ContentFileName[];
  stagedCount: number;
  // Reported by PublishBar through one additive optional callback. The strip
  // renders from it so that, for the whole publish window, ONE statement
  // exists in ONE place: without this the strip would read "Site is live ·
  // last published 2 hours ago" in the same frame as the bar says
  // "Publishing…", which from her chair is a flat contradiction whose
  // obvious reading is "my publish didn't take".
  publishPhase: PublishPhase;
  // Injected only by tests -- the real strip always reads the real asset.
  fetchBuildInfoImpl?: typeof fetchBuildInfo;
  now?: () => number;
}

// ---------------------------------------------------------------------------

const StatusStrip: React.FC<StatusStripProps> = ({
  dirtyFiles,
  stagedCount,
  publishPhase,
  fetchBuildInfoImpl = fetchBuildInfo,
  now = Date.now,
}) => {
  const [outcome, setOutcome] = useState<BuildInfoOutcome | null>(null);
  const [publishStartedAt, setPublishStartedAt] = useState<number | null>(null);
  const [builtAtAtPublish, setBuiltAtAtPublish] = useState<string | null>(null);
  const fetchRef = useRef(fetchBuildInfoImpl);
  fetchRef.current = fetchBuildInfoImpl;

  // Polling: on mount, on window focus, and every 60 seconds -- and the
  // interval is STOPPED while the tab is hidden rather than merely skipped,
  // so a dashboard left open in a background tab all afternoon is not
  // quietly making a request a minute.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const read = () => {
      void fetchRef.current().then((next) => {
        if (!cancelled) setOutcome(next);
      });
    };
    const start = () => {
      if (timer === undefined) timer = setInterval(read, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        read();
        start();
      }
    };
    const onFocus = () => read();

    read();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const currentBuiltAt = outcome !== null && outcome.kind === 'ok' ? outcome.info.builtAt : null;
  const inFlight = IN_FLIGHT_PHASES.has(publishPhase);

  // Remember when this publish attempt started, and what `builtAt` said at
  // that moment, so "did it land" is a comparison rather than a guess.
  useEffect(() => {
    if (inFlight && publishStartedAt === null) {
      setPublishStartedAt(now());
      setBuiltAtAtPublish(currentBuiltAt);
    }
    // `currentBuiltAt`/`now` deliberately excluded: this must capture the
    // values as they were when the attempt STARTED, not follow them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight, publishStartedAt]);

  // `builtAtAtPublish !== null` is required, not defensive: if
  // /build-info.json had not answered yet when the publish started, there is
  // no baseline, and treating "we now know a builtAt" as "the build landed"
  // would report success the instant the first poll came back -- possibly
  // seconds after she pressed Publish, for a build that has not started.
  const builtAtMoved =
    publishStartedAt !== null && builtAtAtPublish !== null && currentBuiltAt !== null && currentBuiltAt !== builtAtAtPublish;
  const nowMs = now();
  const unsavedSentence = stripSummary(dirtyFiles, stagedCount);
  const hasUnsaved = dirtyFiles.length > 0 || stagedCount > 0;
  const liveness = livenessText({
    publishInFlight: inFlight,
    publishStartedAt,
    builtAtMoved,
    publishSucceeded: publishPhase === 'success',
    buildInfoOk: outcome !== null && outcome.kind === 'ok',
    now: nowMs,
  });
  const lastPublished = lastPublishedText(outcome, nowMs);

  return (
    // Queried by this accessible name in every test, never by role alone:
    // CollapsibleSection renders role="status" for a folded panel with a
    // problem, and with all five areas mounted several of those can exist at
    // once, so getByRole('status') is ambiguous by construction.
    <section
      aria-label="Site status"
      className="mb-4 rounded border border-[#6B8B59]/30 bg-white px-4 py-3 font-['Montserrat'] text-sm"
    >
      {/* The live region is SCOPED to the two things whose change is worth
          announcing. Wrapping the whole strip would re-announce it every 60
          seconds, when "2 hours ago" becomes "3 hours ago". */}
      <div role="status" aria-live="polite">
        {liveness !== null && <p className="text-[#222]">{liveness}</p>}
        {/* Never blank: a blank strip is indistinguishable from a broken
            one, which is the complaint this header exists to answer. */}
        <p className="text-gray-600">{unsavedSentence}</p>
      </div>
      {/* Outside the live region, deliberately -- see above. */}
      <p className="mt-1 text-gray-500" title={lastPublished.title}>
        {lastPublished.text}
      </p>
      {/* Relative to this origin rather than site.json's seo.url: the
          dashboard is served from the same host as the site it edits, so
          this stays correct through the move to the real domain with nothing
          to remember to change -- and it does not make the strip wait on a
          content file that a different panel happens to own. */}
      <p className="mt-2">
        <a href="/" target="_blank" rel="noopener" className="text-[#6B8B59] underline">
          {viewSiteLabel(hasUnsaved)}
        </a>
      </p>
      {hasUnsaved && <p className="text-xs text-gray-500">your unpublished changes aren&rsquo;t on it yet.</p>}
    </section>
  );
};

export default StatusStrip;
