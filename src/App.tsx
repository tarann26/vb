import { Fragment, type ReactNode } from 'react';
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
import { sections, type SectionId } from './content';

// Typed as `Record<SectionId, ...>` so tsc enforces exhaustiveness: adding a
// SectionId without adding a matching case here is a build failure, not a
// section that silently stops rendering.
const SECTION_COMPONENTS: Record<SectionId, () => ReactNode> = {
  hero: () => <Hero />,
  ourStory: () => <OurStory />,
  atmosphere: () => <PlaceGallery />,
  food: () => <FoodGallery />,
  drinks: () => <Drinks />,
  press: () => <BlogTeaser />,
  visit: () => <VisitUs />,
};

export function HomePage() {
  return (
    <div className="min-h-screen">
      <SeoHead />
      <Navbar />
      {sections
        .filter((section) => section.enabled)
        .map((section) => (
          <Fragment key={section.id}>{SECTION_COMPONENTS[section.id]()}</Fragment>
        ))}
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