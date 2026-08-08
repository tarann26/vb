// The status strip's copy, as pure functions.
//
// A separate module from the component for two reasons. Every sentence below
// is a judgement someone could argue with -- which failure is worth naming,
// which silence is worse than a wrong guess, how long "still building" lasts
// before it becomes "this did not land" -- and a function is the only honest
// place to put a judgement. And a file that exports both a component and its
// constants breaks fast refresh, which this repo's lint config already warns
// about.
import { formatRelativeTime } from '../drafts';
import type { BuildInfoOutcome } from '../publish';

// How long after a publish stops reporting progress before an unmoved
// `builtAt` stops meaning "still building" and starts meaning "this did not
// land". Above both numbers the copy quotes: the observed build is 1-2
// minutes and the sentence says 2-3 deliberately, because an estimate that
// runs short turns every ordinary build into a late one, and the whole point
// of that line is that waiting feels normal.
export const NOT_LIVE_AFTER_MS = 5 * 60_000;

export function lastPublishedText(outcome: BuildInfoOutcome | null, now: number): { text: string; title?: string } {
  if (outcome === null) return { text: 'Checking when the site last updated…' };
  // Not "the site is down": a failed fetch from her phone on a bad
  // connection is not evidence about the site. It also does not show a stale
  // cached time and it does not guess.
  if (outcome.kind === 'error') return { text: "Couldn't check when the site last updated." };
  const builtAt = Date.parse(outcome.info.builtAt);
  // A nonsense relative time ("in 3 hours") is worse than admitting the gap.
  if (Number.isNaN(builtAt) || builtAt > now) return { text: 'Last published — time unknown' };
  return { text: `Last published ${formatRelativeTime(builtAt, now)}`, title: new Date(builtAt).toLocaleString() };
}

export interface LivenessInput {
  publishInFlight: boolean;
  // When the current publish attempt first reported progress, or null if
  // there is no attempt outstanding.
  publishStartedAt: number | null;
  // Whether `builtAt` has moved since that attempt started. It moves only on
  // a successful build, which is the whole reason this is the liveness
  // signal rather than "a fetch succeeded".
  builtAtMoved: boolean;
  // Whether PublishBar itself has reported the build live. Kept ALONGSIDE
  // `builtAtMoved` rather than instead of it, because each covers a hole in
  // the other: the bar's own report is authoritative but only exists while
  // the bar is still mounted and reporting, and `builtAt` cannot be compared
  // at all if /build-info.json had not answered yet at the moment the
  // publish started.
  publishSucceeded: boolean;
  buildInfoOk: boolean;
  now: number;
}

export function livenessText(input: LivenessInput): string | null {
  if (input.publishStartedAt !== null) {
    if (input.builtAtMoved || input.publishSucceeded) return 'Published just now';
    const elapsed = input.now - input.publishStartedAt;
    if (elapsed >= NOT_LIVE_AFTER_MS) {
      const minutes = Math.floor(elapsed / 60_000);
      return `Your last update hasn't gone live yet — it's been ${minutes} minutes.`;
    }
    return 'Publishing your changes — usually 2–3 minutes';
  }
  if (input.publishInFlight) return 'Publishing your changes — usually 2–3 minutes';
  if (input.buildInfoOk) return 'Site is live';
  return null;
}

// A permanent "View site" beside "you have unpublished changes" invites her
// to tap it, see the published site WITHOUT her work on it, and conclude the
// work is gone.
export function viewSiteLabel(hasUnsaved: boolean): string {
  return hasUnsaved ? 'View the published site ↗' : 'View site ↗';
}

