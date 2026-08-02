import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../index';
import { hashPassword, parseCookie, verifyToken, signToken } from '../auth';
import { makeGitHubStub, utf8, NEW_COMMIT_SHA, type GitHubStub } from './githubStub';

// Runs under this repo's single jsdom Vitest environment (see
// vitest.config.ts's comment on that decision) -- fetch/Request/Response
// here come from Node itself, not from jsdom, so this is a faithful test of
// the handler's own logic even though it isn't running inside workerd.

// A hand-built fake, not an import from @cloudflare/workers-types --
// KVNamespace has no runtime shape in this repo's test environment (see
// vitest.config.ts's comment), only a type-only ambient declaration. Real
// Workers always call fetch(request, env, ctx) with real bindings, so every
// test below passes an env built from this fake rather than calling
// worker.fetch() with only one argument.
class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const TOKEN_SECRET = 'index-test-token-secret';
const PASSWORD = 'the real restaurant password';

async function buildEnv() {
  return {
    KV: new FakeKV() as unknown as KVNamespace,
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    TOKEN_SECRET,
    // Real values in production (wrangler.toml); the shape only matters
    // here, since GitHub itself is always a stubbed `fetch` in this file's
    // /api/publish tests -- see githubStub.ts.
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'index-test-github-token-not-real',
  };
}

// The smallest site.json shape that satisfies validateSite/assertHours
// (src/content/validate.ts, src/content/guards.ts) with zero problems --
// hand-built here rather than read off disk, so this test doesn't start
// failing the moment a future, legitimate edit to the real site.json
// changes its shape.
const VALID_SITE = {
  name: 'Via Bianca',
  tagline: 'A Roman trattoria',
  strapline: 'Handmade pasta, Delhi',
  address: { street: '1 Test Street', locality: 'Test Locality', postalCode: '110001', country: 'India' },
  phones: ['+911234567890'],
  whatsapp: { number: '+911234567890', prefilledMessage: 'Hi, I would like to book a table.' },
  socials: { instagram: 'https://instagram.com/viabianca' },
  hours: [{ days: ['Mo'], opens: '09:00', closes: '22:00' }],
  seo: { title: 'Via Bianca', description: 'A Roman trattoria in Delhi.' },
  copyrightYear: 2026,
};

describe('worker entry point', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;

  beforeEach(async () => {
    env = await buildEnv();
  });

  it('answers /api/health with an unauthenticated 200 JSON body, revealing nothing', async () => {
    const response = await worker.fetch(new Request('https://viabiancadelhi.com/api/health'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body: unknown = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 404 for every other unhandled path', async () => {
    const paths = ['/', '/api/publish', '/api/wa', '/anything'];
    for (const path of paths) {
      const response = await worker.fetch(new Request(`https://viabiancadelhi.com${path}`), env);
      expect(response.status).toBe(404);
    }
  });

  // GET /api/login is deliberately not a route -- only POST is handled --
  // so it still falls through to the same 404 as any other unhandled path.
  it('returns 404 for GET /api/login -- only POST is a route', async () => {
    const response = await worker.fetch(new Request('https://viabiancadelhi.com/api/login'), env);
    expect(response.status).toBe(404);
  });

  describe('POST /api/login', () => {
    function loginRequest(body: unknown, ip = '1.2.3.4') {
      return new Request('https://viabiancadelhi.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(body),
      });
    }

    it('the correct password gets a 204 with a signed, httpOnly, 7-day session cookie', async () => {
      const response = await worker.fetch(loginRequest({ password: PASSWORD }), env);
      expect(response.status).toBe(204);

      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain('Max-Age=604800');

      const token = parseCookie(setCookie, 'vb_session');
      expect(token).not.toBeNull();
      // The cookie carries a token that actually verifies against the same
      // secret the Worker signed it with -- not just a string that looks
      // like one.
      expect(await verifyToken(TOKEN_SECRET, token as string, Math.floor(Date.now() / 1000))).toBe(
        true,
      );
    });

    it('the wrong password gets 401 and no cookie', async () => {
      const response = await worker.fetch(loginRequest({ password: 'guess' }), env);
      expect(response.status).toBe(401);
      expect(response.headers.get('Set-Cookie')).toBeNull();
    });

    it('a missing password gets 400, not 401 -- and never touches the rate limiter as a guess', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await worker.fetch(loginRequest({}), env);
        expect(response.status).toBe(400);
      }
      // 5 malformed bodies did not spend the rate-limit budget: the correct
      // password still succeeds immediately after, rather than 429ing.
      const success = await worker.fetch(loginRequest({ password: PASSWORD }), env);
      expect(success.status).toBe(204);
    });

    // Important fix from the security review: an unset TOKEN_SECRET used to
    // make signToken (via crypto.subtle.importKey on a zero-length key)
    // throw an unhandled DataError instead of failing closed -- so a
    // correct password, mid-setup before TOKEN_SECRET was set, got the
    // owner a raw Cloudflare error page instead of the clean failure the
    // runbook promises. Covers both the empty-string and fully-absent
    // shapes an unset Worker secret can take.
    it('a correct password with TOKEN_SECRET unset fails closed with a clean 500, not a throw', async () => {
      const emptySecretEnv = { ...env, TOKEN_SECRET: '' };
      const emptyResponse = await worker.fetch(loginRequest({ password: PASSWORD }), emptySecretEnv);
      expect(emptyResponse.status).toBe(500);
      expect(emptyResponse.headers.get('Set-Cookie')).toBeNull();

      const undefinedSecretEnv = { ...env, TOKEN_SECRET: undefined } as unknown as typeof env;
      const undefinedResponse = await worker.fetch(
        loginRequest({ password: PASSWORD }),
        undefinedSecretEnv,
      );
      expect(undefinedResponse.status).toBe(500);
      expect(undefinedResponse.headers.get('Set-Cookie')).toBeNull();
    });

    it('a non-JSON body gets 400 rather than a 500', async () => {
      const response = await worker.fetch(
        new Request('https://viabiancadelhi.com/api/login', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
          body: 'not json',
        }),
        env,
      );
      expect(response.status).toBe(400);
    });

    it('locks the IP out after 5 wrong attempts, independent of the password tried', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await worker.fetch(loginRequest({ password: `wrong-${i}` }), env);
        expect(r.status).toBe(401);
      }
      // A 6th attempt, even with the CORRECT password, is now rate-limited
      // -- the limiter tracks the IP, not whether this particular guess was
      // right.
      const locked = await worker.fetch(loginRequest({ password: PASSWORD }), env);
      expect(locked.status).toBe(429);
    });

    it('a successful login clears prior failures for that IP', async () => {
      for (let i = 0; i < 4; i++) {
        await worker.fetch(loginRequest({ password: 'wrong' }), env);
      }
      const success = await worker.fetch(loginRequest({ password: PASSWORD }), env);
      expect(success.status).toBe(204);

      // 4 prior failures were cleared by the success above, so 4 more wrong
      // guesses still don't hit the 5-attempt limit.
      for (let i = 0; i < 4; i++) {
        const r = await worker.fetch(loginRequest({ password: 'wrong-again' }), env);
        expect(r.status).toBe(401);
      }
    });

    it('rate limiting is per IP, not global', async () => {
      for (let i = 0; i < 5; i++) {
        await worker.fetch(loginRequest({ password: 'wrong' }, '1.2.3.4'), env);
      }
      const otherIp = await worker.fetch(loginRequest({ password: PASSWORD }, '9.9.9.9'), env);
      expect(otherIp.status).toBe(204);
    });
  });

  describe('POST /api/publish', () => {
    // The order this whole task is built around: verify token -> parse ->
    // validate every file -> commit only if every file passed. Each test
    // below proves one link of that chain by checking not just the HTTP
    // status but that `stub.calls` -- every request that would have reached
    // GitHub -- stayed empty. Asserting the status alone would pass even if
    // a bug let the Worker call GitHub first and only reject afterwards.
    let stub: GitHubStub;

    beforeEach(() => {
      stub = makeGitHubStub();
      vi.stubGlobal('fetch', stub.fetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function sessionCookie(): Promise<string> {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const token = await signToken(TOKEN_SECRET, expiresAt);
      return `vb_session=${token}`;
    }

    function publishRequest(body: unknown, cookie?: string): Request {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cookie) headers['Cookie'] = cookie;
      return new Request('https://viabiancadelhi.com/api/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    }

    it('an unauthenticated publish is 401 and makes no GitHub call', async () => {
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }),
        env,
      );
      expect(response.status).toBe(401);
      expect(stub.calls).toHaveLength(0);
    });

    // A cookie signed under a *different* secret than this env's
    // TOKEN_SECRET -- distinct from having no cookie at all, and the more
    // dangerous failure mode: verifyToken must actually check the
    // signature, not just "a vb_session cookie is present".
    it('a forged session cookie is also 401 and makes no GitHub call', async () => {
      const forgedToken = await signToken('a-different-secret-entirely', Math.floor(Date.now() / 1000) + 3600);
      const response = await worker.fetch(
        publishRequest(
          { files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] },
          `vb_session=${forgedToken}`,
        ),
        env,
      );
      expect(response.status).toBe(401);
      expect(stub.calls).toHaveLength(0);
    });

    it('one invalid file among valid ones is 422, lists the problem, and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              utf8('src/content/site.json', JSON.stringify(VALID_SITE)),
              // Missing every required field -- id, name, description,
              // image, tags -- so validateContent must report problems for
              // dishes.json even though site.json alongside it is fine.
              utf8('src/content/dishes.json', JSON.stringify([{}])),
            ],
          },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { problems: { field: string; message: string }[] };
      expect(body.problems.length).toBeGreaterThan(0);
      expect(stub.calls).toHaveLength(0);
    });

    it('malformed JSON in one file is 422 (not a 500), and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', '{not valid json')] }, cookie),
        env,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { problems: { field: string; message: string }[] };
      expect(body.problems).toEqual([{ field: 'src/content/site.json', message: 'This file is not valid JSON.' }]);
      expect(stub.calls).toHaveLength(0);
    });

    it('publishes every valid file in one commit and returns its sha', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }, cookie),
        env,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { sha: string };
      expect(body).toEqual({ sha: NEW_COMMIT_SHA });
      // The real GitHub mechanics (base_tree, parents, blob encoding) are
      // github.test.ts's job; this only proves the Worker actually reached
      // commitFiles on a fully valid publish.
      expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
  });
});
