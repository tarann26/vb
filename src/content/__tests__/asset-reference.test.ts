import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isImageHostUrl, isSiteAssetReference } from '../asset-reference';
import { assertPosts } from '../guards';
import { validateContent } from '../validate';
import { isStoryContent } from '../../components/story-api';

// The 2026-08-21 migration rewrites seventy-seven photograph references from
// a path on this site to a URL on the image host. FOUR boundaries decide
// whether such a value is allowed, and every one of them used to refuse it:
//
//   src/content/guards.ts    assertPosts, at module scope in ./index -- so a
//                            refusal here is not a red test, it is
//                            `npm run build` exiting 1 before it emits
//                            anything, and no deploy at all.
//   src/content/guards.ts    assertBlockAssetPath, on every block src, run on
//                            the LIVE D1 read by blog/posts-api.ts.
//   src/content/validate.ts  the Worker's write gate, fourteen fields wide.
//                            Left un-widened it refuses every document the
//                            owner edits, and the migration's own D1 rewrite
//                            (Task 7) goes THROUGH that endpoint.
//   src/components/story-api.ts  the browser's runtime read of the About
//                            section, which answers a value it dislikes with
//                            null -- meaning "keep the compiled-in copy",
//                            which is the silent one.
//
// They are checked together, in one file, because the failure that made this
// file necessary was the four of them disagreeing. Each also keeps its own
// tests where it lives; what is here is the one property that spans them.
const HOST = 'https://img.viabiancarestaurant.com';

// Spelled out rather than imported from src/shared/image-host.ts, and that is
// deliberate: building the input out of the same constant the predicate reads
// makes the two sides agree by construction and proves nothing about WHICH
// host is admitted. This literal reddens if the constant ever moves, which is
// the whole point of having it here.
describe('a whole URL on the image host', () => {
  it('is what the migration writes, and it is admitted', () => {
    expect(isImageHostUrl(`${HOST}/food/pizza1.webp`)).toBe(true);
  });

  it('is admitted with the percent-encoding a spaced filename arrives with', () => {
    expect(isImageHostUrl(`${HOST}/mocktails/signor%20bianca.webp`)).toBe(true);
  });

  it.each([
    ['a host that merely starts the same way', 'https://img.viabiancarestaurant.com.evil.example/x.webp'],
    ['the host spelled inside somebody else\'s path', 'https://evil.example/img.viabiancarestaurant.com/x.webp'],
    ['the host sitting in the userinfo field, where a reader skims past it', 'https://img.viabiancarestaurant.com@evil.example/x.webp'],
    ['credentials in front of the real host, which origin drops', 'https://someone:secret@img.viabiancarestaurant.com/x.webp'],
    ['the same host over plain http', 'http://img.viabiancarestaurant.com/x.webp'],
    ['the bare host, naming no object', 'https://img.viabiancarestaurant.com'],
    ['the bare host with its trailing slash', 'https://img.viabiancarestaurant.com/'],
    ['traversal the parser would have quietly resolved', 'https://img.viabiancarestaurant.com/food/../../x.webp'],
    ['a protocol-relative reference', '//img.viabiancarestaurant.com/x.webp'],
    ['a path on this site, which is the other half\'s answer to give', '/food/pizza1.webp'],
    ['a script url', 'javascript:alert(1)'],
    ['nothing at all', ''],
  ])('is not %s', (_name, value) => {
    expect(isImageHostUrl(value)).toBe(false);
  });
});

describe('isSiteAssetReference: the one question every boundary asks', () => {
  it.each([
    ['a path on this site', '/food/pizza1.webp'],
    ['the menu pdf, which does not move until Task 19', '/menus/food-menu.pdf'],
    ['a photograph on the image host', `${HOST}/food/pizza1.webp`],
  ])('admits %s', (_name, value) => {
    expect(isSiteAssetReference(value)).toBe(true);
  });

  it.each([
    ['a path that leaves this site through a backslash', '/\\evil.example/x.webp'],
    ['traversal out of the site root', '/../secrets.webp'],
    ['a photograph on somebody else\'s host', 'https://evil.example/x.webp'],
    ['a protocol-relative host', '//evil.example/x.webp'],
    ['a data url', 'data:image/webp;base64,AA'],
    ['a bare filename', 'food/pizza1.webp'],
  ])('refuses %s', (_name, value) => {
    expect(isSiteAssetReference(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{ src: '/food/pizza1.webp' }]])(
    'refuses %s, which is not a string at all',
    (value) => {
      expect(isSiteAssetReference(value)).toBe(false);
    },
  );
});

// Every asset-shaped string in a committed document, moved to the image host
// the way scripts/rewrite-image-refs.mjs moves it. Written here rather than
// imported from that script because the script is plain node and because two
// independent expressions of the same transformation is the point: if this
// one and the script disagree, one of them is wrong and the disagreement is
// visible.
//
// After the migration has run, the committed files already hold host URLs,
// this pattern matches nothing, and the transformation is the identity -- so
// these tests assert the same property before and after, which is exactly
// what lets the rewrite land in a commit that is not red.
const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg|pdf)$/i;

function ontoImageHost(value: unknown): unknown {
  if (typeof value === 'string') {
    return ASSET_PATH_PATTERN.test(value) ? HOST + encodeURI(value) : value;
  }
  if (Array.isArray(value)) return value.map(ontoImageHost);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ontoImageHost(item)]));
  }
  return value;
}

function committed(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'src', 'content', name), 'utf-8'));
}

describe('the real documents, rewritten onto the image host, are accepted at every boundary', () => {
  // The nine committed documents that carry a photograph and have a rule in
  // validate.ts. Named rather than discovered, so a document that stops
  // being checked here has to be deleted from a list somebody reads.
  const DOCUMENTS = [
    'dishes.json',
    'drinks.json',
    'experiences.json',
    'galleries.json',
    'menus.json',
    'pages.json',
    'posts.json',
    'press.json',
    'story.json',
  ];

  it.each(DOCUMENTS)('the write gate publishes a rewritten %s with nothing to say about it', (name) => {
    expect(validateContent(name, ontoImageHost(committed(name)))).toEqual([]);
  });

  // Not folded into the loop above: this is the guard that runs at IMPORT
  // time, from src/content/index.ts's module scope, which vite.config.ts
  // pulls in. Its refusal is not a red test, it is a build that stops.
  it('assertPosts imports a rewritten posts.json rather than failing the build', () => {
    const posts = assertPosts(ontoImageHost(committed('posts.json')));
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) expect(isSiteAssetReference(post.image)).toBe(true);
  });

  it('the browser still reads a rewritten story.json as a real document, not as null', () => {
    expect(isStoryContent(ontoImageHost(committed('story.json')))).toBe(true);
  });

  // The widening is a widening and not a hole: the same documents with a
  // photograph moved to a host this site does not own are refused, at each of
  // the three boundaries above.
  const elsewhere = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(ontoImageHost(value)).split(HOST).join('https://evil.example'));

  it.each(DOCUMENTS)('the write gate refuses %s once its photographs move to another website', (name) => {
    expect(validateContent(name, elsewhere(committed(name))).length).toBeGreaterThan(0);
  });

  it('assertPosts refuses a posts.json whose photographs moved to another website', () => {
    expect(() => assertPosts(elsewhere(committed('posts.json')))).toThrow(/not on another website/);
  });

  it('the browser refuses a story.json whose portrait moved to another website', () => {
    expect(isStoryContent(elsewhere(committed('story.json')))).toBe(false);
  });
});

describe('a block src, which posts-api.ts runs against the live database read', () => {
  const A_POST = {
    id: 'test-1',
    slug: 'a-test-post',
    type: 'recipe',
    title: 'A test post',
    date: '2026-01-02',
    excerpt: 'A test excerpt.',
    image: `${HOST}/food/tielle.webp`,
    blocks: [{ kind: 'paragraph', text: 'A test paragraph.' }],
  };
  const withBlock = (block: unknown) => [{ ...A_POST, blocks: [block] }];

  it.each([
    ['an image block', { kind: 'image', src: `${HOST}/food/tielle.webp`, alt: 'A dish' }],
    ['a gallery photo', { kind: 'gallery', images: [{ src: `${HOST}/food/tielle.webp`, alt: 'A dish' }] }],
  ])('accepts %s on the image host', (_name, block) => {
    expect(assertPosts(withBlock(block))[0].blocks[0]).toEqual(block);
  });

  it.each([
    ['an image block', { kind: 'image', src: 'https://evil.example/x.webp', alt: 'A dish' }],
    ['a gallery photo', { kind: 'gallery', images: [{ src: 'https://evil.example/x.webp', alt: 'A dish' }] }],
  ])('refuses %s on another website', (_name, block) => {
    expect(() => assertPosts(withBlock(block))).toThrow(/must be a photo on this site/);
  });
});
