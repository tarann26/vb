import React, { useEffect, useRef, useState } from 'react';
import { Instagram, Menu, X } from 'lucide-react';
import { site, copy } from '../content';

const Navbar: React.FC = () => {
  const [showNavbar, setShowNavbar] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const lastScrollY = useRef(0);

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
        {copy.nav.wordmark}
      </div>

      {/* Links and social */}
     <div className="flex items-center space-x-6">
        <div className="hidden md:flex">
          <div
            data-testid="desktop-nav-links"
            className="space-x-6 text-sm font-['Montserrat'] tracking-wider text-[#6B8B59] uppercase"
          >
            {copy.nav.links.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-[#222] transition">
                {link.label}
              </a>
            ))}
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
          {copy.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={closeMenu}
              className="hover:text-[#222] transition"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
