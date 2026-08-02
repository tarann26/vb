import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Every string this suite exercises already has an identical, pre-existing
// value in copy.json / site.json (Task 1 transcribed it correctly). That
// means a naive `render(<Drinks />); expect(screen.getByText(copy.drinks.intro))`
// assertion passes whether Drinks.tsx reads `copy.drinks.intro` or still
// hardcodes the literal -- the two strings are identical today, so it can
// never fail for the right reason. See Hero.test.tsx's `h1.textContent ===
// site.name` assertion for the same trap.
//
// So instead of matching against today's content value, each test here
// swaps the underlying content module for a fixture whose strings are
// guaranteed to differ from any hardcoded literal in the component, then
// asserts the fixture strings (not the real ones) are what renders. If a
// string is still hardcoded, the fixture text is absent from the DOM and
// the assertion fails with "Unable to find an element" -- a genuine
// hardcoded-string failure, not a missing-import or setup failure.
//
// Mock factories spread `vi.importActual` and override only the fields
// under test, per Footer.test.tsx's LinkedIn tests -- a bare object literal
// would drop every other export (dishes, drinks, story, hours helpers, ...)
// and break unrelated component internals that import from '../../content'
// during the same module graph.
describe('copy-rendered', () => {
  afterEach(() => {
    vi.doUnmock('../../content');
    vi.resetModules();
  });

  it('Hero renders site.name/site.tagline and copy.hero fields from content, not hardcoded literals', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        site: { ...actual.site, name: 'Fixture Ristorante Name', tagline: 'Fixture Ristorante Tagline' },
        copy: {
          ...actual.copy,
          hero: {
            ...actual.copy.hero,
            logoName: 'Fixture Logo Circle Name',
            logoTagline: 'Fixture Logo Circle Tagline',
            reservationsLabel: 'Fixture Reservations Label',
            reserveButton: 'Fixture Reserve Button',
          },
        },
      };
    });
    const { default: Hero } = await import('../Hero');

    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>,
    );

    // h1 and the subtitle paragraph read site.name/site.tagline directly.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fixture Ristorante Name');
    expect(screen.getByText('Fixture Ristorante Tagline')).toBeInTheDocument();
    // The decorative logo circle reads copy.hero.logoName/logoTagline -- a
    // separate pair of fields, deliberately not shared with the h1/subtitle.
    expect(screen.getByText('Fixture Logo Circle Name')).toBeInTheDocument();
    expect(screen.getByText('Fixture Logo Circle Tagline')).toBeInTheDocument();
    expect(screen.getByText('Fixture Reservations Label')).toBeInTheDocument();
    expect(screen.getByText('Fixture Reserve Button')).toBeInTheDocument();
  });

  it('Drinks renders its heading, intro and category labels from copy.drinks', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        copy: {
          ...actual.copy,
          drinks: {
            heading: 'Fixture Drinks Heading',
            intro: 'Fixture drinks intro sentence describing the bar programme.',
            mocktails: 'Fixture Mocktails Label',
            cocktails: 'Fixture Cocktails Label',
            wine: 'Fixture Wine Label',
          },
        },
      };
    });
    const { default: Drinks } = await import('../Drinks');

    render(<Drinks />);

    expect(screen.getByRole('heading', { name: 'Fixture Drinks Heading' })).toBeInTheDocument();
    expect(
      screen.getByText('Fixture drinks intro sentence describing the bar programme.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fixture Mocktails Label' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fixture Cocktails Label' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fixture Wine Label' })).toBeInTheDocument();
  });

  it('BlogTeaser renders its heading, intro, CTA and article-link label from copy.press', async () => {
    const fixtureArticle = {
      id: 'fixture-article',
      title: 'Fixture Article Title',
      publication: 'Fixture Publication',
      date: '2026-01-01',
      excerpt: 'Fixture excerpt text.',
      url: 'https://example.com/fixture',
      image: '/fixture.jpg',
    };
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        press: [fixtureArticle],
        copy: {
          ...actual.copy,
          press: {
            heading: 'Fixture Press Heading',
            intro: 'Fixture press intro sentence about critics.',
            readArticle: 'Fixture Read Article Label',
            viewAll: 'Fixture View All Label',
          },
        },
      };
    });
    const { default: BlogTeaser } = await import('../BlogTeaser');

    render(
      <MemoryRouter>
        <BlogTeaser />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Fixture Press Heading' })).toBeInTheDocument();
    expect(screen.getByText('Fixture press intro sentence about critics.')).toBeInTheDocument();
    expect(screen.getByText('Fixture Read Article Label')).toBeInTheDocument();
    expect(screen.getByText('Fixture View All Label')).toBeInTheDocument();
  });

  it('BlogsPage renders its title, subtitle, back link, heading, intro and pagination labels, and reuses copy.press.readArticle', async () => {
    const fixtureArticles = Array.from({ length: 11 }, (_, i) => ({
      id: `fixture-article-${i}`,
      title: `Fixture Article ${i}`,
      publication: 'Fixture Publication',
      date: '2026-01-01',
      excerpt: 'Fixture excerpt text.',
      url: i === 0 ? 'https://example.com/fixture' : null,
      image: '/fixture.jpg',
    }));
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        press: fixtureArticles,
        copy: {
          ...actual.copy,
          blogsPage: {
            title: 'Fixture BlogsPage Title',
            subtitle: 'Fixture BlogsPage Subtitle',
            heading: 'Fixture BlogsPage Heading',
            intro: 'Fixture blogsPage intro sentence.',
            back: '← Fixture Back Label',
            previous: 'Fixture Previous Label',
            next: 'Fixture Next Label',
          },
          press: { ...actual.copy.press, readArticle: 'Fixture Shared Read Article Label' },
        },
      };
    });
    const { default: BlogsPage } = await import('../BlogsPage');

    render(
      <MemoryRouter>
        <BlogsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fixture BlogsPage Title');
    expect(screen.getByText('Fixture BlogsPage Subtitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Fixture Back Label' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Fixture BlogsPage Heading');
    expect(screen.getByText('Fixture blogsPage intro sentence.')).toBeInTheDocument();
    expect(screen.getByText('Fixture Shared Read Article Label')).toBeInTheDocument();
    // 11 fixture articles at 10/page forces a second page, so Previous/Next render.
    expect(screen.getByText('Fixture Previous Label')).toBeInTheDocument();
    expect(screen.getByText('Fixture Next Label')).toBeInTheDocument();
  });

  it('NotFound renders its heading and back-home label from copy.notFound', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        copy: {
          ...actual.copy,
          notFound: { heading: 'Fixture Not Found Heading', back: 'Fixture Back Home Label' },
        },
      };
    });
    const { default: NotFound } = await import('../NotFound');

    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Fixture Not Found Heading' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fixture Back Home Label' })).toBeInTheDocument();
  });
});
