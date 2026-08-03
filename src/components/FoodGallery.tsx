import React from 'react';
import { useContent } from '../content/ContentContext';

const FoodGallery: React.FC = () => {
  const content = useContent();
  const { dishes, copy } = content;
  return (
    <section id ="menu" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          {content.renderText('food.heading', copy.food.heading)}
        </h2>

        {/* Horizontal scroll container */}
        <div className="relative">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex space-x-6 pb-4 px-1 py-2" style={{ width: 'max-content' }}>
              {dishes.map((dish) => (
                <div
                  key={dish.id}
                  className="flex-shrink-0 w-80 h-64 relative rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 group cursor-pointer"
                >
                  <div className="relative w-full h-full transform hover:scale-105 transition-all duration-300">
                    {content.renderImage(`dishes.${dish.id}.image`, {
                      src: dish.image,
                      alt: dish.name,
                      className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
                      loading: 'lazy',
                    })}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                    <div className="absolute bottom-4 left-4 right-4 text-white">
                      <h3 className="font-['Montserrat'] font-semibold text-xl">{dish.name}</h3>
                      <p className="font-['Open_Sans'] text-sm text-white/80">{dish.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent" />
        </div>
      </div>
    </section>
  );
};

export default FoodGallery;
