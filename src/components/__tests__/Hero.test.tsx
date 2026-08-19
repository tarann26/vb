import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { copy, galleries, site } from '../../content';
import { collagePhotos, countCollagePhotos, collageDepth, MAX_COLLAGE_DEPTH, MAX_COLLAGE_PHOTOS } from '../../content/collage';

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

  // The collage used to be sixteen Tailwind grid-placement strings, and these
  // tests used to be about whether each one resolved inside the six explicit
  // rows and columns. It is a tree of splits now: a photo cannot be
  // "off-grid", because there is no grid and no coordinate to be wrong -- a
  // box is wherever its parent split puts it, by construction. What is left
  // to check is what the tree renders INTO, which is nested flex containers,
  // and jsdom can see the DOM even though it cannot lay it out. The
  // properties that need a layout engine -- that a 1:1 split really does
  // produce two equal boxes, whatever is inside them -- are in
  // e2e/hero-collage.spec.ts against real Chromium, deliberately not here.
  describe('the collage tree', () => {
    it('renders one <img> per photo in the real tree, in document order', () => {
      const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
      const tree = galleries.heroCollage;
      expect(tree).not.toBeNull();
      const photos = collagePhotos(tree!);
      const collage = container.querySelector('.absolute.inset-0.flex');
      expect(collage).not.toBeNull();
      const rendered = Array.from(collage!.querySelectorAll('img')).map((img) => img.getAttribute('src'));
      expect(rendered).toEqual(photos.map((photo) => photo.src));
    });

    // Every photo box is a flex ITEM of its parent split and every split is a
    // flex CONTAINER, and both carry their size inline rather than as a class
    // name -- which is the whole reason the placement strings went away. A
    // regression to a generated class name would leave the numbers below
    // absent from the DOM entirely.
    it('sizes every box with an inline grow factor and a zero basis, never a class name', () => {
      const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
      const collage = container.querySelector('.absolute.inset-0.flex');
      const boxes = Array.from(collage!.querySelectorAll('div'));
      expect(boxes.length).toBeGreaterThan(0);
      boxes.forEach((box) => {
        const style = (box as HTMLElement).style;
        expect(Number(style.flexGrow)).toBeGreaterThan(0);
        expect(style.flexBasis).toBe('0px');
      });
      expect(container.innerHTML).not.toMatch(/col-start-|col-span-|row-start-|row-span-/);
    });

    // The root's own children are the first cut through the hero; a split
    // renders as a flex container in its own direction, so this is the one
    // structural fact the DOM makes visible without a layout engine.
    it('renders a split as a flex container in its own direction', () => {
      const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
      const rows = container.querySelectorAll('.flex.flex-row.gap-1');
      const columns = container.querySelectorAll('.flex.flex-col.gap-1');
      expect(rows.length).toBeGreaterThan(0);
      expect(columns.length).toBeGreaterThan(0);
    });

    // Pinned against the REAL committed content, so this fails the moment the
    // arrangement and this file drift apart in either direction. Task 6
    // dropped the five Farfalle photos (sixteen down to eleven), which also
    // shed one level of nesting off the deepest branch.
    it('the committed collage holds eleven photos, within the cap and the depth limit', () => {
      const tree = galleries.heroCollage!;
      expect(countCollagePhotos(tree)).toBe(11);
      expect(countCollagePhotos(tree)).toBeLessThanOrEqual(MAX_COLLAGE_PHOTOS);
      expect(collageDepth(tree)).toBe(5);
      expect(collageDepth(tree)).toBeLessThanOrEqual(MAX_COLLAGE_DEPTH);
    });
  });

  // The Reserve a Table button is the single action on this site that turns
  // into revenue -- worker/index.ts's POST /api/wa exists to count taps on
  // it server-side. These three tests each guard one property the
  // implementation (Hero.tsx's openReservationWhatsApp) promises: the
  // WhatsApp link opening must never depend on, be delayed by, or be broken
  // by the beacon that counts the tap.
  //
  // This block was removed by owner request on 2026-08-17 (the button's
  // only render call site left Hero.tsx) and restored on 2026-08-18 when
  // the owner reversed that request. Back to its pre-removal form, unchanged.
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
