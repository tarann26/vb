// Where photographs are served from, as one constant the Worker, the browser
// bundle and every script under scripts/ all read.
//
// A CUSTOM DOMAIN, never the r2.dev subdomain. Cloudflare documents r2.dev as
// development-only and rate-limited, warns against even pointing a CNAME at
// it, and gives it no edge caching, no WAF and no bot management. The bucket's
// r2.dev public access is switched off in the dashboard as part of this task.
//
// A subdomain of the site's own zone rather than a second domain, so the
// apex's Strict-Transport-Security includeSubDomains already covers it and no
// second certificate story exists.
export const IMAGE_HOST = 'https://img.viabiancarestaurant.com';

// An R2 object key, e.g. food/pizza1.webp, to the URL a browser fetches.
//
// Keys never carry a leading slash: R2 treats a key that starts with one and
// the otherwise identical key that does not as two separate objects, and half
// this codebase's paths carry one. The boundary is enforced here rather than
// remembered at each call site.
//
// The two spellings are NOT written out here as examples, deliberately. A
// site-root path inside a quoted or backticked span in any src/ file is a
// real reference as far as src/content/__tests__/assets.test.ts is concerned,
// and it fails the suite demanding a file that was only ever illustrative.
// That is not hypothetical: this comment's first draft did exactly it.
//
// encodeURI, because five of this library's filenames carry spaces
// (mocktails/blood orange espresso tonic.webp, mocktails/signor bianca.webp,
// mocktails/viola and sambuco.webp among them). As a site-root path in an
// img element the browser encodes those itself; as a whole https:// URL
// sitting inside JSON they have to arrive already encoded, or the request
// goes to a different key than the one R2 holds.
export function imageUrl(key: string): string {
  if (key.startsWith('/')) throw new Error(`imageUrl: key must not start with a slash, got "${key}"`);
  return IMAGE_HOST + '/' + encodeURI(key);
}

// The inverse, returning null for anything that is not one of ours -- a
// site-root path, a URL on some other host, a bare filename. Callers use the
// null to mean "not an image-host reference", never "broken".
export function keyFromImageUrl(url: string): string | null {
  const prefix = IMAGE_HOST + '/';
  if (!url.startsWith(prefix)) return null;
  const key = decodeURI(url.slice(prefix.length));
  return key.length > 0 && !key.includes('..') ? key : null;
}
