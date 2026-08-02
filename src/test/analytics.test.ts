import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Cloudflare Web Analytics for this site is enabled at the Pages project
// level (dashboard > Workers & Pages > this project > Analytics > Web
// Analytics > Enable), not by hand-placing a beacon <script> in index.html.
// For a Pages project, Cloudflare injects the beacon into every response it
// serves once that is on -- the *.pages.dev preview, the custom domain, and
// every subsequent deploy -- with no token to copy into this repository and
// nothing here that can go stale. See docs/cloudflare-cutover.md Step 4.
//
// This guards the failure mode that decision exists to prevent: someone
// who wants analytics and doesn't know it is already enabled at the
// dashboard level hand-places a beacon script here too. Two beacons on one
// page means two page-view counts for every visit -- the exact metric the
// owner asked for, silently doubled.
describe('analytics', () => {
  it('does not hand-place a Cloudflare beacon, which Cloudflare already injects for this Pages project', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('cloudflareinsights.com');
    expect(html).not.toMatch(/data-cf-beacon/);
  });
});
