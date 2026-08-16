import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { AUTHENTICATED_PATHS } from '../index';
import { hashPassword, parseCookie, verifyToken, signToken } from '../auth';
import {
  makeGitHubStub,
  utf8,
  BASE_COMMIT_SHA,
  BASE_TREE_SHA,
  NEW_COMMIT_SHA,
  PARENT_COMMIT_SHA,
  PARENT_TREE_SHA,
  type GitHubStub,
} from './githubStub';
import { FakeD1, asD1 } from './fakeD1';

// The session key is TOKEN_SECRET bound to the current password hash, so a
// password change revokes every token already issued (worker/auth.ts).
// These tests supply a fixed hash so that binding is held constant except
// where a test varies it deliberately.
// Deliberately NOT in `pbkdf2$<iterations>$<salt>$<hash>` shape:
// src/test/secrets.test.ts scans every tracked file for that pattern to stop
// a real password hash being committed, and it correctly flagged an earlier
// version of this fixture. Nothing here needs a well-formed hash -- the
// session key treats it as opaque key material -- so an obviously-fake
// string keeps the guard meaningful instead of teaching it an exception.
const PASSWORD_HASH = 'test-only-password-hash-placeholder';


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

// Whole-branch review, Important 2: a real Workers KV binding can genuinely
// reject a write (KV Free's 1,000-writes/day cap, shared across everything
// this Worker writes to the same namespace) -- this stands in for that,
// rejecting both the write recordLoginFailure makes and the delete
// clearLoginFailures makes, so both of handleLogin's KV calls around the
// password check can be proven to degrade cleanly instead of throwing.
class KvThatRejectsWrites extends FakeKV {
  override async put(): Promise<void> {
    throw new Error('KV temporarily unavailable');
  }
  override async delete(): Promise<void> {
    throw new Error('KV temporarily unavailable');
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
    // Build-status reporting. Unused by any test in this file (none of them
    // call /api/build-status -- see status.test.ts), but required for `env`
    // to satisfy `Env`.
    CLOUDFLARE_ACCOUNT_ID: 'index-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'index-test-project',
    CLOUDFLARE_API_TOKEN: 'index-test-fixture-cf-token-not-real',
    CF_WEB_ANALYTICS_SITE_TAG: '29e1ba52fba74885a5fc44875a48a078',
    // Phase 2. Unused by any test in this file -- nothing here reads env.DB
    // yet -- but required for `env` to satisfy `Env`.
    DB: {} as unknown as D1Database,
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
    // /api/wa is deliberately not in this list -- Task 10 made it a real
    // route (POST and GET both handled; see count.test.ts), so it no longer
    // belongs in a "everything else 404s" check. /api/wa/anything still
    // does, proving the route match is exact rather than a prefix match.
    const paths = ['/', '/api/publish', '/api/wa/anything', '/anything'];
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

    // Renamed from "7-day session cookie": login now issues a SIX-HOUR idle
  // window, which every authenticated request slides forward, with seven days
  // as an absolute cap nothing can extend (worker/index.ts's two constants).
  // The cookie's Max-Age is the idle window, not the cap.
  it('the correct password gets a 204 with a signed, httpOnly, sliding session cookie', async () => {
      const response = await worker.fetch(loginRequest({ password: PASSWORD }), env);
      expect(response.status).toBe(204);

      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/');
      // 6 hours, not 7 days: the cap is enforced by `iat` inside the token,
      // and re-checked on every slide, so the cookie itself never carries it.
      expect(setCookie).toContain(`Max-Age=${6 * 60 * 60}`);

      const token = parseCookie(setCookie, 'vb_session');
      expect(token).not.toBeNull();
      // The cookie carries a token that actually verifies against the same
      // key the Worker signed it with -- not just a string that looks like
      // one. That key is TOKEN_SECRET bound to the CURRENT password hash, so
      // this reads the hash off the env rather than a constant.
      expect(
        await verifyToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token as string, Math.floor(Date.now() / 1000)),
      ).not.toBeNull();

      // The property this whole change exists for: changing the password
      // revokes every session already issued. Same token, same TOKEN_SECRET,
      // a different password hash -- and it no longer verifies.
      const afterPasswordChange = await hashPassword('a-completely-different-password');
      expect(
        await verifyToken(TOKEN_SECRET, afterPasswordChange, token as string, Math.floor(Date.now() / 1000)),
      ).toBeNull();
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

    // Whole-branch review, Important 2: recordLoginFailure (worker/index.ts)
    // used to sit outside any try/catch. Reproduced directly: a KV whose
    // `put` throws made a wrong password crash the whole request instead of
    // returning the clean 401 every other wrong-password test above expects
    // -- a raw Cloudflare exception page for the single most ordinary
    // mistake an owner makes, mistyping her own password.
    it('a wrong password still gets a clean 401 even when the KV write behind the rate limiter fails', async () => {
      const throwingEnv = { ...env, KV: new KvThatRejectsWrites() as unknown as KVNamespace };
      const response = await worker.fetch(loginRequest({ password: 'wrong' }), throwingEnv);
      expect(response.status).toBe(401);
    });

    // The other half of the same finding: clearLoginFailures (worker/index.ts)
    // was equally unguarded on the success path -- a KV whose `delete` throws
    // used to crash a CORRECT password into the same raw exception instead of
    // the 204 + session cookie it earned.
    it('a correct password still gets 204 even when the KV delete behind clearing failures fails', async () => {
      const throwingEnv = { ...env, KV: new KvThatRejectsWrites() as unknown as KVNamespace };
      const response = await worker.fetch(loginRequest({ password: PASSWORD }), throwingEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Set-Cookie')).toBeTruthy();
    });
  });

  describe('POST /api/publish', () => {
    // The order this whole task is built around: verify token -> parse ->
    // check baseSha (Task 3) -> validate every file -> site.json's
    // developer-owned re-check (Task 3, site.json only) -> commit only if
    // every file passed. Each test below proves one link of that chain by
    // checking not just the HTTP status but that `stub.calls` -- every
    // request that would have reached GitHub -- stayed empty, or that no
    // write (POST/PATCH) happened. Asserting the status alone would pass
    // even if a bug let the Worker call GitHub first and only reject
    // afterwards.
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
      const token = await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, expiresAt - 60, expiresAt);
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
      const forgedToken = await signToken('a-different-secret-entirely', PASSWORD_HASH, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600);
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

    // Security review reproduction (Important 2): `encoding` is
    // client-supplied, and step 3's `flatMap` used to skip `validateContent`
    // entirely for any file that wasn't declared `'utf-8'` -- so a request
    // could opt a JSON file out of validation just by mislabelling its
    // encoding as `'base64'`. Before this was guarded, this exact request
    // committed `site.json` on `main` as the literal bytes "not json at
    // all", passing validateContent (never even called), returning 200 with
    // a sha -- while the next build breaks (guards.ts asserts at import) and
    // the dashboard shows a false "published" success. That's the
    // silent-evaporation failure the spec is built around, reached through
    // the encoding field the brief's own Step 4 snippet left unguarded.
    it('a JSON path mislabelled as base64 is still validated, not silently waved through', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          { files: [{ path: 'src/content/site.json', content: btoa('not json at all'), encoding: 'base64' }] },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { problems: { field: string; message: string }[] };
      expect(body.problems.length).toBeGreaterThan(0);
      expect(stub.calls).toHaveLength(0);
    });

    // Task 5: `/api/upload` no longer commits a photo on its own -- the
    // browser now stages it (`?stage=1`) and sends its base64 bytes in this
    // SAME `files` array as the JSON content files it publishes alongside,
    // so a real request legitimately mixes a non-JSON base64 file with
    // utf-8 JSON files for the first time. That mix is exactly the shape a
    // regression could hide in: a check that skips content validation
    // merely because SOME file in the request is a genuine non-JSON base64
    // asset would still let a JSON file mislabelled base64 slip through
    // right next to it, and the single-file test above can't tell that
    // apart from the fix actually working -- it never has a second file in
    // the request to be distracted by.
    it('a JSON file mislabelled base64 is still refused even alongside a legitimate staged photo', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              // The legitimate half: a staged photo, base64, at a real
              // assets-source/ path -- exactly what PhotoField.tsx sends.
              { path: 'assets-source/food/abc123abc123.jpg', content: btoa('not really a jpeg'), encoding: 'base64' },
              // The attack half: identical shape to the single-file test
              // above, just no longer alone in the request.
              { path: 'src/content/site.json', content: btoa('not json at all'), encoding: 'base64' },
            ],
          },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { problems: { field: string; message: string }[] };
      expect(body.problems.some((p) => p.field === 'src/content/site.json')).toBe(true);
      expect(stub.calls).toHaveLength(0);
    });

    // Security review Minor 1: two entries for the same path produce two
    // blobs and two tree entries; GitHub's tree API keeps the *last* one
    // for a repeated path, so she could publish what she believes are two
    // different edits and silently get only one of them, with no error at
    // all.
    it('the same path sent twice is 400 (not silently resolved by GitHub keeping the last one), and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              utf8('src/content/site.json', JSON.stringify(VALID_SITE)),
              utf8('src/content/site.json', JSON.stringify({ ...VALID_SITE, name: 'A different name' })),
            ],
          },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    // Security review Minor 2: a disallowed path on a non-`.json`, non-utf-8
    // file (an image, in the shape Task 6 will actually send) skips content
    // validation entirely -- step 3 only inspects `.json` paths -- and
    // reaches `commitFiles`, whose own allowlist throws
    // `DisallowedPathError`. That used to fall into handlePublish's generic
    // catch and answer 502 -- "GitHub is broken" -- for what is actually a
    // client mistake. It must answer 400, and it must still make no GitHub
    // call (assertAllowedPath runs before any fetch in commitFiles
    // regardless of which HTTP status ultimately gets returned). Not
    // `package.json` here -- that ends in `.json` and would instead be
    // caught by the previous test's guard, which is a different code path.
    it('a disallowed path on a non-JSON file is 400, not 502, and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          { files: [{ path: '.github/workflows/evil.yml', content: 'AA', encoding: 'base64' }] },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    // Review finding: without a `baseSha` on this file, the test above
    // never actually exercises the baseSha loop at all -- it passes purely
    // on commitFiles' own allowlist (step 6), which runs much later. Adding
    // one here is what proves the allowlist is also enforced at step 3,
    // BEFORE the read a `baseSha` triggers -- confirmed directly: removing
    // step 3's `isContentPath` check let this exact request issue a real,
    // token-authenticated GET to GitHub for `.github/workflows/evil.yml`.
    it('a disallowed path with a baseSha is also 400, not a conflict-triggering read, and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              { path: '.github/workflows/evil.yml', content: 'AA', encoding: 'base64', baseSha: 'anything' },
            ],
          },
          cookie,
        ),
        env,
      );
      expect(response.status).toBe(400);
      // Not 409 -- a malformed path is a client mistake, never a conflict,
      // and must never tell her to discard her buffer and reload.
      expect(stub.calls).toHaveLength(0);
    });

    it('publishes every valid file in one commit and returns its sha', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }, cookie),
        env,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { sha: string; publishId: string; d1Paths: string[] };
      // Task 5: the publish response grew `publishId` and `d1Paths` alongside
      // `sha` -- a GitHub-only publish still returns the real commit sha and
      // an empty `d1Paths`.
      expect(body).toEqual({ sha: NEW_COMMIT_SHA, publishId: expect.any(String), d1Paths: [] });
      // The real GitHub mechanics (base_tree, parents, blob encoding) are
      // github.test.ts's job; this only proves the Worker actually reached
      // commitFiles on a fully valid publish.
      expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true);
    });

    // The claim this whole phase rests on, as an assertion. A publish of
    // existing files makes exactly the GitHub calls it made before Phase 2 and
    // touches D1 not at all.
    it('publishes an existing content file through GitHub only, with no D1 traffic', async () => {
      const fake = new FakeD1();
      const cookie = await sessionCookie();
      const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
      const response = await worker.fetch(
        publishRequest(
          { files: [utf8('src/content/dishes.json', JSON.stringify([goodDish]))] },
          cookie,
        ),
        { ...env, DB: asD1(fake) },
      );
      expect(response.status).toBe(200);
      expect(fake.statements, 'a GitHub-backed publish issued a D1 statement').toEqual([]);
      // `toEqual`, not `toMatchObject`: a dropped `publishId` (or any other
      // key) must turn this red, not pass silently because the keys it does
      // check happen to match.
      expect(await response.json()).toEqual({ sha: expect.any(String), publishId: expect.any(String), d1Paths: [] });
    });

    it('publishes the pilot file through D1 only, with no commit and no build', async () => {
      const fake = new FakeD1();
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest(
          { files: [{ path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' }] },
          cookie,
        ),
        { ...env, DB: asD1(fake) },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { sha: string | null; publishId: string; d1Paths: string[] };
      expect(body.sha, 'a D1-only publish invented a commit sha').toBeNull();
      expect(body.d1Paths).toEqual(['src/content/awards.json']);
      expect(fake.content.get('src/content/awards.json')?.body).toBe('[]');
    });

    // Review finding (Important 3): nothing anywhere in this suite sent a
    // MIXED publish -- one D1 file and one GitHub file in the same request
    // -- so the D1-first ordering step 6's own comment argues for was
    // provable only by reading the code, never by running it. Pins it
    // directly: the GitHub leg is made to fail (a ref-update conflict, same
    // as the GitHub-only case above), and the D1 file's write must still
    // have landed -- which is only true if D1 ran BEFORE the GitHub attempt.
    // Reversed (GitHub first), the GitHub failure would return before the
    // D1 write is ever reached and `fake.content` would stay empty.
    it('writes the D1 leg before attempting GitHub, so a GitHub failure still leaves it committed', async () => {
      const fake = new FakeD1();
      stub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
      vi.stubGlobal('fetch', stub.fetch);
      const cookie = await sessionCookie();
      const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              { path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' },
              utf8('src/content/dishes.json', JSON.stringify([goodDish])),
            ],
          },
          cookie,
        ),
        { ...env, DB: asD1(fake) },
      );
      expect(response.status).toBe(409);
      expect(fake.content.get('src/content/awards.json')?.body, 'the D1 leg never landed').toBe('[]');
    });

    // Review finding (Important 1): `partial` used to ride only the 502
    // branch, so a mixed publish that hit a GitHub CONFLICT -- the branch
    // most likely to actually fire, since it needs no GitHub outage at all
    // -- told her "conflict" and said nothing about the D1 half that had
    // already committed. She had no way to know without checking herself.
    it('reports the D1 half already landed when the GitHub half of a mixed publish conflicts', async () => {
      const fake = new FakeD1();
      stub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
      vi.stubGlobal('fetch', stub.fetch);
      const cookie = await sessionCookie();
      const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
      const response = await worker.fetch(
        publishRequest(
          {
            files: [
              { path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' },
              utf8('src/content/dishes.json', JSON.stringify([goodDish])),
            ],
          },
          cookie,
        ),
        { ...env, DB: asD1(fake) },
      );
      expect(response.status).toBe(409);
      const body = (await response.json()) as { message: string; partial: boolean };
      expect(body.partial, 'a mixed publish did not say the D1 half had landed').toBe(true);
    });

    // Task 10, Step 2: a concurrent-edit ref update (GitHub's own 422 on the
    // PATCH /git/refs/heads/{branch} call -- the branch moved between this
    // request's own read and its write, e.g. a second publish landed in the
    // gap) must answer 409, the SAME status the baseSha check above already
    // uses, not the generic 502 every other commitFiles failure gets. Before
    // github.ts's PublishConflictError existed, this fell straight into the
    // catch-all `json(502, { message })` below -- indistinguishable, by
    // status alone, from GitHub simply being down.
    it('a concurrent-edit ref update (422 from GitHub) is 409, not 502', async () => {
      stub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
      vi.stubGlobal('fetch', stub.fetch);
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }, cookie),
        env,
      );
      expect(response.status).toBe(409);
    });

    // The contrasting case: a plain GitHub outage on the exact same call
    // (PATCH /git/refs/heads/{branch}) must stay 502, not be swept into the
    // same 409 a real conflict gets -- "someone else published, reload and
    // try again" is actively misleading for an outage nothing of hers was
    // ever at risk from. Proves the Worker branches on PublishConflictError
    // specifically, not on "commitFiles threw during the ref update" in
    // general.
    it('a plain 5xx on the same ref-update call stays 502, not 409', async () => {
      stub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 500 });
      vi.stubGlobal('fetch', stub.fetch);
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }, cookie),
        env,
      );
      expect(response.status).toBe(502);
    });

    // Plan 4 Task 3: the conditional write. Without this, a dashboard reload
    // (or a second device) that publishes from a copy of dishes.json older
    // than what's actually on `main` succeeds silently -- `base_tree` is
    // set, the ref fast-forwards, 200 OK -- and whatever changed in between
    // is gone. `baseSha` is the blob sha GET /api/content handed back when
    // the dashboard last read this file; a mismatch means someone else's
    // edit landed since.
    describe('baseSha (Task 3 conditional write)', () => {
      const CURRENT_DISHES_SHA = 'current-dishes-blob-sha';

      it('refuses a publish whose baseSha is stale, and makes no GitHub write call at all', async () => {
        stub = makeGitHubStub({
          contents: { 'src/content/dishes.json': { content: '[]', sha: CURRENT_DISHES_SHA } },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
        const response = await worker.fetch(
          publishRequest(
            {
              files: [
                {
                  path: 'src/content/dishes.json',
                  content: JSON.stringify([goodDish]),
                  encoding: 'utf-8',
                  baseSha: 'old-stale-sha',
                },
              ],
            },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(409);
        const body = (await response.json()) as { problems: { field: string; message: string }[] };
        expect(body).toEqual({
          problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this while you were editing.' }],
        });
        // Not just "no PATCH" (the ref update) -- no POST at all (no blob,
        // tree or commit either). Only the GET this check itself made may
        // have reached GitHub.
        expect(stub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
      });

      // Review finding: an early return on the first mismatch meant she'd
      // fix one conflict, republish, and immediately hit a SECOND one the
      // first response never mentioned. Two files, both stale, in one
      // request -- both must be named in one response.
      it('collects every stale file into one response, not just the first', async () => {
        stub = makeGitHubStub({
          contents: {
            'src/content/dishes.json': { content: '[]', sha: CURRENT_DISHES_SHA },
            'src/content/drinks.json': { content: '[]', sha: 'current-drinks-blob-sha' },
          },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
        const goodDrink = { id: 'y', name: 'Y', description: 'd', category: 'mocktail', image: null };
        const response = await worker.fetch(
          publishRequest(
            {
              files: [
                {
                  path: 'src/content/dishes.json',
                  content: JSON.stringify([goodDish]),
                  encoding: 'utf-8',
                  baseSha: 'stale-dishes-sha',
                },
                {
                  path: 'src/content/drinks.json',
                  content: JSON.stringify([goodDrink]),
                  encoding: 'utf-8',
                  baseSha: 'stale-drinks-sha',
                },
              ],
            },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(409);
        const body = (await response.json()) as { problems: { field: string; message: string }[] };
        expect(body.problems.map((p) => p.field).sort()).toEqual(['src/content/dishes.json', 'src/content/drinks.json']);
        expect(stub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
      });

      // The brief's own reproduction: stale baseSha PLUS content that would
      // independently fail validateContent (`[]` is not a valid dishes.json
      // -- validateDishes refuses an empty menu). This must still answer
      // 409, not 422 -- the baseSha check runs before content validation,
      // deliberately, so she isn't shown a problem to fix in content she
      // never actually committed.
      it('a stale baseSha is 409 even when the content sent alongside it is independently invalid', async () => {
        stub = makeGitHubStub({
          contents: { 'src/content/dishes.json': { content: '[]', sha: CURRENT_DISHES_SHA } },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const response = await worker.fetch(
          publishRequest(
            {
              files: [
                { path: 'src/content/dishes.json', content: '[]', encoding: 'utf-8', baseSha: 'old-stale-sha' },
              ],
            },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(409);
        expect(stub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
      });

      it('publishes when baseSha matches the current blob sha', async () => {
        stub = makeGitHubStub({
          contents: { 'src/content/dishes.json': { content: '[]', sha: CURRENT_DISHES_SHA } },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
        const response = await worker.fetch(
          publishRequest(
            {
              files: [
                {
                  path: 'src/content/dishes.json',
                  content: JSON.stringify([goodDish]),
                  encoding: 'utf-8',
                  baseSha: CURRENT_DISHES_SHA,
                },
              ],
            },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(200);
        expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true);
      });

      it('publishes when baseSha is absent, for callers that do not track it', async () => {
        const cookie = await sessionCookie();
        const goodDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [] };
        const response = await worker.fetch(
          publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([goodDish]))] }, cookie),
          env,
        );
        expect(response.status).toBe(200);
        // No baseSha on the one file sent, and it isn't site.json -- neither
        // Task 3 read (the baseSha check, or the developer-owned re-check)
        // applies, so the only GET calls made are commitFiles' own two
        // (branch head, base tree), never a GET /contents/{path}.
        expect(stub.calls.some((c) => c.method === 'GET' && c.url.includes('/contents/'))).toBe(false);
        expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true);
      });

      it('a baseSha for a file GitHub no longer has (404) is also treated as a conflict, with its own message', async () => {
        stub = makeGitHubStub(); // no `contents` fixture at all -> 404
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const response = await worker.fetch(
          publishRequest(
            {
              files: [{ path: 'src/content/dishes.json', content: '[]', encoding: 'utf-8', baseSha: 'any-sha' }],
            },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(409);
        const body = (await response.json()) as { problems: { field: string; message: string }[] };
        // Distinct from the sha-mismatch message above: "someone else
        // changed this" is actively misleading when there is nothing to
        // compare against at all.
        expect(body.problems).toEqual([
          { field: 'src/content/dishes.json', message: 'This file no longer exists on the site -- reload before publishing.' },
        ]);
        expect(stub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
      });

      // The path-allowlist regression this loop's own `isContentPath` check
      // guards against is pinned above, alongside the other 400 "the same
      // file was sent twice"/"disallowed path" client-mistake cases (see
      // "a disallowed path with a baseSha is also 400" in the plain
      // POST /api/publish tests) -- not duplicated here.
    });

    // Plan 4 Task 2's site.json developer-owned-field rule
    // (validateSiteDeveloperOwnedFields, src/content/validate.ts) only fires
    // when validateContent is given a `current` value -- Task 3 is what
    // actually wires a real one in, by reading site.json fresh from GitHub
    // before committing. These prove that wiring end to end, not just the
    // rule's own unit-level behavior (already covered in validate.test.ts).
    describe('site.json developer-owned fields, re-checked against a fresh read (Task 3)', () => {
      it('refuses a site.json publish that changes a developer-owned field, even though it is structurally valid', async () => {
        stub = makeGitHubStub({
          contents: { 'src/content/site.json': { content: JSON.stringify(VALID_SITE), sha: 'site-sha-1' } },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const renamed = { ...VALID_SITE, name: 'A Totally Different Restaurant' };
        const response = await worker.fetch(
          publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(renamed))] }, cookie),
          env,
        );
        expect(response.status).toBe(422);
        const body = (await response.json()) as { problems: { field: string; message: string }[] };
        expect(body.problems.some((p) => p.field === 'name')).toBe(true);
        expect(stub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
      });

      it('publishes site.json when nothing developer-owned changed from the freshly-read current value', async () => {
        stub = makeGitHubStub({
          contents: { 'src/content/site.json': { content: JSON.stringify(VALID_SITE), sha: 'site-sha-1' } },
        });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        // strapline is hers to change; name/tagline/seo are not.
        const response = await worker.fetch(
          publishRequest(
            { files: [utf8('src/content/site.json', JSON.stringify({ ...VALID_SITE, strapline: 'A new line' }))] },
            cookie,
          ),
          env,
        );
        expect(response.status).toBe(200);
      });

      // If the fresh read fails (GitHub outage, malformed response), the
      // rule must skip -- not fabricate a `current` that blames every
      // developer-owned field. Proven end to end: the read here throws
      // (`contentsFailPath` targets exactly the Contents API request this
      // re-check makes), and the publish must still succeed since nothing
      // else about the file is invalid.
      it('a failed re-read of current site.json does not block an otherwise-valid publish', async () => {
        stub = makeGitHubStub({ contentsFailPath: 'src/content/site.json', contentsFailStatus: 500 });
        vi.stubGlobal('fetch', stub.fetch);
        const cookie = await sessionCookie();
        const response = await worker.fetch(
          publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(VALID_SITE))] }, cookie),
          env,
        );
        expect(response.status).toBe(200);
      });
    });
  });

  // Plan 4 Task 3: GET /api/content. The dashboard's only source of current
  // content -- see worker/index.ts's own comment on handleGetContent for
  // the silent-overwrite scenario this exists to close. Authenticated the
  // same way every other admin route is, and restricted to the same
  // src/content/<name>.json shape commitFiles enforces on writes (Task 3's
  // brief: "do not write a second [allowlist]").
  describe('GET /api/content', () => {
    let stub: GitHubStub;

    beforeEach(() => {
      stub = makeGitHubStub({
        contents: { 'src/content/dishes.json': { content: '[{"id":"x"}]', sha: 'dishes-sha-read' } },
      });
      vi.stubGlobal('fetch', stub.fetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function sessionCookie(): Promise<string> {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const token = await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, expiresAt - 60, expiresAt);
      return `vb_session=${token}`;
    }

    function contentRequest(path: string, cookie?: string): Request {
      const headers: Record<string, string> = {};
      if (cookie) headers['Cookie'] = cookie;
      const url = new URL('https://viabiancadelhi.com/api/content');
      url.searchParams.set('path', path);
      return new Request(url, { headers });
    }

    it('requires a session token to read content', async () => {
      const response = await worker.fetch(contentRequest('src/content/dishes.json'), env);
      expect(response.status).toBe(401);
      expect(stub.calls).toHaveLength(0);
    });

    // Same forged-signature reproduction as POST /api/publish's own 401
    // test -- a cookie must actually verify, not merely be present.
    it('a forged session cookie is also 401', async () => {
      const forgedToken = await signToken('a-different-secret-entirely', PASSWORD_HASH, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600);
      const response = await worker.fetch(
        contentRequest('src/content/dishes.json', `vb_session=${forgedToken}`),
        env,
      );
      expect(response.status).toBe(401);
      expect(stub.calls).toHaveLength(0);
    });

    it('refuses a content path outside src/content, and makes no GitHub call', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(contentRequest('package.json', cookie), env);
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    // The other half of Task 3's own allowlist reuse: assets-source/ is a
    // legal commitFiles WRITE path, but this READ route must still refuse
    // it -- there is no reason it ever serves a binary photo as text.
    it('refuses an assets-source path, even though commitFiles would accept it for a write', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        contentRequest('assets-source/food/a.jpg', cookie),
        env,
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    it('missing the path query entirely is 400', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(
        new Request('https://viabiancadelhi.com/api/content', { headers: { Cookie: cookie } }),
        env,
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toHaveLength(0);
    });

    it('returns the current content and its blob sha for an allowed path', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(contentRequest('src/content/dishes.json', cookie), env);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { content: string; sha: string };
      expect(body).toEqual({ content: '[{"id":"x"}]', sha: 'dishes-sha-read' });
    });

    // Review finding: this route's entire purpose is freshness -- a cache
    // sitting anywhere between here and the dashboard would quietly
    // reintroduce the stale-read problem this task exists to close.
    it('answers with Cache-Control: no-store', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(contentRequest('src/content/dishes.json', cookie), env);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('answers 404 for a well-formed path that does not exist on GitHub', async () => {
      const cookie = await sessionCookie();
      const response = await worker.fetch(contentRequest('src/content/site.json', cookie), env);
      expect(response.status).toBe(404);
    });

    it('answers 502, not a raw throw, when the GitHub read itself fails', async () => {
      stub = makeGitHubStub({ contentsFailPath: 'src/content/dishes.json', contentsFailStatus: 500 });
      vi.stubGlobal('fetch', stub.fetch);
      const cookie = await sessionCookie();
      const response = await worker.fetch(contentRequest('src/content/dishes.json', cookie), env);
      expect(response.status).toBe(502);
    });
  });
});

describe('the 6-hour idle window', () => {
  // Two clocks (worker/index.ts): 6 hours since the last request, and a hard
  // 7 days since login that nothing can extend. The cookie's own `exp` is
  // always the earlier of the two.
  const IDLE = 6 * 60 * 60;
  const ABSOLUTE = 604_800;

  it('a token idle past six hours no longer verifies', async () => {
    const env = await buildEnv();
    const iat = 1_000_000;
    const token = await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, iat, iat + IDLE);
    expect(await verifyToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token, iat + IDLE - 1)).not.toBeNull();
    expect(await verifyToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token, iat + IDLE + 1)).toBeNull();
  });

  it('an authenticated request slides the window forward', async () => {
    const env = await buildEnv();
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, now, now + IDLE);
    const response = await worker.fetch(
      new Request('https://viabiancadelhi.com/api/content?path=src/content/copy.json', {
        headers: { Cookie: `vb_session=${token}` },
      }),
      env,
    );
    // Whatever the route answers, a live session must come back refreshed --
    // that IS the sliding window. Without it the cookie would keep its
    // original expiry and six hours of work would end in a logout.
    const refreshed = response.headers.get('Set-Cookie');
    expect(refreshed, 'an authenticated request must reissue the session cookie').toBeTruthy();
    expect(refreshed).toContain('HttpOnly');
    expect(refreshed).toContain('SameSite=Strict');
  });

  it('a 401 never reissues a session cookie', async () => {
    const env = await buildEnv();
    const response = await worker.fetch(
      new Request('https://viabiancadelhi.com/api/content?path=src/content/copy.json'),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('the absolute cap is never extended by activity', async () => {
    const env = await buildEnv();
    // Logged in seven days ago, active the whole time: the cookie can slide
    // right up to the cap and no further.
    const now = Math.floor(Date.now() / 1000);
    const iat = now - ABSOLUTE + 30;
    const token = await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, iat, now + 60);
    const response = await worker.fetch(
      new Request('https://viabiancadelhi.com/api/content?path=src/content/copy.json', {
        headers: { Cookie: `vb_session=${token}` },
      }),
      env,
    );
    const refreshed = response.headers.get('Set-Cookie');
    if (refreshed) {
      const maxAge = Number(refreshed.match(/Max-Age=(\d+)/)?.[1] ?? '0');
      expect(maxAge, 'a refresh must never push past the absolute cap').toBeLessThanOrEqual(30);
    }
  });

  it('every authenticated route is listed in AUTHENTICATED_PATHS', () => {
    // Guards the guard: a new authenticated route added to the router without
    // a decision about the session shows up here rather than silently never
    // sliding its window.
    //
    // Recorded honestly, since the name overclaims: this compares the
    // constant against a hardcoded literal rather than deriving routes from
    // the router, so it catches an EDIT to the constant but cannot catch an
    // authenticated route that was never added to it. GET /api/wa proves
    // that gap is already live -- it authenticates itself, is routed without
    // withSlidingSession, and is absent from the Set. Adding /api/undo does
    // not widen the gap, but this should not be read as proof of
    // completeness.
    expect([...AUTHENTICATED_PATHS].sort()).toEqual(
      ['/api/analytics', '/api/build-status', '/api/content', '/api/publish', '/api/undo', '/api/upload'],
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/undo. The route's whole job is to refuse in every case where
// putting the commit back would mean something other than what she was told,
// and to spend nothing when it refuses.
describe('POST /api/undo', () => {
  let env: Awaited<ReturnType<typeof buildEnv>>;
  let stub: GitHubStub;

  beforeEach(async () => {
    env = await buildEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function cookie(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return `vb_session=${await signToken(TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, now, now + 3600)}`;
  }

  function undoRequest(body: unknown, sessionCookie?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionCookie) headers['Cookie'] = sessionCookie;
    return new Request('https://viabiancadelhi.com/api/undo', { method: 'POST', headers, body: JSON.stringify(body) });
  }

  function stubWith(opts: Parameters<typeof makeGitHubStub>[0] = {}) {
    stub = makeGitHubStub(opts);
    vi.stubGlobal('fetch', stub.fetch);
    return stub;
  }

  function wroteAnything(): boolean {
    return stub.calls.some(
      (call) =>
        (call.method === 'POST' && (call.url.endsWith('/git/trees') || call.url.endsWith('/git/commits'))) ||
        call.method === 'PATCH',
    );
  }

  it('is 401 with no session, and spends no GitHub subrequest at all', async () => {
    stubWith();
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }), env);
    expect(response.status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it('is 400 when no sha is named', async () => {
    stubWith();
    const response = await worker.fetch(undoRequest({}, await cookie()), env);
    expect(response.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  // The explicit guard. ANY movement of the branch refuses -- an undo is only
  // meaningful relative to one specific commit, so a second device or a
  // developer's push has to stop it rather than revert a stale one.
  it('is 409 when the sha is no longer the branch head, and writes nothing', async () => {
    stubWith();
    const response = await worker.fetch(undoRequest({ sha: 'some-other-commit' }, await cookie()), env);
    expect(response.status).toBe(409);
    expect(wroteAnything()).toBe(false);
  });

  it('is 409 when the commit touched a path outside the allowlist, and writes nothing', async () => {
    stubWith({
      headCommit: {
        sha: BASE_COMMIT_SHA,
        parents: [{ sha: PARENT_COMMIT_SHA }],
        files: [{ filename: 'src/content/dishes.json' }, { filename: 'src/components/Hero.tsx' }],
      },
    });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(409);
    expect(wroteAnything()).toBe(false);
  });

  // Undo puts words and choices back; it never deletes. A path the commit
  // ADDED is absent from the parent tree and is simply left out -- never sent
  // with a null sha, which is how GitHub's tree API removes a file.
  it('omits a path the commit added, and sends no null sha', async () => {
    stubWith({
      headCommit: {
        sha: BASE_COMMIT_SHA,
        parents: [{ sha: PARENT_COMMIT_SHA }],
        files: [{ filename: 'src/content/dishes.json' }, { filename: 'assets-source/food/newphoto.jpg' }],
      },
      trees: {
        [PARENT_TREE_SHA]: { tree: [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes', type: 'blob' }] },
      },
    });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(200);

    const treeBody = stub.bodies.find((b) => b.tree !== undefined)!;
    const entries = treeBody.tree as { path: string; sha: unknown }[];
    expect(entries.map((e) => e.path)).toEqual(['src/content/dishes.json']);
    entries.forEach((entry) => expect(typeof entry.sha).toBe('string'));
  });

  it('is 409 when every path the commit touched was an addition -- there is nothing to put back', async () => {
    stubWith({
      headCommit: {
        sha: BASE_COMMIT_SHA,
        parents: [{ sha: PARENT_COMMIT_SHA }],
        files: [{ filename: 'assets-source/food/newphoto.jpg' }],
      },
      trees: { [PARENT_TREE_SHA]: { tree: [] } },
    });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(409);
    expect(wroteAnything()).toBe(false);
  });

  it('answers 200 with the new commit sha on the happy path', async () => {
    stubWith();
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sha: NEW_COMMIT_SHA });
  });

  // The structural guard, covering the window inside the request that no
  // read-then-check can close. Must be 409, not the 502 an unrecognised
  // throw would get -- the client branches on status alone.
  it('maps a 422 on the ref update to 409, not 502', async () => {
    stubWith({ failOn: '/git/refs/heads/main', failStatus: 422 });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(409);
  });

  // Review finding (Important), and the reason step 3's guard is not enough
  // on its own: three subrequests separate it from the write. A commit
  // landing in that window -- her second device finishing a publish, a
  // developer's push -- used to be absorbed in silence, because restoreBlobs
  // re-read the head itself and built on whatever it found: the ref PATCH
  // was then a plain fast-forward, GitHub accepted it, and the interloper's
  // changes to the very paths being restored were overwritten while she was
  // told "your site is back to how it was".
  it('a commit landing between the head check and the restore is 409, never absorbed', async () => {
    stubWith({ refSha: 'someone-elses-commit-cccc' });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);

    expect(response.status).toBe(409);
    // Whatever it built, it built on the sha the guard validated -- never on
    // the commit that landed since.
    expect(stub.bodies.find((b) => b.parents !== undefined)!.parents).toEqual([BASE_COMMIT_SHA]);
    expect(stub.bodies.find((b) => b.tree !== undefined)!.base_tree).toBe(BASE_TREE_SHA);
  });

  it('a GitHub outage on the tree read is 502, not 409', async () => {
    stubWith({ failOn: `/git/trees/${PARENT_TREE_SHA}?recursive=1`, failStatus: 500 });
    const response = await worker.fetch(undoRequest({ sha: BASE_COMMIT_SHA }, await cookie()), env);
    expect(response.status).toBe(502);
  });
});
