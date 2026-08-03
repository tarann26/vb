import React from 'react';
import { Navigation } from 'lucide-react';
import { useContent } from '../content/ContentContext';

const VisitUs: React.FC = () => {
  const content = useContent();
  const { copy } = content;
  return (
    <section id= "visit" className="py-20 bg-[#F9F9F9]">
      <div className="max-w-4xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          {content.renderText('visit.heading', copy.visit.heading)}
        </h2>
        
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Map */}
          <div className="h-96 relative">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3504.434113489714!2d77.23321039999999!3d28.556724199999998!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390ce3005f5972e5%3A0x5d11a3ec85750962!2sVia%20Bianca-%20Pastificio%20%26%20Ristorante!5e0!3m2!1sen!2sin!4v1749319225296!5m2!1sen!2sin"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={copy.visit.mapTitle}
            ></iframe>
          </div>
          
          {/* Navigation Button */}
          <div className="p-8 text-center">
            <a
                href="https://www.google.com/maps/dir/?api=1&destination=Via+Bianca+Pastificio+%26+Ristorante,+Delhi"
                target="_blank"
                rel="noopener noreferrer"
            >
                <button className="inline-flex items-center space-x-2 bg-[#6B8B59] hover:bg-[#5a7349] text-white font-['Montserrat'] font-bold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide">
                  <Navigation className="w-5 h-5" />
                  <span>{content.renderText('visit.navigateButton', copy.visit.navigateButton)}</span>
                </button>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default VisitUs;