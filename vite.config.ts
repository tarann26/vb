
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from "path";
import { execFileSync } from 'node:child_process';
import buildInfo from './plugins/build-info';
import devImages from './plugins/dev-images';
import sitemap from './plugins/sitemap';
import { pages, posts, site } from './src/content';

// https://vitejs.dev/config/
// Short commit id mixed into every asset filename -- see the `build` block
// below for why. Resolved once, at config load.
function buildId(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 8);
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 8);
  } catch {
    return 'local';
  }
}
const BUILD_ID = buildId();

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    // Build-only (see plugins/build-info.ts): stamps dist/build-info.json
    // with the commit sha, for the admin dashboard to poll and confirm a
    // change is live. Registered unconditionally -- its own `apply: 'build'`
    // is what scopes it away from `vite dev` and Vitest, not anything here.
    buildInfo(),
    // Build-only (see plugins/sitemap.ts): generates dist/sitemap.xml fresh
    // from the real, validated `pages` array every build, replacing the
    // static public/sitemap.xml a developer used to have to hand-edit for
    // every new page. `site.seo.url` is the same base URL SeoHead.tsx's own
    // canonical link and every existing sitemap entry already use.
    // Phase 5, Task 8: `posts` too, for every committed post's own
    // /blog/<slug> entry.
    sitemap(site.seo.url, pages, posts),
    // Dev/preview-only (see plugins/dev-images.ts): serves the site-root
    // image prefix out of public/, which is what the Cloudflare Worker does
    // out of R2 in production. Without it every photograph on the site is a
    // `200 text/html` from the SPA catch-all on a developer's machine. Its
    // own `apply: 'serve'` is what scopes it away from `vite build`.
    devImages(),
  ].filter(Boolean),
  // ---------------------------------------------------------------------------
  // Asset filenames carry the COMMIT as well as the content hash.
  //
  // A content hash alone is a stable identity, and that is normally its whole
  // virtue: identical bytes reuse a cached copy. On this site it is also a
  // liability, because it means a poisoned URL can come BACK.
  //
  // The failure, now four times: a request for a not-yet-propagated asset
  // falls through the SPA catch-all in public/_redirects, is answered with
  // index.html at 200, and the edge stores that HTML under a content-hashed
  // URL that never revalidates. Recovery is to stop referencing that URL.
  // With a pure content hash you cannot always do that -- reverting a change,
  // or rebuilding unchanged code, reproduces the same filename and walks
  // straight back into the poisoned entry. That happened here: a
  // comment-only edit to src/main.tsx left the compiled bytes identical,
  // minification having stripped the comment, so the "new" build served the
  // same poisoned URL and the site stayed down.
  //
  // Salting with the commit makes every deploy's assets unreachable by the
  // previous deploy's cache entries, so any redeploy is a recovery. The cost
  // is that a returning visitor re-downloads chunks whose contents did not
  // change, which for a bundle this size is a few hundred KB against a site
  // that has been wholly unavailable four times.
  //
  // Same resolution order as plugins/build-info.ts, deliberately, so the
  // filenames and the stamped sha can never disagree: Cloudflare's own
  // CF_PAGES_COMMIT_SHA first, then git, then a constant for a sandbox with
  // no .git at all.
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        chunkFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        assetFileNames: `assets/[name]-${BUILD_ID}-[hash][extname]`,
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
