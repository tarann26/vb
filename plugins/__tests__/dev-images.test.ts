// @vitest-environment node
//
// Same reasoning as plugins/__tests__/build-info.test.ts's own header
// comment: this file starts a real Vite dev server, which needs Node's real
// globals, not jsdom's.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import path from 'node:path';
import devImages, { publicFileForImagePath } from '../dev-images';
import { IMAGE_BASE, imageUrl } from '../../src/shared/image-host';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

describe('publicFileForImagePath (pure)', () => {
  it('maps a migrated reference to the file public/ holds under that key', () => {
    expect(publicFileForImagePath(imageUrl('hero/brick.webp'), PUBLIC_DIR)).toBe(
      path.join(PUBLIC_DIR, 'hero', 'brick.webp'),
    );
  });

  // The five filenames carrying a space arrive percent-encoded, because
  // that is what scripts/rewrite-image-refs.mjs wrote into the content and
  // what a browser sends. Decoding them is keyFromImageUrl's job and this is
  // the end of that contract nothing else exercises on this side.
  it('decodes a percent-encoded space back to the real filename', () => {
    expect(publicFileForImagePath(imageUrl('atmosphere/ceiling decor.webp'), PUBLIC_DIR)).toBe(
      path.join(PUBLIC_DIR, 'atmosphere', 'ceiling decor.webp'),
    );
  });

  it('answers null for a key nothing holds', () => {
    expect(publicFileForImagePath(`${IMAGE_BASE}/food/no-such-photo.webp`, PUBLIC_DIR)).toBeNull();
  });

  // A directory resolves to a real path, so without an explicit file check
  // this would be handed to the static middleware to serve.
  it('answers null for a directory', () => {
    expect(publicFileForImagePath(`${IMAGE_BASE}/food`, PUBLIC_DIR)).toBeNull();
  });

  it('answers null for a path outside the prefix', () => {
    expect(publicFileForImagePath('/hero/brick.webp', PUBLIC_DIR)).toBeNull();
  });

  it.each(['/images/../index.html', '/images/hero/../../index.html', '/images/%2e%2e/index.html'])(
    'refuses the traversal %s',
    (pathname) => {
      expect(publicFileForImagePath(pathname, PUBLIC_DIR)).toBeNull();
    },
  );
});

// node:http rather than fetch, and that is not a style choice.
// src/test/setup.ts replaces the global `fetch` with a throwing stub so no
// test can reach the network -- the right rule, and this is a loopback
// request to a server started in this same process a line earlier, whose
// latency is bounded by nothing outside the machine. Stubbing `fetch` here
// would mean stubbing the very transport under test.
function request(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf-8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

describe('the plugin, against a real dev server', () => {
  let server: ViteDevServer | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  // A fixture root rather than this repository's own: what is being tested is
  // the middleware's behaviour on a hit and on a miss, and a two-file public/
  // makes both unambiguous.
  async function start(): Promise<string> {
    root = mkdtempSync(path.join(tmpdir(), 'vb-dev-images-'));
    mkdirSync(path.join(root, 'public', 'food'), { recursive: true });
    // Not a real WebP. Nothing here decodes it -- the assertion is about
    // which bytes come back under which status, and a distinctive short
    // string makes "the SPA shell was served instead" impossible to miss.
    writeFileSync(path.join(root, 'public', 'food', 'pizza1.webp'), 'PHOTOGRAPH-BYTES');
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>shell</title>');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [devImages()],
    });
    await server.listen();
    // Vite's own resolved URL rather than httpServer.address(): the server
    // binds to ::1 and picks the next free port if 5173 is taken, so
    // reconstructing a URL from the address record gets both the host family
    // and the port wrong often enough to be flaky.
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the dev server reported no local url');
    return base.replace(/\/$/, '');
  }

  it('serves the bytes public/ holds, under the migrated prefix', async () => {
    const base = await start();
    const response = await request(`${base}${imageUrl('food/pizza1.webp')}`);
    expect(response.status).toBe(200);
    expect(response.body).toBe('PHOTOGRAPH-BYTES');
  });

  // THE WHOLE REASON THIS PLUGIN EXISTS. Before it, this request was answered
  // by the SPA catch-all with index.html at 200 -- and so was every request
  // for a photograph that DID exist, which is what made twelve Playwright
  // tests report "image did not load" with no failing request anywhere. A
  // miss has to look like a miss.
  it('answers a miss with 404 and not with the SPA shell at 200', async () => {
    const base = await start();
    const response = await request(`${base}${IMAGE_BASE}/food/no-such-photo.webp`);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('<title>shell</title>');
  });

  // The control for the test above: the same server, the same catch-all, a
  // path outside the prefix. This one SHOULD get the shell -- otherwise the
  // 404 above would prove only that the server was broken generally.
  it('still hands an ordinary route to the SPA catch-all', async () => {
    const base = await start();
    const response = await request(`${base}/blog`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('<title>shell</title>');
  });

  // `apply: 'serve'` asked of Vite itself rather than read off the object,
  // the way plugins/__tests__/build-info.test.ts asks the same question of
  // its own plugin. Nothing about a production build should change.
  it('is not part of a build', async () => {
    const config = await resolveConfig({ configFile: false, plugins: [devImages()] }, 'build');
    expect(config.plugins.map((plugin) => plugin.name)).not.toContain('dev-images');
  });
});
