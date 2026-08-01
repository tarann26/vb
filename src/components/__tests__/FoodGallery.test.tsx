import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FoodGallery from '../FoodGallery';
import { dishes } from '../../content';

describe('FoodGallery', () => {
  it('renders one card per dish', () => {
    render(<FoodGallery />);
    expect(screen.getAllByRole('img')).toHaveLength(dishes.length);
  });

  it('shows no filename-derived names', () => {
    render(<FoodGallery />);
    dishes.forEach((dish) => {
      expect(dish.name).not.toMatch(/^(Idk|Pizza)\d+$/);
      expect(dish.name).not.toMatch(/\.(jpg|JPG|png)$/i);
      expect(screen.getByText(dish.name)).toBeInTheDocument();
    });
  });

  it('gives every dish a non-empty description', () => {
    dishes.forEach((dish) => {
      expect(dish.description.trim().length).toBeGreaterThan(0);
    });
  });

  it('uses the dish name as alt text', () => {
    render(<FoodGallery />);
    dishes.forEach((dish) => {
      expect(screen.getByAltText(dish.name)).toBeInTheDocument();
    });
  });
});
