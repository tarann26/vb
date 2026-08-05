// Generates the favicon set from the site's OWN logo lockup -- the sage ring
// with "Via Bianca" in Parisienne over "PASTIFICIO & RISTORANTE" in Montserrat
// that Hero.tsx renders at the top of the homepage.
//
// Rendered in a real browser rather than hand-authored as an SVG, because the
// lockup is not artwork: it is live text in two Google Fonts, and an SVG
// favicon cannot load a web font (favicons are fetched outside the page's own
// font context, so `font-family: Parisienne` in a favicon silently falls back
// to a system serif). Screenshotting the real thing is what keeps the tab icon
// and the page's own logo the same object rather than two drawings that drift.
//
// TWO artworks, not one scaled. At 32px the full lockup is unreadable -- and
// so, checked directly, is the script wordmark alone: "Via Bianca" in
// Parisienne at 32px renders as a grey smudge, because a connected script's
// strokes fall below one pixel long before its letterforms are recognisable.
// The small sizes therefore get a "VB" monogram in the same script inside the
// same sage ring: the two brand cues that survive at tab size are the ring and
// the typeface, and a two-glyph monogram is large enough to keep both. The
// large sizes get the full lockup, where the sub-line is legible again.
//
// Run with `node scripts/favicons.mjs`. Deliberately NOT part of `npm run
// images` or the build: the logo changes roughly never, the output is committed
// (these are top-level files in public/, which .gitignore tracks -- only
// public/<subdirectories>/ are generated-and-ignored), and requiring a browser
// binary in the Cloudflare build for an asset that never changes would be a
// standing cost for no benefit.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAGE = '#6B8B59';
const INK = '#222';
const CANVAS = 1024; // rendered once, large, then downsampled by sharp

function page(full) {
  // `full` draws the sub-line; the small artwork omits it and sizes the script
  // wordmark up to fill the ring instead.
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Parisienne&family=Montserrat:wght@500&display=swap">
<style>
  html,body{margin:0;padding:0;background:transparent}
  .wrap{width:${CANVAS}px;height:${CANVAS}px;display:flex;align-items:center;justify-content:center}
  .ring{
    width:${CANVAS - 64}px;height:${CANVAS - 64}px;border-radius:9999px;
    border:${full ? 40 : 44}px solid ${SAGE};background:#fff;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    box-sizing:border-box;padding:${full ? 150 : 90}px;
  }
  .name{font-family:'Parisienne',cursive;color:${INK};line-height:1.15;margin:0;
        white-space:nowrap;font-size:${full ? 150 : 400}px;
        /* Parisienne has no bold, and at 16px its hairlines fall under one
           pixel and disappear -- checked directly, the monogram rendered as a
           faint grey haze inside a solid ring. A text-stroke fattens the
           SAME typeface rather than substituting a heavier one, so the tab
           icon still reads as this script and not as a generic sans. */
        ${full ? '' : '-webkit-text-stroke:12px ' + INK + ';paint-order:stroke fill;'}}
  .sub{font-family:'Montserrat',sans-serif;font-weight:500;color:${SAGE};
       text-transform:uppercase;letter-spacing:.06em;line-height:1.3;margin:18px 0 0;
       font-size:47px;text-align:center;white-space:nowrap;}
</style></head><body>
<div class="wrap"><div class="ring">
  <p class="name">${full ? 'Via Bianca' : 'VB'}</p>
  ${full ? '<p class="sub">Pastificio &amp;<br>Ristorante</p>' : ''}
</div></div></body></html>`;
}

async function render(browser, full, out) {
  const p = await browser.newPage({ viewport: { width: CANVAS, height: CANVAS } });
  await p.setContent(page(full), { waitUntil: 'networkidle' });
  // Without this the screenshot can land before Parisienne has swapped in and
  // the wordmark bakes in as a fallback serif -- the exact failure this whole
  // script exists to avoid.
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, omitBackground: true });
  await p.close();
}

const tmp = mkdtempSync(join(tmpdir(), 'vb-favicon-'));
const browser = await chromium.launch();
try {
  const fullPng = join(tmp, 'full.png');
  const markPng = join(tmp, 'mark.png');
  await render(browser, true, fullPng);
  await render(browser, false, markPng);

  // Small sizes take the wordmark-only artwork; everything from the Apple
  // touch icon up takes the full lockup, which is where the sub-line is
  // legible again.
  const OUTPUTS = [
    [markPng, 16, 'public/favicon-16.png'],
    [markPng, 32, 'public/favicon-32.png'],
    [fullPng, 180, 'public/apple-touch-icon.png'],
    [fullPng, 192, 'public/icon-192.png'],
    [fullPng, 512, 'public/icon-512.png'],
  ];
  for (const [src, size, dest] of OUTPUTS) {
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 }).toFile(dest);
    console.log(`${dest} (${size}px)`);
  }

  // A .ico holding 16 and 32 for the handful of places that still ask for
  // /favicon.ico by convention rather than reading the <link> tags.
  const ico = await sharp(markPng).resize(32, 32).png().toBuffer();
  writeFileSync('public/favicon.ico', ico);
  console.log('public/favicon.ico (32px, PNG-in-ICO container)');
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
