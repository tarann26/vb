// Binary -> base64, shared by the Worker (worker/upload.ts, encoding a
// photo's bytes for GitHub's blob API) and the browser (src/admin/PhotoField.tsx,
// Task 5 -- encoding the very bytes it just staged so a later publish can
// send them again as `POST /api/publish`'s `content`, without re-reading the
// file from disk).
//
// Chunked, not a single `String.fromCharCode(...bytes)` call: spreading an
// entire array into one call's arguments blows the JS engine's
// call-stack-argument limit somewhere in the tens of thousands of elements
// (the exact ceiling varies by engine), which a multi-megabyte photo blows
// past by one or two orders of magnitude. `String.fromCharCode(...chunk)` in
// bounded pieces converts many bytes per call instead of one, so this stays
// well under that limit regardless of the input's size.
//
// `btoa` and `String.fromCharCode` are both plain Web APIs -- present in the
// Workers runtime (worker/upload.ts already relied on this before this file
// existed) and in every browser -- so nothing here is runtime-specific, and
// moving this out of worker/upload.ts into a shared module changes no
// behavior there, only where the one definition lives.
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
