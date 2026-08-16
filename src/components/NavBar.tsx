import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Menu, X, ChevronDown } from 'lucide-react';
import { useContent } from '../content/ContentContext';

// Plan 7, Task 3, Step 2: "one nav, not two." copy.nav.links (a hand-
// maintained list, each entry carrying the SectionId it scrolls to) and a
// page's own `inNav` flag used to be two independent mechanisms feeding the
// same nav bar, with nothing making them agree. This type is what makes
// them agree BY CONSTRUCTION instead of by convention: every visible entry,
// section or page, is reduced to the one shape the nav actually renders
// (`href` + `label`), and `kind` is what tells the renderer below whether
// `href` is an in-page "#" anchor (a plain `<a>`, so the browser's own
// default scroll-to-anchor behaviour still applies) or a real route (a
// router `<Link>`, so navigating to it is a client-side transition, not a
// full reload). A page's OWN `name` and `slug` are what the nav shows and
// links to -- there is no second, separate "nav label" for a page to drift
// from, the same way copy.nav.links[].label already is section links' own
// single source (still a real, standing gap -- see that field's own
// comment, types.ts, for why IT is editable nowhere; unchanged by this
// task).
interface NavEntry {
  kind: 'section' | 'page';
  href: string;
  label: string;
}

export interface NavbarProps {
  // I1 review fix: `copy.nav.links[].href` is a "#"-fragment that only ever
  // resolves against the HOMEPAGE's own DOM -- `sections` (below) is always
  // the homepage's own `content.sections` regardless of which route mounted
  // this component (there is no per-page ContentProvider; a page route's
  // own `page.sections` is a different list entirely, see App.tsx's
  // PageRoute), and no template section emits an `id` attribute a "#"
  // fragment could land on anyway. Bare `#anchor` is correct on the two
  // routes that actually RENDER those homepage sections (`/` -- App.tsx's
  // HomePage -- and `/edit` -- EditMode.tsx, which deliberately renders
  // only the homepage, see that file's own comment); `offHomePage` is true
  // for exactly the one route that renders something else instead
  // (App.tsx's PageRoute), so a section link there returns to the homepage
  // first (`/#anchor`) instead of scrolling nowhere on the current page.
  // A prop, not a `useLocation()`/`window.location` check inside this
  // component: the call site already knows unambiguously which content it
  // rendered, and a prop keeps this component testable (and usable) with no
  // Router context requirement of its own for the common, homepage case.
  offHomePage?: boolean;
}

// Grouping rule, and why it is this one rather than a hand-kept list of
// slugs: a SECTION link scrolls somewhere on the page you are already on; a
// PAGE link takes you somewhere else entirely. That is a real semantic
// split, not an arbitrary tidy-up, so the nav renders it -- five section
// anchors stay flat, and every page collapses under one word. It also
// scales without maintenance: the next page pages.json gains joins the
// group by itself, with no list here to update.
//
// Below this many pages, a disclosure button costs more than it saves (a
// menu that opens to reveal one item is worse than the item), so the pages
// render flat alongside the sections instead.
const GROUP_PAGES_FROM = 2;

// Shared by both the desktop row and the mobile card. The underline is a
// pseudo-element scaled from 0 on the x-axis rather than a border toggled
// on hover: a border changes the element's box and nudges everything after
// it by a pixel, which reads as a flinch. `origin-left` is what makes it
// extend out of the word rather than unfurl from its centre.
const LINK_BASE =
  'relative inline-block py-1 transition-colors duration-300 hover:text-ink focus-visible:text-ink ' +
  'after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-full after:bg-brand ' +
  'after:origin-left after:scale-x-0 after:transition-transform after:duration-300 ' +
  'hover:after:scale-x-100 focus-visible:after:scale-x-100';

const Navbar: React.FC<NavbarProps> = ({ offHomePage = false }) => {
  const content = useContent();
  const { site, copy, sections, pages } = content;
  const [showNavbar, setShowNavbar] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const groupRef = useRef<HTMLDivElement>(null);

  // Sections she has switched off disappear from the nav too, so a link
  // never scrolls to nothing. hero/drinks have no nav link at all, which
  // this falls out of naturally: they just never match a link's `section`.
  const enabledSectionIds = new Set(
    sections.filter((section) => section.enabled).map((section) => section.id),
  );
  const sectionEntries: NavEntry[] = copy.nav.links
    .filter((link) => enabledSectionIds.has(link.section))
    .map((link) => ({ kind: 'section', href: offHomePage ? `/${link.href}` : link.href, label: link.label }));
  // A page reaches the nav through exactly one flag it already owns
  // (`inNav && enabled`) -- no separate list to keep in sync, and no way
  // for a page to be linked from the nav while disabled (the same
  // "cannot scroll to nothing" guarantee section links already have).
  const pageEntries: NavEntry[] = pages
    .filter((page) => page.inNav && page.enabled)
    .map((page) => ({ kind: 'page', href: `/${page.slug}`, label: page.name }));

  const grouped = pageEntries.length >= GROUP_PAGES_FROM;
  const flatEntries: NavEntry[] = grouped ? sectionEntries : [...sectionEntries, ...pageEntries];
  const groupEntries: NavEntry[] = grouped ? pageEntries : [];

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setShowNavbar(y < 100 || y < lastScrollY.current);
      setScrolled(y > 8);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Escape closes whichever disclosure is open, and a click anywhere outside
  // the group closes it. Both are keyboard/pointer parity for a control that
  // otherwise opens on hover and would strand a keyboard user inside it.
  useEffect(() => {
    if (!isGroupOpen && !isMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsGroupOpen(false);
      setIsMenuOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(event.target as Node)) setIsGroupOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isGroupOpen, isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);
  const closeAll = () => {
    setIsMenuOpen(false);
    setIsGroupOpen(false);
  };

  const renderEntry = (link: NavEntry, className: string, onClick?: () => void) =>
    link.kind === 'section' ? (
      <a key={link.href} href={link.href} onClick={onClick} className={className}>
        {link.label}
      </a>
    ) : (
      <Link key={link.href} to={link.href} onClick={onClick} className={className}>
        {link.label}
      </Link>
    );

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        showNavbar || isMenuOpen
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 -translate-y-full'
      } ${
        // A hairline and a blur once she has scrolled, instead of a shadow
        // that is either fully on or fully off -- the bar reads as a layer
        // over the photography rather than a slab dropped on top of it.
        scrolled || isMenuOpen
          ? 'bg-white/90 backdrop-blur-md border-b border-brand/15'
          : 'bg-white border-b border-transparent'
      } py-3 px-6 flex justify-between items-center`}
    >
      {/* Logo */}
      <div className="text-3xl font-['Parisienne'] text-ink">
        {content.renderText('nav.wordmark', copy.nav.wordmark)}
      </div>

      {/* Links and social */}
     <div className="flex items-center space-x-6">
        <div className="hidden md:flex">
          <div
            data-testid="desktop-nav-links"
            className="flex items-center space-x-6 text-sm font-['Montserrat'] tracking-wider text-accent uppercase"
          >
            {flatEntries.map((link) => renderEntry(link, LINK_BASE))}

            {grouped && (
              <div
                ref={groupRef}
                className="relative"
                onMouseEnter={() => setIsGroupOpen(true)}
                onMouseLeave={() => setIsGroupOpen(false)}
              >
                <button
                  type="button"
                  aria-expanded={isGroupOpen}
                  aria-haspopup="true"
                  // Opens; never toggles. Found while writing this
                  // control's first tests (it had none): the wrapper above
                  // opens on `mouseenter`, so by the time a real click
                  // arrives the menu is ALREADY open and a toggle closed it
                  // again. With a mouse that means clicking the word you
                  // are pointing at makes the menu you can see disappear;
                  // on any touch device wide enough to get this nav
                  // (`md:` and up -- a tablet), a tap fires the
                  // compatibility mouseenter and the click back-to-back, so
                  // the menu opened and shut inside one tap and the four
                  // pages were unreachable by touch entirely.
                  //
                  // Closing is still fully available and now has exactly
                  // one meaning per input: the pointer leaving the group,
                  // a click outside it, Escape, or following one of the
                  // links. `aria-expanded` stays honest either way, and a
                  // second Enter on an already-open menu is a no-op rather
                  // than a surprise.
                  onClick={() => setIsGroupOpen(true)}
                  className={`${LINK_BASE} flex items-center gap-1 uppercase tracking-wider`}
                >
                  {/* Plain text, deliberately NOT `content.renderText(...)`.
                      This word is a <button>'s own label, and at /edit
                      renderText returns a contentEditable span -- which
                      showed the same dashed edge every other editable leaf
                      on the page shows, and could not be edited at all: a
                      click lands on the button, toggles the menu and
                      focuses nothing, and a contentEditable nested inside a
                      button does not take focus in any browser regardless.
                      The affordance was a lie, which is worse than no
                      affordance: it teaches her that /edit's dashed edge
                      sometimes means nothing. (Written "dashed edge", not
                      the CSS property's own one-word name -- that word is
                      also a real, bare Tailwind utility, and this project's
                      content scan has no JS parser, so spelling it here
                      emits an unused rule into the shipped stylesheet.
                      Measured, not guessed: the first draft of this comment
                      added exactly that rule, +29 bytes, caught by the
                      rule-level build diff this repo's standing instruction
                      requires.)

                      The alternative -- lift the label out of the button so
                      it CAN be focused, and leave the chevron beside it as
                      the disclosure -- was rejected on three counts. It
                      turns one control into two, so the word that reveals
                      four pages stops being the thing you click and a
                      ~14px chevron becomes the only pointer target. It adds
                      a second Tab stop in the nav for a word that changes
                      approximately never. And this dropdown really does
                      render for the public (pages.json carries four
                      `inNav` pages today), so restructuring it would move
                      the pinned homepage byte count
                      (src/test/homepage-bytes.test.tsx) to pay for an
                      /edit-only benefit -- whereas rendering the bare
                      string here is byte-identical to what renderText's own
                      identity default already produced for every visitor.

                      Nothing is lost: `nav.pagesLabel` keeps its real,
                      working input on /edit/manage (COPY_FIELDS, "Pages
                      menu label", under Page copy -> Navigation), and that
                      screen is now one link away from /edit. It is excluded
                      from EDITABLE_TEXT_PATHS (src/admin/editable-paths.ts)
                      so no other surface can start advertising it either.*/}
                  {copy.nav.pagesLabel}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform duration-300 ${isGroupOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isGroupOpen && (
                  <div
                    data-testid="desktop-nav-group"
                    className="absolute right-0 top-full pt-3"
                  >
                    <div className="min-w-[13rem] rounded-md border-t-2 border-brand bg-cream py-2 shadow-xl shadow-black/5 ring-1 ring-black/5">
                      {groupEntries.map((link, index) => (
                        // Staggered by inline style rather than a Tailwind
                        // arbitrary value per index: the delay is data, not a
                        // class, and building a per-index delay class
                        // from an index is exactly the dynamic-class shape
                        // Tailwind's scanner cannot see -- the same hazard
                        // galleries.json's grid strings already cost this
                        // project nine invisible collage photos.
                        <div
                          key={link.href}
                          style={{ animationDelay: `${index * 40}ms` }}
                          className="animate-nav-in"
                        >
                          {renderEntry(
                            link,
                            'block px-4 py-2.5 normal-case tracking-normal font-["Open_Sans"] text-ink/80 ' +
                              'transition-colors duration-200 hover:bg-brand/8 hover:text-ink',
                            closeAll,
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {site.socials.instagram && (
          <a
            href={site.socials.instagram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.nav.instagramLabel}
            className="text-accent transition-colors duration-300 hover:text-ink"
          >
            <Instagram className="h-5 w-5" />
          </a>
        )}
        <button
          type="button"
          aria-label={copy.nav.menuLabel}
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
          className="md:hidden text-accent transition-colors duration-300 hover:text-ink"
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {isMenuOpen && (
        // A floating card pinned to the right, not a full-bleed sheet: the
        // old panel spanned `left-0 right-0` and swallowed the viewport, so
        // opening the menu hid the page you were deciding whether to leave.
        // `max-w-[15rem]` keeps the photography visible beside it.
        <div
          data-testid="mobile-nav-panel"
          className="absolute right-4 top-full mt-2 w-[15rem] max-w-[calc(100vw-2rem)] md:hidden
                     overflow-hidden rounded-lg border-t-2 border-brand bg-cream
                     shadow-xl shadow-black/10 ring-1 ring-black/5 animate-nav-in"
        >
          <div className="flex flex-col py-2 text-sm font-['Montserrat'] tracking-wider text-accent uppercase">
            {flatEntries.map((link, index) => (
              <div key={link.href} style={{ animationDelay: `${index * 35}ms` }} className="animate-nav-in">
                {renderEntry(
                  link,
                  'block px-5 py-2.5 transition-colors duration-200 hover:bg-brand/8 hover:text-ink',
                  closeMenu,
                )}
              </div>
            ))}

            {groupEntries.length > 0 && (
              <>
                <div className="mx-5 my-2 border-t border-brand/20" />
                {groupEntries.map((link, index) => (
                  <div
                    key={link.href}
                    style={{ animationDelay: `${(flatEntries.length + index) * 35}ms` }}
                    className="animate-nav-in"
                  >
                    {renderEntry(
                      link,
                      'block px-5 py-2.5 normal-case tracking-normal font-["Open_Sans"] text-ink/80 ' +
                        'transition-colors duration-200 hover:bg-brand/8 hover:text-ink',
                      closeAll,
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
