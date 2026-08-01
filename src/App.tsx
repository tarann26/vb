import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/NavBar';
import Hero from './components/Hero';
import OurStory from './components/OurStory';
import PlaceGallery from './components/PlaceGallery';
import FoodGallery from './components/FoodGallery';
import Drinks from './components/Drinks';
import BlogTeaser from './components/BlogTeaser';
import VisitUs from './components/VisitUs';
import Footer from './components/Footer';
import ReservationPage from './components/ReservationPage';
import AdminReservations from './components/AdminReservations';
import BlogsPage from './components/BlogsPage';
import SeoHead from './components/SeoHead';

function HomePage() {
  return (
    <div className="min-h-screen">
      <SeoHead />
      <Navbar />
      <Hero />
      <OurStory />
      <PlaceGallery />
      <FoodGallery />
      <Drinks />
      <BlogTeaser />
      <VisitUs />
      <Footer />
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/reservation" element={<ReservationPage />} />
        <Route path="/admin" element={<AdminReservations />} />
        <Route path="/blogs" element={<BlogsPage />} />
      </Routes>
    </Router>
  );
}

export default App;