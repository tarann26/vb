import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Drinks from '../Drinks';
import { drinks, copy } from '../../content';

describe('Drinks', () => {
  it('renders every drink name', () => {
    render(<Drinks />);
    drinks.forEach((drink) => {
      expect(screen.getByText(drink.name)).toBeInTheDocument();
    });
  });

  it('groups drinks into the three categories', () => {
    render(<Drinks />);
    [copy.drinks.mocktails, copy.drinks.cocktails, copy.drinks.wine].forEach((heading) => {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
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
