import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useContent, ContentProvider, defaultBundle } from '../ContentContext';
import { copy as realCopy, posts as realPosts } from '../index';
import { AppRoutes } from '../../App';

function ReadsAtmosphereHeading() {
  const content = useContent();
  return <p>{content.copy.atmosphere.heading}</p>;
}

describe('ContentContext', () => {
  it('wraps the same static exports index.ts already validates, not a re-derived copy', () => {
    expect(defaultBundle.copy).toBe(realCopy);
  });

  // Review finding (Minor M1). Every other bundle field is held to its
  // binding by some surface that renders it -- emptying `experiences` here
  // reddens homepage-bytes, for instance. `posts` has no rendering surface
  // until Tasks 7-9, so mutating `defaultBundle.posts` to `[]` reddened
  // NOTHING across all 2960 tests: an unguarded binding those tasks would
  // have inherited, and the exact shape of the defect Phase 3 shipped when
  // /edit's carousel drew zero cards against six live ones.
  //
  // THE MUTATION: change `posts,` to `posts: []` in ContentContext.ts's
  // defaultBundle. Identity fails first, then the length assertion -- so
  // this also catches the subtler `posts: [...posts]`, which would be a
  // re-derived copy rather than the validated export and is the same class
  // of mistake this test's own sibling above was written for.
  it('binds posts to the validated export itself, not an empty or copied stand-in', () => {
    expect(defaultBundle.posts).toBe(realPosts);
    expect(defaultBundle.posts.length).toBeGreaterThan(0);
  });

  it('renderText default is the identity function', () => {
    expect(defaultBundle.renderText('atmosphere.heading', 'hello')).toBe('hello');
  });

  it('renderImage default renders a plain <img> carrying the given props', () => {
    render(<>{defaultBundle.renderImage('galleries.atmosphere.0', { src: '/x.webp', alt: 'y' })}</>);
    const img = screen.getByAltText('y');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/x.webp');
  });

  it('useContent falls back to defaultBundle with no provider mounted', () => {
    render(<ReadsAtmosphereHeading />);
    expect(screen.getByText(realCopy.atmosphere.heading)).toBeInTheDocument();
  });

  // The gate that actually proves the mechanism works: a provider value
  // reaches a real rendered component, not just a component built to read
  // useContent() for this test's own sake. PlaceGallery is the first
  // component migrated below to read copy.atmosphere.heading through
  // useContent() rather than a static import -- reverting that one file's
  // migration (back to `import { copy } from '../content'`) turns this red,
  // since PlaceGallery would then always render the real heading regardless
  // of what provider value is mounted around it.
  it('renders the provider value when one is present', () => {
    const bundle = {
      ...defaultBundle,
      copy: { ...defaultBundle.copy, atmosphere: { heading: 'Sentinel' } },
    };
    render(
      <ContentProvider value={bundle}>
        <MemoryRouter>
          <AppRoutes />
        </MemoryRouter>
      </ContentProvider>,
    );
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
  });
});
