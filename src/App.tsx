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
import BlogsPage from './components/BlogsPage';
import SeoHead from './components/SeoHead';
import NotFound from './components/NotFound';

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/blogs" element={<BlogsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}

export default App;