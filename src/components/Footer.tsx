import React from 'react';
import { Instagram, Linkedin, Clock, MapPin, Phone } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#222] text-white py-16">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid gap-12 md:grid-cols-2">
          {/* ---------- Left Section ---------- */}
          <div className="space-y-6">
            <div className="flex items-center space-x-3">
              <div>
                <h3 className="font-['Parisienne'] text-2xl text-[#6B8B59]">Via Bianca</h3>
                <p className="font-['Montserrat'] text-sm uppercase tracking-wide text-gray-400">
                  Pastificio & Ristorante
                </p>
              </div>
            </div>

            <div className="space-y-3 font-['Open_Sans']">
              <div className="flex items-start space-x-3">
                <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#6B8B59]" />
                <p className="text-gray-300">
                  N-Block Market, Greater Kailash I<br />
                  New Delhi 110048
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <Phone className="h-5 w-5 text-[#6B8B59]" />
                  <p className="font-semibold text-gray-300">For Reservations:</p>
                </div>
                <div className="ml-8 space-y-1">
                  <p className="text-white">+91 92115 63311</p>
                  <p className="text-white">+91 92117 91188</p>
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
                <div>
                  <p className="mb-1 text-gray-400">Monday – Friday</p>
                  <p className="text-white">12:00 PM – 11:30 PM</p>
                </div>
                <div>
                  <p className="mb-1 text-gray-400">Saturday – Sunday</p>
                  <p className="text-white">12:00 PM – 11:30 AM</p>
                </div>
              </div>
            </div>

            {/* Follow-us links */}
            <div className="flex items-center space-x-4">
              <span className="font-['Montserrat'] font-semibold">Follow&nbsp;Us:</span>

              {/* Instagram */}
              <a
                href="https://instagram.com/viabiancadelhi"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#6B8B59] p-3 transition-all duration-300 transform hover:scale-110 hover:bg-[#5a7349]"
                aria-label="Follow Via Bianca on Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>

              {/* LinkedIn */}
              <a
                href="https://linkedin.com/company/viabiancadelhi"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#6B8B59] p-3 transition-all duration-300 transform hover:scale-110 hover:bg-[#5a7349]"
                aria-label="Connect with Via Bianca on LinkedIn"
              >
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        {/* ---------- Copyright ---------- */}
        <div className="mt-12 border-t border-gray-700 pt-8 text-center">
          <p className="font-['Open_Sans'] text-sm text-gray-400">
            © 2024 Via Bianca Pastificio & Ristorante. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
