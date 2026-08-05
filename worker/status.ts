// GET /api/build-status?sha=<sha> -- tells her whether a publish actually
// went live. Per the spec: "Step 5 exists because of step 4. Once a bad edit
// cannot break the site, the new failure mode is that her work silently
// evaporates. She must be told." dist/build-info.json (plugins/build-info.ts,
// Task 7) is written only on a SUCCESSFUL build -- when `test:deploy` fails,
// no new file is written at all, so the previous build's stamp stays live and
// a dashboard polling it shows "publishing..." forever, unable to tell "still
// building" from "build failed" from "the deploy hook never fired". This
// route reads Cloudflare's own Pages deployments API instead, which knows the
// real state regardless of whether the build ever produced output.
//
// Deliberately NOT sourced from the deploy hook's own response: a Cloudflare
// Pages deploy hook (worker/index.ts's `scheduled` handler fires one) answers
// only with an empty 200 -- no deployment id, nothing to poll -- so the hook
// response can never be the source of this endpoint's data.
import { parseCookie, verifyToken } from './auth';
import type { GitHubEnv } from './github';

// Account and project identifiers, not secrets -- same non-sensitive-var
// treatment as GitHubEnv's OWNER/REPO/BRANCH (worker/github.ts). The token
// that actually grants read access is the one field below that IS a secret.
export interface PagesEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_PAGES_PROJECT: string;
  // Pages-scoped (Account.Cloudflare Pages: Read is enough), never the
  // account-wide token used elsewhere -- see docs/cloudflare-cutover.md for
  // how a human creates one. A Worker secret, not a wrangler.toml var, for
  // the same reason GITHUB_TOKEN and ADMIN_PASSWORD_HASH are: src/test/secrets.test.ts
  // fails the build if anything shaped like a real token lands in a
  // committed file.
  CLOUDFLARE_API_TOKEN: string;
}

export type BuildStatusEnv = PagesEnv & Pick<GitHubEnv, 'GITHUB_OWNER' | 'GITHUB_REPO'> & { TOKEN_SECRET: string; ADMIN_PASSWORD_HASH: string };

export type BuildState = 'queued' | 'building' | 'live' | 'failed';

// The shape of one entry in Cloudflare's `GET .../pages/projects/{project}/deployments`
// response, narrowed to only the fields this route reads. Every field is
// typed `unknown`-then-guarded at the point of use (see mapDeploymentState and
// findDeploymentBySha below) rather than trusted -- the same posture
// worker/github.ts takes toward GitHub's own responses (see that file's
// getBranchHeadSha/getCommitTreeSha comments): Cloudflare can answer 200 OK
// with a body shaped differently than expected, and trusting an unchecked
// field here would silently report the wrong state to a human trying to
// decide whether to worry about a broken deploy.
interface CloudflareDeployment {
  url?: unknown;
  latest_stage?: { name?: unknown; status?: unknown };
  deployment_trigger?: { metadata?: { commit_hash?: unknown } };
}

function findDeploymentBySha(deployments: CloudflareDeployment[], sha: string): CloudflareDeployment | undefined {
  return deployments.find((d) => d.deployment_trigger?.metadata?.commit_hash === sha);
}

// Maps a Cloudflare Pages deployment's `latest_stage` onto the four states
// the dashboard needs. Documented stage names are `queued`, `initialize`,
// `clone_repo`, `build`, `deploy`; documented statuses are FIVE, not four --
// `idle`, `active`, `success`, `failure`, `canceled`. An earlier version of
// this comment (and this function) only accounted for four, which left
// `canceled` falling through to the catch-all `building` return below --
// confirmed by reproduction: a superseded deployment Cloudflare cancels
// (which it does -- the exact scenario docs/cloudflare-cutover.md §11c
// names, a photo-upload commit immediately followed by a publish commit)
// would report "building" forever, since a canceled deployment's stage
// never moves again. Fixed by treating `canceled` the same as `failure`:
// both mean this specific deployment will never reach `live`, and "failed"
// is the honest word for that, not "still going".
//
// No deployment found for this sha at all -- either GitHub hasn't told
// Cloudflare about the push yet, or Cloudflare hasn't created a deployment
// record for it yet -- reports `queued` rather than an error. That is a
// deliberate brief requirement, not a guess: a dashboard polling this
// immediately after a publish would otherwise flash a confusing error for the
// first second or two before Cloudflare's own record catches up, and
// "queued" is the honest word for "nothing to report yet, not necessarily
// wrong".
//
// `deploy` succeeding is the only stage/status combination that means
// genuinely live: every earlier stage succeeding is necessary but not
// sufficient, since the site isn't actually serving the new build until
// `deploy` itself finishes. Anything else still in flight (queued/idle, or
// any stage active) is `building`.
export function mapDeploymentState(deployment: CloudflareDeployment | undefined): BuildState {
  if (!deployment) return 'queued';
  const stage = deployment.latest_stage;
  if (!stage) return 'queued';
  const status = typeof stage.status === 'string' ? stage.status : undefined;
  const name = typeof stage.name === 'string' ? stage.name : undefined;
  if (status === 'failure' || status === 'canceled') return 'failed';
  if (name === 'deploy' && status === 'success') return 'live';
  return 'building';
}

// A real commit sha is 40 hex characters; a short sha (what `git rev-parse
// --short` or a UI might show) is at least 7. Checked before anything is sent
// to Cloudflare -- not a security boundary (this value only ever ends up
// inside a JSON response's `commitUrl` string, never executed, never used to
// build a file path), but garbage here is a client mistake worth a clean 400
// rather than a wasted Cloudflare API call and a `commitUrl` nobody could
// ever have followed anyway.
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBuildStatus(request: Request, env: BuildStatusEnv): Promise<Response> {
  // Same auth gate as every other admin route (worker/index.ts's
  // handlePublish, worker/upload.ts's handleUpload): a session cookie,
  // verified, before anything else runs -- including, here, the Cloudflare
  // API call this route's whole job is to make.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  const sha = new URL(request.url).searchParams.get('sha');
  if (!sha || !SHA_PATTERN.test(sha)) {
    return json(400, { message: 'A valid commit sha is required.' });
  }

  // `?env=production` scopes this to the deployments that actually serve
  // the live domain -- without it, Cloudflare returns preview deployments
  // too (one per non-production branch/PR), which this project doesn't use
  // today but would otherwise be free to shift which page a given sha's
  // deployment record lands on.
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT}/deployments?env=production`;

  let res: Response;
  try {
    // 10s: generous for a JSON list call, but bounded -- a Worker's own
    // request has real limits regardless, and a hung upstream fetch
    // shouldn't tie this route up for longer than a human waiting on "did
    // it work?" would tolerate.
    res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return json(502, { message: error instanceof Error ? error.message : 'Could not reach Cloudflare.' });
  }
  if (!res.ok) {
    return json(502, { message: `Cloudflare returned ${res.status} listing deployments.` });
  }

  // A 200 whose body doesn't parse, or whose envelope says `success: false`
  // (Cloudflare's API can answer this way even with a 200 status), must NOT
  // collapse to "no deployments found" -- that reads as `queued`, the most
  // reassuring state this endpoint can report, which is exactly backwards
  // for a route whose whole job is being the honest failure signal
  // build-info.json can't be. An earlier version of this route treated a
  // parse failure the same as a genuinely empty deployments list; a
  // maintenance-mode HTML body or a malformed proxy response would have
  // silently reported "queued" indefinitely instead of the 502 this is.
  const parsedBody = (await res.json().catch(() => null)) as { success?: unknown; result?: unknown } | null;
  if (parsedBody === null || parsedBody.success === false) {
    return json(502, { message: 'Cloudflare returned an unreadable response listing deployments.' });
  }
  const deployments = Array.isArray(parsedBody.result) ? (parsedBody.result as CloudflareDeployment[]) : [];
  const deployment = findDeploymentBySha(deployments, sha);

  return json(200, {
    state: mapDeploymentState(deployment),
    deploymentUrl: typeof deployment?.url === 'string' ? deployment.url : null,
    // Built from GITHUB_OWNER/GITHUB_REPO (already-known, non-secret Worker
    // vars), never from anything Cloudflare's response contains -- Cloudflare
    // has no reason to know this repository's GitHub URL shape, and this is
    // the "link to the commit" the spec asks for regardless of whether a
    // matching deployment was even found.
    commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${sha}`,
  });
}
