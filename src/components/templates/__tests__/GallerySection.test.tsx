import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GallerySection from '../GallerySection';

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
