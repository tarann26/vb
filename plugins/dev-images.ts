import type { Plugin, Connect } from 'vite';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { IMAGE_BASE, keyFromImageUrl } from '../src/shared/image-host';

// The photographs, in `vite dev` and `vite preview`.
//
// WHAT BROKE, AND WHY IT WAS INVISIBLE UNTIL IT WASN'T. The 2026-08-21
// migration moved every photograph reference onto the site-root prefix
// src/shared/image-host.ts defines. In production that prefix is a Worker
// route (wrangler.toml's third entry) and worker/images.ts reads the object
// out of R2. Nothing in this repository served that prefix anywhere else, so
// on a developer's machine every photograph on the site stopped loading at
// once -- not with a 404, which would at least look like a failure, but with
// the SPA catch-all's `200 text/html`: index.html, delivered where a WebP was
// asked for. An <img> pointed at that renders as nothing, reports
// `naturalWidth === 0`, and logs no error. Twelve Playwright tests went red
// saying only "image did not load", and `npm run dev` showed a site with no
// pictures in it.
//
// THIS IS THE DEV-ONLY HALF OF worker/images.ts, and it deliberately answers
// the same two questions the same way:
//
//   Which key does this URL name? `keyFromImageUrl`, the same function the
//     Worker calls, so the encoding this end decodes is by construction the
//     encoding the rewrite produced -- and `..` is refused here for the same
//     reason it is refused there, in front of the filesystem rather than
//     after it.
//   What does a miss return? A 404. NEVER a fall-through to `next()`, which
//     is precisely how this became a `200 text/html` in the first place: the
//     SPA catch-all answers anything the static middleware could not serve.
//     A photograph that is not there has to look like it is not there.
//
// WHERE THE BYTES COME FROM instead of R2: public/, which `npm run images`
// generates from assets-source/ and which held these exact files under these
// exact names before the migration moved the references. The mapping is
// therefore just the prefix -- key `food/pizza1.webp` is `public/food/
// pizza1.webp` -- and once existence is settled the request is handed to
// Vite's own static middleware by rewriting the URL, so content types,
// range requests and conditional GETs stay Vite's business rather than
// becoming a second, worse implementation of them here.
//
// WHAT THIS DOES NOT CHECK, on purpose: case. macOS's filesystem is
// case-insensitive, so an `existsSync` here would answer yes to a spelling
// production 404s on, and building a case-exact index would mean invalidating
// it every time `npm run images` writes a new derivative. That guarantee is
// not weakened, it just lives where it already lived -- src/content/__tests__/
// assets.test.ts resolves every migrated reference against
// image-manifest.json's keys, which is an exact, case-sensitive match against
// the objects the bucket actually holds.
export function publicFileForImagePath(pathname: string, publicDir: string): string | null {
  const key = keyFromImageUrl(pathname);
  if (key === null) return null;

  // ONE PLACE REFUSES A TRAVERSAL, and it is the same place the Worker's
  // does: `keyFromImageUrl` above rejects any key containing `..`, which is
  // why a key reaching here cannot address anything outside publicDir. A
  // second containment test was written here and then removed -- nothing
  // could make it fail, worker/images.ts does not carry one either, and a
  // check the two halves do not share is a divergence between them rather
  // than a hardening of one.
  const file = path.join(publicDir, key);

  // A directory is not a photograph. Without this, `/images/food` resolves to
  // a real path and the rewrite below hands Vite a directory to serve.
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function middleware(publicDir: () => string): Connect.NextHandleFunction {
  const prefix = IMAGE_BASE + '/';
  return (req, res, next) => {
    const url = req.url;
    if (!url) return next();

    // Split the query off before matching, and keep it for the rewrite: the
    // path decides, the query is passed through untouched.
    const queryAt = url.indexOf('?');
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
    if (!pathname.startsWith(prefix)) return next();

    if (publicFileForImagePath(pathname, publicDir()) === null) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Not found');
      return;
    }

    // The prefix is dropped from the URL as it was WRITTEN, not from the
    // decoded key: `/images/atmosphere/ceiling%20decor.webp` becomes
    // `/atmosphere/ceiling%20decor.webp`, still percent-encoded, which is
    // what Vite's static middleware expects to decode for itself. Re-encoding
    // a decoded key here would be a second encoder to keep in agreement with
    // the one in src/shared/image-host.ts.
    req.url = url.slice(IMAGE_BASE.length);
    next();
  };
}

// `apply: 'serve'` -- this has no business in a build. Production serves these
// bytes from R2 through the Worker, and dist/ carries public/ at the site root
// exactly as it always did; nothing here changes a single emitted byte.
//
// Registered inside `configureServer`'s body rather than from a returned
// function, and that is the difference between working and not: a returned
// function is installed AFTER Vite's own middlewares, which is after the
// static handler and after the SPA fallback that was answering these requests
// with index.html.
export default function devImages(): Plugin {
  let publicDir = 'public';
  let previewDir = 'dist';
  return {
    name: 'dev-images',
    apply: 'serve',
    configResolved(config) {
      publicDir = config.publicDir;
      previewDir = path.isAbsolute(config.build.outDir)
        ? config.build.outDir
        : path.join(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(middleware(() => publicDir));
    },
    // `vite preview` serves dist/, where public/ has already been copied to
    // the site root -- so the same mapping holds against a different
    // directory. Covered because preview is a real command in package.json
    // and would otherwise carry the identical trap, silently.
    configurePreviewServer(server) {
      server.middlewares.use(middleware(() => previewDir));
    },
  };
}
