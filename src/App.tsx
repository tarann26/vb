import { Fragment, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
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
import PageSeoHead from './components/PageSeoHead';
import NotFound from './components/NotFound';
import type { SectionId, Section } from './content';
import { useContent } from './content/ContentContext';
import TextSection from './components/templates/TextSection';
import ItemListSection from './components/templates/ItemListSection';
import GallerySection from './components/templates/GallerySection';
import DetailBlockSection from './components/templates/DetailBlockSection';

// The only reference to admin code anywhere outside src/admin/ itself, and
// it must stay that way -- src/test/bundle.test.ts fails the build the
// moment a second one appears, static or dynamic. React.lazy's own dynamic
// import is what keeps everything reachable from AdminApp out of the chunk
// every visitor downloads; a plain top-level import here would put it back
// in, unconditionally, for every single page load.
const AdminApp = lazy(() => import('./admin/AdminApp'));

// The real homepage rendered with live content instead of the build-time
// snapshot (Plan 5 Task 2) -- a second, independent lazy chunk, same
// reasoning as AdminApp above. React Router 7 ranks routes by specificity
// regardless of declaration order, so this and '/edit/manage/*' below never
// need to worry about which is listed first; in practice they do not even
// overlap, since a bare `path="/edit"` Route matches only the exact
// '/edit' path, never a deeper one.
const EditMode = lazy(() => import('./admin/EditMode'));

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

// Plan 7, Task 1: `Section` is now a discriminated union (bespoke | template)
// -- see src/content/types.ts's own comment on why. `renderSection` is the
// one place both HomePage (below) and EditMode.tsx's own `DynamicSections`
// dispatch through, so the two can never drift on WHICH branch handles
// which kind, only (as before) on which COMPONENT a given id maps to.
//
// Plan 7, Task 2: the four real template components
// (src/components/templates/) replace Task 1's own `null` stubs here, still
// through the exact same exhaustive switch shape -- delete a case below (or
// add a fifth TemplateType without a case) and `_exhaustive: never` fails
// `tsc -b`, naming this file, proven directly in Task 1's own commit and
// unchanged by this swap.
function renderSection(section: Section): ReactNode {
  if (section.kind === 'bespoke') {
    return SECTION_COMPONENTS[section.id]();
  }
  switch (section.template) {
    case 'text':
      return <TextSection id={section.id} content={section.content} />;
    case 'itemList':
      return <ItemListSection id={section.id} content={section.content} />;
    case 'gallery':
      return <GallerySection id={section.id} content={section.content} />;
    case 'detailBlock':
      return <DetailBlockSection id={section.id} content={section.content} />;
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export function HomePage() {
  const { sections } = useContent();
  return (
    <div className="min-h-screen">
      <SeoHead />
      <Navbar />
      {sections
        .filter((section) => section.enabled)
        .map((section) => (
          <Fragment key={section.id}>{renderSection(section)}</Fragment>
        ))}
      <Footer />
    </div>
  );
}

// Plan 7, Task 3, Step 1: a page she creates, rendered at `/:slug`. A
// disabled page and a nonexistent slug both resolve here identically --
// `pages.find` returns `undefined` for either (a disabled page is filtered
// out by the same `&& p.enabled` check a nonexistent one would fail
// anyway), and both fall through to the exact same <NotFound /> the
// catch-all route below already renders for a URL that matches nothing at
// all. No separate "this page exists but is off" message: from a visitor's
// (or a crawler's) side, the two are indistinguishable on purpose -- a
// disabled page must not even hint that a slug is reserved for something
// she has simply switched off.
function PageRoute() {
  const { slug } = useParams<{ slug: string }>();
  const { pages } = useContent();
  const page = pages.find((p) => p.slug === slug && p.enabled);
  if (!page) return <NotFound />;
  return (
    <div className="min-h-screen">
      <PageSeoHead page={page} />
      {/* I1 review fix: this page renders `page.sections`, never the
          homepage's own -- `offHomePage` tells Navbar its usual "#anchor"
          section links would resolve against DOM ids that do not exist on
          THIS page, and to prefix them back to the homepage instead. */}
      <Navbar offHomePage />
      {page.sections
        .filter((section) => section.enabled)
        .map((section) => (
          <Fragment key={section.id}>{renderSection(section)}</Fragment>
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
      <Route
        path="/edit"
        element={
          <Suspense fallback={null}>
            <EditMode />
          </Suspense>
        }
      />
      <Route
        path="/edit/manage/*"
        element={
          <Suspense fallback={null}>
            <AdminApp />
          </Suspense>
        }
      />
      {/* Plan 7, Task 3, Step 1: React Router 7 ranks routes by
          specificity, not declaration order (the same property Plan 5
          relied on for '/edit' vs '/edit/manage', and pinned by a
          regression test there) -- '/blogs', '/edit' and '/edit/manage/*'
          above are all more specific than this single dynamic segment and
          win regardless of where this line sits. Verified directly, not
          just assumed: src/test/routing.test.tsx pins exactly this
          property for every one of those routes against a page slugged to
          collide with each. */}
      <Route path="/:slug" element={<PageRoute />} />
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