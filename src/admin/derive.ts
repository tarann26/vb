// The derivative, made in her browser, before the request.
//
// WHY HERE AND NOT ON THE SERVER. scripts/images.mjs loads sharp's native
// binding at module scope and workerd cannot execute native code, so a Worker
// cannot make a smaller copy of a photograph at all. Cloudflare's own image
// products that could are billable and the owner is on free tiers. That leaves
// the browser -- which is not a fallback position here: this repository
// already runs a WASM HEIC decoder on this owner's phone for this exact upload
// (./heic), so the capability is demonstrated in production rather than
// assumed.
//
// WHAT IT MIRRORS. scripts/images.mjs's encodeDerivative is sharp's own
// rotate, width-cap and webp chain at quality 78. Each clause has an answer
// here:
//   rotate              -> decoded through an image element, which applies
//                          EXIF orientation in every browser since 2020.
//                          createImageBitmap's imageOrientation option was
//                          rejected: a browser may ignore an option it does
//                          not know, and the symptom is a portrait photograph
//                          landing sideways on the live menu.
//   width: maxWidthFor  -> maxWidthForCategory, pinned to scripts/paths.mjs
//                          by src/shared/__tests__/image-widths.test.ts.
//   withoutEnlargement  -> targetSize never scales above 1.
//   webp at quality 78  -> toBlob('image/webp', 0.78).
//
// WHAT IT CANNOT MIRROR, stated rather than glossed: canvas encodes with the
// browser's WebP encoder, not libwebp, and scales down with the browser's own
// sampling, not Lanczos. The MEASURED difference on three real photographs is
// in docs/image-derivation.md. The mitigation for the sampling is halvingSteps
// below; the mitigation for the encoder is that the untouched original is
// stored beside the derivative, so scripts/rederive.mjs (Task 20) can
// regenerate any object with the real pipeline and the same key.
import { maxWidthForCategory } from '../shared/image-widths';

export const WEBP_QUALITY = 0.78;
export const JPEG_QUALITY = 0.82;

export interface Derived {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  encoder: 'webp' | 'jpeg';
}

export function targetSize(natural: { width: number; height: number }, maxWidth: number) {
  // Math.min(1, ...) is withoutEnlargement: a photograph narrower than the cap
  // is encoded at its own size and never stretched.
  const scale = Math.min(1, maxWidth / natural.width);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

// A single drawImage from 4032px down to 1000px asks the browser for a 4x
// reduction in one sampling pass, and every browser answers it with a cheap
// bilinear sample that drops detail and leaves aliasing you can see on exactly
// the things this restaurant photographs -- basil, crumb, the edge of a plate.
// Halving repeatedly until the last step is under 2x costs a few milliseconds
// and is the standard answer.
export function halvingSteps(fromWidth: number, toWidth: number): number[] {
  const steps: number[] = [];
  let width = fromWidth;
  // `width / 2 > toWidth`, not `width > toWidth`: the second never terminates
  // for a target of 1, because Math.round(1/2) is 1 forever.
  while (width / 2 > toWidth) {
    width = Math.round(width / 2);
    steps.push(width);
  }
  steps.push(toWidth);
  return steps;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function derive(file: File, category: string): Promise<Derived> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    const target = targetSize(natural, maxWidthForCategory(category));

    let source: CanvasImageSource = image;
    let sourceWidth = natural.width;
    let sourceHeight = natural.height;
    let canvas: HTMLCanvasElement | null = null;

    for (const stepWidth of halvingSteps(natural.width, target.width)) {
      const stepHeight = Math.max(1, Math.round((stepWidth / natural.width) * natural.height));
      canvas = document.createElement('canvas');
      canvas.width = stepWidth;
      canvas.height = stepHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare photos for upload.');
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, stepWidth, stepHeight);
      source = canvas;
      sourceWidth = stepWidth;
      sourceHeight = stepHeight;
    }
    if (canvas === null) throw new Error('This browser cannot prepare photos for upload.');

    const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY);

    // toBlob does NOT fail on an unsupported type -- the specification says it
    // falls back to image/png, SILENTLY. A PNG of a photograph is several
    // times the size of the WebP it replaced, so shipping one unnoticed makes
    // the menu slow rather than broken, which is the kind of failure nobody
    // reports. Checking the type is the only way to see it. Safari has encoded
    // WebP since 16.4, so this branch should never fire on the owner's phone;
    // it exists because "should never" is not a thing to bet a photograph on.
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, contentType: 'image/webp', width: canvas.width, height: canvas.height, encoder: 'webp' };
    }

    // JPEG, not the original bytes, and not a refusal. Every browser encodes
    // JPEG from a canvas, so this branch always produces something -- and it
    // produces something SCALED DOWN, which is what actually matters: a
    // fallback that uploaded the 4032px original would put a 6 MB photograph
    // on a phone. Refusing instead and telling her to find another browser is
    // the alternative, and it is worse: she is holding a phone, in a
    // restaurant, and "use a different browser" is not an instruction she can
    // act on. The cost is one photograph's compression ratio.
    //
    // It is stored under the .webp key with contentType image/jpeg on purpose:
    // a browser obeys the served Content-Type and ignores the URL's extension,
    // so it renders correctly, and the key stays the one derivativePath
    // computes rather than becoming format-dependent.
    const jpeg = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    if (!jpeg) throw new Error('This browser could not prepare the photo. Try a different browser.');
    return { blob: jpeg, contentType: 'image/jpeg', width: canvas.width, height: canvas.height, encoder: 'jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
