import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { galleries, site } from '../../content';

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

  it('reports a conversion when the reservation button is used', async () => {
    const user = userEvent.setup();
    const beacon = vi.fn();
    vi.stubGlobal('__cfBeacon', { trackEvent: beacon });
    vi.stubGlobal('open', vi.fn());

    render(<MemoryRouter><Hero /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /reserve a table/i }));

    expect(beacon).toHaveBeenCalledWith('reservation_click');
    vi.unstubAllGlobals();
  });

  it('still opens whatsapp when analytics is unavailable', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.stubGlobal('__cfBeacon', undefined);

    render(<MemoryRouter><Hero /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /reserve a table/i }));

    expect(open).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
