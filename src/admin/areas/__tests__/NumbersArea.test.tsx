// Every card as she reads it, from fixed payloads.
//
// Every one of these zero-data strings is the state this screen SHIPS in --
// the dataset was empty the day it was written and will be near-empty for a
// week or two. So they are pinned first, not last: the difference between
// "too early" and "broken" is the difference between her trusting this
// screen and deciding it does not work.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumbersArea from '../NumbersArea';
import { CAMPAIGN_CAVEAT, CAMPAIGN_VS_REFERRER, CARD_HEADINGS, archiveSentence } from '../../manage/analytics';
import { KNOWN_CAMPAIGN_SOURCES } from '../../../shared/campaign-sources';
import { ZERO_DATA_PAYLOAD, isAnalyticsRange } from '../../../shared/analytics-payload';
import type { AnalyticsPayload, AnalyticsRange } from '../../../shared/analytics-payload';
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
  vi.useRealTimers();
});

// The stat cards refuse to compare against a period that predates counting,
// which makes the DAY the test runs on part of what it asserts -- and today
// is inside the stretch where the real panel refuses. `toFake: ['Date']`
// only, so setTimeout stays real and Testing Library's findBy* still work.
function onDay(day: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T09:00:00.000Z`));
}

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
// Module scope rather than inside one describe: the campaign and
// busiest-times blocks below build their own fixtures from this one, and a
// second hand-typed "populated" payload is how two blocks come to disagree
// about what a populated screen looks like.
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
  // EARLIER THAN series[0], deliberately. These two used to hold the same
  // date, which made the trend caption green whether it read the drawn
  // series' first point or the archive's earliest row -- and it read the
  // wrong one. The real payload puts them apart from the archive's second
  // day onwards (ninety backfilled days under a thirty-day range), so the
  // fixture does too.
  seriesStartsOn: '2026-05-22',
});

describe('with real numbers', () => {
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

  // POPULATED leaves visitsPrevious and tapsPrevious at zero, so BOTH stat
  // cards fall into `direction: 'unknown'` and print the same sentence --
  // which means every assertion above this one survives the two mutations
  // that matter most here: swapping the two denominators, and swapping the
  // two units. Neither is arithmetic and neither lives in comparison.ts or
  // StatCard.tsx; both live in the four lines of JSX that decide WHICH
  // number each card divides by and WHICH noun it names. So the comparison
  // needs one fixture where the two cards cannot produce the same sentence:
  // distinct non-zero previous values, both above MIN_PREVIOUS_FOR_CHANGE,
  // giving percentages that are different from each other and different
  // from what the crossed wiring would produce (4100/470 is 772% and
  // 512/3300 is 84% fewer). These are e2e/edit-backend.ts's own numbers, so
  // the browser and jsdom are reading the same story.
  const WITH_HISTORY = payload({ ...POPULATED, visitsPrevious: 3300, tapsPrevious: 470 });

  it('each stat card compares its own number against its own previous, in its own unit', async () => {
    // Far enough past both counting-start dates that the whole of each
    // previous window was being counted -- otherwise the honest answer is
    // the refusal two cases below, and this wiring cannot be seen at all.
    onDay('2027-01-15');
    renderNumbers(okFetch(WITH_HISTORY) as unknown as typeof fetch);

    const visits = (await screen.findByText('Visits')).closest('div') as HTMLElement;
    expect(within(visits).getByText('about 4,100 visits')).toBeInTheDocument();
    expect(within(visits).getByText('24% more visits than the period before.')).toBeInTheDocument();

    const taps = screen.getByText('Reserve a Table').closest('div') as HTMLElement;
    expect(within(taps).getByText('at least 512 tapped Reserve a Table')).toBeInTheDocument();
    expect(within(taps).getByText('9% more taps than the period before.')).toBeInTheDocument();
  });

  // The comparison's other floor, and the one the count cannot see. At L+45
  // on a 30-day range the previous window is fifteen real days and fifteen
  // days of nothing, so 4,100 against 3,300 would print "24% more visits"
  // for a restaurant whose traffic did not move -- and the counting-started
  // banner that would explain it is suppressed the moment visits stop being
  // zero, so nothing on the screen would say why.
  it('refuses to compare against a period that predates counting', async () => {
    onDay('2026-10-02');
    renderNumbers(okFetch(WITH_HISTORY) as unknown as typeof fetch);

    const visits = (await screen.findByText('Visits')).closest('div') as HTMLElement;
    expect(within(visits).getByText('Not enough of the period before to compare visits against.')).toBeInTheDocument();
    expect(within(visits).queryByText(/% more visits/)).not.toBeInTheDocument();
  });

  // Taps have been counted since 7 August and visits only since the 18th, and
  // the windows are up to ninety days long, so there is a real stretch where
  // one card can honestly compare and the other cannot. A single flag for
  // both cards would have to be wrong on one of them, which is the shape of
  // the defect that put one counting-start date behind two questions.
  it('answers per measure, so the taps card can compare on a day the visits card cannot', async () => {
    // Taps: 2 x 28 days back is 2026-08-15, after 7 August -- whole.
    // Visits: 2 x 30 days back is 2026-08-11, before 18 August -- not.
    onDay('2026-10-10');
    renderNumbers(okFetch(WITH_HISTORY) as unknown as typeof fetch);

    const taps = (await screen.findByText('Reserve a Table')).closest('div') as HTMLElement;
    expect(within(taps).getByText('9% more taps than the period before.')).toBeInTheDocument();

    const visits = screen.getByText('Visits').closest('div') as HTMLElement;
    expect(within(visits).getByText('Not enough of the period before to compare visits against.')).toBeInTheDocument();
  });

  // The other half of the same wiring: with nothing behind it, the card says
  // so in the card's own words rather than printing a percentage off zero.
  it('says it cannot compare when the period before is empty', async () => {
    onDay('2027-01-15');
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);

    const visits = (await screen.findByText('Visits')).closest('div') as HTMLElement;
    expect(within(visits).getByText('Not enough of the period before to compare visits against.')).toBeInTheDocument();

    const taps = screen.getByText('Reserve a Table').closest('div') as HTMLElement;
    expect(within(taps).getByText('Not enough of the period before to compare taps against.')).toBeInTheDocument();
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
  // series and grain, and hands the caption BOTH dates -- the first point
  // drawn and the archive's earliest row. Passing a literal null for either
  // would leave the chart looking perfect and the sentence under it wrong,
  // and passing the archive's date as the chart's start is exactly the defect
  // POPULATED's two dates now hold apart.
  it('the trend card dates the chart from the series it draws, not from the archive', async () => {
    renderNumbers(okFetch(POPULATED) as unknown as typeof fetch);
    const card = (await screen.findByText(CARD_HEADINGS.trend)).closest('div') as HTMLElement;

    expect(within(card).getByRole('img', { name: 'Visits over the last 4 days, highest 200' })).toBeInTheDocument();
    expect(
      within(card).getByText('This chart begins on 20 July 2026. The record itself goes back to 22 May 2026.'),
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
// The card the whole write path exists for. Its EMPTY state is the
// deliverable: on the day it ships there are no tagged links in the world, so
// what the card does is teach her how to make one and which words the write
// path recognises.
describe('the campaign card', () => {
  function withCampaigns(campaigns: AnalyticsPayload['campaigns']) {
    return okFetch(payload({ ...POPULATED, campaigns })) as unknown as typeof fetch;
  }

  const INSTAGRAM = [{ source: 'instagram', label: 'Instagram link', arrivals: 84 }];

  it('shows each source with its exact count, in her words', async () => {
    renderNumbers(withCampaigns(INSTAGRAM));

    expect(await screen.findByText('Instagram link')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
    // The machine value never reaches the screen -- "instagram" beside a
    // referrer card that also says Instagram is the collision this avoids.
    expect(screen.queryByText('instagram')).toBeNull();
  });

  it('teaches her how to make a tagged link when there is nothing to show yet', async () => {
    renderNumbers(withCampaigns([]));
    expect(await screen.findByText(/utm_source=instagram/)).toBeInTheDocument();
  });

  it('lists the words the site actually recognises, so a wrong tag is discoverable', async () => {
    // Without this list she uses ?utm_source=insta, every arrival lands in
    // "other", and the card tells her Instagram brought nobody.
    //
    // Read off the ONE paragraph that carries the list, rather than searched
    // for anywhere on screen: the how-to sentence above it also contains the
    // word instagram, so an unscoped query would match two elements whether
    // or not the list is there -- and would then start PASSING the moment the
    // list was deleted. Exactly backwards.
    renderNumbers(withCampaigns([]));
    const words = await screen.findByText(/Words this site recognises/);
    for (const source of KNOWN_CAMPAIGN_SOURCES) {
      expect(words.textContent).toContain(source);
    }
  });

  it('says a tag is not a referrer, in both states', async () => {
    renderNumbers(withCampaigns([]));
    expect(await screen.findByText(CAMPAIGN_VS_REFERRER)).toBeInTheDocument();
    cleanup();

    renderNumbers(withCampaigns([{ source: 'other', label: 'Someone else’s link', arrivals: 12 }]));
    expect(await screen.findByText(CAMPAIGN_VS_REFERRER)).toBeInTheDocument();
  });

  it('says what it cannot tell her, on the card', async () => {
    renderNumbers(withCampaigns(INSTAGRAM));
    const card = (await screen.findByText(CARD_HEADINGS.campaigns)).closest('div') as HTMLElement;
    expect(within(card).getByText(CAMPAIGN_CAVEAT)).toBeInTheDocument();
  });

  it('groups everything she has not named into one row', async () => {
    renderNumbers(withCampaigns([{ source: 'other', label: 'Someone else’s link', arrivals: 12 }]));
    expect(await screen.findByText('Someone else’s link')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The busiest-times card is the ONE card here that can be absent. What it
// draws is pinned in src/admin/manage/__tests__/HoursChart.test.tsx; these two
// are about whether the card is on the screen at all, and the difference
// between the two payload values that decide it.
describe('the busiest-times card', () => {
  it('is not rendered at all when the site cannot answer the question', async () => {
    renderNumbers(okFetch(payload({ ...POPULATED, hourly: null })) as unknown as typeof fetch);

    // Waited on a sentence only the ANSWERED screen prints, never on a
    // heading -- and that choice was made by watching this test survive a
    // mutation it was written to catch. Every heading is on screen while the
    // request is still out, and a card handed a null it cannot read throws
    // mid-render, which under React leaves an EMPTY document. "The hours
    // heading is absent" is then true because the whole panel is gone, and a
    // test that waited on a heading would report that as a pass.
    expect(await screen.findByText('Busier than the week before — 312 visits, up from 240.')).toBeInTheDocument();
    expect(screen.queryByText(CARD_HEADINGS.hours)).toBeNull();
  });

  it('IS rendered, empty, when the week was simply quiet', async () => {
    renderNumbers(okFetch(payload({ ...POPULATED, hourly: [] })) as unknown as typeof fetch);

    expect(await screen.findByText(CARD_HEADINGS.hours)).toBeInTheDocument();
    const card = screen.getByText(CARD_HEADINGS.hours).closest('div') as HTMLElement;
    expect(within(card).getByRole('img', { name: /Indian time/ })).toBeInTheDocument();
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
// The range control. Everything here is about WHICH question the panel asks
// and WHOSE answer it paints; how the pills look, how big they are and
// whether one covers another is geometry, and lives in
// e2e/numbers-visuals.spec.ts.
describe('the range control', () => {
  // Which range a call asked for. Falls back to the default for anything
  // unrecognised, so a bogus parameter reaches the assertions in
  // "never sends a range the Worker does not know" rather than throwing here
  // and reporting as some other failure.
  function rangeOf(input: RequestInfo | URL): AnalyticsRange {
    const asked = new URL(String(input), 'http://dashboard.test').searchParams.get('range');
    return isAnalyticsRange(asked) ? asked : '30d';
  }

  // ECHOES the range it was asked for, because the real Worker does: the body
  // carries its own `range` so a body served under the wrong cache key is
  // visible rather than silently relabelled. A stub that answered every
  // question with the same label would be testing a Worker this project does
  // not have.
  function stubAnalytics(bodyFor: (range: AnalyticsRange) => Partial<AnalyticsPayload> = () => ({})) {
    return vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(payload({ ...POPULATED, ...bodyFor(rangeOf(input)), range: rangeOf(input) })), {
          status: 200,
        }),
    );
  }

  // A fetch that never settles: the state the control is in for as long as
  // the Worker is thinking, which on this route is up to ten seconds.
  function neverResolvingAnalytics() {
    return vi.fn(() => new Promise<Response>(() => undefined));
  }

  // Every request held open until the test says otherwise, and answerable in
  // any order. This is the only way to put two answers in flight at once and
  // decide which one lands second.
  function deferredAnalytics() {
    const waiting: { range: AnalyticsRange; settle: (body: Partial<AnalyticsPayload>) => void }[] = [];
    const impl = vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          const asked = rangeOf(input);
          waiting.push({
            range: asked,
            settle: (body) => {
              // `label` is what the BODY claims, which is not always what was
              // asked -- that is the whole point of the echo.
              const label = body.range ?? asked;
              resolve(new Response(JSON.stringify(payload({ ...POPULATED, ...body, range: label })), { status: 200 }));
            },
          });
        }),
    );
    async function answer(range: AnalyticsRange, body: Partial<AnalyticsPayload> = {}): Promise<void> {
      const index = waiting.findIndex((held) => held.range === range);
      expect(index, `no request is waiting for ${range}`).toBeGreaterThanOrEqual(0);
      const [held] = waiting.splice(index, 1);
      await act(async () => {
        held.settle(body);
        await Promise.resolve();
      });
    }
    return { impl, answer };
  }

  // Waits for the pill to be pressable before pressing it. React ignores a
  // click on a disabled control entirely, so a bare fireEvent against one
  // reports as "she pressed it and nothing happened" -- which is exactly the
  // defect a test here might be trying to catch, arriving as a false pass.
  async function pressRange(label: string): Promise<void> {
    const button = await screen.findByRole('button', { name: label });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    fireEvent.click(button);
  }

  it('starts on 30 days', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith('/api/analytics?range=30d');
    });
    expect(await screen.findByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  // PublishBar is one <form> wrapping this whole screen, and a bare <button>
  // inside a form defaults to type="submit".
  it('never submits the form it sits inside', async () => {
    renderNumbers(stubAnalytics() as unknown as typeof fetch);
    const group = await screen.findByRole('group', { name: 'How far back' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('asks the Worker for the range she picked', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await pressRange('Last 90 days');
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith('/api/analytics?range=90d');
    });
  });

  it('asks once per range per session, not once per click', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await pressRange('Last 90 days');
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    await pressRange('Last 30 days');
    await pressRange('Last 90 days');
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  // Not re-asking is only correct if the panel REMEMBERS. Without the stored
  // answer she gets the 90-day figures under a 30-day pill, which is the
  // exact mismatch the per-range cache key exists to prevent, arriving
  // through the front end instead.
  it('paints the numbers of the range she returned to, not the ones she left', async () => {
    const fetchImpl = stubAnalytics((range) => ({ visits: range === '90d' ? 900 : 4100 }));
    renderNumbers(fetchImpl as unknown as typeof fetch);
    expect(await screen.findByText('about 4,100 visits')).toBeInTheDocument();

    await pressRange('Last 90 days');
    expect(await screen.findByText('about 900 visits')).toBeInTheDocument();

    await pressRange('Last 30 days');
    expect(await screen.findByText('about 4,100 visits')).toBeInTheDocument();
    expect(screen.queryByText('about 900 visits')).toBeNull();
  });

  it('still asks only once when she never touches the control', async () => {
    // The ORIGINAL guarantee, re-pinned: a dashboard load costs no Cloudflare
    // call for a screen she does not open, and coming back to one she has
    // costs none either.
    const fetchImpl = stubAnalytics();
    const registry = fakeRegistry();
    const { rerender } = render(
      <NumbersArea active={false} registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const active of [true, false, true]) {
      rerender(<NumbersArea active={active} registry={registry} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    }
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  // TWO mechanisms close this, and they close different halves of it.
  //
  // The first is the disabled control below: while an answer is outstanding
  // she cannot start a second request, so two answers are never in flight at
  // once through the front end.
  //
  // The second is this one, and it is the half `disabled` cannot reach: the
  // ten-minute Cache API entry behind this route is keyed per range, and a
  // body served under the wrong key arrives labelled with the range it was
  // built for rather than the one that was asked. The panel refuses it
  // instead of relabelling 7 days as 90 -- which is the whole reason
  // AnalyticsPayload carries its own `range`.
  //
  // Refusing to PAINT it is only half of refusing it; the case below this one
  // covers the other half, and the two fail for different reasons.
  it('discards an answer for a range she is no longer looking at', async () => {
    const backend = deferredAnalytics();
    renderNumbers(backend.impl as unknown as typeof fetch);
    await backend.answer('30d', { visits: 4100 });
    expect(await screen.findByText('about 4,100 visits')).toBeInTheDocument();

    await pressRange('Last 90 days');
    // The answer to her 90-day question comes back carrying the 7-day label.
    await backend.answer('90d', { range: '7d', visits: 7 });

    expect(screen.queryByText('about 7 visits')).toBeNull();
    expect(screen.queryByText('about 4,100 visits')).toBeNull();
  });

  // The other half of that refusal, and it is the half that decides whether
  // she ever sees the refused number. Refusing to PAINT a body and refusing
  // to KEEP it are two separate decisions: the panel remembers each range's
  // answer and replays it whenever she opens this area, so a body that was
  // refused but kept is handed back to her on the next visit, under the pill
  // that refused it. The area nav is not disabled while a range loads, so
  // "the next visit" is one click away the whole time.
  it('does not hand back a refused answer when she leaves the area and returns', async () => {
    const backend = deferredAnalytics();
    const registry = fakeRegistry();
    const impl = backend.impl as unknown as typeof fetch;
    const view = render(<NumbersArea active registry={registry} fetchImpl={impl} />);
    await backend.answer('30d', { visits: 4100 });
    expect(await screen.findByText('about 4,100 visits')).toBeInTheDocument();

    await pressRange('Last 90 days');
    // Her 90-day question, answered with a body carrying the 7-day label.
    await backend.answer('90d', { range: '7d', visits: 7 });
    expect(screen.queryByText('about 7 visits')).toBeNull();

    // She clicks Pages, then clicks Numbers again.
    view.rerender(<NumbersArea active={false} registry={registry} fetchImpl={impl} />);
    view.rerender(<NumbersArea active registry={registry} fetchImpl={impl} />);

    // Still on the range she chose, and still without an answer for it.
    expect(screen.getByRole('button', { name: 'Last 90 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('about 7 visits')).toBeNull();
    expect(screen.queryByText(/visits$/)).toBeNull();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
  });

  it('cannot be pressed while a request is in flight', async () => {
    renderNumbers(neverResolvingAnalytics() as unknown as typeof fetch);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeDisabled();
    });
  });

  // The other half of the same claim, and the reason the race above cannot be
  // reached from the front end: a pill she cannot press starts nothing.
  it('starts no second request while the first is still out', async () => {
    const fetchImpl = neverResolvingAnalytics();
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('never sends a range the Worker does not know', async () => {
    const fetchImpl = stubAnalytics(() => ({ yearAvailable: true }));
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await screen.findByRole('button', { name: 'By year' });
    for (const label of ['Last 7 days', 'Last 90 days', 'By year']) {
      await pressRange(label);
    }
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });
    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\/analytics\?range=(7d|30d|90d|year)$/);
    }
  });

  it('offers no By year button until the archive holds something', async () => {
    renderNumbers(stubAnalytics(() => ({ yearAvailable: false })) as unknown as typeof fetch);
    expect(await screen.findByRole('button', { name: 'Last 90 days' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'By year' })).toBeNull();
  });

  it('offers it once the archive does', async () => {
    renderNumbers(stubAnalytics(() => ({ yearAvailable: true })) as unknown as typeof fetch);
    expect(await screen.findByRole('button', { name: 'By year' })).toBeInTheDocument();
  });

  it('says the breakdown is not KEPT by year, rather than saying nobody visited', async () => {
    const fetchImpl = stubAnalytics((range) =>
      range === 'year' ? { yearAvailable: true, byPath: [], byReferer: [] } : { yearAvailable: true },
    );
    renderNumbers(fetchImpl as unknown as typeof fetch);
    await pressRange('By year');

    const pages = (await screen.findByText(CARD_HEADINGS.b)).closest('div') as HTMLElement;
    expect(within(pages).getByText(archiveSentence())).toBeInTheDocument();
    const sources = screen.getByText(CARD_HEADINGS.c).closest('div') as HTMLElement;
    expect(within(sources).getByText(archiveSentence())).toBeInTheDocument();

    expect(screen.queryByText(/Nothing to rank yet/)).toBeNull();
    expect(screen.queryByText(/this will show whether people found you/)).toBeNull();
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
