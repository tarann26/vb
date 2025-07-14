
import React from 'react';
import FadeIn from './FadeIn';
import { Download } from 'lucide-react';

const SignatureMocktails: React.FC = () => {
  const mocktails = [
    {
      name: "Bicerin",
      flavor: "Espresso, chocolate & cream",
      image: "/public/mocktails/bicerin.jpg"
    },
    {
      name: "Espresso Tonic",
      flavor: "Espresso, blood orange & ginger ale",
      image: "/public/mocktails/blood orange espresso tonic.JPG"
    },
    {
      name: "Piccante",
      flavor: "Pineapple, birds eye chili & salt",
      image: "/public/mocktails/piccante.JPG"
    },
    {
      name: "Signor Bianca",
      flavor: "Dragonfruit, coconut water & honey",
      image: "/public/mocktails/signor bianca.png"
    },
    {
      name: "Viola and Sambuco",
      flavor: "Blueberries, basil leaves, lavender & ginger ale and Elderflower, cucumber & black tea",
      image: "/public/mocktails/viola and sambuco.png"
    }
  ];

  return (
    <FadeIn>
    <section className="py-20 bg-[#FFFDF8] relative overflow-hidden">
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
            Zero-Proof, Full Flavor
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            Our signature mocktails celebrate the vibrant herbs and fresh ingredients of Italian gardens. 
            Each drink is carefully crafted to deliver complex flavors and refreshing experiences, 
            from our basil-lime spritz to our rosemary-grapefruit fizz and espresso-orange tonic.
          </p>
        </div>

        {/* Horizontal scroll container */}
        <div className="overflow-x-auto scrollbar-hide mb-12">
          <div className="flex space-x-8 pb-4" style={{ width: 'max-content' }}>
            {mocktails.map((mocktail, index) => (
              <div 
                key={index}
                className="flex-shrink-0 w-64 bg-white rounded-3xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 overflow-hidden group cursor-pointer"
              >
                <div className="h-80 relative">
                  <img 
                    src={mocktail.image}
                    alt={mocktail.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
                </div>
                <div className="p-6 text-center">
                  <h3 className="font-['Parisienne'] text-2xl text-[#6B8B59] mb-2">{mocktail.name}</h3>
                  <p className="font-['Montserrat'] text-sm uppercase tracking-wider text-gray-600">
                    {mocktail.flavor}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Download Full Menu Button */}
        <div className="text-center">
        <a href="/public/Menu%20-%20Expanded.pdf" download>
            <button className="inline-flex items-center space-x-2 bg-[#6B8B59] hover:bg-[#5a7349] text-white font-['Montserrat'] font-semibold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide">
              <Download className="w-5 h-5" />
              <span>Download Full Menu</span>
            </button>
          </a>
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
    </FadeIn>
  );
};

export default SignatureMocktails;
