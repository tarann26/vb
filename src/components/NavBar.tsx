import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Menu, X } from 'lucide-react';
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

const Navbar: React.FC = () => {
  const content = useContent();
  const { site, copy, sections, pages } = content;
  const [showNavbar, setShowNavbar] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const lastScrollY = useRef(0);

  // Sections she has switched off disappear from the nav too, so a link
  // never scrolls to nothing. hero/drinks have no nav link at all, which
  // this falls out of naturally: they just never match a link's `section`.
  const enabledSectionIds = new Set(
    sections.filter((section) => section.enabled).map((section) => section.id),
  );
  const sectionEntries: NavEntry[] = copy.nav.links
    .filter((link) => enabledSectionIds.has(link.section))
    .map((link) => ({ kind: 'section', href: link.href, label: link.label }));
  // A page reaches the nav through exactly one flag it already owns
  // (`inNav && enabled`) -- no separate list to keep in sync, and no way
  // for a page to be linked from the nav while disabled (the same
  // "cannot scroll to nothing" guarantee section links already have).
  const pageEntries: NavEntry[] = pages
    .filter((page) => page.inNav && page.enabled)
    .map((page) => ({ kind: 'page', href: `/${page.slug}`, label: page.name }));
  const visibleLinks: NavEntry[] = [...sectionEntries, ...pageEntries];

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setShowNavbar(y < 100 || y < lastScrollY.current);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        showNavbar || isMenuOpen
          ? 'bg-white shadow-md opacity-100 translate-y-0'
          : 'bg-transparent shadow-none opacity-0 -translate-y-full'
      } py-3 px-6 flex justify-between items-center`}
    >
      {/* Logo */}
      <div className="text-3xl font-['Parisienne'] text-[#222]">
        {content.renderText('nav.wordmark', copy.nav.wordmark)}
      </div>

      {/* Links and social */}
     <div className="flex items-center space-x-6">
        <div className="hidden md:flex">
          <div
            data-testid="desktop-nav-links"
            className="space-x-6 text-sm font-['Montserrat'] tracking-wider text-[#6B8B59] uppercase"
          >
            {visibleLinks.map((link) =>
              link.kind === 'section' ? (
                <a key={link.href} href={link.href} className="hover:text-[#222] transition">
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} to={link.href} className="hover:text-[#222] transition">
                  {link.label}
                </Link>
              ),
            )}
          </div>
        </div>
        {site.socials.instagram && (
          <a
            href={site.socials.instagram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.nav.instagramLabel}
            className="text-[#6B8B59] hover:text-[#222] transition"
          >
            <Instagram className="h-5 w-5" />
          </a>
        )}
        <button
          type="button"
          aria-label={copy.nav.menuLabel}
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
          className="md:hidden text-[#6B8B59] hover:text-[#222] transition"
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {isMenuOpen && (
        <div
          data-testid="mobile-nav-panel"
          className="absolute top-full left-0 right-0 md:hidden bg-white shadow-md flex flex-col items-start px-6 py-4 space-y-4 text-sm font-['Montserrat'] tracking-wider text-[#6B8B59] uppercase"
        >
          {visibleLinks.map((link) =>
            link.kind === 'section' ? (
              <a key={link.href} href={link.href} onClick={closeMenu} className="hover:text-[#222] transition">
                {link.label}
              </a>
            ) : (
              <Link key={link.href} to={link.href} onClick={closeMenu} className="hover:text-[#222] transition">
                {link.label}
              </Link>
            ),
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
