import React from 'react';
import { Instagram, Linkedin, Clock, MapPin, Phone } from 'lucide-react';
import { site } from '../content';

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#222] text-white py-16">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid gap-12 md:grid-cols-2">
          {/* ---------- Left Section ---------- */}
          <div className="space-y-6">
            <div className="flex items-center space-x-3">
              <div>
                <h3 className="font-['Parisienne'] text-2xl text-[#6B8B59]">{site.name}</h3>
                <p className="font-['Montserrat'] text-sm uppercase tracking-wide text-gray-400">
                  {site.tagline}
                </p>
              </div>
            </div>

            <div className="space-y-3 font-['Open_Sans']">
              <div className="flex items-start space-x-3">
                <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#6B8B59]" />
                <p className="text-gray-300">
                  {site.address.street}
                  <br />
                  {site.address.locality} {site.address.postalCode}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <Phone className="h-5 w-5 text-[#6B8B59]" />
                  <p className="font-semibold text-gray-300">For Reservations:</p>
                </div>
                <div className="ml-8 space-y-1">
                  {site.phones.map((phone) => (
                    <p key={phone} className="text-white">{phone}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ---------- Right Section ---------- */}
          <div className="space-y-6">
            <div>
              <h4 className="mb-4 flex items-center space-x-2 font-['Montserrat'] text-lg font-semibold">
                <Clock className="h-5 w-5 text-[#6B8B59]" />
                <span>Opening Hours</span>
              </h4>

              <div className="grid grid-cols-2 gap-4 font-['Open_Sans'] text-sm">
                {site.hours.map((h) => (
                  <div key={h.label}>
                    <p className="mb-1 text-gray-400">{h.label}</p>
                    <p className="text-white">{h.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Follow-us links */}
            <div className="flex items-center space-x-4">
              <span className="font-['Montserrat'] font-semibold">Follow&nbsp;Us:</span>

              {/* Instagram */}
              <a
                href={site.socials.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#6B8B59] p-3 transition-all duration-300 transform hover:scale-110 hover:bg-[#5a7349]"
                aria-label="Follow Via Bianca on Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>

              {/* LinkedIn */}
              {site.socials.linkedin && (
                <a
                  href={site.socials.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-[#6B8B59] p-3 transition-all duration-300 transform hover:scale-110 hover:bg-[#5a7349]"
                  aria-label="Connect with Via Bianca on LinkedIn"
                >
                  <Linkedin className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ---------- Copyright ---------- */}
        <div className="mt-12 border-t border-gray-700 pt-8 text-center">
          <p className="font-['Open_Sans'] text-sm text-gray-400">
            © {site.copyrightYear} {site.name} {site.tagline}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
