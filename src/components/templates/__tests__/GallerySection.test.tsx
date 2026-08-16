import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GallerySection from '../GallerySection';
import { GALLERY_LAYOUTS } from '../../../content/guards';

const IMAGES = [
  { src: '/press/logo-a.webp', alt: 'Partner A logo' },
  { src: '/press/logo-b.webp', alt: 'Partner B logo' },
];

describe('GallerySection', () => {
  it('renders every image with its own src and alt, regardless of layout', () => {
    render(<GallerySection id="partners" content={{ heading: 'Our Partners', layout: 'scroll', images: IMAGES }} />);
    const images = screen.getAllByRole('img');
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['/press/logo-a.webp', '/press/logo-b.webp']);
    expect(images.map((img) => img.getAttribute('alt'))).toEqual(['Partner A logo', 'Partner B logo']);
  });

  // The merge decision (Task 2, Step 1): "logo grid" is this SAME
  // component, told apart only by `layout` -- proven here by asserting the
  // two layouts actually produce DIFFERENT markup for the identical image
  // list, not just that both happen to render something.
  it('layout: "scroll" wraps images in a horizontally-scrolling flex row', () => {
    const { container } = render(
      <GallerySection id="atmosphere-extra" content={{ heading: 'Gallery', layout: 'scroll', images: IMAGES }} />,
    );
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('layout: "grid" arranges images in a CSS grid, not a scroller', () => {
    const { container } = render(
      <GallerySection id="clients" content={{ heading: 'Our Clients', layout: 'grid', images: IMAGES }} />,
    );
    expect(container.querySelector('.grid')).not.toBeNull();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });

  // The layout that carries the cooking-class pamphlet. jsdom cannot say
  // how big it renders -- e2e/page-galleries.spec.ts measures that -- but it
  // CAN say the two properties that made the old rendering wrong are absent
  // from the markup: the 96px logo cell and the desaturation filter. Both
  // are class names on the wrapper in the grid branch, so their absence
  // here is a real, checkable difference rather than a restatement.
  it('layout: "hero" is neither the scroller nor the 96px grayscale logo cell', () => {
    const { container } = render(
      <GallerySection id="pamphlet" content={{ heading: 'Sunday, 12pm', layout: 'hero', images: [IMAGES[0]] }} />,
    );
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expect(container.querySelector('.grid')).toBeNull();
    expect(container.querySelector('.h-24')).toBeNull();
    expect(container.querySelector('.grayscale')).toBeNull();
    // And it is still the same testid contract every layout honours, so the
    // browser spec and the editor's own image list can find the image.
    expect(screen.getByTestId('gallery-image-pamphlet-0')).toBeInTheDocument();
  });

  // Guards the accepted-layout list against the renderer. GALLERY_LAYOUTS is
  // what guards.ts lets through and what GALLERY_LAYOUT_FIELD offers her in
  // the dashboard; a layout with no branch in this component renders an
  // empty section on her live site. Proven by markup, not by reading the
  // union type -- and the three-branch `&&` chain here has no `else`, so a
  // future fourth layout that nobody wires up fails this instead of
  // shipping blank.
  it('every layout guards.ts accepts renders its images', () => {
    const options = GALLERY_LAYOUTS;
    expect(options.length).toBe(3);
    for (const layout of options) {
      const { container, unmount } = render(
        <GallerySection id="probe" content={{ heading: 'Probe', layout, images: IMAGES }} />,
      );
      expect(container.querySelectorAll('img'), `layout "${layout}" rendered no images`).toHaveLength(IMAGES.length);
      unmount();
    }
  });

  it('renders the WhatsApp button only when the section content includes one', () => {
    const { rerender } = render(
      <GallerySection id="clients" content={{ heading: 'Our Clients', layout: 'grid', images: IMAGES }} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <GallerySection
        id="clients"
        content={{
          heading: 'Our Clients',
          layout: 'grid',
          images: IMAGES,
          whatsapp: { label: 'Partner with us', message: 'Hi, I would like to partner with Via Bianca.' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Partner with us' })).toBeInTheDocument();
  });
});
