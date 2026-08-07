import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// INVERTED, deliberately. This file used to assert the OPPOSITE -- that
// index.html contains no `cloudflareinsights.com` and no `data-cf-beacon` --
// on the grounds that Web Analytics was switched on at the Cloudflare Pages
// project level and Cloudflare would inject its own beacon into every
// response, so a hand-placed one would double-count every visit.
//
// That was a correct reading of what auto-install is documented to do, and
// it is not what happens here. Auto-install is on for this site (site_tag
// 29e1ba52fba74885a5fc44875a48a078, bound to the aionxxxi.uk zone) and the
// beacon never appeared in the HTML: three cache-busted requests to the live
// site came back with no beacon in the response, and the
// rumPageloadEventsAdaptiveGroups dataset was empty. Cloudflare's HTML
// injection runs on responses the ZONE serves and is not applied to
// responses served by Pages -- which, on this site, is all of them. The old
// test was pinning "no beacon anywhere", i.e. no analytics at all.
//
// So the assertions flip, and the file is rewritten rather than deleted: a
// deleted test leaves this finding written down nowhere and leaves the tag
// itself unguarded.
//
// The pin is a COUNT, not a presence check. The failure this file exists to
// prevent has not gone away, it has only moved: turning auto-install back on
// in the dashboard, or pasting the snippet a second time, puts two beacons
// on the page and doubles every number on the Numbers screen. A presence
// check passes happily in both of those states.
const BEACON_TOKEN = '7d977bcbda6e4e38884875918d153e7f';
const BEACON_HOST = 'https://static.cloudflareinsights.com';

// Comments stripped first, and this is load-bearing rather than tidiness:
// the comment in index.html that explains the beacon necessarily discusses
// the beacon, and a count taken over the raw file would be counting prose.
const markup = () => readFileSync('index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');

describe('analytics', () => {
  it('hand-places exactly one Cloudflare beacon, because auto-install does not reach Pages-served HTML', () => {
    const tags = [...markup().matchAll(/<script\b[^>]*\bsrc="https:\/\/[^"]*cloudflareinsights\.com[^"]*"[^>]*>/g)];
    expect(tags).toHaveLength(1);
  });

  it('points that beacon at the real script with this site\'s own token', () => {
    const tag = markup().match(/<script\b[^>]*\bsrc="https:\/\/[^"]*cloudflareinsights\.com[^"]*"[^>]*>/)?.[0];
    expect(tag).toBeDefined();
    expect(tag).toContain(`${BEACON_HOST}/beacon.min.js`);
    // The token is what routes the data to this site's Web Analytics
    // property. A wrong or truncated one still loads, still fires, and
    // reports into nothing -- there is no client-side error to notice.
    expect(tag).toContain(`data-cf-beacon='{"token": "${BEACON_TOKEN}"}'`);
  });

  // Cross-pin. The tag and the policy that permits it live in two different
  // files, and either one alone is useless: strip the origin out of
  // public/_headers and the browser refuses the script with the tag still
  // sitting in the markup looking correct. `npm run test:csp` catches that
  // too, but it needs a production build and a real Chromium, so it does not
  // run on every `npm test` -- this does.
  it('is permitted by the shipped CSP, in both the directives it needs', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1];
    expect(csp).toBeDefined();

    const directive = (name: string) =>
      csp!.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

    // Loading beacon.min.js.
    expect(directive('script-src')).toContain(BEACON_HOST);
    // The beacon's own POST to /cdn-cgi/rum, which is on the apex host
    // rather than the one the script is served from.
    expect(directive('connect-src')).toContain('https://cloudflareinsights.com');
  });
});
