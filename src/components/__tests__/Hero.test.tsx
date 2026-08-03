import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { copy, galleries, site } from '../../content';

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

  it('places every collage image in a distinct grid cell', () => {
    // Filter to only entries with at least one explicit placement (col-start or row-start).
    // Auto-placed entries (no explicit col or row) have no collision risk; CSS grid handles them.
    const explicitlyPlaced = galleries.heroCollage.filter((i) => {
      const hasCol = /col-start-\d+/.test(i.className);
      const hasRow = /row-start-\d+/.test(i.className);
      return hasCol || hasRow;
    });

    const cells = explicitlyPlaced.map((i) => {
      const col = i.className.match(/col-start-\d+/)?.[0];
      const row = i.className.match(/row-start-\d+/)?.[0];
      return `${col}:${row}`;
    });

    expect(new Set(cells).size).toBe(cells.length);
  });

  it('does not false-positive when multiple entries are auto-placed', () => {
    // Prove that auto-placed entries don't cause spurious collisions
    const fixture = [
      { src: '/hero/scene.png', className: 'col-start-5 col-span-2 row-span-2' },
      { src: '/hero/auto1.png', className: 'col-span-2 row-span-2' }, // auto-placed
      { src: '/hero/auto2.png', className: 'col-span-2 row-span-1' }, // also auto-placed, different span
    ];

    const explicitlyPlaced = fixture.filter((i) => {
      const hasCol = /col-start-\d+/.test(i.className);
      const hasRow = /row-start-\d+/.test(i.className);
      return hasCol || hasRow;
    });

    const cells = explicitlyPlaced.map((i) => {
      const col = i.className.match(/col-start-\d+/)?.[0];
      const row = i.className.match(/row-start-\d+/)?.[0];
      return `${col}:${row}`;
    });

    // Should pass: only the explicitly-placed entry is checked; auto-placed ones are skipped
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('detects when two entries occupy the same explicit grid cell', () => {
    // Prove that the test catches genuine collisions
    const fixture = [
      { src: '/hero/scene.png', className: 'col-start-3 col-span-1 row-start-2' },
      { src: '/hero/ceiling.png', className: 'col-start-3 col-span-1 row-start-2' }, // collision
    ];

    const explicitlyPlaced = fixture.filter((i) => {
      const hasCol = /col-start-\d+/.test(i.className);
      const hasRow = /row-start-\d+/.test(i.className);
      return hasCol || hasRow;
    });

    const cells = explicitlyPlaced.map((i) => {
      const col = i.className.match(/col-start-\d+/)?.[0];
      const row = i.className.match(/row-start-\d+/)?.[0];
      return `${col}:${row}`;
    });

    // Should fail: both entries map to the same cell
    expect(new Set(cells).size).not.toBe(cells.length);
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

    it('still opens WhatsApp when navigator.sendBeacon throws', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: vi.fn(() => {
          throw new Error('beacon failed');
        }),
        configurable: true,
      });

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));

      expect(openSpy).toHaveBeenCalledWith(
        `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
        '_blank',
        'noopener',
      );
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

      const { getByRole } = renderHero();
      fireEvent.click(getByRole('button', { name: copy.hero.reserveButton }));

      expect(openSpy).toHaveBeenCalledWith(
        `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
        '_blank',
        'noopener',
      );
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
  });
});
