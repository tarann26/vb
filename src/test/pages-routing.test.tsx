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
  // I4 review fix: this test's name has always claimed to prove the restore
  // -- but never actually unmounted anything. The old body hand-assigned
  // `document.title = originalTitle` itself and called that a "sanity"
  // check, which passes identically whether PageSeoHead's own cleanup runs
  // or not (confirmed directly: commenting out that cleanup line entirely
  // left this test green). A real `unmount()` -- the same thing a route
  // change back to `/`, or to any route with no page metadata of its own,
  // actually does to this component -- is what exercises the cleanup for
  // real.
  it('sets document.title on mount, and restores the previous title on unmount (navigating away)', async () => {
    // A controlled sentinel, not whatever `document.title` happens to hold
    // when this test starts -- jsdom's own document (and therefore its
    // title) is shared across every test in this FILE (vitest's default
    // per-file, not per-test, isolation), so an earlier test in this same
    // describe block already having rendered (and unmounted) a PageSeoHead
    // for this exact page could otherwise leave `document.title` already
    // sitting at 'Our Menu | Via Bianca' before this test's own first line
    // ever runs -- which would make THIS test pass even under the mutation
    // it exists to catch (both sides of the final assertion would read the
    // same already-leaked value). Confirmed directly: reading the ambient
    // title instead of setting a sentinel first stayed green under exactly
    // the cleanup-removed mutation this test's own comment below names.
    document.title = 'Sentinel Title Before Mount';
    const { unmount } = await renderWithPages([makePage()], '/our-menu');
    expect(document.title).toBe('Our Menu | Via Bianca');
    unmount();
    // Mutation this guards: PageSeoHead's own cleanup
    // (`document.title = previousTitle`) replaced with a no-op -- confirmed
    // red, `document.title` stays at the page's own title instead of
    // reverting when this test's own homepage search snippet needs it to.
    expect(document.title).toBe('Sentinel Title Before Mount');
  });

  it('rewrites the existing <meta name="description"> tag\'s content, not a second, competing one, and restores it on unmount', async () => {
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

    const { unmount } = await renderWithPages([makePage()], '/our-menu');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'A short, honest description.',
    );

    // I4 review fix: the old test stopped here, then removed `meta` BY HAND
    // in its own teardown -- proving the mutate-not-append half but nothing
    // about restore. A real `unmount()` is what a route change actually
    // does; PageSeoHead's own cleanup must put the site-wide description
    // back, or the NEXT page (or the homepage) would silently keep showing
    // this page's own snippet in search results.
    unmount();
    // Mutation this guards: PageSeoHead's own cleanup restoring
    // `descriptionMeta`'s content replaced with a no-op -- confirmed red,
    // the tag stays at this page's own description instead of reverting.
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'The original, site-wide description.',
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

// I1 review finding: copy.nav.links's own "#"-fragment hrefs (e.g.
// "#our-story") only ever resolve against the HOMEPAGE's own DOM -- on a
// page route, `document.querySelector('#our-story')` is null (a page
// renders its own `page.sections`, never the homepage's), so a bare
// "#our-story" link there scrolled nowhere, on every page she creates. The
// fix: NavBar prefixes a section link with "/" when it is not rendering the
// homepage's own content, so the link returns to `/` (where the id it names
// really exists) instead of dying on the current route.
describe('NavBar: a section link ("#our-story") returns to the homepage when off it (I1)', () => {
  it('prefixes a section link with "/" on a page route, so it targets the homepage', async () => {
    await renderWithPages([makePage()], '/our-menu');
    const links = screen.getAllByRole('link');
    const sectionLink = links.find((l) => l.getAttribute('href')?.startsWith('#') || l.getAttribute('href')?.startsWith('/#'));
    expect(sectionLink).toBeDefined();
    expect(sectionLink?.getAttribute('href')).toMatch(/^\/#/);
  });

  it('leaves a section link as a bare "#anchor" on the homepage itself, unchanged', async () => {
    await renderWithPages([makePage()], '/');
    const links = screen.getAllByRole('link');
    const sectionLink = links.find((l) => l.getAttribute('href')?.startsWith('#'));
    expect(sectionLink).toBeDefined();
    expect(sectionLink?.getAttribute('href')).not.toMatch(/^\//);
  });
});
