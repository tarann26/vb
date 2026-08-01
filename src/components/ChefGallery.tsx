// Note: the image path below is /public/-prefixed and will 404 in
// production (Vite serves public/ at the root, not at /public/). Not
// fixed here because this component is not rendered anywhere in the app.

import React from 'react';

const ChefGallery: React.FC = () => {
  const chefs = [
    { 
      name: "Chef Kamalika Anand", 
      role: "Executive Chef & Founder",
      image: "/public/team/alice.jpg"
    },
    
  ];

  return (
    <section className="py-20 bg-slate-800">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-white text-center mb-16">
          La Brigata
        </h2>
        
        {/* Horizontal scroll container */}
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex justify-center space-x-12 pb-4" style={{ minWidth: 'max-content' }}>
            {chefs.map((chef, index) => (
              <div 
                key={index}
                className="flex-shrink-0 text-center group cursor-pointer"
              >
                <div className="w-32 h-32 md:w-40 md:h-40 mx-auto mb-6 relative">
                  <img 
                    src={chef.image}
                    alt={`${chef.name} - ${chef.role}`}
                    className="w-full h-full object-cover rounded-full shadow-2xl group-hover:scale-110 transition-transform duration-500 border-4 border-[#6B8B59]"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 rounded-full bg-[#6B8B59]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
                <h3 className="font-['Montserrat'] font-semibold text-lg text-white mb-2">{chef.name}</h3>
                <p className="font-['Open_Sans'] text-[#6B8B59] text-sm uppercase tracking-wide">{chef.role}</p>
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

export default ChefGallery;