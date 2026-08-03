import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Creating the real KV namespace requires Cloudflare account access nobody
// running this codebase's tests has -- an agent cannot create it, and a
// plausible-looking invented id would look correct in review and fail only
// at deploy time, silently, on whichever human runs `wrangler deploy`. This
// pins wrangler.toml's KV id to an obviously-fake placeholder so a deploy
// attempted before the real namespace exists fails a fast, readable test
// (this one, via `npm run test:deploy`) instead of the Worker failing at
// runtime with an unbound KV binding. docs/cloudflare-cutover.md tells the
// human doing the cutover to run `wrangler kv namespace create` and paste
// the real id here, which is the one and only thing that should ever make
// this test fail.
describe('wrangler.toml KV namespace', () => {
  it('still carries the unset placeholder id, not a real namespace id', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^id\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('PLACEHOLDER-NOT-A-REAL-NAMESPACE-ID');
  });
});

// Same pattern, same reason (Task 8 of the worker plan): the Cloudflare
// account id and Pages project name that GET /api/build-status needs
// (worker/status.ts's PagesEnv) cannot be looked up by an agent -- that
// requires Cloudflare account access. A plausible-looking invented value
// would look correct in review and fail only at deploy time, silently,
// with build-status querying an account or project that doesn't exist.
// This pins both to obviously-fake placeholders so a deploy attempted
// before a human fills them in fails a fast, readable test (via
// `npm run test:deploy`) instead. docs/cloudflare-cutover.md tells the
// human doing the cutover where to find the real values and paste them in.
describe('wrangler.toml Cloudflare Pages identifiers', () => {
  it('still carries the unset placeholder account id, not a real Cloudflare account id', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CLOUDFLARE_ACCOUNT_ID\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('PLACEHOLDER-NOT-A-REAL-ACCOUNT-ID');
  });

  it('still carries the unset placeholder project name, not a real Pages project name', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CLOUDFLARE_PAGES_PROJECT\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('PLACEHOLDER-NOT-A-REAL-PAGES-PROJECT-NAME');
  });
});

// Task 8's cron: hourly, but conditional on the Worker's own side (see
// worker/index.ts's `anythingPublishesToday`) -- this only pins that the
// trigger itself is registered with the right cadence. An unconditional
// hourly hook would be 720-744 builds/month against Pages Free's 500 cap;
// this test cannot see the conditional check (that's scheduled.test.ts's
// job), only that the schedule string a missing or wrong `[triggers]` block
// would silently mean "the cron never runs at all" -- caught here instead
// of discovered by a dashboard that never shows a cron invocation.
describe('wrangler.toml cron trigger', () => {
  it('registers the hourly schedule the scheduled handler expects', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const crons = match![1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    expect(crons).toEqual(['0 * * * *']);
  });
});
