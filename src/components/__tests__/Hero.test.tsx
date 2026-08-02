import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { galleries, site } from '../../content';

describe('Hero', () => {
  it('has exactly one h1, and it is the page heading rather than the logo', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(site.name);
    expect(h1s[0].closest('[aria-hidden="true"]')).toBeNull();
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
});
