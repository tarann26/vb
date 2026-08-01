import React from 'react';
import { galleries } from '../content';

const PlaceGallery: React.FC = () => {
  return (
    <section id="gallery" className="py-20 bg-[#F9F9F9]">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          Atmosfera
        </h2>

        {/* Horizontal scroll container */}
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex space-x-8 pb-4" style={{ width: 'max-content' }}>
            {galleries.atmosphere.map((image, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-64 h-64 rounded-xl overflow-hidden shadow-md transform hover:scale-105 transition duration-300"
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlaceGallery;
