import React from 'react';
import { drinks } from '../content';
import type { Drink } from '../content';

const CATEGORY_ORDER: { key: Drink['category']; heading: string }[] = [
  { key: 'mocktail', heading: 'Mocktails' },
  { key: 'cocktail', heading: 'Cocktails' },
  { key: 'wine', heading: 'Wine' },
];

const Drinks: React.FC = () => {
  return (
    <section id="drinks" className="py-20 bg-[#FFFDF8] relative overflow-hidden">
      {/* Sparkling bubble background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-3 h-3 bg-[#6B8B59]/20 rounded-full animate-ping"></div>
        <div className="absolute top-1/3 right-1/4 w-2 h-2 bg-[#6B8B59]/30 rounded-full animate-ping animation-delay-300"></div>
        <div className="absolute bottom-1/3 left-1/3 w-4 h-4 bg-[#6B8B59]/15 rounded-full animate-ping animation-delay-700"></div>
        <div className="absolute top-1/2 right-1/6 w-2 h-2 bg-[#6B8B59]/25 rounded-full animate-ping animation-delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 relative">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-6">
            Drinks
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            Our bar pours a full Italian programme alongside our zero-proof mocktails: prosecco
            spritzes, rosé and classic cocktails from the bar team, and a wine list running from
            everyday Chianti to a Barolo DOCG and a Brunello di Montalcino.
          </p>
        </div>

        {CATEGORY_ORDER.map(({ key, heading }) => {
          const items = drinks.filter((drink) => drink.category === key);
          if (items.length === 0) return null;

          return (
            <div key={key} className="mb-16 last:mb-0">
              <h3 className="font-['Montserrat'] text-2xl md:text-3xl font-bold text-[#222] mb-8 text-center">
                {heading}
              </h3>

              {/* Drinks with photography: horizontal scroll of cards */}
              {items.some((drink) => drink.image) && (
                <div className="overflow-x-auto scrollbar-hide mb-8">
                  <div className="flex space-x-8 pb-4" style={{ width: 'max-content' }}>
                    {items
                      .filter((drink) => drink.image)
                      .map((drink) => (
                        <div
                          key={drink.id}
                          className="flex-shrink-0 w-64 bg-white rounded-3xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 overflow-hidden group cursor-pointer"
                        >
                          <div className="h-80 relative">
                            <img
                              src={drink.image as string}
                              alt={drink.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
                          </div>
                          <div className="p-6 text-center">
                            <h4 className="font-['Parisienne'] text-2xl text-[#6B8B59] mb-2">
                              {drink.name}
                            </h4>
                            <p className="font-['Montserrat'] text-sm uppercase tracking-wider text-gray-600">
                              {drink.description}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Drinks without photography: name-and-description list */}
              {items.some((drink) => !drink.image) && (
                <ul className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6">
                  {items
                    .filter((drink) => !drink.image)
                    .map((drink) => (
                      <li key={drink.id} className="text-center sm:text-left">
                        <h4 className="font-['Parisienne'] text-2xl text-[#6B8B59] mb-1">
                          {drink.name}
                        </h4>
                        <p className="font-['Open_Sans'] text-sm text-gray-700 leading-relaxed">
                          {drink.description}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .animation-delay-300 {
          animation-delay: 300ms;
        }
        .animation-delay-700 {
          animation-delay: 700ms;
        }
        .animation-delay-1000 {
          animation-delay: 1000ms;
        }
      `}</style>
    </section>
  );
};

export default Drinks;
