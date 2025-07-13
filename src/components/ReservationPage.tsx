
import React from 'react';
import ReservationForm from './ReservationForm';
import Footer from './Footer';

const ReservationPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <h1 className="font-['Parisienne'] text-4xl text-[#222] mb-2">Via Bianca</h1>
              <p className="font-['Montserrat'] text-[#6B8B59] text-sm uppercase tracking-wider">
                Pastificio & Ristorante
              </p>
            </div>
            <button 
              onClick={() => window.location.href = '/'}
              className="text-[#6B8B59] hover:text-[#222] font-['Montserrat'] text-sm uppercase tracking-wide"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>

      {/* Reservation Form */}
      <ReservationForm />
      
      {/* Footer */}
      <Footer />
    </div>
  );
};

export default ReservationPage;
