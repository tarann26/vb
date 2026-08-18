import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BlockView } from '../blocks';
import type { Block } from '../../../content/types';
import { BLOCK_KINDS } from '../../../content/guards';

function renderBlock(block: Block) {
  return render(
    <MemoryRouter>
      <BlockView block={block} />
    </MemoryRouter>,
  );
}

// Fixtures that appear nowhere in src/content/posts.json. Phase 4's root
// cause was a fixture equal to the real committed content, which cannot
// distinguish a real binding from a hardcoded copy of that same value.
const EVERY_BLOCK: Record<string, Block> = {
  paragraph: { kind: 'paragraph', text: 'Rest the **dough** for an hour.' },
  heading: { kind: 'heading', text: 'Before you start' },
  bulletList: { kind: 'bulletList', items: ['A wide bowl', 'A bench scraper'] },
  numberList: { kind: 'numberList', items: ['Mix', 'Knead', 'Rest'] },
  image: { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle, sliced', caption: 'Tielle, *sliced*' },
  gallery: {
    kind: 'gallery',
    images: [
      { src: '/food/tielle.webp', alt: 'A tielle' },
      { src: '/food/tiramisu.webp', alt: 'A tiramisu' },
    ],
  },
  quote: { kind: 'quote', text: 'Slow down, stay awhile.', attribution: 'Chef Kamalika' },
  ingredients: { kind: 'ingredients', heading: 'What you need', items: ['400g 00 flour', '4 eggs'] },
  steps: { kind: 'steps', heading: 'How to make it', items: ['Make a well', 'Break in the eggs'] },
  citation: { kind: 'citation', publication: 'A Magazine', url: 'https://example.com/a', date: '2026-03-04' },
};

describe('BlockView covers every kind', () => {
  // The completeness check that actually means something: derived from
  // BLOCK_KINDS (guards.ts, itself pinned as a literal in guards.test.ts),
  // so an eleventh kind added to the model with no fixture and no branch
  // fails HERE rather than rendering nothing on a live page.
  it('has a fixture and a rendered output for every kind in BLOCK_KINDS', () => {
    expect(Object.keys(EVERY_BLOCK).sort()).toEqual([...BLOCK_KINDS].sort());
    BLOCK_KINDS.forEach((kind) => {
      const { container } = renderBlock(EVERY_BLOCK[kind]);
      expect(container.firstElementChild, `${kind} rendered nothing`).not.toBeNull();
    });
  });
});

describe('each block renders its own shape', () => {
  it('paragraph is a <p> with its markdown parsed', () => {
    const { container } = renderBlock(EVERY_BLOCK.paragraph);
    const p = container.querySelector('p');
    expect(p?.textContent).toBe('Rest the dough for an hour.');
    expect(p?.querySelector('strong')?.textContent).toBe('dough');
  });

  it('heading is an h2, never an h1 -- the post title owns the h1', () => {
    const { container } = renderBlock(EVERY_BLOCK.heading);
    expect(container.querySelector('h2')?.textContent).toBe('Before you start');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('bulletList is a <ul> with a disc marker', () => {
    const { container } = renderBlock(EVERY_BLOCK.bulletList);
    const ul = container.querySelector('ul');
    expect(ul?.className).toContain('list-disc');
    expect([...ul!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['A wide bowl', 'A bench scraper']);
  });

  // Not in the brief as written -- added because mutation #9 (dropping the
  // <Inline> wrapper inside Items and rendering `{item}` instead) leaves
  // every OTHER test in this file green: the malicious-paste case still
  // passes (raw text is still text either way) and the plain-text disc-marker
  // case above never contains markdown syntax to lose. This is the only
  // assertion in the file that a list item's own text is run through the
  // markdown parser at all.
  it('a list item has its markdown parsed, not rendered as literal asterisks', () => {
    const { container } = renderBlock({ kind: 'bulletList', items: ['A **wide** bowl'] });
    const li = container.querySelector('li');
    expect(li?.querySelector('strong')?.textContent).toBe('wide');
  });

  // Admin redesign Task 26. Nesting is stored as a parallel `levels` array
  // and read back into a tree here, so these four cases are the whole of what
  // a visitor can be shown.
  describe('a nested list', () => {
    // The migration claim, from the renderer's side: every list committed
    // before nesting existed carries no `levels` at all, and has to come out
    // as the flat list it always was. `querySelectorAll('ul')` counts the
    // nested ones too, so the count is what says "flat" here.
    it('renders exactly as it did when levels is absent', () => {
      const { container } = renderBlock(EVERY_BLOCK.bulletList);
      expect(container.querySelectorAll('ul')).toHaveLength(1);
      expect([...container.querySelectorAll('li')].map((li) => li.textContent))
        .toEqual(['A wide bowl', 'A bench scraper']);
    });

    it('puts the nested item INSIDE the item above it, never beside it', () => {
      const { container } = renderBlock({
        kind: 'bulletList',
        items: ['A wide bowl', 'A bench scraper'],
        levels: [0, 1],
      });
      expect(container.querySelectorAll('ul')).toHaveLength(2);
      // `li > ul > li`, and the direct-child combinators are the point: a
      // sub-list that is a SIBLING of the item it belongs to is invalid
      // markup that browsers and screen readers each repair their own way.
      const nested = container.querySelectorAll('li > ul > li');
      expect(nested).toHaveLength(1);
      expect(nested[0].textContent).toBe('A bench scraper');
      // And the outer list still has one item of its own, not two.
      expect(container.querySelector('ul')?.children).toHaveLength(1);
    });

    it('keeps the numbered marker all the way down', () => {
      const { container } = renderBlock({
        kind: 'numberList',
        items: ['Mix', 'Knead'],
        levels: [0, 1],
      });
      const lists = [...container.querySelectorAll('ol')];
      expect(lists).toHaveLength(2);
      lists.forEach((ol) => expect(ol.className).toContain('list-decimal'));
      expect(container.querySelector('ul')).toBeNull();
    });

    // The clamp. `[0, 2]` passes both boundaries -- each depth is a whole
    // number inside the cap and the two arrays are the same length -- and
    // without `Math.min(..., stack.length)` in `nest` the second item reads
    // `stack[1]`, which is undefined, and the whole post page throws instead
    // of rendering. One step of nesting is the honest reading of a jump
    // nobody could have produced by pressing Tab.
    it('renders one step of nesting for a depth that jumps, rather than throwing', () => {
      const { container } = renderBlock({
        kind: 'bulletList',
        items: ['A wide bowl', 'A bench scraper'],
        levels: [0, 2],
      });
      expect(container.querySelectorAll('ul')).toHaveLength(2);
      expect(container.querySelectorAll('li > ul > li')[0]?.textContent).toBe('A bench scraper');
    });

    it('nests three deep in three lists, and the deepest item is inside both', () => {
      const { container } = renderBlock({
        kind: 'bulletList',
        items: ['One', 'Two', 'Three'],
        levels: [0, 1, 2],
      });
      expect(container.querySelectorAll('ul')).toHaveLength(3);
      expect(container.querySelectorAll('li > ul > li > ul > li')[0]?.textContent).toBe('Three');
    });

    it('steps back out again, so a later item at depth 0 is not left inside the sub-list', () => {
      const { container } = renderBlock({
        kind: 'bulletList',
        items: ['One', 'Two', 'Three'],
        levels: [0, 1, 0],
      });
      const outer = container.querySelector('ul');
      expect(outer?.children).toHaveLength(2);
      expect([...(outer?.children ?? [])].map((li) => li.firstChild?.textContent)).toEqual(['One', 'Three']);
    });

    it('parses a nested item’s markdown, the same as any other item', () => {
      const { container } = renderBlock({
        kind: 'bulletList',
        items: ['A bowl', 'A **wide** one'],
        levels: [0, 1],
      });
      expect(container.querySelector('li > ul > li strong')?.textContent).toBe('wide');
    });
  });

  it('numberList is an <ol> with a decimal marker -- preflight strips both, so the class is load-bearing', () => {
    const { container } = renderBlock(EVERY_BLOCK.numberList);
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain('list-decimal');
    expect([...ol!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Mix', 'Knead', 'Rest']);
  });

  it('image is a figure with alt text and a parsed caption', () => {
    const { container } = renderBlock(EVERY_BLOCK.image);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/food/tielle.webp');
    expect(img?.getAttribute('alt')).toBe('A tielle, sliced');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(container.querySelector('figcaption')?.querySelector('em')?.textContent).toBe('sliced');
  });

  it('an image with no caption renders no empty figcaption', () => {
    const { container } = renderBlock({ kind: 'image', src: '/food/tielle.webp', alt: 'A tielle', caption: '' });
    expect(container.querySelector('figcaption')).toBeNull();
  });

  // The case above supplies caption: '' -- a PRESENT empty string. A real
  // caption-less image (dd224e6 made `caption` optional at the type; nothing
  // requires posts.json to carry the key at all) has the key ABSENT, not
  // empty, and `block.caption` is `undefined` there, not `''`. The two
  // `?? ''` guards in Figure/BlockView exist precisely for this shape, and
  // the case above cannot exercise them: `'' ?? ''` and `undefined ?? ''`
  // both evaluate to `''`, so a fixture that only ever supplies `''` leaves
  // `?? ''` indistinguishable from no guard at all. Dropping the guard
  // (`block.caption as string`) throws `TypeError: Cannot read properties of
  // undefined (reading 'trim')` here, during render -- a white-screen crash
  // on content validatePosts explicitly accepts.
  it('an image with the caption key entirely absent renders no figcaption, and does not throw', () => {
    const { container } = renderBlock({ kind: 'image', src: '/food/tielle.webp', alt: 'A tielle' });
    expect(container.querySelector('figcaption')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/food/tielle.webp');
  });

  it('gallery renders one img per image, each with its own alt', () => {
    const { container } = renderBlock(EVERY_BLOCK.gallery);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/food/tielle.webp', '/food/tiramisu.webp']);
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['A tielle', 'A tiramisu']);
  });

  it('quote is a blockquote with its attribution in a cite', () => {
    const { container } = renderBlock(EVERY_BLOCK.quote);
    expect(container.querySelector('blockquote')?.textContent).toContain('Slow down, stay awhile.');
    expect(container.querySelector('cite')?.textContent).toBe('Chef Kamalika');
  });

  it('a quote with no attribution renders no empty cite', () => {
    const { container } = renderBlock({ kind: 'quote', text: 'Just the words.', attribution: '' });
    expect(container.querySelector('cite')).toBeNull();
  });

  // Same landmine as the image case above, on the other `?? ''` guard: an
  // absent key, not a present empty string. `block.attribution` is
  // `undefined` here. Dropping the guard (`(block.attribution as
  // string).trim()`) throws the same `TypeError: Cannot read properties of
  // undefined (reading 'trim')`.
  it('a quote with the attribution key entirely absent renders no cite, and does not throw', () => {
    const { container } = renderBlock({ kind: 'quote', text: 'Just the words.' });
    expect(container.querySelector('cite')).toBeNull();
    expect(container.querySelector('blockquote')?.textContent).toContain('Just the words.');
  });

  it('ingredients is a heading and an unordered list', () => {
    const { container } = renderBlock(EVERY_BLOCK.ingredients);
    expect(container.querySelector('h3')?.textContent).toBe('What you need');
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['400g 00 flour', '4 eggs']);
  });

  it('steps is a heading and an ORDERED list -- the difference from ingredients is the whole point', () => {
    const { container } = renderBlock(EVERY_BLOCK.steps);
    expect(container.querySelector('h3')?.textContent).toBe('How to make it');
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('citation names the publication, the date, and links out safely', () => {
    const { container } = renderBlock(EVERY_BLOCK.citation);
    // The date literal, not a call to formatArticleDate -- an expectation
    // computed by the code under test proves nothing (PostPage.test.tsx's
    // own note on the same function). '2026-03-04' is EVERY_BLOCK.citation's
    // own date. Previously only 'A Magazine' was asserted here, so dropping
    // formatArticleDate(block.date) entirely from BlockView's citation case
    // left this test (and its sibling below) green.
    expect(container.textContent).toContain('A Magazine, March 4, 2026');
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/a');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a citation with no link renders the publication, the date, and no anchor', () => {
    const { container } = renderBlock({ kind: 'citation', publication: 'A Magazine', url: null, date: '2026-03-04' });
    expect(container.textContent).toContain('A Magazine, March 4, 2026');
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('a malicious paste in any block is words, not elements', () => {
  const PAYLOAD = '<script>alert(1)</script>';
  it.each(['paragraph', 'heading', 'quote'] as const)('%s', (kind) => {
    const block = (kind === 'quote'
      ? { kind, text: PAYLOAD, attribution: '' }
      : { kind, text: PAYLOAD }) as Block;
    const { container } = renderBlock(block);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe(PAYLOAD);
  });

  it('a list item', () => {
    const { container } = renderBlock({ kind: 'bulletList', items: [PAYLOAD] });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('li')?.textContent).toBe(PAYLOAD);
  });
});
