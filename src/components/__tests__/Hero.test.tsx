import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { galleries } from '../../content';

describe('Hero', () => {
  it('never renders an image with an empty src', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const images = Array.from(container.querySelectorAll('img'));
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => {
      expect(img.getAttribute('src')).toBeTruthy();
    });
  });

  it('places every collage image in a distinct grid cell', () => {
    const cells = galleries.heroCollage.map((i) => {
      const col = i.className.match(/col-start-\d+/)?.[0] ?? 'col-auto';
      const row = i.className.match(/row-start-\d+/)?.[0] ?? 'row-auto';
      return `${col}:${row}`;
    });
    expect(new Set(cells).size).toBe(cells.length);
  });
});
