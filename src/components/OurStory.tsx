import React, { useEffect, useState } from 'react';

const imageFiles = [
  'cut.JPG',
  'dinner.JPG',
  'handmaking.jpg',
  'oven.JPG',
  'shape.JPG',
  'stuff.JPG'
];

const images = imageFiles.map((file) => `/public/our_story/${file}`);

const OurStory: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 3200); // 3.2 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <section id = "our-story" className="py-20 bg-[#F9F9F9]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Story Text */}
          <div className="space-y-6">
            <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-8">
              Our Story
            </h2>
            <div className="space-y-4 font-['Open_Sans'] text-gray-700 leading-relaxed">
              <p>
                Chef Kamalika Anand's culinary journey began in the prestigious kitchens of Michelin-starred restaurants...
              </p>
              <p>
                At Via Bianca, every strand of pasta is crafted fresh daily using time-honored techniques...
              </p>
              <p>
                Our philosophy is simple: great food begins with great ingredients...
              </p>
            </div>
          </div>

          {/* Rotating Image Carousel */}
          <div className="relative overflow-hidden rounded-2xl shadow-2xl h-[400px]">
            <div
              className="flex transition-transform duration-[800ms] ease-in-out"
              style={{ transform: `translateX(-${currentIndex * 100}%)` }}
            >
              {images.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`Slide ${idx}`}
                  className="w-full flex-shrink-0 object-cover h-[400px]"
                />
              ))}
            </div>
            {/* Torn paper effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-white/10 pointer-events-none"></div>
            {/* Decorative circle */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-[#6B8B59] rounded-full opacity-20 pointer-events-none"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OurStory;
