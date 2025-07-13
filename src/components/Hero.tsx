import React from 'react';
import { ChefHat } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Hero: React.FC = () => {
  const navigate = useNavigate();

  const handleReservation = () => {
    navigate('/reservation');
  };

  return (
    <section className="min-h-screen bg-white flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Grid Collage Background */}
      <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 gap-1">
        {/* Top Left Corner - 2x2 grid */}
        <div className="col-span-2 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg" 
            alt="Italian pasta" 
            className="w-full h-full object-cover opacity-40 hover:opacity-50 transition-opacity duration-500"
          />
        </div>
        
        {/* Top Right Corner - 2x2 grid */}
        <div className="col-start-5 col-span-2 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg" 
            alt="Italian restaurant" 
            className="w-full h-full object-cover opacity-40 hover:opacity-50 transition-opacity duration-500"
          />
        </div>

        {/* Bottom Left Corner - 2x2 grid */}
        <div className="col-span-2 row-start-5 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1438672/pexels-photo-1438672.jpeg" 
            alt="Italian ingredients" 
            className="w-full h-full object-cover opacity-40 hover:opacity-50 transition-opacity duration-500"
          />
        </div>

        {/* Bottom Right Corner - 2x2 grid */}
        <div className="col-start-5 col-span-2 row-start-5 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1410235/pexels-photo-1410235.jpeg" 
            alt="Italian wine and food" 
            className="w-full h-full object-cover opacity-40 hover:opacity-50 transition-opacity duration-500"
          />
        </div>

        {/* Top edge fillers */}
        <div className="col-start-3 col-span-2 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1633578/pexels-photo-1633578.jpeg" 
            alt="Fresh herbs" 
            className="w-full h-full object-cover opacity-30 hover:opacity-40 transition-opacity duration-500"
          />
        </div>

        {/* Bottom edge fillers */}
        <div className="col-start-3 col-span-2 row-start-6 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1435904/pexels-photo-1435904.jpeg" 
            alt="Italian bread" 
            className="w-full h-full object-cover opacity-30 hover:opacity-40 transition-opacity duration-500"
          />
        </div>

        {/* Left edge fillers */}
        <div className="col-span-1 row-start-3 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg" 
            alt="Olive oil" 
            className="w-full h-full object-cover opacity-30 hover:opacity-40 transition-opacity duration-500"
          />
        </div>

        {/* Right edge fillers */}
        <div className="col-start-6 col-span-1 row-start-3 row-span-2 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg" 
            alt="Italian tomatoes" 
            className="w-full h-full object-cover opacity-30 hover:opacity-40 transition-opacity duration-500"
          />
        </div>

        {/* Additional corner touches - Keep these less visible as they're closer to center */}
        <div className="col-start-3 col-span-1 row-start-2 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg" 
            alt="Basil leaves" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-4 col-span-1 row-start-2 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1438672/pexels-photo-1438672.jpeg" 
            alt="Parmesan cheese" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-2 col-span-1 row-start-3 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1410235/pexels-photo-1410235.jpeg" 
            alt="Italian spices" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-5 col-span-1 row-start-3 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1633578/pexels-photo-1633578.jpeg" 
            alt="Fresh vegetables" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-2 col-span-1 row-start-4 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1435904/pexels-photo-1435904.jpeg" 
            alt="Italian cooking" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-5 col-span-1 row-start-4 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg" 
            alt="Italian dining" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-3 col-span-1 row-start-5 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg" 
            alt="Italian culture" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>

        <div className="col-start-4 col-span-1 row-start-5 row-span-1 relative overflow-hidden">
          <img 
            src="https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg" 
            alt="Italian tradition" 
            className="w-full h-full object-cover opacity-15 hover:opacity-25 transition-opacity duration-500"
          />
        </div>
      </div>

      {/* Overlay to ensure text readability */}
      <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px]"></div>

      {/* Animated pasta steam background */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <div className="absolute top-1/3 left-1/4 w-2 h-20 bg-gradient-to-t from-transparent via-gray-200 to-transparent opacity-30 animate-pulse rounded-full transform rotate-12"></div>
        <div className="absolute top-1/2 right-1/3 w-1 h-16 bg-gradient-to-t from-transparent via-gray-300 to-transparent opacity-20 animate-pulse rounded-full transform -rotate-12 animation-delay-500"></div>
        <div className="absolute bottom-1/3 left-1/3 w-1.5 h-12 bg-gradient-to-t from-transparent via-gray-200 to-transparent opacity-25 animate-pulse rounded-full transform rotate-6 animation-delay-1000"></div>
      </div>

      {/* Main Content - Centered and elevated */}
      <div className="relative z-20">
        {/* Logo */}
        <div className="mb-8 transform hover:scale-105 transition-transform duration-500 flex justify-center">
          <div className="w-48 h-48 rounded-full shadow-2xl bg-white border-4 border-[#6B8B59] flex items-center justify-center backdrop-blur-sm">
            <div className="text-center select-none cursor-default">
              <h1 className="font-['Parisienne'] text-3xl text-[#222] mb-1">Via Bianca</h1>
              <p className="font-['Montserrat'] text-[#6B8B59] text-xs uppercase tracking-wider">
                Pastificio & Ristorante
              </p>
            </div>
          </div>
        </div>

        {/* Hero Text */}
        <div className="text-center max-w-4xl mx-auto select-none cursor-default">
          <h2 className="font-['Parisienne'] text-5xl md:text-7xl text-[#222] mb-6 animate-fade-in drop-shadow-sm">
            Via Bianca
          </h2>
          <p className="font-['Montserrat'] text-[#6B8B59] text-lg md:text-xl uppercase tracking-wide mb-8 drop-shadow-sm">
            Pastificio & Ristorante
          </p>
          <p className="font-['Parisienne'] text-2xl md:text-3xl text-[#222] mb-8 leading-relaxed drop-shadow-sm">
            Sip Italiano, Taste the Soul of Puglia
          </p>
          
          {/* Reservation Phone Numbers */}
          <div className="mb-8 space-y-2">
            <p className="font-['Montserrat'] text-[#6B8B59] text-sm uppercase tracking-wide">For Reservations</p>
            <div className="space-y-1">
              <p className="font-['Open_Sans'] text-[#222] text-lg font-semibold">+91 92115 63311</p>
              <p className="font-['Open_Sans'] text-[#222] text-lg font-semibold">+91 92117 91188</p>
            </div>
          </div>
          
          {/* CTA Button */}
          <button 
            onClick={handleReservation}
            className="bg-[#6B8B59] hover:bg-[#5a7349] text-white font-['Montserrat'] font-semibold px-8 py-4 rounded-lg transform hover:scale-105 hover:shadow-xl transition-all duration-300 uppercase tracking-wide shadow-lg"
          >
            Reserve a Table
          </button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce z-20">
        <ChefHat className="w-6 h-6 text-[#6B8B59] drop-shadow-sm" />
      </div>
    </section>
  );
};

export default Hero;