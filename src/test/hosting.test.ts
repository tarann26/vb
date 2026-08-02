import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('cloudflare hosting config', () => {
  it('rewrites every unmatched route to the SPA entry point', () => {
    expect(existsSync('public/_redirects')).toBe(true);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  // Scoped to the /assets/* block specifically, not matched against the
  // whole file. A whole-file regex passes as long as `max-age=31536000` and
  // `immutable` appear *somewhere*, even if a later edit attaches them to
  // the wrong rule -- e.g. swapping this policy onto the unhashed-photo
  // rules below and vice versa. That exact swap was built and run against
  // the old whole-file version of these two tests, and both passed.
  it('caches hashed bundles immutably', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const blocks = headers.trim().split(/\n\s*\n/);
    const assetsBlock = blocks.find((b) => b.startsWith('/assets/'));
    expect(assetsBlock).toBeDefined();
    expect(assetsBlock).toMatch(/max-age=31536000/);
    expect(assetsBlock).toMatch(/immutable/);
  });

  // Scoped to each unhashed-asset block, for the same reason: a whole-file
  // match for `max-age=604800` and `must-revalidate` is satisfied by any
  // block carrying those strings, including the /assets/* block if a future
  // edit accidentally duplicates them there instead of removing them from
  // it.
  it('caches unhashed public assets for a week, revalidating', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const blocks = headers.trim().split(/\n\s*\n/);
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/'));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => {
      expect(block).toMatch(/max-age=604800/);
      expect(block).toMatch(/must-revalidate/);
    });
  });

  it('never marks unhashed assets immutable', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const blocks = headers.trim().split(/\n\s*\n/);
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/'));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => expect(block).not.toContain('immutable'));
  });
});

describe('documented cloudflare build command', () => {
  // Task 2 made public/ derivatives untracked, so a fresh clone (exactly what
  // Cloudflare builds from) has none until `npm run images` runs. `npm run
  // test:deploy` runs the suite that checks those derivatives exist. Run the
  // test gate before the images step and the gate fails on a machine that did
  // nothing wrong -- it just hasn't generated the files it's checking for
  // yet. This extracts the actual documented command and checks the ordering
  // rather than merely asserting the word "images" appears somewhere in the
  // document, which would pass even if the document only mentioned images in
  // passing without running them first.
  it('runs `npm run images` before `npm run test:deploy`', () => {
    const doc = readFileSync('docs/cloudflare-cutover.md', 'utf8');
    const match = doc.match(/\*\*Build command:\*\*\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const command = match![1];

    const imagesIndex = command.indexOf('npm run images');
    const testDeployIndex = command.indexOf('npm run test:deploy');

    expect(imagesIndex).toBeGreaterThanOrEqual(0);
    expect(testDeployIndex).toBeGreaterThanOrEqual(0);
    expect(imagesIndex).toBeLessThan(testDeployIndex);
  });
});
