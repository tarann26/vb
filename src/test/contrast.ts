// WCAG 2.1 relative luminance and contrast ratio.
//
// Lives under src/test/ rather than src/ because nothing SHIPPING needs it:
// it exists so the palette assertions in src/test/palette.test.ts and
// e2e/brand-contrast.spec.ts are arithmetic rather than opinion. Note that
// tailwind.config.js deliberately excludes ./src/test/** from its content
// glob, so nothing in this directory can emit CSS.
function channels(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// The sRGB transfer function. The linearisation is the whole point: a plain
// channel average would call #808080 mid-grey at 0.5 when a human eye reads
// it at 0.216, and every threshold downstream would be wrong.
function linearize(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
