import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ItemListSection from '../ItemListSection';
import type { ItemListTemplateContent } from '../../../content/types';

const CONTENT: ItemListTemplateContent = {
  heading: 'Breads & Dips',
  items: [
    { image: '/food/focaccia.webp', name: 'Focaccia', description: 'Herbed and olive-oiled.' },
    { image: '/food/hummus.webp', name: 'Hummus', description: 'Smooth and lemony.' },
  ],
};

describe('ItemListSection', () => {
  it('renders the heading and every item\'s name, description and image', () => {
    render(<ItemListSection id="breads-and-dips" content={CONTENT} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Breads & Dips' })).toBeInTheDocument();
    expect(screen.getByText('Focaccia')).toBeInTheDocument();
    expect(screen.getByText('Herbed and olive-oiled.')).toBeInTheDocument();
    expect(screen.getByText('Hummus')).toBeInTheDocument();
    expect(screen.getByText('Smooth and lemony.')).toBeInTheDocument();

    const images = screen.getAllByRole('img');
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['/food/focaccia.webp', '/food/hummus.webp']);
    // alt text comes from the item's own name, matching FoodGallery's own
    // dish-card convention (Dish.image's alt is dish.name).
    expect(images.map((img) => img.getAttribute('alt'))).toEqual(['Focaccia', 'Hummus']);
  });

  it('never renders an image with an empty src', () => {
    render(<ItemListSection id="breads-and-dips" content={CONTENT} />);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('src')).not.toBe('');
    });
  });

  it('renders no WhatsApp button when the section has none, and shows it when present', () => {
    const { rerender } = render(<ItemListSection id="x" content={CONTENT} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <ItemListSection
        id="x"
        content={{ ...CONTENT, whatsapp: { label: 'Order breads and dips', message: 'Hi, I would like to order.' } }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Order breads and dips' })).toBeInTheDocument();
  });
});
