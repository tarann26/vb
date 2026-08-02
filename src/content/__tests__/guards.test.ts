import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('guards module', () => {
  it('imports no JSON, so a Worker can use it', () => {
    // `import.meta.url` is routed through a variable rather than passed as a
    // literal second argument to `new URL(...)`: Vite's import-analysis
    // plugin statically recognizes the exact syntactic pattern
    // `new URL('literal', import.meta.url)` as its asset-URL-import feature
    // and rewrites the base to the dev-server origin (`http://localhost:3000/`)
    // instead of leaving it a `file:` URL -- confirmed directly, `readFileSync`
    // then throws "The URL must be of scheme file". Assigning `import.meta.url`
    // to `metaUrl` first (so the call site no longer matches that pattern)
    // sidesteps the rewrite and resolves to the real file on disk.
    const metaUrl = import.meta.url;
    const source = readFileSync(new URL('../guards.ts', metaUrl), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/[a-z-]+\.json['"]/);
  });

  it('accepts a valid copy fixture and rejects a blank string in it', async () => {
    const { assertCopy } = await import('../guards');
    const valid = {
      nav: {
        wordmark: 'Via Bianca',
        links: [{ section: 'hero', label: 'Home', href: '#a' }],
        instagramLabel: 'Follow Via Bianca on Instagram',
        menuLabel: 'Menu',
      },
      hero: {
        logoName: 'Via Bianca',
        logoTagline: 'Pastificio & Ristorante',
        reservationsLabel: 'For reservations',
        reserveButton: 'Reserve a Table',
      },
      atmosphere: { heading: 'Atmosfera' },
      food: { heading: 'Hand-crafted Pastas' },
      drinks: {
        heading: 'Drinks',
        intro: 'Our bar pours a full Italian programme.',
        mocktails: 'Mocktails',
        cocktails: 'Cocktails',
        wine: 'Wine',
      },
      press: {
        heading: 'Latest Stories',
        intro: 'Discover what critics are saying.',
        readArticle: 'Read Article',
        viewAll: 'View All Stories',
      },
      visit: { heading: 'Visit Us', navigateButton: 'Navigate', mapTitle: 'Via Bianca Location' },
      footer: {
        hoursHeading: 'Opening Hours',
        followLabel: 'Follow Us:',
        reservationsLabel: 'For Reservations:',
        rightsSuffix: '. All rights reserved.',
        instagramLabel: 'Follow Via Bianca on Instagram',
        linkedinLabel: 'Connect with Via Bianca on LinkedIn',
      },
      blogsPage: {
        title: 'Via Bianca Stories',
        subtitle: 'News and press',
        heading: 'Stories',
        intro: 'Read the latest.',
        back: 'Back',
        previous: 'Previous',
        next: 'Next',
      },
      notFound: { heading: 'Page not found', back: 'Back to home' },
    };
    expect(() => assertCopy(valid)).not.toThrow();
    expect(() => assertCopy({ ...valid, nav: { ...valid.nav, wordmark: '   ' } }))
      .toThrow(/nav\.wordmark/);
  });

  it('accepts a valid drink category and rejects an unknown one', async () => {
    const { assertDrinkCategory } = await import('../guards');
    expect(assertDrinkCategory({ id: 'aperol-spritz', category: 'cocktail' }, 0)).toBe('cocktail');
    expect(() => assertDrinkCategory({ id: 'aperol-spritz', category: 'soda' }, 0)).toThrow(
      /invalid category "soda"/,
    );
  });
});
