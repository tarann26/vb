import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '../NavBar';

describe('Navbar', () => {
  it('exposes a menu toggle for small screens', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
  });

  it('opens and closes the menu', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu after a link is followed', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);

    // Scoped to the mobile panel: jsdom applies no CSS/media queries, so the
    // desktop link list (hidden only via the `hidden` class, which jsdom
    // never evaluates) and the mobile panel both have an "Our Story" link in
    // the DOM at once. An unscoped query would be ambiguous here even though
    // a real browser only ever shows one of the two.
    const panel = screen.getByTestId('mobile-nav-panel');
    await user.click(within(panel).getByRole('link', { name: /our story/i }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // Regression test: the desktop link list must keep rendering regardless of
  // isMenuOpen. It previously only rendered when the menu was closed, which
  // is invisible under md (CSS already hides it there) but strands desktop
  // users with no links if the mobile menu is left open while the viewport
  // crosses the md breakpoint (e.g. resizing a window, rotating a tablet).
  // Visibility above md must come from CSS alone, never from this state.
  it('keeps the desktop links rendered even while the mobile menu is open', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);

    const desktopLinks = screen.getByTestId('desktop-nav-links');
    expect(within(desktopLinks).getAllByRole('link')).toHaveLength(5);
  });
});
