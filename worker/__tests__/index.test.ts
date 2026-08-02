import { describe, it, expect } from 'vitest';
import worker from '../index';

// Runs under this repo's single jsdom Vitest environment (see
// vitest.config.ts's comment on that decision) -- fetch/Request/Response
// here come from Node itself, not from jsdom, so this is a faithful test of
// the handler's own logic even though it isn't running inside workerd.
describe('worker entry point', () => {
  it('answers /api/health with an unauthenticated 200 JSON body, revealing nothing', async () => {
    const response = await worker.fetch(new Request('https://viabiancadelhi.com/api/health'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body: unknown = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 404 for every other path -- no route does anything yet', async () => {
    const paths = ['/', '/api/login', '/api/publish', '/api/wa', '/anything'];
    for (const path of paths) {
      const response = await worker.fetch(new Request(`https://viabiancadelhi.com${path}`));
      expect(response.status).toBe(404);
    }
  });
});
