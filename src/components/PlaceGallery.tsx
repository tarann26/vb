import React from 'react';

const PlaceGallery: React.FC = () => {
  const places = [
    "/public/atmosphere/dining.jpg",
    "/public/atmosphere/outsideLOGO.jpg",
    "/public/atmosphere/ambience.JPG",
    "/public/atmosphere/ceiling decor.png",
    "/public/atmosphere/front mirror.png",
    "/public/atmosphere/painting board.JPG",
    "/public/atmosphere/room.png",
    "/public/atmosphere/table.png",
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
            {places.map((src, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-64 h-64 rounded-xl overflow-hidden shadow-md transform hover:scale-105 transition duration-300"
              >
                <img
                  src={src}
                  alt={`Place ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
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
