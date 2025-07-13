import React from 'react';
import { Download } from 'lucide-react';

const MenuTeaser: React.FC = () => {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-16">
          Our Menu
        </h2>
        
        <div className="grid md:grid-cols-3 gap-8 mb-12">
          <div className="group cursor-pointer">
            <div className="bg-[#F9F9F9] hover:bg-[#6B8B59] hover:text-white p-8 rounded-2xl transition-all duration-300 transform hover:scale-105">
              <h3 className="font-['Montserrat'] text-2xl font-bold mb-4 group-hover:text-white">Antipasti</h3>
              <p className="font-['Open_Sans'] text-gray-600 group-hover:text-white/90">
                Fresh burrata, cured meats, seasonal bruschetta
              </p>
            </div>
          </div>
          
          <div className="group cursor-pointer">
            <div className="bg-[#F9F9F9] hover:bg-[#6B8B59] hover:text-white p-8 rounded-2xl transition-all duration-300 transform hover:scale-105">
              <h3 className="font-['Montserrat'] text-2xl font-bold mb-4 group-hover:text-white">Paste</h3>
              <p className="font-['Open_Sans'] text-gray-600 group-hover:text-white/90">
                Hand-rolled orecchiette, truffle tagliatelle, classics
              </p>
            </div>
          </div>
          
          <div className="group cursor-pointer">
            <div className="bg-[#F9F9F9] hover:bg-[#6B8B59] hover:text-white p-8 rounded-2xl transition-all duration-300 transform hover:scale-105">
              <h3 className="font-['Montserrat'] text-2xl font-bold mb-4 group-hover:text-white">Dolci</h3>
              <p className="font-['Open_Sans'] text-gray-600 group-hover:text-white/90">
                Tiramisu, cannoli, seasonal fruit desserts
              </p>
            </div>
          </div>
        </div>
        
        <button className="inline-flex items-center space-x-2 bg-[#6B8B59] hover:bg-[#5a7349] text-white font-['Montserrat'] font-semibold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide">
          <Download className="w-5 h-5" />
          <span>Download Full Menu</span>
        </button>
      </div>
    </section>
  );
};

export default MenuTeaser;