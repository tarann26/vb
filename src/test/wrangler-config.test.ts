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
