// Every card as she reads it, from fixed payloads.
//
// Every one of these zero-data strings is the state this screen SHIPS in --
// the dataset was empty the day it was written and will be near-empty for a
// week or two. So they are pinned first, not last: the difference between
// "too early" and "broken" is the difference between her trusting this
// screen and deciding it does not work.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumbersArea from '../NumbersArea';
import { CARD_HEADINGS } from '../../manage/analytics';
import { ZERO_DATA_PAYLOAD } from '../../../shared/analytics-payload';
import type { AnalyticsPayload } from '../../../shared/analytics-payload';
import type { ContentEntries, ContentRegistry } from '../../publish';

function payload(overrides: Partial<AnalyticsPayload> = {}): AnalyticsPayload {
  return { ...ZERO_DATA_PAYLOAD, ...overrides };
}

// The shape NumbersArea actually reads: `getEntries()['pages.json'].data`.
// Everything else on ContentRegistry is unreachable from this component.
function fakeRegistry(entries: ContentEntries = {}): ContentRegistry {
  return {
    getEntries: () => entries,
    register: () => {},
    updateData: () => {},
    markPublished: () => {},
    version: 0,
  } as unknown as ContentRegistry;
}

function okFetch(body: AnalyticsPayload) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function errorFetch(reason: string) {
  return vi.fn(async () => new Response(JSON.stringify({ reason, message: 'nope' }), { status: 502 }));
}

function renderNumbers(fetchImpl: typeof fetch, entries?: ContentEntries) {
  return render(<NumbersArea active registry={fakeRegistry(entries)} fetchImpl={fetchImpl} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('the state it ships in', () => {
  it('frames the emptiness ONCE, above the cards, rather than four times inside them', async () => {
    renderNumbers(okFetch(ZERO_DATA_PAYLOAD) as unknown as typeof fetch);

    // A LITERAL, deliberately. `Visitor counting started on
    // ${formatCountingStartedOn(CONSTANT)}.` re-derives the expected string
    // from the value under test, so it stays green whichever of the two
    // counting-start dates the banner points at -- which is precisely the
    // defect backlog item 1 records. This is the date the Web Analytics
    // token was unified and the visit dataset reset to zero.
    expect(await screen.findByText('Visitor counting started on 18 August 2026.')).toBeInTheDocument();
    // The sentence that turns four blanks into one honest statement.
    expect(screen.getByText(/Nothing is wrong with your website/)).toBeInTheDocument();
  });

  it('Card A says it in ONE sentence, not as a real number beside a zero', async () => {
    renderNumbers(
      okFetch(payload({ visits: 0, bookingTaps: { total: 41, days: 28, lowerBound: true } })) as unknown as typeof fetch,
    );

    const card = (await screen.findByText(CARD_HEADINGS.a)).closest('div') as HTMLElement;
    expect(within(card).getByText(/We haven't started counting visits yet\./)).toBeInTheDocument();
    // The two-numbers layout is genuinely absent, not merely showing zeroes.
    expect(within(card).queryByText(/^about /)).not.toBeInTheDocument();
    expect(within(card).queryByText(/^at least /)).not.toBeInTheDocument();
  });

  it.each([
    [CARD_HEADINGS.b, 'Nothing to rank yet — this fills in once people start visiting.'],
    [
      CARD_HEADINGS.c,
      'Nothing yet — this will show whether people found you through Instagram, Google, or by typing your address in.',
    ],
    [CARD_HEADINGS.d, 'Not enough history yet — this needs two full weeks to compare.'],
  ])('%s reads as too early, not as broken', async (heading, expected) => {
    renderNumbers(okFetch(ZERO_DATA_PAYLOAD) as unknown as typeof fetch);
    const card = (await screen.findByText(heading)).closest('div') as HTMLElement;
    expect(within(card).getByText(expected)).toBeInTheDocument();
  });

  // The word this copy exists to avoid.
  it('never uses the word "analytics" anywhere on the screen', async () => {
    const { container } = renderNumbers(okFetch(ZERO_DATA_PAYLOAD) as unknown as typeof fetch);
    await screen.findByText(CARD_HEADINGS.a);
    expect(container.textContent ?? '').not.toMatch(/analytics/i);
  });
});

// ---------------------------------------------------------------------------
describe('with real numbers', () => {
  const POPULATED = payload({
    visits: 4100,
    thisWeekVisits: 312,
    priorWeekVisits: 240,
    bookingTaps: { total: 512, days: 28, lowerBound: true },
    byPath: [
      { path: '/', visits: 2000 },
      { path: '/catering', visits: 400 },
      { path: '/never-heard-of-it', visits: 3 },
    ],
    byReferer: [
      { kind: 'instagram', label: 'Instagram', host: null, visits: 1200 },
      { kind: 'other', label: 'Other links', host: 't.co', visits: 40 },
    ],
    // Four points, so the trend card actually draws rather than falling back
    // to "not enough days yet". A populated fixture with an empty series
    // would leave every assertion about the chart passing for the wrong
    // reason.
    series: [
      { date: '2026-07-20', visits: 90, complete: true },
      { date: '2026-07-21', visits: 140, complete: true },
      { date: '2026-07-22', visits: 60, complete: true },
      { date: '2026-07-23', visits: 200, complete: true },
    ],
    seriesStartsOn: '2026-07-20',
  });

  const PAGES_ENTRY = {
    'pages.json': { data: [{ slug: 'catering', name: 'Catering' }], initial: [], sha: 'x' },
  } as unknown as ContentEntries;

  it('Card A shows both numbers, the relationship, and the lower-bound caveat', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    const card = (await screen.findByText(CARD_HEADINGS.a)).closest('div') as HTMLElement;

    expect(within(card).getByText(/^about /)).toBeInTheDocument();
    const text = card.textContent ?? '';
    // Mutation this guards: drop "at least" from tapsSentence -- red.
    expect(text).toMatch(/at least \d/);
    expect(text).not.toMatch(/\d+ bookings?/);
    expect(within(card).getByText(/About 1 in 8 visits ended in a tap/)).toBeInTheDocument();
    expect(within(card).getByText(/lower bound, not a count/)).toBeInTheDocument();
  });

  it('Card B names the pages she recognises, and shows an unknown path raw', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch, PAGES_ENTRY);
    const card = (await screen.findByText(CARD_HEADINGS.b)).closest('div') as HTMLElement;

    expect(within(card).getByText('Homepage')).toBeInTheDocument();
    expect(within(card).getByText('Catering')).toBeInTheDocument();
    expect(within(card).getByText('/never-heard-of-it')).toBeInTheDocument();
  });

  it('Card C shows the bucket, with the real host in smaller text for "Other links"', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    const card = (await screen.findByText(CARD_HEADINGS.c)).closest('div') as HTMLElement;

    expect(within(card).getByText('Instagram')).toBeInTheDocument();
    expect(within(card).getByText('Other links')).toBeInTheDocument();
    expect(within(card).getByText('t.co')).toBeInTheDocument();
  });

  // The trend card is the only place on this panel that draws anything, and
  // this is the wiring: that the card hands the chart the payload's own
  // series and grain, and hands the caption the payload's own start. Passing
  // a literal null for the start would leave the chart looking perfect and
  // the sentence under it wrong.
  it('the trend card draws the payload series and dates the record from it', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    const card = (await screen.findByText(CARD_HEADINGS.trend)).closest('div') as HTMLElement;

    expect(within(card).getByRole('img', { name: 'Visits over the last 4 days, highest 200' })).toBeInTheDocument();
    expect(
      within(card).getByText(
        'This chart begins on 20 July 2026, when the record started. It cannot reach back before that.',
      ),
    ).toBeInTheDocument();
  });

  it('Card D is one sentence, and nothing on the panel is drawn on a canvas', async () => {
    const { container } = renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    const card = (await screen.findByText(CARD_HEADINGS.d)).closest('div') as HTMLElement;

    expect(within(card).getByText('Busier than the week before — 312 visits, up from 240.')).toBeInTheDocument();
    // Card D itself stays wordless of any drawing: the owner's stated
    // requirement for THIS card is a sentence, not something to interpret.
    expect(card.querySelector('svg')).toBeNull();
    // And nowhere on the panel is there a <canvas>. The trend card above
    // draws hand-written SVG; a canvas would mean a charting library had been
    // pulled in for one polyline, which is what the spec ruled out.
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('the banner is gone once there is anything to show', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    await screen.findByText(CARD_HEADINGS.a);
    expect(screen.queryByText(/Visitor counting started on/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the wait, and the two ways it can fail', () => {
  it("shows every card's REAL heading while it loads, never a spinner with nothing named", async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    renderNumbers((() => gate) as unknown as typeof fetch);

    Object.values(CARD_HEADINGS).forEach((heading) => {
      expect(screen.getByText(heading)).toBeInTheDocument();
    });
    release(new Response(JSON.stringify(ZERO_DATA_PAYLOAD), { status: 200 }));
    await screen.findByText(/Visitor counting started on/);
  });

  // The two sentences are different because they need different human
  // actions -- wait, versus fix a token. An undifferentiated "something went
  // wrong" would have her retrying forever against a permission that will
  // never grant itself.
  it('offers a Retry only for the failure retrying can fix', async () => {
    const { unmount } = renderNumbers(errorFetch('unreachable') as unknown as typeof fetch);
    expect(await screen.findByText("Couldn't reach the visitor numbers just now.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    unmount();

    renderNumbers(errorFetch('upstream-auth') as unknown as typeof fetch);
    expect(await screen.findByText("The visitor numbers aren't connected yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  // PublishBar is one <form> wrapping this whole screen, and a bare <button>
  // inside a form defaults to type="submit" -- which here means a second
  // Publish trigger.
  it('the Retry button declares its type', async () => {
    renderNumbers(errorFetch('unreachable') as unknown as typeof fetch);
    expect(await screen.findByRole('button', { name: 'Retry' })).toHaveAttribute('type', 'button');
  });

  it('Retry asks again', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ reason: 'unreachable' }), { status: 502 }));
    const user = userEvent.setup();
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await screen.findByRole('button', { name: 'Retry' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
describe('it asks once per session', () => {
  // There is no mount event under mount-and-hide -- every area is mounted
  // from the first render -- so `active` is the only signal that means "she
  // is looking at this". Without the ref latch, every return visit would be
  // another Cloudflare API call.
  //
  // Mutation this guards: remove the useRef latch -- the second render with
  // `active` true fires a second request and this goes red.
  it('does not fetch until it is the visible area, and never twice', async () => {
    const fetchImpl = okFetch(ZERO_DATA_PAYLOAD);
    const registry = fakeRegistry();
    const { rerender } = render(
      <NumbersArea active={false} registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    rerender(<NumbersArea active registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    // Away, and back.
    rerender(<NumbersArea active={false} registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    rerender(<NumbersArea active registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
describe('a 200 that is not the shape this screen renders', () => {
  // Collapsing a malformed answer into "nothing to report" reports the most
  // reassuring state possible at exactly the wrong moment -- the same
  // refusal worker/status.ts already documents for Cloudflare's REST
  // `success: false`. Here it would also throw mid-render on the first
  // `undefined.toLocaleString()`, costing the whole area rather than a card.
  it('is an error, not an empty state, and does not throw', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nonsense: true }), { status: 200 }));
    renderNumbers(fetchImpl as unknown as typeof fetch);

    expect(await screen.findByText("The visitor numbers aren't connected yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Visitor counting started on/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('under StrictMode, which is how this really runs', () => {
  // src/main.tsx wraps the whole app in <StrictMode>, so in development React
  // mounts, unmounts and remounts every component. A `cancelled` flag scoped
  // to one effect run interacts with the once-per-session latch in exactly
  // the wrong way: the FIRST run starts the one request the latch allows and
  // its cleanup discards the answer, while the second run returns early
  // because the latch is already set -- and the screen sits on "Loading…"
  // forever.
  //
  // Found in a real browser by this screen's e2e case, then pinned here.
  // Mutation this guards: go back to a per-run `cancelled` flag -- red.
  it('still shows the answer after React remounts it', async () => {
    const fetchImpl = okFetch(ZERO_DATA_PAYLOAD);
    render(
      <StrictMode>
        <NumbersArea active registry={fakeRegistry()} fetchImpl={fetchImpl as unknown as typeof fetch} />
      </StrictMode>,
    );

    expect(await screen.findByText(/Visitor counting started on/)).toBeInTheDocument();
    // And still exactly one request, which is the other half of the latch.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
