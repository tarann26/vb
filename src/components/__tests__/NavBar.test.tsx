import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '../NavBar';
import { copy, pages, sections } from '../../content';

// Wrapped in a router because the nav now renders a real <Link> for every
// page with `inNav && enabled` (NavBar.tsx's own `pageEntries`), and a Link
// outside a Router throws on `useContext(...).basename`. This test file used
// to render <Navbar/> bare, which worked only while pages.json was empty --
// the moment the first page reached the nav, all four cases here died on a
// router error rather than on anything about the nav itself.
function renderNav() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>,
  );
}


// copy.nav.links[].label is owner-editable via copy.json; look it up rather
// than pinning today's wording, so a content edit to the label doesn't break
// this behavioral test. Previously this pinned `#our-story` specifically --
// but which link is visible at all is *also* owner-editable now (turning a
// section off removes its nav link), so pinning any one href was itself a
// content-coupling hazard: disabling Atmosfera's section, say, wouldn't
// touch '#our-story' and this fixture would still resolve, but disabling
// Our Story's own section would make `copy.nav.links.find(...)` still find
// the entry (copy.json is unchanged) while Navbar renders no such link,
// silently breaking this test for a reason unrelated to what it's meant to
// cover. Picking the first link whose section is *currently enabled* keeps
// this fixture valid under both kinds of edit -- content and toggle.
const enabledSectionIds = new Set(sections.filter((s) => s.enabled).map((s) => s.id));
const visibleLink = copy.nav.links.find((l) => enabledSectionIds.has(l.section));
if (!visibleLink) {
  throw new Error('Fixture assumption broken: no copy.nav.links entry points at an enabled section');
}

describe('Navbar', () => {
  it('exposes a menu toggle for small screens', () => {
    renderNav();
    expect(screen.getByRole('button', { name: copy.nav.menuLabel })).toBeInTheDocument();
  });

  it('opens and closes the menu', async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu after a link is followed', async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });
    await user.click(toggle);

    // Scoped to the mobile panel: jsdom applies no CSS/media queries, so the
    // desktop link list (hidden only via the `hidden` class, which jsdom
    // never evaluates) and the mobile panel both have an "Our Story" link in
    // the DOM at once. An unscoped query would be ambiguous here even though
    // a real browser only ever shows one of the two.
    const panel = screen.getByTestId('mobile-nav-panel');
    await user.click(within(panel).getByRole('link', { name: visibleLink.label }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // Regression test: the desktop link list must keep rendering regardless of
  // isMenuOpen. It previously only rendered when the menu was closed, which
  // is invisible under md (CSS already hides it there) but strands desktop
  // users with no links if the mobile menu is left open while the viewport
  // crosses the md breakpoint (e.g. resizing a window, rotating a tablet).
  // Visibility above md must come from CSS alone, never from this state.
  //
  // Asserts "at least one", not a pinned count: how many links are visible
  // depends on how many sections are currently enabled, which is
  // owner-editable via the dashboard this plan is building toward. A pinned
  // `toHaveLength(5)` would fail the build the first time she switches a
  // section off, even though nothing regressed -- exactly the class of
  // content-coupling hazard fixed in commit 1c8c691. `getAllByRole` already
  // throws if the list is empty, so the regression this test exists to
  // catch (the list vanishing while the menu is open) still fails loudly.
  it('keeps the desktop links rendered even while the mobile menu is open', async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole('button', { name: copy.nav.menuLabel });
    await user.click(toggle);

    const desktopLinks = screen.getByTestId('desktop-nav-links');
    expect(within(desktopLinks).getAllByRole('link').length).toBeGreaterThan(0);
  });
});

// The pages disclosure ("Experiences"), which had no test of any kind until
// its label was found advertising an edit affordance it could not honour
// (see NavBar.tsx's own comment at that label, and the matching describe
// block in src/admin/__tests__/editable-paths.test.tsx). The repair leaves
// this control's behaviour exactly as it was, and that is precisely the
// claim worth pinning: the label stops being a contentEditable, and the
// button keeps opening by pointer AND by keyboard, and Escape keeps closing
// it.
describe("Navbar's pages disclosure", () => {
  // Not vacuous by construction: the disclosure only exists once two or
  // more pages carry `inNav && enabled` (NavBar.tsx's own GROUP_PAGES_FROM).
  // Read off the real content rather than assumed, so if pages.json ever
  // drops below that this fails HERE, naming the reason, instead of every
  // test below failing on a missing button.
  const navPages = pages.filter((page) => page.inNav && page.enabled);
  if (navPages.length < 2) {
    throw new Error('Fixture assumption broken: fewer than two pages.json entries are in the nav, so no disclosure renders');
  }

  function disclosure(): HTMLElement {
    return screen.getByRole('button', { name: copy.nav.pagesLabel });
  }

  it("shows the label from copy.json as the button's own name", () => {
    renderNav();
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure()).toHaveAttribute('aria-haspopup', 'true');
  });

  // The hover path, isolated: a raw mouseenter on the group wrapper, with no
  // activation of any kind.
  // Mutation this guards: deleting `onMouseEnter` from that wrapper --
  // confirmed red here and green in every other test in this block.
  it('opens on hover', () => {
    renderNav();
    fireEvent.mouseEnter(disclosure().parentElement as HTMLElement);
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
  });

  // The activation path, isolated the other way: a bare click event with no
  // preceding pointer movement, so nothing has hovered anything.
  // Mutation this guards: deleting `onClick` from that button -- confirmed
  // red here (and in the keyboard test below), while the hover test above
  // stays green, which is exactly the split that made this defect invisible
  // for as long as it existed.
  it('opens on a click alone, with no hover first', () => {
    renderNav();
    fireEvent.click(disclosure());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');

    const group = screen.getByTestId('desktop-nav-group');
    navPages.forEach((page) => {
      expect(within(group).getByRole('link', { name: page.name })).toHaveAttribute('href', `/${page.slug}`);
    });
  });

  // The real-world sequence, which is where this control was actually
  // broken: a genuine pointer interaction fires mouseenter and then click,
  // in that order -- a mouse moving onto the word, and equally a TAP on any
  // touch device wide enough to be shown this nav, which dispatches the
  // compatibility mouse events before the click. The wrapper's hover
  // handler had already opened the menu by the time the click arrived, so a
  // toggling click closed it again inside the same interaction.
  //
  // Mutation this guards: `onClick={() => setIsGroupOpen(true)}` reverted to
  // `onClick={() => setIsGroupOpen((open) => !open)}` -- confirmed red here
  // and green in both isolated tests above, which is why this one has to
  // exist separately from either.
  it('stays open through a real hover-then-click interaction (a tap produces exactly this)', async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(disclosure());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('desktop-nav-group')).toBeInTheDocument();
  });

  // The keyboard path. A <button> activates on Enter by itself, which is
  // exactly why the label had to stay INSIDE it -- lifting the label out to
  // make it editable in place would have left this working only on the
  // chevron beside it.
  it('opens from the keyboard, with the label itself as the focused control', async () => {
    const user = userEvent.setup();
    renderNav();
    disclosure().focus();
    expect(document.activeElement).toBe(disclosure());
    await user.keyboard('{Enter}');
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
  });

  // Mutation this guards: removing the `keydown` listener's own
  // `setIsGroupOpen(false)` (NavBar.tsx's Escape effect) -- confirmed red.
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderNav();
    fireEvent.click(disclosure());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('desktop-nav-group')).not.toBeInTheDocument();
  });
});
