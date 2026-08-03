// Review finding (Task 9): every whole-file section in AdminApp.tsx
// (ArraySection, SectionsSection, HoursSection, MenusSection, GallerySection,
// StorySection, CopySection) hands `fetchContent`'s own unchecked
// `JSON.parse(...) as ContentTypeMap[K]` (src/admin/content.ts's own header
// comment already calls this out) straight into `.map`/`.length`/property
// reads with no runtime guard. A malformed galleries.json, story.json or
// menus.json throws mid-render -- and because the ONLY error boundary
// anywhere in this app is main.tsx's top-level one, wrapping the WHOLE SPA
// (not just AdminApp), that throw unmounts EVERY section, not just the
// broken one: she loses Dishes, Drinks, Press, Sections and Hours too, with
// no way back in except reloading, which fails identically against the same
// bad file. CopySection already defended itself (`leafValue`/`withLeaf`'s
// own fallbacks) -- this is the same idea, generalized to every section, so
// a bug in one JSON file costs one section, never the whole page.
//
// A second, admin-specific component rather than reusing
// src/components/ErrorBoundary.tsx: that one is styled and worded for a
// full-page failure of the PUBLIC site (a "Reload" link back to "/"), which
// inside one <section> of the logged-in dashboard would read as a broken,
// out-of-place fragment and would navigate her OUT of the dashboard on the
// one click she has.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  // Named in the fallback message, so "one section" reads as a specific,
  // recognizable one to her ("Menus", not "a section").
  name: string;
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} section failed to render:`, error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <section className="mb-10">
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 font-['Montserrat'] text-sm text-red-700">
          {`Could not show ${this.props.name} — something in this file's content confused this page. The rest of the dashboard is unaffected; try reloading.`}
        </p>
      </section>
    );
  }
}

export default SectionErrorBoundary;
