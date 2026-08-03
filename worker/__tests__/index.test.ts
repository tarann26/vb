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
    // Task 8: build-status and the scheduled-rebuild cron. Unused by any
    // test in this file (none of them call /api/build-status or
    // worker.scheduled -- see status.test.ts and scheduled.test.ts), but
    // required for `env` to satisfy `Env`.
    CLOUDFLARE_ACCOUNT_ID: 'index-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'index-test-project',
    CLOUDFLARE_API_TOKEN: 'index-test-fixture-cf-token-not-real',
    DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/index-test-not-real',
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

    // Whole-branch review, Important 3: verified directly against this exact
    // route -- POST /api/publish with a DD-MM-swapped publishAt used to
    // return 200 and commit, because validateContent had no rule for the
    // field at all. It does now (src/content/validate.ts's
    // validatePublishAt); this is that fix proven end-to-end through the
    // real route, not just at the validator's own unit level -- nothing
    // reaches GitHub for a request that never should have.
    it('a malformed publishAt is 422 and makes no GitHub call, not a landed commit the build later fails', async () => {
      const cookie = await sessionCookie();
      const badDish = { id: 'x', name: 'X', description: 'd', image: '/food/x.webp', tags: [], publishAt: '01-09-2026' };
      const response = await worker.fetch(
        publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([badDish]))] }, cookie),
        env,
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { problems: { field: string; message: string }[] };
      expect(body.problems.some((p) => p.field.includes('publishAt'))).toBe(true);
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
      const body = (await response.json()) as { sha: string };
      expect(body).toEqual({ sha: NEW_COMMIT_SHA });
      // The real GitHub mechanics (base_tree, parents, blob encoding) are
      // github.test.ts's job; this only proves the Worker actually reached
      // commitFiles on a fully valid publish.
      expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true);
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
      const token = await signToken(TOKEN_SECRET, expiresAt);
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
      const forgedToken = await signToken('a-different-secret-entirely', Math.floor(Date.now() / 1000) + 3600);
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
