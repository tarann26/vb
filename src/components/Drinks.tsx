import React from 'react';
import { Download } from 'lucide-react';
import { useContent, type EditableTextPath } from '../content/ContentContext';
import type { Drink } from '../content';

const hasImage = (drink: Drink): drink is Drink & { image: string } => drink.image !== null;

const Drinks: React.FC = () => {
  const content = useContent();
  const { drinks, menus, copy } = content;

  // Built inside the component body, not at module scope: a module-scope
  // array literal would capture copy.drinks.mocktails/cocktails/wine once,
  // at import time, and freeze all three category headings at their
  // build-time values -- exactly the two-surfaces-disagree bug this plan
  // calls out by name, since a dashboard edit to any of the three would
  // never reach this component while a static import elsewhere would.
  const CATEGORY_ORDER: { key: Drink['category']; heading: string; path: EditableTextPath }[] = [
    { key: 'mocktail', heading: copy.drinks.mocktails, path: 'drinks.mocktails' },
    { key: 'cocktail', heading: copy.drinks.cocktails, path: 'drinks.cocktails' },
    { key: 'wine', heading: copy.drinks.wine, path: 'drinks.wine' },
  ];

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
            {content.renderText('drinks.heading', copy.drinks.heading)}
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            {content.renderText('drinks.intro', copy.drinks.intro)}
          </p>
        </div>

        {CATEGORY_ORDER.map(({ key, heading, path }) => {
          const items = drinks.filter((drink) => drink.category === key);
          if (items.length === 0) return null;

          return (
            <div key={key} className="mb-16 last:mb-0">
              <h3 className="font-['Montserrat'] text-2xl md:text-3xl font-bold text-[#222] mb-8 text-center">
                {content.renderText(path, heading)}
              </h3>

              {/* Drinks with photography: horizontal scroll of cards */}
              {items.some(hasImage) && (
                <div className="relative mb-8">
                  <div className="overflow-x-auto scrollbar-hide">
                    <div className="flex space-x-8 pb-4 px-1 py-2" style={{ width: 'max-content' }}>
                      {items
                        .filter(hasImage)
                        .map((drink) => (
                          <div
                            key={drink.id}
                            className="flex-shrink-0 w-64 bg-white rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 overflow-hidden group cursor-pointer"
                          >
                            <div className="transform hover:scale-105 transition-all duration-300">
                              <div className="h-80 relative">
                                {content.renderImage(`drinks.${drink.id}.image`, {
                                  src: drink.image,
                                  alt: drink.name,
                                  className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
                                  loading: 'lazy',
                                })}
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
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#FFFDF8] to-transparent" />
                </div>
              )}

              {/* Drinks without photography: name-and-description list */}
              {items.some((drink) => !hasImage(drink)) && (
                <ul className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6">
                  {items
                    .filter((drink) => !hasImage(drink))
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

        {/* Download Full Menu Buttons */}
        <div className="text-center flex flex-wrap justify-center gap-4">
          {menus.map((menu) => (
            <a key={menu.id} href={menu.file} download>
              <button className="inline-flex items-center space-x-2 bg-[#6B8B59] hover:bg-[#5a7349] text-white font-['Montserrat'] font-semibold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide">
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
