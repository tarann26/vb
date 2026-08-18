import { describe, expect, it } from 'vitest';
import {
  SITE_URL,
  articleJsonLd,
  escapeHtmlAttribute,
  postMetadata,
} from '../post-seo';
import type { Post } from '../../src/content/types';

// A post whose title and excerpt both carry characters that are dangerous in
// an attribute, in a text node, and inside a <script> block -- one fixture
// exercising all three escaping contexts, rather than three clean fixtures
// that would all pass with no escaping at all.
const POST: Post = {
  id: 'post-1',
  slug: 'assassina',
  type: 'recipe',
  title: 'Spaghetti all\'Assassina & "burnt" pasta',
  date: '2026-08-10',
  excerpt: 'A Puglian classic <cooked> in tomato water, not water.',
  image: '/press/hotelier.webp',
  blocks: [],
};

describe('post metadata', () => {
  it('reads the canonical host from site.json rather than a second literal', () => {
    expect(SITE_URL).toBe('https://vb.aionxxxi.uk');
  });

  it('titles the page with the post title alone, appending nothing', () => {
    expect(postMetadata(POST).title).toBe(POST.title);
  });

  it('describes the page with the post excerpt', () => {
    expect(postMetadata(POST).description).toBe(POST.excerpt);
  });

  it('builds the canonical from site.seo.url and the slug, not from any request', () => {
    expect(postMetadata(POST).canonical).toBe('https://vb.aionxxxi.uk/blog/assassina');
  });

  it('makes the open graph image absolute against the same host', () => {
    expect(postMetadata(POST).imageUrl).toBe('https://vb.aionxxxi.uk/press/hotelier.webp');
  });

  it('escapes quotes and angle brackets for an attribute value', () => {
    expect(escapeHtmlAttribute('a "b" <c> & \'d\'')).toBe('a &quot;b&quot; &lt;c&gt; &amp; &#39;d&#39;');
  });

  it('emits Article structured data with the four fields a rich result reads', () => {
    const json = articleJsonLd(POST);
    expect(json['@type']).toBe('Article');
    expect(json.headline).toBe(POST.title);
    expect(json.description).toBe(POST.excerpt);
    expect(json.datePublished).toBe('2026-08-10');
    expect(json.image).toBe('https://vb.aionxxxi.uk/press/hotelier.webp');
    expect(json.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://vb.aionxxxi.uk/blog/assassina',
    });
  });

  // The one escaping rule that is specific to JSON-LD: a `<` inside a
  // <script> block can close it early ("</script>" inside a string value),
  // which turns structured data into injected markup. JSON.stringify does
  // not escape it; this does.
  it('never lets a raw < reach the script block', () => {
    const script = postMetadata(POST).jsonLdScript;
    expect(script).not.toContain('<');
    expect(script).toContain('\\u003c');
  });
});

import { readFileSync } from 'node:fs';
import { SHELL_ANCHORS, rewriteShellHead } from '../post-shell';

const SHELL = readFileSync('index.html', 'utf8');

describe('rewriting the shell head', () => {
  const meta = postMetadata(POST);
  const out = rewriteShellHead(SHELL, meta)!;

  it('rewrites rather than refuses, against the real committed shell', () => {
    expect(out).not.toBeNull();
  });

  it('replaces the static title with the post title, leaving exactly one', () => {
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain(`<title>Spaghetti all&#39;Assassina &amp; &quot;burnt&quot; pasta</title>`);
    expect(out).not.toContain('Authentic Italian Dining in Delhi</title>');
  });

  it('rewrites the one description meta in place rather than appending a second', () => {
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain('A Puglian classic &lt;cooked&gt; in tomato water, not water.');
  });

  it('turns og:type from website into article', () => {
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).not.toContain('content="website"');
  });

  it('points og:image and twitter:image at the post image, absolutely', () => {
    const matches = out.match(/content="https:\/\/vb\.aionxxxi\.uk\/press\/hotelier\.webp"/g);
    expect(matches).toHaveLength(2);
    expect(out).not.toContain('/og-image.jpg');
  });

  it('points og:url at the post canonical', () => {
    expect(out).toContain('<meta property="og:url" content="https://vb.aionxxxi.uk/blog/assassina" />');
  });

  it('adds the canonical link the shell deliberately ships without', () => {
    // Not a plain `not.toContain('rel="canonical"')`: index.html's own head
    // comment (just above the og block) explains the omission by quoting
    // `<link rel="canonical">` verbatim as prose, so that bare substring is
    // present in the raw shell. The functional shape -- an actual tag with
    // an href -- is what must be absent before the rewrite and present after.
    expect(SHELL).not.toContain('rel="canonical" href=');
    expect(out).toContain('<link rel="canonical" href="https://vb.aionxxxi.uk/blog/assassina">');
  });

  it('adds exactly one Article structured-data block', () => {
    expect(out.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(out).toContain('"@type":"Article"');
  });

  // The fail-safe. A shell this function does not recognise must come back
  // untouched, not half-rewritten: a page with the post's title and the
  // site's own og:image is worse than a page with neither, because the two
  // disagree and nothing downstream can tell.
  it('refuses outright when an anchor is missing', () => {
    const broken = SHELL.replace(/<meta property="og:url"[^>]*>/, '');
    expect(rewriteShellHead(broken, meta)).toBeNull();
  });

  it('names every anchor it depends on, each matching the real shell once', () => {
    expect(SHELL_ANCHORS.length).toBeGreaterThan(0);
    for (const { name, pattern } of SHELL_ANCHORS) {
      const found = SHELL.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
      expect(found, `anchor "${name}" did not match the committed index.html exactly once`).toHaveLength(1);
    }
  });
});
