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
// served for every route by vercel.json's SPA rewrite, so a canonical
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

  it('is absent on /blogs rather than pointing at the homepage', () => {
    render(
      <MemoryRouter initialEntries={['/blogs']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(canonicals()).toHaveLength(0);
  });
});
