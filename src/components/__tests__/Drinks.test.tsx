import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Drinks from '../Drinks';
import { drinks } from '../../content';

describe('Drinks', () => {
  it('renders every drink name', () => {
    render(<Drinks />);
    drinks.forEach((drink) => {
      expect(screen.getByText(drink.name)).toBeInTheDocument();
    });
  });

  it('groups drinks into the three categories', () => {
    render(<Drinks />);
    ['Mocktails', 'Cocktails', 'Wine'].forEach((heading) => {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    });
  });

  it('describes only drinks that exist', () => {
    render(<Drinks />);
    ['basil-lime spritz', 'rosemary-grapefruit fizz', 'espresso-orange tonic'].forEach((ghost) => {
      expect(screen.queryByText(new RegExp(ghost, 'i'))).toBeNull();
    });
  });
});
