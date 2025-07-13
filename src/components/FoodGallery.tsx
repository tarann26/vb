import React from 'react';

const FoodGallery: React.FC = () => {
  const dishes = [
    { name: "Spaghetti all'Assassina", image: "/public/food/assassina.jpg" },
    { name: "Aglio Olio e Pepperoncino", image: "/public/food/aglio.jpg" },
    { name: "Tiella Barese", image: "/public/food/tielle.jpg" },
    { name: "Margarita", image: "/public/food/margarita.jpg" },
    { name: "Bicerin", image: "/public/food/bicerin.jpg" },
    { name: "Tiramisu", image: "/public/food/tiramisu.jpg" },
    { name: "Pistachio Affogato", image: "/public/food/pistaAffo.jpg" }
    
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