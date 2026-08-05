import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Drinks from '../Drinks';
import { drinks } from '../../content';
import type { Drink } from '../../content';

// The owner's own request (see Drinks.tsx's header comment): the three
// text-list categories (Mocktails/Cocktails/Wine) are gone, replaced by a
// single FoodGallery-style photo carousel that shows only drinks with an
// image. drinks.json keeps all 38 records -- deleting the 37 without a photo
// yet would mean retyping every name and description once they're
// photographed -- so this file tests the carousel's own filter, not the
// content file's size.
const hasImage = (drink: Drink): drink is Drink & { image: string } => drink.image !== null;
const photographed = drinks.filter(hasImage);
const unphotographed = drinks.filter((drink) => !hasImage(drink));

describe('Drinks', () => {
  it('renders one card per drink that has a photo', () => {
    render(<Drinks />);
    expect(screen.getAllByRole('img')).toHaveLength(photographed.length);
  });

  it("renders every photographed drink's name and description", () => {
    render(<Drinks />);
    photographed.forEach((drink) => {
      expect(screen.getByText(drink.name)).toBeInTheDocument();
      expect(screen.getByText(drink.description)).toBeInTheDocument();
    });
  });

  it('uses the drink name as alt text', () => {
    render(<Drinks />);
    photographed.forEach((drink) => {
      expect(screen.getByAltText(drink.name)).toBeInTheDocument();
    });
  });

  // The real regression this guards: the old layout rendered a drink with no
  // photo as a name-and-description text line ("Drinks without photography").
  // That fallback is gone -- a drink with no `image` must not appear on the
  // page at all, in any form, until it has one.
  it('does not render a drink that has no photo -- no text-list fallback', () => {
    render(<Drinks />);
    expect(unphotographed.length).toBeGreaterThan(0); // non-vacuous against real content
    unphotographed.forEach((drink) => {
      expect(screen.queryByText(drink.name)).not.toBeInTheDocument();
    });
  });

  // The three category sub-headings (Mocktails/Cocktails/Wine) no longer
  // exist anywhere -- not in copy.json (see copy.json's own drinks.* keys)
  // and not hardcoded in this component either.
  it('renders no category sub-heading', () => {
    render(<Drinks />);
    expect(screen.queryByText('Mocktails')).not.toBeInTheDocument();
    expect(screen.queryByText('Cocktails')).not.toBeInTheDocument();
    expect(screen.queryByText('Wine')).not.toBeInTheDocument();
  });

  // "Describes only drinks that exist" (retired drinks and prose ghosts)
  // moved to src/content/validate.ts: it rejects a bad drinks.json or
  // copy.json before the commit exists, rather than after the build has
  // already run against it.
});
