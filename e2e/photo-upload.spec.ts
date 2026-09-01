// The half only a real browser can answer: whether canvas.toBlob('image/webp')
// produces a WebP at all, at the capped width, materially smaller than what
// went in. jsdom has no canvas encoder, so src/admin/__tests__/derive.test.ts
// deliberately never calls derive() and this file is the only thing that does.
import { test, expect } from '@playwright/test';

test('a real browser produces a real webp, at the capped width, much smaller', async ({ page }) => {
  await page.goto('/edit');

  const result = await page.evaluate(async () => {
    // A 3000x2000 canvas standing in for a phone photograph. Generated in the
    // page rather than read from disk so the spec needs no fixture and
    // measures the browser's own encoder, which is the thing under test. The
    // squares matter: a flat gradient compresses to almost nothing under any
    // encoder, so a size comparison over one would prove nothing.
    const big = document.createElement('canvas');
    big.width = 3000;
    big.height = 2000;
    const context = big.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 3000, 2000);
    gradient.addColorStop(0, '#9D4949');
    gradient.addColorStop(1, '#C8D8E8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 3000, 2000);
    for (let i = 0; i < 400; i++) {
      context.fillStyle = `hsl(${i % 360} 70% ${30 + (i % 40)}%)`;
      context.fillRect((i * 37) % 3000, (i * 53) % 2000, 40, 40);
    }
    const original = await new Promise<Blob>((r) => big.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const file = new File([original], 'photo.jpg', { type: 'image/jpeg' });
    const { derive } = await import('/src/admin/derive.ts');
    const derived = await derive(file, 'food');
    return {
      encoder: derived.encoder, type: derived.blob.type, width: derived.width,
      height: derived.height, bytes: derived.blob.size, originalBytes: original.size,
    };
  });

  expect(result.encoder).toBe('webp');
  expect(result.type).toBe('image/webp');
  expect(result.width).toBe(1000);
  expect(result.height).toBe(667);
  // A 3000px JPEG down to a 1000px WebP is a >3x reduction on any real
  // encoder. A number close to the original means the resize did not happen
  // and the encode simply re-wrapped the same pixels.
  expect(result.bytes).toBeLessThan(result.originalBytes / 3);
});

test('a hero photograph is capped lower than a food one', async ({ page }) => {
  await page.goto('/edit');
  const widths = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 2000;
    canvas.getContext('2d')!.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg'));
    const file = new File([blob], 'p.jpg', { type: 'image/jpeg' });
    const { derive } = await import('/src/admin/derive.ts');
    return { hero: (await derive(file, 'hero')).width, food: (await derive(file, 'food')).width };
  });
  expect(widths.hero).toBe(500);
  expect(widths.food).toBe(1000);
});
