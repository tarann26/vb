// Records what the browser ACTUALLY sent.
//
// The distinction this module exists for: `page.route(...)` intercepts a
// request and lets a test assert that its own handler ran, which proves the
// pattern matched and nothing else. `page.on('request')` fires for every
// request the page emits, whether or not anything intercepts it, and the
// array it fills is evidence rather than a stand-in for evidence.
//
// A route handler is still needed alongside it, because the dev server has no
// Worker behind it and would answer /api/campaign with the SPA fallback. That
// handler exists only to keep the network quiet; the assertions read this
// array and never ask whether it ran.
//
// Not a `.spec.ts`: playwright.config.ts's testDir picks up every file it
// considers a test, and a helper with no test() call is reported as an empty
// suite.
import type { Page } from '@playwright/test';

export interface ObservedRequest {
  url: string;
  method: string;
  postData: string | null;
}

export function observeRequests(page: Page, pattern: RegExp): ObservedRequest[] {
  const seen: ObservedRequest[] = [];
  page.on('request', (request) => {
    if (!pattern.test(request.url())) return;
    seen.push({ url: request.url(), method: request.method(), postData: request.postData() });
  });
  return seen;
}
