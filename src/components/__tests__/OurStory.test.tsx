import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  // Scoped to the carousel, not to the whole section. Before Phase 4 this
  // counted every <img> on the page and that happened to equal the carousel
  // length; the byline portrait is now a second kind of image in the same
  // section, so an unscoped count would have had to be bumped to
  // `length + 1` -- a number that stays correct no matter what goes wrong
  // with the portrait, i.e. an assertion that could no longer fail for its
  // stated reason.
  it('carousel images come from content, not a filename list', () => {
    const { container } = render(<OurStory />);
    const carousel = container.querySelector('[data-testid="our-story-carousel"]');
    expect(carousel).not.toBeNull();
    const images = within(carousel as HTMLElement).getAllByRole('img');
    expect(images).toHaveLength(galleries.ourStory.length);
    images.forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Slide \d+$/);
    });
  });

  describe('the chef byline', () => {
    it('names her and says what she is', () => {
      render(<OurStory />);
      const byline = screen.getByTestId('chef-byline');
      expect(within(byline).getByText(story.chef.name)).toBeInTheDocument();
      expect(within(byline).getByText(story.chef.role)).toBeInTheDocument();
    });

    it('shows her portrait, from content, with her own description of it', () => {
      render(<OurStory />);
      const portrait = screen.getByTestId('chef-portrait');
      expect(portrait).toHaveAttribute('src', story.chef.portrait);
      expect(portrait).toHaveAttribute('alt', story.chef.portraitAlt);
    });

    // The portrait is the last thing on the page's eighth section. Eager
    // loading it would put a 114KB request on the critical path for an
    // image almost nobody scrolls to.
    it('defers the portrait until it is scrolled to', () => {
      render(<OurStory />);
      expect(screen.getByTestId('chef-portrait')).toHaveAttribute('loading', 'lazy');
    });

    // The byline sits BELOW the prose, not above it: the paragraphs are
    // already written in her voice, so the signature belongs at the end of
    // the letter. Asserted by document order rather than by a class name,
    // which would survive a reorder.
    it('sits after the last paragraph', () => {
      render(<OurStory />);
      const lastParagraph = screen.getByText(story.paragraphs[story.paragraphs.length - 1]);
      const byline = screen.getByTestId('chef-byline');
      expect(lastParagraph.compareDocumentPosition(byline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
