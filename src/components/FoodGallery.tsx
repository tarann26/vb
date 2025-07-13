import React from 'react';

const FoodGallery: React.FC = () => {
  const dishes = [
    { name: 'assassina', image: '/public/food/assassina.jpg' },
    { name: 'aglio', image: '/public/food/aglio.jpg' },
    { name: 'tielle', image: '/public/food/tielle.jpg' },
    { name: 'margarita', image: '/public/food/margarita.jpg' },
    { name: 'tiramisu', image: '/public/food/tiramisu.jpg' },
    { name: 'pistaAffo', image: '/public/food/pistaAffo.jpg' },
    { name: 'arrosticini', image: '/public/food/arrosticini.JPG' },
    { name: 'boozy donna', image: '/public/food/boozy donna.JPG' },
    { name: 'idk1', image: '/public/food/idk1.JPG' },
    { name: 'idk2', image: '/public/food/idk2.JPG' },
    { name: 'piemontese', image: '/public/food/piemontese.JPG' },
    { name: 'pollo alla cacciatora', image: '/public/food/pollo alla cacciatora.JPG' }
  ];

  return (
    <section id ="menu" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          Hand-crafted Pastas & Wood-Fired Classics
        </h2>
        
        {/* Horizontal scroll container */}
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex space-x-6 pb-4" style={{ width: 'max-content' }}>
            {dishes.map((dish, index) => (
              <div 
                key={index}
                className="flex-shrink-0 w-80 h-64 relative rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
              >
                <img 
                  src={dish.image}
                  alt={dish.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                <div className="absolute bottom-4 left-4 text-white">
                  <h3 className="font-['Montserrat'] font-semibold text-xl">{dish.name}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
};

export default FoodGallery;