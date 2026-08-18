import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SHELL_ANCHORS, rewriteShellHead } from '../post-shell';
import { postMetadata } from '../post-seo';
import type { Post } from '../../src/content/types';

// Review fix round 1, F3. post-shell.ts's own header comment claims its
// SHELL_ANCHORS patterns are pinned "against the REAL BUILT dist/index.html
// by src/test/crawlers.test.ts" -- that was false: crawlers.test.ts is
// entirely about robots.txt and sitemap.xml, and SHELL_ANCHORS was (before
// this file) referenced nowhere outside post-shell.ts and post-seo.test.ts,
// which reads the SOURCE index.html, not dist/. Vite happens to copy
// <head> through untransformed today, so source and built shells agree, but
// nothing made that stay true. If a future Vite/plugin change ever rewrote
// a tag's shape in the build step alone, every anchor here would keep
// matching the source file, this pin would say nothing, and
// rewriteShellHead would start returning null against the real deployed
// shell -- Task 3's handler would then silently serve every post with no
// metadata rewrite at all, indistinguishable from a normal page.
//
// REQUIRED (VB_REQUIRE_DIST) follows the same idiom
// src/test/bundle.post-build.test.ts already established for this exact
// problem: a bare skipIf(!existsSync(...)) can't tell "dist/ doesn't exist
// yet, that's expected pre-build" apart from "dist/ should be here and
// isn't" post-build. `npm run test:bundle` sets VB_REQUIRE_DIST=1 and now
// runs this file by name (package.json), and `npm run build` ends with
// `npm run test:bundle` -- so this pin actually runs, against the real
// artifact, on every build, not merely on a run where dist/ happens to
// already be on disk.
const REQUIRED = !!process.env.VB_REQUIRE_DIST;
const DIST_INDEX = 'dist/index.html';

const POST: Post = {
  id: 'dist-pin',
  slug: 'dist-pin',
  type: 'story',
  title: 'Dist Pin',
  date: '2026-08-10',
  excerpt: 'Pins SHELL_ANCHORS against the real built shell, not the source one.',
  image: '/press/hotelier.webp',
  blocks: [],
};

describe('post-shell.ts SHELL_ANCHORS against the real built dist/index.html', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_INDEX))(
    'every anchor matches dist/index.html exactly once, and rewriteShellHead succeeds against it',
    () => {
      const html = readFileSync(DIST_INDEX, 'utf8');
      for (const { name, pattern } of SHELL_ANCHORS) {
        const found = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
        expect(found, `anchor "${name}" did not match dist/index.html exactly once`).toHaveLength(1);
      }
      expect(rewriteShellHead(html, postMetadata(POST))).not.toBeNull();
    },
  );
});
