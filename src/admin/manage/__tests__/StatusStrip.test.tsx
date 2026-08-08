// The status strip: what it says in each state, when it asks again, and
// what it announces.
//
// Every query goes through `aria-label="Site status"` and never through a
// role alone. That is not style: CollapsibleSection renders `role="status"`
// for a folded panel with a problem, and with all five areas mounted several
// of those can exist at once, so `getByRole('status')` is ambiguous by
// construction on this screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { act } from '@testing-library/react';
import StatusStrip from '../StatusStrip';
import { NOT_LIVE_AFTER_MS, lastPublishedText, livenessText, viewSiteLabel } from '../status-copy';
import type { BuildInfoOutcome } from '../../publish';
import type { ContentFileName } from '../../content';
import type { PublishPhase } from '../../PublishBar';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');

function buildInfo(builtAt: string, sha = 'abc123'): BuildInfoOutcome {
  return { kind: 'ok', info: { sha, builtAt } };
}

function renderStrip(options: {
  outcome?: BuildInfoOutcome;
  dirtyFiles?: ContentFileName[];
  stagedCount?: number;
  publishPhase?: PublishPhase;
  now?: number;
} = {}) {
  const fetchImpl = vi.fn(async () => options.outcome ?? buildInfo('2026-08-07T10:00:00.000Z'));
  const result = render(
    <StatusStrip
      dirtyFiles={options.dirtyFiles ?? []}
      stagedCount={options.stagedCount ?? 0}
      publishPhase={options.publishPhase ?? 'idle'}
      fetchBuildInfoImpl={fetchImpl as never}
      now={() => options.now ?? NOW}
    />,
  );
  return { ...result, fetchImpl };
}

function strip(): HTMLElement {
  return screen.getByLabelText('Site status');
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe('the unsaved sentence names files, and is never blank', () => {
  it('says nothing is waiting at zero', async () => {
    renderStrip();
    expect(await within(strip()).findByText('Nothing waiting to be published')).toBeInTheDocument();
  });

  it('names the files rather than counting sections', async () => {
    renderStrip({ dirtyFiles: ['dishes.json', 'site.json'] });
    expect(
      await within(strip()).findByText("Dishes and Opening hours have changes you haven't published yet"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the last-publish line', () => {
  it('shows a relative time, with the absolute one in the title', async () => {
    renderStrip({ outcome: buildInfo('2026-08-07T10:00:00.000Z') });
    const line = await within(strip()).findByText('Last published 2 hours ago');
    expect(line).toHaveAttribute('title');
  });

  it('admits it could not check, rather than showing a stale time or guessing', async () => {
    renderStrip({ outcome: { kind: 'error' } });
    expect(await within(strip()).findByText("Couldn't check when the site last updated.")).toBeInTheDocument();
    // And it does NOT claim the site is down: a failed fetch from her phone
    // on a bad connection says nothing about the site.
    expect(within(strip()).queryByText(/site is down/i)).not.toBeInTheDocument();
  });

  it('a builtAt in the future reads as unknown, not as a nonsense relative time', async () => {
    renderStrip({ outcome: buildInfo('2026-08-07T18:00:00.000Z') });
    expect(await within(strip()).findByText('Last published — time unknown')).toBeInTheDocument();
    expect(within(strip()).queryByText(/in \d/)).not.toBeInTheDocument();
  });

  // A SEPARATE case from the one above, deliberately. A missing sha says
  // nothing whatsoever about a timestamp, and an earlier draft of this
  // design collapsed the two into one branch.
  it("a sha of 'unknown' still shows the time normally", async () => {
    renderStrip({ outcome: buildInfo('2026-08-07T10:00:00.000Z', 'unknown') });
    expect(await within(strip()).findByText('Last published 2 hours ago')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the publish window is one statement in one place', () => {
  it('says it is publishing for the whole window, never "Site is live"', async () => {
    renderStrip({ publishPhase: 'polling', dirtyFiles: ['dishes.json'] });
    expect(await within(strip()).findByText('Publishing your changes — usually 2–3 minutes')).toBeInTheDocument();
    expect(within(strip()).queryByText('Site is live')).not.toBeInTheDocument();
  });

  it('says the site is live when nothing is outstanding and build-info answered', async () => {
    renderStrip();
    expect(await within(strip()).findByText('Site is live')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('livenessText -- the states, without a component around them', () => {
  it('reports the landing, once builtAt has moved', () => {
    expect(
      livenessText({
        publishInFlight: false,
        publishStartedAt: NOW,
        builtAtMoved: true,
        publishSucceeded: false,
        buildInfoOk: true,
        now: NOW,
      }),
    ).toBe('Published just now');
  });

  it('keeps saying "publishing" right up to the five-minute mark', () => {
    const almost = NOW + NOT_LIVE_AFTER_MS - 1;
    expect(
      livenessText({
        publishInFlight: false,
        publishStartedAt: NOW,
        builtAtMoved: false,
        publishSucceeded: false,
        buildInfoOk: true,
        now: almost,
      }),
    ).toBe('Publishing your changes — usually 2–3 minutes');
  });

  // The real failure signal, and the one the withdrawn green pill could
  // never give: builtAt moves ONLY on a successful build.
  it('names the failure once the build has plainly not landed', () => {
    const late = NOW + 12 * 60_000;
    expect(
      livenessText({
        publishInFlight: false,
        publishStartedAt: NOW,
        builtAtMoved: false,
        publishSucceeded: false,
        buildInfoOk: true,
        now: late,
      }),
    ).toBe("Your last update hasn't gone live yet — it's been 12 minutes.");
  });

  it('says nothing at all rather than "live" when build-info could not be read', () => {
    expect(
      livenessText({
        publishInFlight: false,
        publishStartedAt: null,
        builtAtMoved: false,
        publishSucceeded: false,
        buildInfoOk: false,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe('lastPublishedText', () => {
  it('says it is still checking before the first answer', () => {
    expect(lastPublishedText(null, NOW).text).toBe('Checking when the site last updated…');
  });

  it('refuses an unparseable builtAt rather than rendering NaN', () => {
    expect(lastPublishedText(buildInfo('not-a-date'), NOW).text).toBe('Last published — time unknown');
  });
});

// ---------------------------------------------------------------------------
describe('the View-site link changes its label with the unsaved count', () => {
  it('is a plain invitation when nothing is unsaved', async () => {
    renderStrip();
    const link = await within(strip()).findByRole('link', { name: viewSiteLabel(false) });
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).toHaveAttribute('target', '_blank');
  });

  // A permanent "View site" beside "you have unpublished changes" invites
  // her to tap it, see the site WITHOUT her work on it, and conclude the
  // work is gone.
  it('warns her what she will see when something is unsaved', async () => {
    renderStrip({ dirtyFiles: ['dishes.json'] });
    expect(await within(strip()).findByRole('link', { name: 'View the published site ↗' })).toBeInTheDocument();
    expect(within(strip()).getByText(/aren’t on it yet/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('polling', () => {
  it('asks again after 60 seconds, stops while the tab is hidden, and asks on focus', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = renderStrip();
    await act(async () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Hidden: the interval is STOPPED, not merely skipped.
    // Mutation this guards: delete the visibilitychange listener -- two more
    // calls arrive and this goes red.
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(120_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    spy.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe('the live region is scoped, not wrapped around the strip', () => {
  // A strip that is entirely live re-announces itself every 60 seconds, when
  // "2 hours ago" becomes "3 hours ago".
  //
  // Mutation this guards: move aria-live onto the <section> itself.
  it('announces the publish phase and the unsaved sentence, and not the timestamp', async () => {
    renderStrip({ publishPhase: 'polling', dirtyFiles: ['dishes.json'] });
    await within(strip()).findByText('Publishing your changes — usually 2–3 minutes');

    const live = within(strip()).getByRole('status');
    expect(within(live).getByText('Publishing your changes — usually 2–3 minutes')).toBeInTheDocument();
    expect(within(live).getByText(/have changes you haven't published yet|has changes you haven't published yet/)).toBeInTheDocument();

    const timestamp = within(strip()).getByText('Last published 2 hours ago');
    expect(live.contains(timestamp)).toBe(false);
  });
});
