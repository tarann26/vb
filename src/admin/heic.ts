// Converts a HEIC/HEIF photo to JPEG entirely in her browser, before it
// ever reaches the upload request. Every iPhone photo is HEIC by default
// and the image library scripts/images.mjs builds with (sharp's prebuilt
// binaries) cannot read it -- without this, an iPhone upload would commit
// bytes the build can never turn into a derivative, the asset guardrail
// would catch the missing public/ file, and the build would fail with no
// obvious link back to "she uploaded a HEIC photo." worker/upload.ts
// rejects a HEIC upload outright (400, telling her to convert first)
// specifically because this is supposed to have already happened by the
// time a request reaches it.
//
// Lives under src/admin/, not src/shared/, on purpose: this is the one
// module in the client bundle allowed to import 'heic-to', whose WASM
// decoder is several hundred KB. src/test/bundle.test.ts enforces that
// nothing outside src/admin/ imports this file, and that dist/assets/
// never contains the decoder -- both at the artifact, because a runtime
// spy cannot observe a bundler's decision to include or exclude a module
// (see that file's own comment).
import { detectFormat } from '../shared/image-format';

// heic-to's own quality knob (README calls 0.5 "medium"); 0.92 favours a
// photo that still looks right next to the ones she didn't have to
// convert, over shaving a few more kilobytes off an image that
// scripts/images.mjs re-encodes into its own derivative sizes anyway.
const JPEG_QUALITY = 0.92;

// "IMG_1234.HEIC" -> "IMG_1234.jpg". Only ever called after detectFormat
// has already confirmed the *content* is HEIC -- the extension being
// replaced here is cosmetic (what she sees in her file picker / the admin
// UI afterwards), never what decided whether to convert.
function withJpegExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  return `${base}.jpg`;
}

// Same object back, no allocation, for anything that isn't HEIC -- most
// uploads (a JPEG or PNG from anywhere other than an iPhone's camera) hit
// this path and should cost nothing beyond the one read needed to know
// that.
//
// Detects by content, never by filename or declared MIME type, for the
// same reason src/shared/image-format.ts does: `IMG_1234.HEIC` renamed to
// `.jpg` is still HEIC, and a `.heic` extension on a JPEG is not -- this
// repository already contains a live example of the latter
// (assets-source/atmosphere/dining.jpg is PNG data wearing a `.jpg` name).
export async function convertHeic(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectFormat(bytes) !== 'heic') return file;

  // Imported dynamically, and only once content has already proven this
  // file needs it -- a static `import { heicTo } from 'heic-to'` at the
  // top of this module would still keep the WASM decoder out of any
  // bundle that never imports heic.ts at all, but would pull it into
  // *this* module's own chunk unconditionally, defeating the point of
  // gating it behind a per-file, content-based check: every visitor to a
  // page that reaches this module would download the decoder even when
  // every upload that page ever handles is already a JPEG.
  const { heicTo } = await import('heic-to');
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: JPEG_QUALITY });

  // heicTo returns a Blob, which has no `.name` -- wrap it in a File so
  // the result is something the rest of the admin upload flow can hand to
  // a `<input type="file">`-shaped API or a FormData append the same way
  // it would an unconverted file.
  return new File([blob], withJpegExtension(file.name), { type: 'image/jpeg' });
}
