
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from "path";
import filterUnpublished from './plugins/filter-unpublished';
import buildInfo from './plugins/build-info';
import sitemap from './plugins/sitemap';
import { pages, site } from './src/content';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    // Build-only (see plugins/filter-unpublished.ts): strips future-dated
    // dishes/drinks/press articles out of the shipped JS. Registered
    // unconditionally -- its own `apply: 'build'` is what scopes it away
    // from `vite dev` and Vitest, not anything here.
    filterUnpublished(),
    // Build-only (see plugins/build-info.ts): stamps dist/build-info.json
    // with the commit sha, for the admin dashboard to poll and confirm a
    // change is live. Same apply: 'build' scoping as filterUnpublished
    // above, for the same reason.
    buildInfo(),
    // Build-only (see plugins/sitemap.ts): generates dist/sitemap.xml fresh
    // from the real, validated `pages` array every build, replacing the
    // static public/sitemap.xml a developer used to have to hand-edit for
    // every new page. `site.seo.url` is the same base URL SeoHead.tsx's own
    // canonical link and every existing sitemap entry already use.
    sitemap(site.seo.url, pages),
  ].filter(Boolean),
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
