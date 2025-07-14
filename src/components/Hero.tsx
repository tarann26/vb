import React from 'react';
import { ChefHat } from 'lucide-react';
import { useNavigate } from 'react-router-dom';


const Hero: React.FC = () => {
 const navigate = useNavigate();


 return (
  <section className="min-h-screen bg-white relative flex items-center justify-center overflow-hidden">
    {/* brick background */}
    <img
      src="/hero/brick.jpg"
      alt=""
      className="absolute inset-0 -z-20 w-full h-full object-cover opacity-20"
    />
     {/* ===== Collage ===== */}
     <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 gap-1">
      {[
        // [src, extraTailwindClasses]
        ['', 'col-span-2 row-span-2'],
        ['/hero/scene.png', 'col-start-5 col-span-2 row-span-2'],
        ['', 'col-span-2 row-start-5 row-span-2'],
        ['/hero/farfalle3.png', 'col-start-5 col-span-2 row-start-5 row-span-2'],
        // thin edge fillers…
        ['/hero/farfalle1.png', 'col-start-3 col-span-2 row-span-1'],
        ['/public/atmosphere/dining.jpg', 'col-start-3 col-span-2 row-start-6 row-span-1'],
        ['/public/atmosphere/ambience.JPG', 'col-span-1 row-start-3 row-span-2'],
        ['/hero/bus.jpeg', 'col-start-6 col-span-1 row-start-3 row-span-2'],        // subtle middle accents (kept, but you can drop if you like)
        ['/hero/bus.jpeg', 'col-start-3 col-span-1 row-start-2'],
        ['/public/atmosphere/ceiling decor.png', 'col-start-3 col-span-1 row-start-2'],
        ['/public/our_story/oven.JPG', 'col-start-4 col-span-1 row-start-2'],
        ['/public/atmosphere/front mirror.png', 'col-start-2 col-span-1 row-start-3'],
        ['/hero/building.png', 'col-start-5 col-span-1 row-start-3'],
        ['/public/our_story/stuff.JPG', 'col-start-2 col-span-1 row-start-4'],
        ['/public/atmosphere/room.png', 'col-start-5 col-span-1 row-start-4'],
        ['/public/our_story/cut.JPG', 'col-start-3 col-span-1 row-start-5'],
        ['/hero/farfalle.png', 'col-start-4 col-span-1 row-start-5'],
      ].map(([src, cls], i) => (
         <div key={i} className={`${cls} relative overflow-hidden`}>
           <img
             src={src as string}
             alt=""
             className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity duration-500"
           />
         </div>
       ))}
     </div>


     {/* ===== White strip (blocks collage under the content) ===== */}
     <div className="absolute inset-0 flex justify-center pointer-events-none">
       {/* adjust max-w to tweak width of the clear strip */}
       <div className="w-full max-w-[600px] bg-white/95"></div>
     </div>


     {/* ===== Main content ===== */}
     <div className="relative z-10 text-center px-6">
       {/* circular logo */}
       <div className="w-40 h-40 mx-auto mb-8 flex items-center justify-center rounded-full border-4 border-[#6B8B59] bg-white shadow-lg">
         <div className="select-none">
           <h1 className="font-['Parisienne'] text-3xl text-[#222]">Via Bianca</h1>
           <p className="font-['Montserrat'] text-xs uppercase tracking-wider text-[#6B8B59]">
             Pastificio & Ristorante
           </p>
         </div>
       </div>


       <h2 className="font-['Parisienne'] text-6xl md:text-7xl text-[#222] mb-4">Via Bianca</h2>
       <p className="font-['Montserrat'] text-lg md:text-xl uppercase tracking-wide text-[#6B8B59] mb-6">
         Pastificio & Ristorante
       </p>
       <p className="font-['Parisienne'] text-2xl md:text-3xl text-[#222] mb-8">
         Sip&nbsp;Italiano,&nbsp;Taste&nbsp;the&nbsp;Soul&nbsp;of&nbsp;Puglia
       </p>


       {/* reservation numbers */}
       <div className="mb-8">
         <p className="font-['Montserrat'] text-sm tracking-wide uppercase text-[#6B8B59]">For reservations</p>
         <p className="font-['Open_Sans'] text-lg font-semibold text-[#222]">+91&nbsp;92115&nbsp;63311</p>
         <p className="font-['Open_Sans'] text-lg font-semibold text-[#222]">+91&nbsp;92117&nbsp;91188</p>
       </div>


       <button
  onClick={() =>
    window.open('https://wa.me/919211791188?text=Hi%2C%20I%20want%20to%20reserve%20a%20table', '_blank')
  }
  className="bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-semibold uppercase tracking-wide shadow-lg hover:shadow-xl transition-all duration-300"
>
  Reserve a Table
</button>

     </div>


     {/* scroll cue */}
     <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
       <ChefHat className="w-6 h-6 text-[#6B8B59]" />
     </div>
   </section>
 );
};


export default Hero;
