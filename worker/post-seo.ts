// Phase 5C. The four things the spec names -- title, description, Open Graph
// image, Article structured data -- as pure strings, with no request, no
// database and no I/O anywhere in this file. Everything that can go wrong
// here is decidable by reading one function.
//
// The canonical host comes from src/content/site.json's own `seo.url`, NOT
// from the request's origin, and that is the opposite of the posture
// siteOriginOf and publicCacheKey take in this Worker. Deliberate: those two
// answer "who is asking", which genuinely varies per host. A canonical
// answers "which of the hosts this site answers on should win", and there
// is exactly one right answer to that at a time. src/components/useCanonical.ts
// already records the reasoning at length; this is the same one field, read
// from the same one file, so the day the domain moves it is still one edit.
import site from '../src/content/site.json';
import type { Post } from '../src/content/types';

export const SITE_URL: string = site.seo.url;

// The author name the homepage's own Restaurant block already hardcodes
// (src/components/SeoHead.tsx). Not read from content because no content
// field holds it -- inventing one for this would be scope this phase's own
// spec sentence does not imply.
const AUTHOR_NAME = 'Kamalika Anand';

export interface PostMetadata {
  title: string;
  description: string;
  canonical: string;
  imageUrl: string;
  // Already escaped for a <script> block. Insert verbatim; do not escape again.
  jsonLdScript: string;
}

// Attribute-context escaping. Both quote characters are escaped, not just
// the double quote, so this stays correct if a value ever lands in a
// single-quoted attribute.
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function canonicalForSlug(slug: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}/blog/${slug}`;
}

// `post.image` is guaranteed non-blank and site-relative by
// src/content/guards.ts (a non-blank string check, then isSiteRelativePath)
// for every Post this repo can build from committed content -- confirmed
// directly: assertPosts (guards.ts) rejects a blank or non-site-relative
// image, and Post['image'] (src/content/types.ts) is a required string, so
// posts.json cannot describe an imageless post.
//
// That guarantee does NOT yet extend to a D1 row. Task 3 is what reads posts
// out of D1 instead of posts.json, and worker/post-lookup.ts -- the module
// that will do that -- does not exist yet; nothing under worker/ calls
// assertPosts or validatePosts today. Task 3 is REQUIRED to run the same (or
// an equivalent) guard on the D1 body before a Post reaches this function --
// until it does, this concatenation can produce a bare origin for a
// D1-sourced row with no image. There is deliberately no "post with no
// photo" branch here regardless of that: the content model does not permit
// one for build-time content, and a runtime fallback would be dead code
// standing in for the guard Task 3 must add at its own input boundary, not
// for a branch this function should grow.
export function absoluteImageUrl(image: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}${image}`;
}

export function articleJsonLd(post: Post, siteUrl: string = SITE_URL): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    // The authored calendar date, passed through unchanged. schema.org's
    // datePublished accepts a bare ISO date, and src/content/article-date.ts
    // records at length why turning this string into a Date and back is how
    // this site once showed every visitor west of UTC the wrong day.
    datePublished: post.date,
    image: absoluteImageUrl(post.image, siteUrl),
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalForSlug(post.slug, siteUrl) },
    author: { '@type': 'Person', name: AUTHOR_NAME },
    publisher: { '@type': 'Organization', name: `${site.name} ${site.tagline}` },
  };
}

// JSON inside a <script> block, not JSON in a body. `JSON.stringify` leaves
// `<` alone, so a value containing the literal characters that close a script
// element would end the block early and everything after it would be parsed
// as markup. Escaping every `<` as its JSON unicode escape is lossless -- a
// JSON parser reads `<` and `<` identically -- and there is then no
// character sequence in the output that an HTML parser can act on.
export function jsonLdScriptBody(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function postMetadata(post: Post, siteUrl: string = SITE_URL): PostMetadata {
  return {
    title: post.title,
    description: post.excerpt,
    canonical: canonicalForSlug(post.slug, siteUrl),
    imageUrl: absoluteImageUrl(post.image, siteUrl),
    jsonLdScript: jsonLdScriptBody(articleJsonLd(post, siteUrl)),
  };
}
