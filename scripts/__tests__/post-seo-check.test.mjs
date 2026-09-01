import { describe, expect, it } from 'vitest';
import { postSeoProblems } from '../post-seo-check.mjs';

const EXPECTED = {
  siteUrl: 'https://vb.aionxxxi.uk',
  slug: 'assassina',
  title: 'Spaghetti all\'Assassina',
  excerpt: 'A Puglian classic in tomato water.',
  image: '/press/hotelier.webp',
};

function goodHtml() {
  return [
    '<html><head>',
    '<title>Spaghetti all&#39;Assassina</title>',
    '<meta name="description" content="A Puglian classic in tomato water." />',
    '<meta property="og:type" content="article" />',
    '<meta property="og:image" content="https://vb.aionxxxi.uk/press/hotelier.webp" />',
    '<meta property="og:url" content="https://vb.aionxxxi.uk/blog/assassina" />',
    '<link rel="canonical" href="https://vb.aionxxxi.uk/blog/assassina">',
    '<script type="application/ld+json">{"@type":"Article","headline":"Spaghetti all\\u0027Assassina"}</script>',
    '</head><body></body></html>',
  ].join('');
}

describe('post SEO, checked against a raw response body', () => {
  it('accepts a page that carries all four artefacts', () => {
    expect(postSeoProblems(goodHtml(), EXPECTED)).toEqual([]);
  });

  // The exact failure this whole check exists for: the route is not live, so
  // Pages answered with the untouched shell. It is a 200, it is valid HTML,
  // it renders perfectly in a browser, and it is completely wrong.
  it('rejects the site-wide title', () => {
    const shell = goodHtml().replace(/<title>[^<]*<\/title>/, '<title>Via Bianca - Pastificio &amp; Ristorante</title>');
    expect(postSeoProblems(shell, EXPECTED)).toContain('title is not the post title');
  });

  // The second copy of worker/post-seo.ts's absoluteImageUrl. After the
  // 2026-08-21 migration a post's image is an absolute URL on the image host,
  // and a `siteUrl + image` expectation would demand an og:image with two
  // schemes in it -- so this gate would fail every deploy against a page that
  // is completely correct.
  it('accepts a post whose image is an absolute url on the image host', () => {
    const hosted = { ...EXPECTED, image: 'https://img.viabiancarestaurant.com/press/hotelier.webp' };
    const html = goodHtml().replace(
      'https://vb.aionxxxi.uk/press/hotelier.webp',
      'https://img.viabiancarestaurant.com/press/hotelier.webp',
    );
    expect(postSeoProblems(html, hosted)).toEqual([]);
  });

  it('still rejects a hosted image the page does not actually carry', () => {
    const hosted = { ...EXPECTED, image: 'https://img.viabiancarestaurant.com/press/hotelier.webp' };
    expect(postSeoProblems(goodHtml(), hosted)).toContain('og:image is not the post image');
  });

  it('rejects the site-wide open graph image', () => {
    const shell = goodHtml().replace(/press\/hotelier\.webp/, 'og-image.jpg');
    expect(postSeoProblems(shell, EXPECTED)).toContain('og:image is not the post image');
  });

  it('rejects a missing canonical', () => {
    const shell = goodHtml().replace(/<link rel="canonical"[^>]*>/, '');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no canonical for this post');
  });

  it('rejects a missing Article block', () => {
    const shell = goodHtml().replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no Article structured data');
  });

  it('rejects structured data that is not an Article', () => {
    const shell = goodHtml().replace('"@type":"Article"', '"@type":"Restaurant"');
    expect(postSeoProblems(shell, EXPECTED)).toContain('no Article structured data');
  });

  it('rejects a description that is not the excerpt', () => {
    const shell = goodHtml().replace('A Puglian classic in tomato water.', 'Authentic Italian dining in Greater Kailash.');
    expect(postSeoProblems(shell, EXPECTED)).toContain('description is not the post excerpt');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    expect(postSeoProblems('<html><head></head></html>', EXPECTED).length).toBeGreaterThanOrEqual(5);
  });

  // The trap hit while verifying this live: index.html's own head COMMENT
  // contains the string `rel="canonical"` as prose, explaining why the
  // homepage has no canonical tag. A naive substring match on that fragment
  // finds the comment and reports a canonical that is not there. Proven here
  // against the real committed shell, unrewritten -- the page a crawler gets
  // if the Worker route is ever deleted or bypassed.
  it('fails a non-rewritten page even though it contains the words rel="canonical" in prose', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const shell = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(shell).toContain('rel="canonical"');
    expect(shell).not.toMatch(/<link rel="canonical" href="https:\/\/vb\.aionxxxi\.uk\/blog\/assassina">/);

    const problems = postSeoProblems(shell, EXPECTED);
    expect(problems).toContain('no canonical for this post');
    expect(problems).toContain('title is not the post title');
    expect(problems).toContain('no Article structured data');
  });
});
