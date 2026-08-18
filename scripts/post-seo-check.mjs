// Phase 5C. What a crawler receives, checked against the RAW response body
// with JavaScript never executing.
//
// WHY THIS IS NOT AN e2e SPEC, which is the mistake this file exists to
// avoid. src/components/blog/PostPage.tsx already sets document.title and
// rewrites the description meta on the client. So a Playwright test that
// reads document.title on /blog/<slug> passes with this entire phase
// reverted -- it proves the SPA works, which was never in question. The only
// assertion that says anything about server-rendered SEO is one made against
// the bytes of the HTTP response before any script runs. That is a string,
// so this module takes a string.
//
// IMPORTS NOTHING, deliberately, for the reason scripts/published-posts-check.mjs
// gives at length: `npm run verify:deploy` is plain `node scripts/verify-deploy.mjs`,
// and a single import that needs `tsx` would stop the whole check running.
// Keep it that way.

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function postSeoProblems(html, expected) {
  const problems = [];
  const canonical = `${expected.siteUrl}/blog/${expected.slug}`;
  const imageUrl = `${expected.siteUrl}${expected.image}`;

  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!title || decodeEntities(title[1]) !== expected.title) {
    problems.push('title is not the post title');
  }

  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  if (!description || decodeEntities(description[1]) !== expected.excerpt) {
    problems.push('description is not the post excerpt');
  }

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/);
  if (!ogImage || ogImage[1] !== imageUrl) {
    problems.push('og:image is not the post image');
  }

  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/);
  if (!ogUrl || ogUrl[1] !== canonical) {
    problems.push('og:url is not the post canonical');
  }

  if (!html.includes(`<link rel="canonical" href="${canonical}">`)) {
    problems.push('no canonical for this post');
  }

  // Parsed rather than substring-matched, so a page that merely CONTAINS the
  // characters `"@type":"Article"` inside some other block cannot pass, and
  // so index.html's own head comment -- which contains the literal prose
  // `rel="canonical"` -- cannot be mistaken for the tag above either, since
  // that check is `includes` on the full functional shape of the tag, not a
  // bare substring of the attribute name.
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let article = null;
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1]);
      if (parsed && parsed['@type'] === 'Article') article = parsed;
    } catch {
      problems.push('structured data is not valid JSON');
    }
  }
  if (!article) {
    problems.push('no Article structured data');
  } else if (article.headline !== expected.title) {
    problems.push('Article headline is not the post title');
  }

  return problems;
}
