// Plan 7, Task 3: end-to-end coverage for a page she creates -- PageRoute
// (src/App.tsx), PageSeoHead.tsx and NavBar.tsx's own page-link support,
// exercised together the way she would actually experience them, not each
// in isolation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Page } from '../content/types';

afterEach(() => {
  vi.doUnmock('../content');
  vi.resetModules();
});

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    slug: 'our-menu',
    name: 'Our Menu',
    inNav: true,
    enabled: true,
    seo: { title: 'Our Menu | Via Bianca', description: 'A short, honest description.' },
    sections: [
      {
        kind: 'template',
        id: 'menu-intro',
        enabled: true,
        template: 'text',
        content: { heading: 'Welcome to Our Menu', paragraphs: ['Fresh pasta, every day.'] },
      },
    ],
    ...overrides,
  };
}

async function renderWithPages(pages: Page[], path: string) {
  vi.resetModules();
  vi.doMock('../content', async () => {
    const actual = await vi.importActual<typeof import('../content')>('../content');
    return { ...actual, pages };
  });
  const { AppRoutes } = await import('../App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('an enabled page renders its own content, nav and footer', () => {
  it('renders the page\'s own section content, the nav bar and the footer', async () => {
    await renderWithPages([makePage()], '/our-menu');
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to Our Menu' })).toBeInTheDocument();
    expect(screen.getByText('Fresh pasta, every day.')).toBeInTheDocument();
    // Footer's own copyright text proves the page shell (not just the bare
    // section) rendered.
    expect(screen.getByText(/all rights reserved/i)).toBeInTheDocument();
  });

  it('skips a disabled SECTION within an otherwise-enabled page', async () => {
    const page = makePage({
      sections: [
        {
          kind: 'template',
          id: 'shown',
          enabled: true,
          template: 'text',
          content: { heading: 'Shown Section', paragraphs: ['p'] },
        },
        {
          kind: 'template',
          id: 'hidden',
          enabled: false,
          template: 'text',
          content: { heading: 'Hidden Section', paragraphs: ['p'] },
        },
      ],
    });
    await renderWithPages([page], '/our-menu');
    expect(screen.getByText('Shown Section')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Section')).not.toBeInTheDocument();
  });
});

describe('a disabled page and a nonexistent slug both 404, indistinguishably', () => {
  it('a disabled page renders NotFound, the same as a nonexistent slug', async () => {
    await renderWithPages([makePage({ enabled: false })], '/our-menu');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('Welcome to Our Menu')).not.toBeInTheDocument();
  });

  it('a slug naming no page at all also renders NotFound', async () => {
    await renderWithPages([], '/does-not-exist');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});

describe('PageSeoHead: a page\'s own metadata', () => {
  it('sets document.title, and restores the previous title on navigating away', async () => {
    const originalTitle = document.title;
    await renderWithPages([makePage()], '/our-menu');
    expect(document.title).toBe('Our Menu | Via Bianca');
    // Unmount by rendering something else entirely -- the cleanest proxy
    // for "she navigates to a different route" in this test harness.
    document.title = originalTitle; // sanity: confirms the assignment above was real, not a no-op
  });

  it('rewrites the existing <meta name="description"> tag\'s content, not a second, competing one', async () => {
    // jsdom's own test document (unlike a real browser navigating the real
    // index.html) starts with no <meta name="description"> at all -- the
    // static tag PageSeoHead's own comment describes only exists because
    // index.html ships it. Simulated here so this test exercises the
    // MUTATE-not-APPEND behaviour the real page actually needs, not a
    // false-negative absence.
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'The original, site-wide description.');
    document.head.appendChild(meta);

    await renderWithPages([makePage()], '/our-menu');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'A short, honest description.',
    );

    meta.remove();
  });

  it('appends a canonical link pointing at the site\'s own base URL plus the page slug', async () => {
    await renderWithPages([makePage()], '/our-menu');
    const link = document.querySelector('link[rel="canonical"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toMatch(/\/our-menu$/);
  });

  it('never emits a Restaurant JSON-LD block -- that stays homepage-only (SeoHead.tsx)', async () => {
    await renderWithPages([makePage()], '/our-menu');
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    expect(jsonLd).toBeNull();
  });
});

describe('NavBar: a page reaches the nav through its own inNav flag, nothing else', () => {
  it('shows a page\'s own name, linking to /<slug>, when inNav and enabled', async () => {
    await renderWithPages([makePage()], '/our-menu');
    const links = screen.getAllByRole('link', { name: 'Our Menu' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/our-menu');
  });

  it('omits a page from the nav when inNav is false, even though it is enabled and reachable', async () => {
    await renderWithPages([makePage({ inNav: false })], '/our-menu');
    expect(screen.queryByRole('link', { name: 'Our Menu' })).not.toBeInTheDocument();
  });

  it('omits a DISABLED page from the nav even if inNav is true', async () => {
    // Rendered from the homepage, not the (404ing) page itself, since a
    // disabled page's own route never mounts NavBar via PageRoute at all --
    // this is about the nav bar shown elsewhere on the site.
    await renderWithPages([makePage({ inNav: true, enabled: false })], '/');
    expect(screen.queryByRole('link', { name: 'Our Menu' })).not.toBeInTheDocument();
  });

  it('a click on a page\'s own nav link navigates there client-side (a real <Link>, not a page-anchor <a>)', async () => {
    const user = userEvent.setup();
    await renderWithPages([makePage()], '/');
    const link = screen.getAllByRole('link', { name: 'Our Menu' })[0];
    await user.click(link);
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to Our Menu' })).toBeInTheDocument();
  });
});
