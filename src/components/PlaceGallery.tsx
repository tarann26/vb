import React from 'react';

const PlaceGallery: React.FC = () => {
  const places = [
    {
      name: "Dining Room",
      image: "/public/atmosphere/dining.jpg"
    },
    {
      name: "Facade",
      image: "/public/atmosphere/outsideLOGO.jpg"
    },
    {
      name: "ambience",
      image: "/public/atmosphere/ambience.JPG"
    },
    {
      name: "ceiling decor",
      image: "/public/atmosphere/ceiling decor.png"
    },
    {
      name: "front mirror",
      image: "/public/atmosphere/front mirror.png"
    },
    {
      name: "painting board",
      image: "/public/atmosphere/painting board.JPG"
    },
    {
      name: "room",
      image: "/public/atmosphere/room.png"
    },
    {
      name: "table",
      image: "/public/atmosphere/table.png"
    }
  ];

  return (
    <section id="gallery" className="py-20 bg-[#F9F9F9]">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          Atmosfera
        </h2>
        
        {/* Horizontal scroll container */}
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex space-x-8 pb-4" style={{ width: 'max-content' }}>
            {places.map((place, index) => (
              <div 
                key={index}
                className="flex-shrink-0 w-64 bg-white shadow-md rounded-xl overflow-hidden group transform hover:scale-105 transition duration-300"
              >
                <div className="bg-white p-3 pb-6 rounded-xl">
                  <img 
                    src={place.image}
                    alt={place.name || `Place ${index + 1}`}
                    className="w-full h-64 object-cover border border-gray-200 rounded-lg"
                    loading="lazy"
                  />
                  <div className="text-center text-sm font-semibold text-[#444] mt-4 font-['Montserrat']">
                    {place.name || '\u00A0'}
                  </div>
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

export default PlaceGallery;