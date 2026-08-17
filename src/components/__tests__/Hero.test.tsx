import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { galleries, site } from '../../content';
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

  // The Reserve a Table button (and the WhatsApp-opening handler it alone
  // triggered) was removed from Hero.tsx by owner request, 2026-08-17 --
  // see .superpowers/sdd/2026-08-17-phase-5b-block-editor/owner-request-1-brief.md.
  // The six tests that used to live in this block (`getByRole('button', {
  // name: copy.hero.reserveButton })`, three properties of the now-deleted
  // `openReservationWhatsApp`) tested a control that no longer renders --
  // removed along with it rather than left red against a button that
  // cannot be found. `copy.hero.reserveButton` itself is untouched (its
  // COPY_FIELDS entry stays -- deleting it would drop the value on the
  // owner's next /edit publish), it just has no in-place control left in
  // NOT_EDITABLE_IN_PLACE_COPY_FIELDS (src/admin/editable-paths.ts).
});
