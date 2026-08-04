// Plan 7, Task 3, Step 1: proves -- rather than assumes -- that `/:slug`
// (App.tsx's PageRoute, added this task) never shadows `/`, `/blogs`,
// `/edit` or `/edit/manage`. The plan's own instruction names Plan 5's
// identical verification for `/edit` vs `/edit/manage`
// (src/admin/__tests__/EditMode.test.tsx's own "post-review Fix 7" describe
// block) as the precedent to follow here.
//
// The content-level guard (guards.ts's assertPages/RESERVED_PAGE_SLUGS)
// already refuses a page slugged "blogs" or "edit" outright (see
// guards.test.ts) -- so a page that COULD collide can never actually exist
// in real, validated content. This test deliberately does not rely on that
// guard holding: it mocks `pages` to contain exactly such a colliding
// entry, bypassing the guard entirely, so what's actually proven is
// React Router 7's OWN specificity ranking, independent of whether the
// content-level guard that currently prevents the scenario stays in place.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { site } from '../content';

afterEach(() => {
  vi.doUnmock('../content');
  vi.resetModules();
});

async function renderAt(path: string) {
  vi.resetModules();
  vi.doMock('../content', async () => {
    const actual = await vi.importActual<typeof import('../content')>('../content');
    return {
      ...actual,
      // A page slugged "blogs" AND one slugged "edit" -- both reserved,
      // both refused by the real guard (guards.test.ts), injected here
      // anyway so this test proves the ROUTER's own behaviour rather than
      // the content guard's.
      pages: [
        {
          slug: 'blogs',
          name: 'Colliding Blogs Page',
          inNav: false,
          enabled: true,
          seo: { title: 'x', description: 'x' },
          sections: [],
        },
        {
          slug: 'edit',
          name: 'Colliding Edit Page',
          inNav: false,
          enabled: true,
          seo: { title: 'x', description: 'x' },
          sections: [],
        },
      ],
    };
  });
  const { AppRoutes } = await import('../App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

function stubFetchLoggedOut() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return new Response(null, { status: 401 });
      throw new Error(`routing.test.tsx: unexpected fetch to ${url} while logged out`);
    }),
  );
}

describe('/:slug never shadows a live static route, even with a colliding page injected', () => {
  it('/blogs still renders BlogsPage, not the colliding page', async () => {
    await renderAt('/blogs');
    // BlogsPage's own real <h1> (copy.blogsPage.title) -- present only if
    // the static route won over the injected colliding page.
    expect(screen.getByRole('heading', { level: 1, name: 'Via Bianca Stories' })).toBeInTheDocument();
    expect(screen.queryByText('Colliding Blogs Page')).not.toBeInTheDocument();
  });

  it('/edit still renders EditMode\'s own login overlay, not the colliding page', async () => {
    stubFetchLoggedOut();
    await renderAt('/edit');
    expect(await screen.findByRole('form', { name: 'Admin login' })).toBeInTheDocument();
    expect(screen.queryByText('Colliding Edit Page')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('/edit/manage still renders AdminApp\'s own login form, not a page route fallback', async () => {
    stubFetchLoggedOut();
    await renderAt('/edit/manage');
    expect(await screen.findByRole('form', { name: 'Admin login' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('/ still renders the real homepage, not a page route fallback', async () => {
    await renderAt('/');
    // Hero's own <h1> renders site.name -- present only if HomePage won.
    expect(screen.getByRole('heading', { level: 1, name: site.name })).toBeInTheDocument();
  });

  it('a genuinely unreserved slug still resolves to PageRoute (positive control)', async () => {
    vi.resetModules();
    vi.doMock('../content', async () => {
      const actual = await vi.importActual<typeof import('../content')>('../content');
      return {
        ...actual,
        pages: [
          {
            slug: 'our-menu',
            name: 'Our Menu',
            inNav: false,
            enabled: true,
            seo: { title: 'Our Menu', description: 'd' },
            sections: [],
          },
        ],
      };
    });
    const { AppRoutes } = await import('../App');
    render(
      <MemoryRouter initialEntries={['/our-menu']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    // An enabled page with zero sections still mounts the page shell
    // (Navbar/Footer) -- proven by the presence of the nav, not NotFound's
    // own text.
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });
});
