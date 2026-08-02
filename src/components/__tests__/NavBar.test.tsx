import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '../NavBar';
import { copy } from '../../content';

// copy.nav.links[].label is owner-editable via copy.json; look it up by href
// (a structural anchor, not prose) rather than pinning the current wording,
// so a content edit to the label doesn't break this behavioral test.
const OUR_STORY_HREF = '#our-story';
const ourStoryLink = copy.nav.links.find((l) => l.href === OUR_STORY_HREF);
if (!ourStoryLink) {
  throw new Error(`Fixture assumption broken: copy.nav.links has no "${OUR_STORY_HREF}" entry`);
}

describe('Navbar', () => {
  it('exposes a menu toggle for small screens', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: copy.nav.menuLabel })).toBeInTheDocument();
  });

  it('opens and closes the menu', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu after a link is followed', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });
    await user.click(toggle);

    // Scoped to the mobile panel: jsdom applies no CSS/media queries, so the
    // desktop link list (hidden only via the `hidden` class, which jsdom
    // never evaluates) and the mobile panel both have an "Our Story" link in
    // the DOM at once. An unscoped query would be ambiguous here even though
    // a real browser only ever shows one of the two.
    const panel = screen.getByTestId('mobile-nav-panel');
    await user.click(within(panel).getByRole('link', { name: ourStoryLink.label }));
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
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });
    await user.click(toggle);

    const desktopLinks = screen.getByTestId('desktop-nav-links');
    expect(within(desktopLinks).getAllByRole('link')).toHaveLength(5);
  });
});
