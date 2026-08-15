import { describe, expect, it } from 'vitest';
import sections from '../content/sections.json';
import copy from '../content/copy.json';
import story from '../content/story.json';

describe('homepage section order', () => {
  it('leads with the food and puts the story last before Visit', () => {
    // The PR head's note: atmosphere, food, then drinks come first. Taran's:
    // About moves towards the bottom. Both are satisfied by this order.
    expect(sections.map((s) => s.id)).toEqual([
      'hero', 'atmosphere', 'food', 'drinks', 'press', 'ourStory', 'visit',
    ]);
  });

  it('keeps every section enabled', () => {
    expect(sections.every((s) => s.enabled)).toBe(true);
  });
});

describe('the story section presents as About', () => {
  it('headings say About, not Our Story', () => {
    expect(story.heading).toBe('About');
  });

  it('the nav calls it About and places it after the menu', () => {
    const labels = copy.nav.links.map((l) => l.label);
    expect(labels).toContain('About');
    expect(labels).not.toContain('Our Story');
    expect(labels.indexOf('About')).toBeGreaterThan(labels.indexOf('Menu'));
  });

  it('keeps the section id and the live anchor unchanged', () => {
    // Both are load-bearing and independently so. The id is also the
    // galleries.ourStory key and the galleries.ourStory.N editable path;
    // the anchor is a URL someone may have bookmarked.
    const link = copy.nav.links.find((l) => l.label === 'About');
    expect(link?.section).toBe('ourStory');
    expect(link?.href).toBe('#our-story');
  });
});
