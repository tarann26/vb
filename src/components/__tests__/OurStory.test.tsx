import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OurStory from '../OurStory';
import { story, galleries } from '../../content';

describe('OurStory', () => {
  it('has no truncated placeholder paragraphs', () => {
    story.paragraphs.forEach((p) => {
      expect(p.trim().endsWith('...')).toBe(false);
      expect(p.trim().endsWith('…')).toBe(false);
    });
  });

  it('renders every paragraph', () => {
    render(<OurStory />);
    story.paragraphs.forEach((p) => {
      expect(screen.getByText(p)).toBeInTheDocument();
    });
  });

  it('carousel images come from content, not a filename list', () => {
    render(<OurStory />);
    expect(screen.getAllByRole('img')).toHaveLength(galleries.ourStory.length);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Slide \d+$/);
    });
  });
});
