import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { recordArrivalIfTagged } from './campaign';
import './index.css';

const root = document.getElementById('root')!;

// index.html seeds #root with a "this page did not load" message, styled to
// stay invisible for its first few seconds (see that file's own comment).
// Clearing it here is what makes it a FALLBACK rather than content: it is
// removed the instant this module runs, so the only way a visitor ever sees
// it is if this module never ran at all.
//
// Cleared explicitly rather than left for React to overwrite. createRoot()
// does not adopt or replace existing children -- it renders alongside them
// and warns -- so without this the message would sit above the real site.
//
// The failure it covers has now happened FOUR times, so it is worth naming
// precisely rather than leaving as "sometimes the cache goes wrong". THIS
// file's own compiled chunk is the usual victim: a request for
// /assets/index-<hash>.js that arrives while a deploy is still propagating
// falls through the SPA catch-all in public/_redirects, is answered with
// index.html at 200, and the edge stores that HTML under a content-hashed URL
// which by construction never revalidates. The browser then refuses to
// execute the entry bundle as a module script, nothing mounts, and without
// the markup in index.html every visitor gets a blank white page.
//
// Only the same-origin cache variant is poisoned, which is why `curl -I`
// reports a healthy `application/javascript` while every real browser is
// broken. Any check has to send the site's own Origin to see it.
//
// Recovery is bounded to an hour by `s-maxage` on /assets/* (public/_headers)
// and detectable by `npm run verify:deploy`. What actually PREVENTS it is not
// fetching a freshly-deployed asset through the production zone at all --
// see scripts/verify-deploy.mjs, which now checks the per-deployment Pages
// URL instead, having twice caused the outage it was written to catch.
root.replaceChildren();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// AFTER the render call and at MODULE SCOPE, never in an effect. Module scope
// runs exactly once per document however many times React mounts anything,
// which is what makes StrictMode's double-mount irrelevant here rather than
// merely survivable. After, because issuing a request must not sit in front
// of a paint that has already been scheduled.
recordArrivalIfTagged();
