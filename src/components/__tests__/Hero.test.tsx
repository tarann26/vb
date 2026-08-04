import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { copy, galleries, site } from '../../content';
import { GRID_SIZE, isOnGrid, parsePlacement, resolveLayout } from '../../content/placement';

describe('Hero', () => {
  it('has exactly one h1, and it is the page heading rather than the logo', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(site.name);
    // Anchor to the decorative logo circle's structural class rather than to
    // aria-hidden's presence: pre-fix, the circle carries no aria-hidden at
    // all, so a check keyed on that attribute is satisfied vacuously in both
    // the buggy and fixed markup. `.rounded-full` is the one stable handle
    // on the circle (the only rounded-full element in Hero.tsx) and its
    // relationship to the h1 genuinely differs between the two states: the
    // h1 used to live inside it, now it is a sibling below it.
    const circle = container.querySelector('.rounded-full');
    expect(circle?.getAttribute('aria-hidden')).toBe('true');
    expect(h1s[0].closest('.rounded-full')).toBeNull();
  });

  // The strapline used to be hardcoded here while site.strapline was pinned
  // to index.html, so an editor who changed site.json got a red test naming
  // index.html, fixed that one file, went green -- and the sentence a
  // visitor actually sees stayed the old one. This asserts the rendered
  // sentence is the content-layer sentence, with the non-breaking spaces
  // that keep it from wrapping mid-phrase.
  it('renders site.strapline, non-breaking, rather than a hardcoded copy', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const text = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
    expect(text).toContain(site.strapline.replace(/ /g, '\u00A0'));
    // The plain-space form must not appear: that would mean the nbsp
    // substitution was dropped and the phrase can now wrap.
    expect(text).not.toContain(site.strapline);
  });

  it('never renders an image with an empty src', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const images = Array.from(container.querySelectorAll('img'));
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => {
      expect(img.getAttribute('src')).toBeTruthy();
    });
  });

  // Replaces the old "places every collage image in a distinct grid cell"
  // test (and its two supporting fixtures below) -- review finding C3: that
  // test built its key as `${col-start}:${row-start}` and never read spans
  // at all, so it accepted a tile sitting entirely INSIDE another (distinct
  // keys, real overlap, false pass) and refused two tiles that never touch
  // but happen to auto-place into different rows with the same key (same
  // key, no real collision, false fail). It was written to catch an
  // authoring mistake in a hand-edited file, back when a developer was the
  // only editor -- once she is the editor (Tasks 3/4) it would silently
  // revert her drags. Overlap is a legitimate thing to want in a photo
  // collage and CSS grid already handles it; what actually breaks the page
  // is a tile resolving outside the six explicit rows/columns
  // `grid-rows-6`/`grid-cols-6` declare, where Hero.tsx's own
  // `overflow-hidden` (line 57) clips it. `resolveLayout` -- the same
  // function `validateContent` (src/content/validate.ts) calls -- is what
  // decides that here, so this test and the server-side validator cannot
  // disagree about what "off grid" means by construction.
  describe('collage placement', () => {
    it('every real heroCollage className parses -- a garbled one would silently auto-place instead of failing loudly', () => {
      galleries.heroCollage.forEach(({ className }) => {
        expect(parsePlacement(className)).not.toBeNull();
      });
    });

    // This is the live defect this plan's own Task 2 repairs, proven here
    // rather than merely described: entry 4 (`/hero/farfalle4.webp`,
    // `col-start-3 col-span-2 row-span-1`, no `row-start`) resolves into an
    // implicit SEVENTH row -- outside `grid-rows-6` -- because by the time
    // the sparse auto-placement cursor reaches it, columns 3-4 are already
    // occupied in every one of the six explicit rows. Every other entry
    // already resolves on-grid today; only entry 4 does not. Once Task 2
    // gives entry 4 an explicit row start pinning it to the collage's first
    // row, this assertion becomes false and must be updated to "every entry
    // is on-grid" -- it is
    // deliberately pinned to today's real, uncorrected content so it fails
    // the moment that content and this test's own expectation drift apart
    // in either direction, rather than silently describing a bug that was
    // already fixed out from under it.
    it('today, entry 4 is the one real tile that resolves into an implicit row -- every other entry is on-grid', () => {
      const resolved = resolveLayout(galleries.heroCollage.map((tile) => parsePlacement(tile.className)));
      resolved.forEach((placement, i) => {
        if (i === 4) {
          expect(isOnGrid(placement)).toBe(false);
        } else {
          expect(isOnGrid(placement)).toBe(true);
        }
      });
    });

    // Closes the old test's first blind spot: a tile sitting entirely
    // INSIDE another must be accepted, not refused -- she is arranging a
    // photo collage, and overlapping tiles are a legitimate thing to want.
    it('does not refuse a tile that sits entirely inside another -- overlap is allowed', () => {
      const resolved = resolveLayout([
        parsePlacement('col-start-3 col-span-2 row-start-2 row-span-2'),
        parsePlacement('col-start-3 col-span-1 row-start-2 row-span-1'), // inside the first
      ]);
      resolved.forEach((placement) => expect(isOnGrid(placement)).toBe(true));
    });

    // Closes the old test's second blind spot: two tiles that auto-place
    // into different rows and never touch must not be refused just because
    // the OLD test's key (`${col-start}:${row-start}`) happened to collide
    // (both entries here have no col-start/row-start at all -- the exact
    // shape that produced a false failure before).
    it('does not false-positive when multiple entries are auto-placed into different rows', () => {
      const resolved = resolveLayout([
        parsePlacement('col-start-5 col-span-2 row-span-2'),
        parsePlacement('col-span-2 row-span-2'),
        parsePlacement('col-span-2 row-span-1'),
      ]);
      resolved.forEach((placement) => expect(isOnGrid(placement)).toBe(true));
    });

    // Proves this test would actually catch a real, page-breaking layout --
    // a tile whose own declared span is wider than the grid can never
    // resolve on-grid no matter where it lands.
    it('refuses a placement whose span alone cannot fit on the grid', () => {
      const [resolved] = resolveLayout([parsePlacement(`col-span-${GRID_SIZE + 1} row-span-1`)]);
      expect(isOnGrid(resolved)).toBe(false);
    });
  });

  // The Reserve a Table button is the single action on this site that turns
  // into revenue -- worker/index.ts's POST /api/wa exists to count taps on
  // it server-side. These three tests each guard one property the
  // implementation (Hero.tsx's openReservationWhatsApp) promises: the
  // WhatsApp link opening must never depend on, be delayed by, or be broken
  // by the beacon that counts the tap.
  describe('the Reserve a Table button', () => {
    afterEach(() => {
      // Restores navigator.sendBeacon to jsdom's own natural state --
      // absent -- so a stub or spy installed by one test here can never
      // leak into a later one, in this file or (since jsdom's window is
      // fresh per test file, not per test) any other.
      vi.restoreAllMocks();
      delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
    });

    function renderHero() {
      return render(
        <MemoryRouter>
          <Hero />
        </MemoryRouter>,
      );
    }

    // Review finding: the two tests below used to assert only
    // `openSpy.toHaveBeenCalledWith(...)` -- true regardless of what the
    // beacon code does, since window.open is the handler's first statement
    // and nothing after it can ever un-call something that already ran.
    // Deleting Hero.tsx's try/catch, or its `?.`, left both tests green.
    //
    // React does not let a thrown event handler crash the click: in a dev
    // build, `invokeGuardedCallbackDev` re-dispatches the handler through a
    // throwaway DOM node so the browser's own uncaught-exception reporting
    // produces a proper stack trace, rather than rethrowing synchronously
    // out of `fireEvent.click` itself (confirmed directly -- a `try/catch`
    // wrapped around `fireEvent.click` never observes the throw). jsdom
    // reports that the same way a real browser would: as an `error` event
    // dispatched on `window`, which nothing in a passing run of this file
    // should ever produce. Tracking that event is what lets these two
    // tests tell "the beacon's failure was contained" apart from "the
    // beacon's failure merely didn't stop window.open, but leaked past
    // openReservationWhatsApp anyway" -- the second of which is not what
    // "never lets a broken beacon affect the click" (Hero.tsx's own
    // comment) promises.
    function trackUncaughtErrors(): { events: ErrorEvent[]; stop: () => void } {
      const events: ErrorEvent[] = [];
      const onError = (event: ErrorEvent) => {
        events.push(event);
      };
      window.addEventListener('error', onError);
      return { events, stop: () => window.removeEventListener('error', onError) };
    }

    it('still opens WhatsApp when navigator.sendBeacon throws, and the throw never escapes as an uncaught error', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: vi.fn(() => {
          throw new Error('beacon failed');
        }),
        configurable: true,
      });
      const uncaught = trackUncaughtErrors();

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));
      uncaught.stop();

      expect(openSpy).toHaveBeenCalledWith(
        `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
        '_blank',
        'noopener',
      );
      // Confirmed directly: deleting Hero.tsx's try/catch around the
      // beacon call (leaving `navigator.sendBeacon?.('/api/wa');` bare)
      // leaves the assertion above green -- window.open already ran -- but
      // turns this one red, with jsdom reporting the escaped
      // `Error: beacon failed` as an uncaught `window` error event. That is
      // the one thing distinguishing "contained" from "merely didn't stop
      // window.open" that the assertion above cannot see on its own.
      expect(uncaught.events).toEqual([]);
    });

    // jsdom has no navigator.sendBeacon at all by default -- a test that
    // merely clicks the button under jsdom's own untouched navigator would
    // pass whether or not Hero.tsx guards this case, proving nothing about
    // the implementation. Deleting the property explicitly, immediately
    // before clicking, makes the precondition part of the test itself
    // rather than an accident of the environment.
    it('still opens WhatsApp when navigator.sendBeacon is undefined', () => {
      delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
      expect(window.navigator.sendBeacon).toBeUndefined();
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      const uncaught = trackUncaughtErrors();

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));
      uncaught.stop();

      expect(openSpy).toHaveBeenCalledWith(
        `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
        '_blank',
        'noopener',
      );
      // Kept for the same reason as the test above, but honestly: with
      // sendBeacon genuinely undefined, `navigator.sendBeacon?.(...)` and a
      // bare `navigator.sendBeacon(...)` wrapped in the try/catch produce
      // an IDENTICAL outcome -- neither one throws anywhere an observer can
      // see, because `?.` short-circuits before any call is attempted at
      // all. Confirmed directly, twice: deleting just the `?.` (try/catch
      // left in place) leaves this event array empty, because the
      // resulting TypeError is still caught by the same catch that
      // protects the *other* test above; deleting the try/catch too
      // (nothing left but `navigator.sendBeacon?.('/api/wa');`) ALSO
      // leaves it empty, because `?.` never attempts the call in the first
      // place when sendBeacon is undefined -- there is nothing for a
      // missing catch to fail to catch. A bare `catch {}` with no binding
      // discards the error it catches entirely, so nothing distinguishes
      // "never threw" from "threw and was silently absorbed" from outside
      // the function. This assertion is real (it would catch a REAL
      // regression -- sendBeacon undefined suddenly throwing past this
      // handler) but it is not, and cannot be, a test that specifically
      // kills a deleted `?.` while the try/catch survives it -- that
      // mutation has no externally observable effect at all under this
      // precondition, and no test written against this component's public
      // behavior can prove otherwise.
      expect(uncaught.events).toEqual([]);
    });

    // fireEvent.click, not userEvent.click: user-event deliberately spreads
    // a click across several awaited steps even for one click, so checking
    // an assertion right after it without awaiting would prove nothing
    // about synchronicity either way. fireEvent.click dispatches the DOM
    // event (and therefore React's handler) synchronously, so this
    // assertion -- made with no `await` between the click and the check --
    // genuinely fails if the handler ever put so much as one `await` ahead
    // of window.open, which would delay the WhatsApp link behind the beacon.
    it('calls window.open synchronously in the same tick as the click, never delayed by the beacon', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: vi.fn(() => true),
        configurable: true,
      });

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));

      // No `await`, no `waitFor` above this line -- if window.open had not
      // already run by here, this fails.
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    // Review finding: the previous test above proves window.open ran by a
    // certain point in time, but says nothing about its position relative
    // to the beacon call -- a handler that fires sendBeacon FIRST and
    // window.open second, with the try/catch left in place, still passes
    // every test above: the try/catch swallows whatever the beacon does,
    // and window.open still eventually runs before the assertion. That
    // reordering defeats the whole point of this button (see
    // openReservationWhatsApp's own comment: "window.open runs first,
    // synchronously, as the very first statement") with every other test
    // in this file green. This test catches reordering specifically, by
    // recording the actual sequence both mocks ran in rather than only
    // whether each ran at all.
    // Whole-branch review, M5: none of the tests above inspect what URL the
    // beacon actually fires at, only whether `sendBeacon` was called at all.
    // Confirmed directly: changing the literal in Hero.tsx from '/api/wa' to
    // '/api/whatsapp' -- worker/index.ts's route stays at '/api/wa' -- left
    // every test above green, since sendBeacon is fire-and-forget and none
    // of them read its argument. That mismatch is silent in production too:
    // the beacon still "succeeds" (fire-and-forget, no response ever read),
    // and the one revenue metric this route exists to produce reads zero
    // forever, with no other signal anything is wrong.
    it('fires the beacon at /api/wa, matching worker/index.ts\'s POST route', () => {
      const beaconSpy = vi.fn(() => true);
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: beaconSpy,
        configurable: true,
      });
      vi.spyOn(window, 'open').mockReturnValue(null);

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));

      expect(beaconSpy).toHaveBeenCalledWith('/api/wa');
    });

    it('calls window.open before firing the beacon -- not merely both, but in that order', () => {
      const order: string[] = [];
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
        order.push('open');
        return null;
      });
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: vi.fn(() => {
          order.push('sendBeacon');
          return true;
        }),
        configurable: true,
      });

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['open', 'sendBeacon']);
    });
  });
});
