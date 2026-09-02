# What the browser encoder costs, measured

`npm run build` runs `npm run images`, which loads `sharp`'s native binding and
reads originals out of `assets-source/`. Once originals leave the repository
that step has nothing to read, and there is no server-side replacement at any
price the owner will pay: **workerd executes no native code**, so a Cloudflare
Worker cannot run `sharp`, and every Cloudflare resizing product (Images, the
`/cdn-cgi/image/` transform endpoint) is billable.

The answer is split by time.

- **The fifty photographs that already exist are never re-encoded at all.**
  They are fetched from the production CDN and put into R2 byte for byte
  (Task 4). Nothing below applies to them.
- **Every upload from Task 18 onward is encoded in the owner's browser**, by
  `src/admin/derive.ts`, before the request leaves the page.

This file is the measurement of the second half. The plan that introduced it
forbids an estimate: the browser column is a number somebody ran.

## The measurement

Three real photographs from `assets-source/`, encoded both ways at the same
nominal quality and the same width cap.

- **sharp** — `encodeDerivative(file, maxWidthFor(file))` from
  `scripts/images.mjs`: `.rotate()`, `.resize({ width, withoutEnlargement })`,
  `.webp({ quality: 78 })`.
- **browser** — `derive(file, category)` from `src/admin/derive.ts`, run inside
  a real Chromium against the same bytes: decode through an image element,
  halving downscale, `canvas.toBlob('image/webp', 0.78)`.

**Browser column produced on Chromium 151.0.7922.34** (Playwright 1.62.1's
bundled build, headless, macOS 26.3.1 arm64). That column is a property of an
encoder, not of this repository, and it moves when that encoder does.

| File | Category | Cap | Output | sharp | browser | Difference |
|---|---|---|---|---|---|---|
| `assets-source/food/pizza1.JPG` | food | 1000 | 1000×665 | 69,878 B | 66,206 B | **−5.3%** |
| `assets-source/atmosphere/dining.jpg` | atmosphere | 1000 | 560×704 | 58,836 B | 59,364 B | **+0.9%** |
| `assets-source/our_story/oven.jpg` | our_story | 1000 | 1000×1503 | 31,896 B | 29,996 B | **−6.0%** |
| **Total** | | | | **160,610 B** | **155,566 B** | **−3.1%** |

Mean per-file difference: **−3.4%**.

**The output dimensions are identical on all three**, which is the half of this
that was least certain in advance:

- `dining.jpg` is 560×704 at source, well under the 1000 cap, and both encoders
  left it alone. That is `withoutEnlargement` and `targetSize`'s
  `Math.min(1, …)` agreeing.
- `oven.jpg` is stored 6048×4024 with an EXIF orientation tag and comes out
  **1000×1503 portrait from both**. `sharp.rotate()` and the browser's image
  decode applied the same rotation. A portrait photograph landing sideways on
  the live menu is the failure this pipeline is most exposed to, and on this
  browser it does not happen.

## Verdict

> **Accepted at 0.78.** The browser column is **3.4% smaller** on average and
> is within 1% on the one file where it is larger. No file is anywhere near the
> 40% threshold that would have forced a re-measure at `WEBP_QUALITY = 0.72`,
> so `WEBP_QUALITY` stays **0.78** and `src/admin/__tests__/derive.test.ts`
> pins it against `QUALITY` in `scripts/paths.mjs` rather than against `0.78`
> written twice.

**This is the opposite of the direction the plan expected**, and the expectation
is worth correcting rather than quietly dropping. The reasoning was that a
canvas encode uses a lower encoder effort at the same nominal quality and
downscales with the browser's own sampling rather than Lanczos, so the output
would be larger. On these three files it is not. The likely reason is the
halving downscale: a softer intermediate image has less high-frequency detail
for the encoder to spend bytes on, which pays back more than the weaker encoder
costs. **A smaller file at the same nominal quality is not automatically a
better one** — some of that saving is detail that is gone. What the table
settles is the bandwidth question, which was the one being asked.

## What it does not settle, and what covers that

1. **Any browser but this one.** Chromium's encoder is not Safari's, and the
   owner uploads from an iPhone. `canvas.toBlob` does **not** fail on an
   unsupported type — the specification says it silently falls back to
   `image/png`, and Safari before 16.4 did exactly that. A PNG of a photograph
   is several times the size of the WebP it replaced, which makes the menu slow
   rather than broken: the kind of failure nobody reports. So `derive()` checks
   the produced blob's `type` and, if it is not `image/webp`, re-encodes as
   JPEG at 0.82 and stores it **under the same `.webp` key with
   `Content-Type: image/jpeg`** — browsers obey the served type and ignore the
   extension. That keeps her working and costs one photograph's compression
   ratio. **This has not been run on her actual device.** See below.
2. **Perceptual quality.** Nothing here looked at the pixels. The mitigation is
   that the untouched original is stored beside every derivative under a
   `source/` prefix, and `scripts/rederive.mjs` (Task 20) pulls it back out and
   re-encodes it with `encodeDerivative` **imported from `scripts/images.mjs`,
   not copied** — same key, so no content file moves and no cache entry needs
   purging beyond that key's own policy.

## Two claims in the plan that the mutation runs disproved

Recorded here rather than dropped, because both were written as reasons.

1. **`halvingSteps` at a target of 1 does not hang under `width > toWidth`.**
   The plan's comment said that guard "never terminates for a target of 1,
   because Math.round(1/2) is 1 forever". Run: it terminates at 1 and pushes a
   redundant second 1 — a final no-op pass, not a hang. Width 1 *is* a fixpoint
   of the halving, so a guard satisfiable at width 1 (a target of 0) really
   would loop forever, and `targetSize` never returns 0. The test that separates
   the two is now "never draws the same width twice", because both sequences
   are short and the old length bound passed either way.
2. **The e2e byte assertion does not prove the downscale happened.** With the
   halving loop replaced by one full-width pass, the output is 60,072 B against
   a 317,143 B source — a 5.3x reduction, comfortably inside
   `bytes < originalBytes / 3`. What actually reddened was
   `expect(result.width).toBe(1000)`. The byte check stays for the failure it
   can see (an encode that returned the original blob) and the spec now says
   which assertion carries which claim.

## STILL OWED: the run on the owner's device

The plan's Step 8, and it is not something any Chromium spec can answer.

Add a temporary control to `/edit/manage` that calls `derive()` on a picked
photograph and prints `{ encoder, type, size, width, height }`, deploy it to a
Pages preview, and run it on her phone with a photograph straight from the
camera roll — **including one taken in portrait**, so the EXIF path is
exercised on the decoder she actually uses. Record the browser, its version,
the reported `encoder`, and whether the portrait came out upright. Then remove
the control.

- If `encoder` reads `jpeg`, **that is not a failure** — it is the fallback
  doing its job. Record it.
- **If the portrait comes out sideways, the pipeline is wrong** and the image
  decode path needs replacing before Task 18 wires it into the upload.

Nothing calls `derive()` yet. It is built six tasks before it is used, which is
what leaves room to find this out.

## Reproducing the table

sharp:

    node --input-type=module -e "
    import { encodeDerivative } from './scripts/images.mjs';
    import { maxWidthFor } from './scripts/paths.mjs';
    for (const f of ['assets-source/food/pizza1.JPG','assets-source/atmosphere/dining.jpg','assets-source/our_story/oven.jpg']) {
      const b = await encodeDerivative(f, maxWidthFor(f)).toBuffer();
      console.log('sharp', f, b.length);
    }"

browser: a throwaway Playwright spec that reads each file with `readFileSync`,
hands the bytes to the page, wraps them in a `File`, calls
`derive(file, '<its category>')` and logs `blob.size`. It is deliberately not
committed — the numbers belong in this file, not in the suite, and a spec that
asserts a byte count from one browser build would be red on the next one.
