import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SeoHead from '../SeoHead';
import { AppRoutes } from '../../App';
import { site } from '../../content';

const canonicals = () =>
  Array.from(document.head.querySelectorAll('link[rel="canonical"]'));

describe('SeoHead', () => {
  it('declares a self-canonical for the homepage', () => {
    render(<SeoHead />);
    const links = canonicals();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(site.seo.url);
  });

  it('puts the canonical in <head>, the only place it is honoured', () => {
    const { container } = render(<SeoHead />);
    expect(container.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
  });

  it('removes the canonical when unmounted, so it cannot outlive the route', () => {
    const { unmount } = render(<SeoHead />);
    expect(canonicals()).toHaveLength(1);
    unmount();
    expect(canonicals()).toHaveLength(0);
  });

  it('still emits the Restaurant JSON-LD', () => {
    const { container } = render(<SeoHead />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const json = JSON.parse(script!.textContent ?? '{}');
    expect(json['@type']).toBe('Restaurant');
    expect(json.description).toBe(site.seo.description);
  });
});

// The regression this whole arrangement exists to prevent: index.html is
// served for every route by public/_redirects' SPA rewrite, so a canonical
// declared there pointed /blogs at the homepage -- telling Google not to
// index a page public/sitemap.xml explicitly asks it to index.
describe('canonical url per route', () => {
  it('is the homepage url on /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(canonicals().map((link) => link.getAttribute('href'))).toEqual([site.seo.url]);
  });

  // This used to assert /blogs had NO canonical, and that was the right call
  // when it was written: index.html is served for every route, so a canonical
  // there would name the homepage on /blogs too, and "no canonical" leaves a
  // page indexed under its own URL, which was correct while the site had one
  // URL.
  //
  // It has two. Cloudflare Pages serves the entire site from its generated
  // preview subdomain as well -- publicly, with `Allow: /` in robots.txt --
  // so "indexed under its own URL" now means indexed under both hosts'
  // versions of it, competing. /blogs was the only indexable route with
  // nothing to break that tie: the homepage has SeoHead's canonical and every
  // `/<slug>` page has PageSeoHead's.
  //
  // The property that mattered then still holds and is still asserted: the
  // canonical on /blogs is never the homepage's. What changed is WHICH real
  // URL it names -- Phase 5, Task 8 turned /blogs into a client-side
  // <Navigate to="/blog" replace />, so a visitor (and this test's router)
  // lands on /blog before BlogIndex's own useCanonical ever runs, and /blog
  // is what it declares. Pointing at the homepage, or at nothing, would both
  // still be worse than emitting nothing at all -- it would actively ask
  // Google to drop the page -- but the specific URL this test pins had to
  // move with the redirect.
  it('is /blog\'s own url when reached via /blogs, never the homepage\'s', () => {
    render(
      <MemoryRouter initialEntries={['/blogs']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(canonicals().map((link) => link.getAttribute('href'))).toEqual([`${site.seo.url}/blog`]);
  });

  // Exactly one, on every route that has one. Two canonical links on a page
  // have no defined winner, and the append-on-mount/remove-on-unmount shape
  // these components share is precisely the thing that produces a duplicate
  // if a cleanup is ever dropped -- which a single-element assertion above
  // would still catch, but only for the route it runs on.
  it('never emits more than one canonical on any route', () => {
    for (const route of ['/', '/blogs']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes />
        </MemoryRouter>,
      );
      expect(canonicals(), `on ${route}`).toHaveLength(1);
      unmount();
      // And nothing left behind for the next route to inherit.
      expect(canonicals(), `after leaving ${route}`).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The `noindex` that stops Cloudflare Pages' generated preview subdomain
// being indexed as a second, competing copy of the whole site.
// ---------------------------------------------------------------------------
describe('noindex on the preview host', () => {
  const robots = () => Array.from(document.head.querySelectorAll('meta[name="robots"]'));

  function renderAt(hostname: string) {
    // jsdom's `location` is not assignable, so the whole object is replaced.
    // Restored by the caller, since leaking a fake hostname into later tests
    // would make them assert against a site that isn't this one.
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, hostname, href: `https://${hostname}/` },
    });
    const result = render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    return {
      ...result,
      restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
    };
  }

  it('marks a *.pages.dev host noindex', () => {
    const { restore, unmount } = renderAt('vb-c7r.pages.dev');
    expect(robots().map((m) => m.getAttribute('content'))).toEqual(['noindex, nofollow']);
    unmount();
    // Removed on unmount, so a client-side navigation cannot strand it.
    expect(robots()).toHaveLength(0);
    restore();
  });

  // The failure mode this design exists to make impossible. An earlier,
  // more natural-reading version of the check ("hostname is not the one in
  // site.seo.url") would serve `noindex` to Googlebot on the real site for
  // as long as site.seo.url lagged the domain actually in use -- which is
  // the exact state this repository has been in for weeks while running on
  // a test host. Suffix matching cannot express that mistake.
  it.each([
    'viabiancadelhi.com',
    'www.viabiancadelhi.com',
    'vb.aionxxxi.uk',
    'localhost',
    // The nastiest near-miss: a real domain that merely CONTAINS the string.
    'pages.dev.viabiancadelhi.com',
  ])('never marks %s noindex, whatever site.seo.url currently says', (hostname) => {
    const { restore, unmount } = renderAt(hostname);
    expect(robots()).toHaveLength(0);
    unmount();
    restore();
  });
});
