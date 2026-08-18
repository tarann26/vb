// Phase 5C. The shell's <head>, rewritten as a string.
//
// STRING REPLACEMENT, NOT HTMLRewriter, and the reason is testability rather
// than preference. HTMLRewriter has no runtime shape under this repo's Vitest
// environment (vitest.config.ts's own header lists the workerd globals that
// are and are not real there), so a rewriter built on it could only ever be
// checked by deploying it -- which is exactly the thing this phase must not
// do, since a mistake here is a wrong <head> on a real post URL.
//
// The brittleness that normally makes this a bad idea is answered two ways.
// First, every pattern below is exported and pinned against the REAL
// committed index.html by this module's own test, and against the REAL BUILT
// dist/index.html by src/test/crawlers.test.ts -- so an index.html edit that
// changes a tag's shape is a red build, not a silent stop. Second, this
// function REFUSES: if any anchor is missing it returns null and the caller
// serves the shell untouched. A half-rewritten head -- the post's title
// beside the site's own og:image -- is worse than no rewrite at all, because
// the two disagree and nothing downstream can tell which is meant.
import { escapeHtmlAttribute, type PostMetadata } from './post-seo';

// Every tag this module replaces. `name` is what a failure message says;
// `pattern` must match the shell exactly once. Non-global on purpose --
// String.replace with a non-global regex replaces the first match, and
// "exactly once" is asserted separately rather than assumed here.
export const SHELL_ANCHORS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'title', pattern: /<title>[\s\S]*?<\/title>/ },
  { name: 'description', pattern: /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:type', pattern: /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:title', pattern: /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:description', pattern: /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:url', pattern: /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/ },
  { name: 'og:image', pattern: /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:title', pattern: /<meta\s+property="twitter:title"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:description', pattern: /<meta\s+property="twitter:description"\s+content="[^"]*"\s*\/?>/ },
  { name: 'twitter:image', pattern: /<meta\s+property="twitter:image"\s+content="[^"]*"\s*\/?>/ },
  { name: 'head-close', pattern: /<\/head>/ },
];

function metaTag(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtmlAttribute(content)}" />`;
}

export function rewriteShellHead(shell: string, meta: PostMetadata): string | null {
  for (const { pattern } of SHELL_ANCHORS) {
    if (!pattern.test(shell)) return null;
  }

  // The title is a TEXT node, and the description is an ATTRIBUTE, but both
  // go through the same attribute-grade escape. Over-escaping a text node is
  // lossless for the characters involved here (a browser renders `&amp;` as
  // `&`); under-escaping either is an injection. One function, no per-context
  // branch to get backwards.
  const title = escapeHtmlAttribute(meta.title);
  const description = escapeHtmlAttribute(meta.description);

  // Built as a list of [anchor, replacement] pairs applied in order, rather
  // than a chain of .replace calls, so a new tag is one line and cannot
  // accidentally be applied to an already-rewritten string.
  const replacements: readonly (readonly [RegExp, string])[] = [
    [SHELL_ANCHORS[0].pattern, `<title>${title}</title>`],
    [SHELL_ANCHORS[1].pattern, `<meta name="description" content="${description}" />`],
    [SHELL_ANCHORS[2].pattern, metaTag('og:type', 'article')],
    [SHELL_ANCHORS[3].pattern, metaTag('og:title', meta.title)],
    [SHELL_ANCHORS[4].pattern, metaTag('og:description', meta.description)],
    [SHELL_ANCHORS[5].pattern, metaTag('og:url', meta.canonical)],
    [SHELL_ANCHORS[6].pattern, metaTag('og:image', meta.imageUrl)],
    [SHELL_ANCHORS[7].pattern, metaTag('twitter:title', meta.title)],
    [SHELL_ANCHORS[8].pattern, metaTag('twitter:description', meta.description)],
    [SHELL_ANCHORS[9].pattern, metaTag('twitter:image', meta.imageUrl)],
  ];

  let out = shell;
  for (const [pattern, replacement] of replacements) {
    // The replacement string is passed through a function so a `$&` or `$1`
    // sequence inside a post title is inserted literally rather than being
    // read by String.replace as a capture reference.
    out = out.replace(pattern, () => replacement);
  }

  // Appended immediately before </head>, not after some other tag: both of
  // these are only honoured inside <head>, and this is the one position that
  // is correct regardless of what else the shell grows later.
  const injected =
    `<link rel="canonical" href="${escapeHtmlAttribute(meta.canonical)}">` +
    `<script type="application/ld+json">${meta.jsonLdScript}</script>` +
    `</head>`;
  return out.replace(SHELL_ANCHORS[10].pattern, () => injected);
}
