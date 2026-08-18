import React from 'react';
import { Download } from 'lucide-react';
import { useContent } from '../content/ContentContext';
import type { Drink } from '../content';

const hasImage = (drink: Drink): drink is Drink & { image: string } => drink.image !== null;

const Drinks: React.FC = () => {
  const content = useContent();
  const { drinks, menus, copy } = content;

  return (
    <section id="drinks" className="py-20 bg-wash-warm relative overflow-hidden">
      {/* Sparkling bubble background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-3 h-3 bg-brand/20 rounded-full animate-ping"></div>
        <div className="absolute top-1/3 right-1/4 w-2 h-2 bg-brand/30 rounded-full animate-ping animation-delay-300"></div>
        <div className="absolute bottom-1/3 left-1/3 w-4 h-4 bg-brand/15 rounded-full animate-ping animation-delay-700"></div>
        <div className="absolute top-1/2 right-1/6 w-2 h-2 bg-brand/25 rounded-full animate-ping animation-delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 relative">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-6">
            {content.renderText('drinks.heading', copy.drinks.heading)}
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            {content.renderText('drinks.intro', copy.drinks.intro)}
          </p>
        </div>

        {/* The same horizontal-scroll photo carousel as FoodGallery -- one
            card per drink that actually has a photo, no category
            sub-headings and no text list. The full 38-item bar list stays in
            drinks.json (the downloadable PDF menu below is where that list
            still lives for a diner); this only ever shows what has been
            photographed. */}
        <div className="relative mb-16">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex space-x-6 pb-4 px-1 py-2" style={{ width: 'max-content' }}>
              {drinks.filter(hasImage).map((drink) => (
                <div
                  key={drink.id}
                  className="flex-shrink-0 w-80 h-64 relative rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 group cursor-pointer"
                >
                  <div className="relative w-full h-full transform hover:scale-105 transition-all duration-300">
                    {content.renderImage(`drinks.${drink.id}.image`, {
                      src: drink.image,
                      alt: drink.name,
                      className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
                      loading: 'lazy',
                    })}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                    <div className="absolute bottom-4 left-4 right-4 text-white">
                      <h3 className="font-['Montserrat'] font-semibold text-xl">{drink.name}</h3>
                      <p className="font-['Open_Sans'] text-sm text-white/80">{drink.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-wash-warm to-transparent" />
        </div>

        {/* Download Full Menu Buttons */}
        <div className="text-center flex flex-wrap justify-center gap-4">
          {menus.map((menu) => (
            <a key={menu.id} href={menu.file} download>
              <button className="inline-flex items-center space-x-2 bg-brand hover:bg-brand-dark text-ink font-['Montserrat'] font-semibold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide">
                <Download className="w-5 h-5" />
                <span>{menu.label}</span>
              </button>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Drinks;
