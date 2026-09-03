import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// What the split tree actually renders, measured in a real browser.
//
// None of this can be checked in vitest: jsdom has no layout engine, so every
// box it reports is 0x0 and every ratio comes out identical no matter what the
// stylesheet says. That is not a theoretical gap here -- it is precisely how
// this collage shipped nine photos nobody could see. Their placement classes
// had no rules in the built stylesheet, the tiles auto-placed into implicit
// rows, `overflow-hidden` clipped them away, and every jsdom test stayed
// green because the markup was fine and only the LAYOUT was wrong.
//
// Three properties, each one a different way that failure could come back:
//   1. Every split's children take the proportions the content authored.
//   2. A 1:1 split renders two equal boxes whatever is inside them -- the
//      `flexBasis: 0` half of Hero.tsx's sizing, without which an image's
//      intrinsic width leaks into the ratio.
//   3. Every photo in the tree has a real box on screen.

interface CollageNode {
  kind: 'photo' | 'split';
  id: string;
  src?: string;
  direction?: 'row' | 'column';
  children?: CollageNode[];
  sizes?: number[];
}

// Read at run time rather than imported: this spec runs as ESM, where a JSON
// import needs an import attribute, and reading the committed file directly is
// both simpler and unambiguous about which bytes are being checked.
const GALLERIES_PATH = fileURLToPath(new URL('../src/content/galleries.json', import.meta.url));
const TREE = (JSON.parse(readFileSync(GALLERIES_PATH, 'utf8')) as { heroCollage: CollageNode }).heroCollage;

// Derived from TREE, not hardcoded: the owner can add or remove a collage
// photo from /edit, which changes both of these, and a literal count here is
// exactly the kind of number Task 6 (dropping five Farfalle photos) broke.
function photoCount(node: CollageNode): number {
  return node.kind === 'photo' ? 1 : (node.children ?? []).reduce((sum, child) => sum + photoCount(child), 0);
}
function splitCount(node: CollageNode): number {
  return node.kind === 'photo' ? 0 : 1 + (node.children ?? []).reduce((sum, child) => sum + splitCount(child), 0);
}
const PHOTO_COUNT = photoCount(TREE);
const SPLIT_COUNT = splitCount(TREE);

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

// Waits for every collage image to settle, so a lazily-loaded photo cannot
// resize a box between the measurement and the assertion. Bounded, for the
// reason e2e/collage-hit-test.spec.ts records: an unbounded wait on an image
// that fires neither load nor error hangs the spec until the suite timeout,
// which is a worse failure than the flake it fixes.
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bounded = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    const images = [...document.querySelectorAll('img')].filter((img) => !img.complete);
    await bounded(
      Promise.all(
        images.map((img) => new Promise((r) => {
          img.addEventListener('load', r, { once: true });
          img.addEventListener('error', r, { once: true });
        })),
      ),
      5000,
    );
  });
}

// Walks the committed tree and the rendered DOM in lockstep -- child index i
// of a split node is child index i of its <div>, which is exactly what
// `renderCollageNode` (src/components/Hero.tsx) builds -- and reports one
// measurement per split. Done inside ONE `evaluate` so every box is read from
// the same frame; a per-node round trip would let a late image load move
// layout underneath an already-measured parent.
async function measureSplits(page: Page, tree: CollageNode) {
  return page.evaluate((serialised: string) => {
    const root = JSON.parse(serialised) as {
      kind: string; id: string; direction?: string; children?: unknown[]; sizes?: number[];
    };
    const container = document.querySelector('section .absolute.inset-0.flex');
    if (!container) throw new Error('collage container not found');
    const rootEl = container.firstElementChild;
    if (!rootEl) throw new Error('collage root node not rendered');

    const results: {
      id: string; direction: string; gap: number; containerExtent: number;
      sizes: number[]; extents: number[];
    }[] = [];

    function walk(node: typeof root, el: Element): void {
      if (node.kind !== 'split') return;
      const children = [...el.children];
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const horizontal = node.direction === 'row';
      results.push({
        id: node.id,
        direction: String(node.direction),
        gap: parseFloat(horizontal ? style.columnGap : style.rowGap) || 0,
        containerExtent: horizontal ? rect.width : rect.height,
        sizes: node.sizes ?? [],
        extents: children.map((child) => {
          const r = child.getBoundingClientRect();
          return horizontal ? r.width : r.height;
        }),
      });
      (node.children ?? []).forEach((child, i) => walk(child as typeof root, children[i]));
    }

    walk(root, rootEl);
    return results;
  }, JSON.stringify(tree));
}

for (const viewport of VIEWPORTS) {
  test.describe(`the hero collage renders its split tree at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('every split divides its box in the proportions the content authors', async ({ page }) => {
      await page.goto('/');
      await settle(page);

      const splits = await measureSplits(page, TREE);
      // Non-vacuous: SPLIT_COUNT is derived from the same TREE this walk just
      // measured, so a walk that silently found none would still fail here
      // rather than passing with no assertions run at all -- the exact shape
      // of test this repo counts as a defect.
      expect(splits.length).toBe(SPLIT_COUNT);

      for (const split of splits) {
        expect(split.extents.length, `${split.id}: rendered a different number of boxes than the tree has`).toBe(
          split.sizes.length,
        );
        // Flexbox subtracts the gaps first, then distributes what is left by
        // the relative grow factors -- so the expected extent of child i is
        // (container - gap * (n - 1)) * sizes[i] / sum(sizes).
        const total = split.sizes.reduce((t, s) => t + s, 0);
        const available = split.containerExtent - split.gap * (split.sizes.length - 1);
        split.sizes.forEach((size, i) => {
          const expected = (available * size) / total;
          // One CSS pixel of slack, for sub-pixel rounding only. Any real
          // mistake -- a dropped `flexBasis`, a size read off the wrong
          // index, an ignored `sizes` array -- is wrong by far more than that.
          expect(
            Math.abs(split.extents[i] - expected),
            `${split.id} child ${i}: expected ${expected.toFixed(2)}px, measured ${split.extents[i].toFixed(2)}px`,
          ).toBeLessThanOrEqual(1);
        });
      }
    });

    // The property `flexBasis: 0` exists for, stated as the case that breaks
    // without it.
    //
    // `right-middle-column`, not `right-bottom-pair`: the latter was a 1:1
    // ROW split holding /our_story/cut.webp and /hero/farfalle.webp, and
    // farfalle.webp does not exist any more -- Task 6 removed it along with
    // four other photos. `right-middle-column` is the surviving 1:1 split
    // with the same property this test needs: two photos whose intrinsic
    // sizes differ substantially along the split's own axis. It is a COLUMN
    // split, so that axis is height, not width -- hero/building.webp is
    // 500x548 natively and atmosphere/room.webp is 1000x1088, exactly a 2:1
    // difference in intrinsic HEIGHT, which is what would leak into the
    // layout the moment a flex item's base size comes from its content
    // instead of from zero.
    test('a 1:1 split renders two equal boxes even when the two photos differ in intrinsic height', async ({ page }) => {
      await page.goto('/');
      await settle(page);

      const measured = await page.evaluate(() => {
        const box = (src: string) => {
          const img = document.querySelector<HTMLImageElement>(`section img[src="${src}"]`);
          if (!img) throw new Error(`no collage image for ${src}`);
          const el = img.closest('div');
          if (!el) throw new Error(`no box around ${src}`);
          return { height: el.getBoundingClientRect().height, natural: img.naturalHeight };
        };
        // The migrated spelling, which is what the rendered `src` carries
        // since the photographs moved to the image host. These are matched
        // as exact attribute values, so the prefix is not optional here.
        return { tall: box('/images/atmosphere/room.webp'), short: box('/images/hero/building.webp') };
      });

      // The precondition, asserted rather than assumed: if these two photos
      // ever became the same size, the test below would still pass and would
      // no longer be checking anything.
      expect(measured.tall.natural).toBeGreaterThan(measured.short.natural);
      expect(measured.tall.height).toBeGreaterThan(0);
      expect(Math.abs(measured.tall.height - measured.short.height)).toBeLessThanOrEqual(1);
    });

    // Not `getBoundingClientRect().width/height > 0`: that ignores the
    // section's own `overflow-hidden` entirely, since a rect's geometry is
    // reported the same whether or not an ancestor clips it -- a box laid out
    // wholly outside the collage container would still measure nonzero and
    // pass. That is precisely the shape of the original nine-photo bug this
    // file's header describes. Fixed by intersecting each box with the
    // collage container's own rect and requiring real overlap on both axes.
    test('every photo has a real box on screen, none collapsed to nothing or clipped away', async ({ page }) => {
      await page.goto('/');
      await settle(page);

      const boxes = await page.evaluate(() => {
        const container = document.querySelector('section .absolute.inset-0.flex');
        if (!container) throw new Error('collage container not found');
        const c = container.getBoundingClientRect();
        return [...container.querySelectorAll('img')].map((img) => {
          const el = img.closest('div')!;
          const r = el.getBoundingClientRect();
          const visibleWidth = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
          const visibleHeight = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
          return { src: img.getAttribute('src'), visibleWidth, visibleHeight };
        });
      });

      expect(boxes.length).toBe(PHOTO_COUNT);
      for (const box of boxes) {
        expect(box.visibleWidth, `${box.src} has no width actually visible inside the collage container`).toBeGreaterThan(0);
        expect(box.visibleHeight, `${box.src} has no height actually visible inside the collage container`).toBeGreaterThan(0);
      }
    });
  });
}
