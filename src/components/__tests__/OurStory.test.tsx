import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OurStory from '../OurStory';
import { story, galleries } from '../../content';

describe('OurStory', () => {
  // "No trailing ellipsis" moved to src/content/validate.ts: it rejects a
  // bad story.json before the commit exists, rather than after the build
  // has already run against it.

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
