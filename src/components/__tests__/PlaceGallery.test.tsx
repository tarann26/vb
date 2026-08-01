import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlaceGallery from '../PlaceGallery';
import { galleries } from '../../content';

describe('PlaceGallery', () => {
  it('renders one image per atmosphere entry', () => {
    render(<PlaceGallery />);
    expect(screen.getAllByRole('img')).toHaveLength(galleries.atmosphere.length);
  });

  it('uses descriptive alt text, not positional labels', () => {
    render(<PlaceGallery />);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Place \d+$/);
    });
  });

  it('never emits a /public/ src', () => {
    render(<PlaceGallery />);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('src')).not.toContain('/public/');
    });
  });
});
