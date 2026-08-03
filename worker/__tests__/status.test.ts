import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleBuildStatus, mapDeploymentState, type BuildStatusEnv } from '../status';
import { signToken } from '../auth';

// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment) -- fetch,
// Request, Response and URL here come from Node itself, not jsdom.

const TOKEN_SECRET = 'status-test-token-secret';
const SHA = 'a'.repeat(40);

function buildEnv(): BuildStatusEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'test-project',
    CLOUDFLARE_API_TOKEN: 'status-test-fixture-token-not-real',
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    TOKEN_SECRET,
  };
}

async function sessionCookie(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = await signToken(TOKEN_SECRET, expiresAt);
  return `vb_session=${token}`;
}

function statusRequest(sha: string | null, cookie?: string): Request {
  const url = new URL('https://viabiancadelhi.com/api/build-status');
  if (sha !== null) url.searchParams.set('sha', sha);
  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = cookie;
  return new Request(url, { headers });
}

// A stub shaped like Cloudflare's actual `GET .../pages/projects/{project}/deployments`
// response envelope: `{ success, result: [...] }`. Only the fields
// worker/status.ts actually reads are populated.
function cloudflareDeploymentsResponse(deployments: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ success: true, result: deployments }), { status });
}

function deployment(sha: string, stage: { name: string; status: string } | undefined, url = 'https://abc123.via-bianca.pages.dev') {
  return {
    url,
    latest_stage: stage,
    deployment_trigger: { metadata: { commit_hash: sha } },
  };
}

describe('mapDeploymentState', () => {
  it('is "queued" when no deployment record exists yet for this sha', () => {
    expect(mapDeploymentState(undefined)).toBe('queued');
  });

  it('is "queued" when a deployment exists but has not reached any stage yet', () => {
    expect(mapDeploymentState({ latest_stage: undefined })).toBe('queued');
  });

  it.each([
    ['queued', 'idle'],
    ['initialize', 'active'],
    ['clone_repo', 'success'],
    ['build', 'active'],
    ['build', 'success'],
    ['deploy', 'active'],
  ])('is "building" while stage is %s / %s', (name, status) => {
    expect(mapDeploymentState({ latest_stage: { name, status } })).toBe('building');
  });

  it('is "live" only once the deploy stage itself succeeds', () => {
    expect(mapDeploymentState({ latest_stage: { name: 'deploy', status: 'success' } })).toBe('live');
  });

  it('is "failed" when the most recent stage failed, regardless of which stage', () => {
    expect(mapDeploymentState({ latest_stage: { name: 'build', status: 'failure' } })).toBe('failed');
    expect(mapDeploymentState({ latest_stage: { name: 'deploy', status: 'failure' } })).toBe('failed');
  });

  // Proves failure is checked ahead of the name==='deploy' case, not that a
  // failure elsewhere merely fails to match "live" by accident -- a stage
  // literally named "deploy" with status "failure" must not report "live".
  it('a failed deploy stage is "failed", not "live"', () => {
    expect(mapDeploymentState({ latest_stage: { name: 'deploy', status: 'failure' } })).not.toBe('live');
  });
});

describe('GET /api/build-status', () => {
  let env: BuildStatusEnv;

  beforeEach(() => {
    env = buildEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a session token -- no cookie is 401 and makes no Cloudflare call', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const response = await handleBuildStatus(statusRequest(SHA), env);
    expect(response.status).toBe(401);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('a forged session cookie is also 401 and makes no Cloudflare call', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const forged = await signToken('a-different-secret', Math.floor(Date.now() / 1000) + 3600);
    const response = await handleBuildStatus(statusRequest(SHA, `vb_session=${forged}`), env);
    expect(response.status).toBe(401);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('a missing sha is 400 and makes no Cloudflare call', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const cookie = await sessionCookie();
    const response = await handleBuildStatus(statusRequest(null, cookie), env);
    expect(response.status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('a malformed sha is 400 and makes no Cloudflare call', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const cookie = await sessionCookie();
    const response = await handleBuildStatus(statusRequest('not-a-sha!!', cookie), env);
    expect(response.status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('an unknown sha (no matching deployment) is 200 "queued", not an error', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => cloudflareDeploymentsResponse([deployment('b'.repeat(40), { name: 'deploy', status: 'success' })])),
    );
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: string; deploymentUrl: unknown; commitUrl: string };
    expect(body.state).toBe('queued');
    expect(body.deploymentUrl).toBeNull();
  });

  it('a live deployment matching the sha reports "live" with its deployment URL', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        cloudflareDeploymentsResponse([
          deployment('b'.repeat(40), { name: 'deploy', status: 'success' }, 'https://wrong.pages.dev'),
          deployment(SHA, { name: 'deploy', status: 'success' }, 'https://correct.pages.dev'),
        ]),
      ),
    );
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: string; deploymentUrl: string; commitUrl: string };
    expect(body.state).toBe('live');
    expect(body.deploymentUrl).toBe('https://correct.pages.dev');
  });

  it('a failed deployment matching the sha reports "failed"', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => cloudflareDeploymentsResponse([deployment(SHA, { name: 'build', status: 'failure' })])),
    );
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    const body = (await response.json()) as { state: string };
    expect(body.state).toBe('failed');
  });

  // The spec's own requirement: "a link to the commit". Built from
  // GITHUB_OWNER/GITHUB_REPO regardless of what Cloudflare answers -- proven
  // by asserting it even on the "unknown sha" / no-deployment-found path,
  // where Cloudflare's response contributes nothing else to the body.
  it('always returns a GitHub commit URL built from GITHUB_OWNER/GITHUB_REPO, matched or not', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal('fetch', vi.fn(async () => cloudflareDeploymentsResponse([])));
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    const body = (await response.json()) as { commitUrl: string };
    expect(body.commitUrl).toBe(`https://github.com/tarann26/vb/commit/${SHA}`);
  });

  it('surfaces a non-2xx from the Cloudflare API as 502, not a silently empty result', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    expect(response.status).toBe(502);
  });

  it('a network failure reaching Cloudflare is 502, not an unhandled throw', async () => {
    const cookie = await sessionCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const response = await handleBuildStatus(statusRequest(SHA, cookie), env);
    expect(response.status).toBe(502);
  });

  it('requests the correct Cloudflare deployments URL, authenticated with the Pages token', async () => {
    const cookie = await sessionCookie();
    const fetchStub = vi.fn(async () => cloudflareDeploymentsResponse([]));
    vi.stubGlobal('fetch', fetchStub);
    await handleBuildStatus(statusRequest(SHA, cookie), env);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT}/deployments`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  });
});
