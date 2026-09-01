import { describe, it, expect } from 'vitest';
import { referencesIn, islandFrom, committedReferences, sweep } from '../../../scripts/verify-image-urls.mjs';

const ORIGIN = 'https://viabiancarestaurant.com';

function fake(map: Record<string, { status: number; type: string }>) {
  return async (url: string) => {
    const answer = map[url];
    if (!answer) throw new Error('no route');
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: new Headers({ 'content-type': answer.type }),
    } as unknown as Response;
  };
}

describe('the live image sweep', () => {
  it('finds references nested anywhere in a document, of every extension', () => {
    const found = referencesIn({
      a: [{ image: '/food/x.webp' }],
      b: { c: 'https://img.h/y.webp' },
      d: '/og-image.jpg',
    });
    expect(found).toEqual(['/food/x.webp', 'https://img.h/y.webp', '/og-image.jpg']);
  });

  it('ignores strings that are not image references', () => {
    expect(referencesIn({ url: 'https://viabiancarestaurant.com', file: '/menus/food-menu.pdf' })).toEqual([]);
  });

  it('reads the island out of served html', () => {
    const html = '<head><script type="application/json" id="vb-content">{"a":1}</script></head>';
    expect(islandFrom(html)).toEqual({ a: 1 });
  });

  it('returns null rather than throwing when there is no island', () => {
    expect(islandFrom('<head></head>')).toBeNull();
  });

  it('passes an image that answers 200 with an image content type', async () => {
    const url = 'https://img.h/y.webp';
    expect(await sweep([url], ORIGIN, fake({ [url]: { status: 200, type: 'image/webp' } }))).toEqual([]);
  });

  it('fails a reference that 404s', async () => {
    const url = 'https://img.h/y.webp';
    expect(await sweep([url], ORIGIN, fake({ [url]: { status: 404, type: 'text/html' } })))
      .toEqual([{ url, why: 'HTTP 404' }]);
  });

  // The exact shape the SPA catch-all produces for a missing site-root path:
  // 200, but it is index.html. A status-only check calls this healthy.
  it('fails a reference answered 200 with text/html', async () => {
    const url = 'https://viabiancarestaurant.com/food/gone.webp';
    const problems = await sweep(['/food/gone.webp'], ORIGIN, fake({ [url]: { status: 200, type: 'text/html' } }));
    expect(problems[0].why).toContain('not an image');
  });

  it('reports an unreachable host rather than throwing out of the sweep', async () => {
    expect((await sweep(['https://img.h/y.webp'], ORIGIN, fake({})))[0].why).toContain('unreachable');
  });

  it('sweeps each distinct url once, however many documents name it', async () => {
    let calls = 0;
    const url = 'https://img.h/y.webp';
    await sweep([url, url, url], ORIGIN, async () => {
      calls += 1;
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/webp' }) } as unknown as Response;
    });
    expect(calls).toBe(1);
  });

  // HEAD, not GET. 2.6 MB of image bodies per deploy check buys nothing, and
  // this is the only place that choice is visible from the outside.
  it('asks for the head of the object, not its body', async () => {
    const methods: (string | undefined)[] = [];
    await sweep(['https://img.h/y.webp'], ORIGIN, async (_url, init) => {
      methods.push(init?.method);
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/webp' }) } as unknown as Response;
    });
    expect(methods).toEqual(['HEAD']);
  });

  // The poisoned-cache variant this site has shipped three times is keyed on
  // Origin with no Vary advertising the split, so a request without the header
  // reads a different cached variant than a visitor gets.
  it('carries the site origin on every request, like every other check here', async () => {
    let sent: string | undefined;
    await sweep(['/food/x.webp'], ORIGIN, async (_url, init) => {
      sent = new Headers(init?.headers).get('Origin') ?? undefined;
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/webp' }) } as unknown as Response;
    });
    expect(sent).toBe(ORIGIN);
  });

  it('resolves a site-root reference against the origin and leaves an absolute one alone', async () => {
    const asked: string[] = [];
    await sweep(['/food/x.webp', 'https://img.h/y.webp'], ORIGIN, async (url) => {
      asked.push(url);
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/webp' }) } as unknown as Response;
    });
    expect(asked).toEqual(['https://viabiancarestaurant.com/food/x.webp', 'https://img.h/y.webp']);
  });
});

// The vacuity guard. `npm run verify:images` reporting `0/0 references resolve`
// is a green run that proved nothing, and the runner prints the two halves
// separately for exactly that reason -- but nothing about the RUNNER is
// checkable offline. What is checkable is that the repository half is not
// empty, which is the half that carries every reference today.
describe('the committed half of the union', () => {
  it('reads a substantial number of references straight out of src/content', () => {
    expect(committedReferences().length).toBeGreaterThanOrEqual(60);
  });

  it('leaves the menu pdfs out, because a pdf is not an image and never answers image/*', () => {
    expect(committedReferences().some((path) => path.endsWith('.pdf'))).toBe(false);
  });
});
