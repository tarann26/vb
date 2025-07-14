import React, { useEffect, useState } from 'react';
import { Instagram} from 'lucide-react';

const Navbar: React.FC = () => {
  const [showNavbar, setShowNavbar] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // If scrolling up OR near top, show the navbar
      if (currentScrollY < 100 || currentScrollY < lastScrollY) {
        setShowNavbar(true);
      } else {
        setShowNavbar(false);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        showNavbar
          ? 'bg-white shadow-md opacity-100 translate-y-0'
          : 'bg-transparent shadow-none opacity-0 -translate-y-full'
      } py-3 px-6 flex justify-between items-center`}
    >
      {/* Logo */}
      <div className="text-3xl font-['Parisienne'] text-[#222]">
        Via Bianca
      </div>

      {/* Links */}
     {/* Links and social */}
     <div className="flex items-center space-x-6">
        <div className="space-x-6 text-sm font-['Montserrat'] tracking-wider text-[#6B8B59] uppercase">
          <a href="#our-story" className="hover:text-[#222] transition">Our Story</a>
          <a href="#gallery" className="hover:text-[#222] transition">Gallery</a>
          <a href="#menu" className="hover:text-[#222] transition">Menu</a>
          <a href="#blogs" className="hover:text-[#222] transition">Stories</a>
          <a href="#visit" className="hover:text-[#222] transition">Visit Us</a>
        </div>
        <a
          href="https://instagram.com/viabiancadelhi"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Follow Via Bianca on Instagram"
          className="text-[#6B8B59] hover:text-[#222] transition"
        >
          <Instagram className="h-5 w-5" />
        </a>
      </div>
    </nav>
  );
};

export default Navbar;