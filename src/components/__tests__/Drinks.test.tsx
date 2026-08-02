import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Drinks from '../Drinks';
import { drinks, copy } from '../../content';
import type { Drink } from '../../content';

const CATEGORY_HEADING: Record<Drink['category'], string> = {
  mocktail: copy.drinks.mocktails,
  cocktail: copy.drinks.cocktails,
  wine: copy.drinks.wine,
};

describe('Drinks', () => {
  it('renders every drink name', () => {
    render(<Drinks />);
    drinks.forEach((drink) => {
      expect(screen.getByText(drink.name)).toBeInTheDocument();
    });
  });

  it('shows a heading for every category that currently has a drink', () => {
    // Drinks.tsx renders `null` for a category with zero items (see
    // Drinks.tsx's `if (items.length === 0) return null`), so deleting every
    // drink in one category is a legitimate content edit that removes that
    // category's heading too. Iterating only the categories actually present
    // in `drinks` -- instead of all three unconditionally -- keeps this test
    // invariant under that edit.
    render(<Drinks />);
    const presentCategories = [...new Set(drinks.map((d) => d.category))];
    presentCategories.forEach((category) => {
      expect(screen.getByRole('heading', { name: CATEGORY_HEADING[category] })).toBeInTheDocument();
    });
  });

  it('describes only drinks that exist', () => {
    render(<Drinks />);
    [
      // Ghosts from the original intro copy: described drinks that were never on the menu.
      'basil-lime spritz',
      'rosemary-grapefruit fizz',
      'espresso-orange tonic',
      // Retired from the current printed menu: must not silently reappear.
      'Bicerin',
      'Espresso Tonic',
      'Signor Bianca',
      'Sambuco',
    ].forEach((ghost) => {
      expect(screen.queryByText(new RegExp(ghost, 'i'))).toBeNull();
    });
  });
});
