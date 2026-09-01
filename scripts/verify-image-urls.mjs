// Every image a visitor's browser is about to ask for, asked for.
//
// IT SWEEPS THE UNION of two populations, and the union is the point:
//
//   (1) The content island the Worker injects into the live homepage
//       (worker/site-page.ts, Task 10). That covers every document whose live
//       copy is a D1 row -- documents this repository does not hold and a
//       walk of src/content/ cannot see. Before Task 12 there is no island,
//       and this half is simply empty.
//
//   (2) Every reference in the committed src/content/*.json. That covers every
//       document still backed by GitHub, for which the committed file IS what
//       the site serves, and press.json, which never moves.
//
// A checker that swept only (1) would go quietly vacuous for GitHub-backed
// documents; one that swept only (2) would go quietly vacuous the moment a
// document moved to D1. Sweeping both cannot be vacuous either way.
//
// THE UNION PRODUCES NO FALSE POSITIVES, and the reason is decision D9:
// NOTHING in this system ever deletes an R2 object. So a committed floor that
// has drifted behind a D1 row still names an object that is still there and
// still answers. A reference that fails this sweep is a real failure.
//
// HEAD, not GET: the question is whether the object is there and correctly
// typed, and 2.6 MB of image bodies per deploy check buys nothing. R2 answers
// HEAD with the same status and content-type it answers GET with.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ISLAND_ID = 'vb-content';

const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg)$/i;
const IMAGE_URL_PATTERN = /^https:\/\/[a-z0-9.-]+\/.+\.(jpg|jpeg|png|webp|avif|gif)$/i;

export function referencesIn(value, found = []) {
  if (typeof value === 'string') {
    if (ASSET_PATH_PATTERN.test(value) || IMAGE_URL_PATTERN.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => referencesIn(item, found));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => referencesIn(item, found));
  }
  return found;
}

// Pulled out of the served HTML with a regex rather than a DOM parser: this
// script runs in plain Node with no jsdom, and the anchor it looks for is a
// script tag this repository authors itself and pins with its own test
// (worker/__tests__/site-page.test.ts). A parser here would be a second
// dependency for a single, fully-controlled shape.
export function islandFrom(html) {
  const match = html.match(
    new RegExp(`<script type="application/json" id="${ISLAND_ID}">([\\s\\S]*?)</script>`),
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].replaceAll('\\u003c', '<'));
  } catch {
    return null;
  }
}

export async function sweep(references, origin, fetchImpl = fetch) {
  const problems = [];
  const seen = new Set();
  for (const reference of references) {
    if (seen.has(reference)) continue;
    seen.add(reference);
    const url = reference.startsWith('/') ? origin + reference : reference;
    let response;
    try {
      response = await fetchImpl(url, { method: 'HEAD', headers: { Origin: origin } });
    } catch (error) {
      problems.push({ url, why: `unreachable: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!response.ok) {
      problems.push({ url, why: `HTTP ${response.status}` });
      continue;
    }
    // The SPA catch-all in public/_redirects answers a MISSING site-root path
    // with index.html at 200 -- so a 200 alone cannot tell a real photograph
    // from a missing one. The content type is what separates them, and it is
    // the same distinction scripts/verify-deploy.mjs already draws for .js and
    // .css assets, for the same outage.
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!type.startsWith('image/')) problems.push({ url, why: `served as "${type}", not an image` });
  }
  return problems;
}

// Top-level imports, not `require`. The plan this came from wrote
// `const { readFileSync } = require('node:fs')` inside this function; `require`
// is not defined in an ES module, so that body threw a ReferenceError on the
// first call -- from inside scripts/verify-deploy.mjs, after a deploy, which
// is the worst place in this repository to discover a typo.
export function committedReferences(dir = join('src', 'content')) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => referencesIn(JSON.parse(readFileSync(join(dir, name), 'utf-8'))));
}

if (import.meta.filename === process.argv[1]) {
  const site = process.env.VB_SITE ?? 'https://viabiancarestaurant.com';
  const origin = new URL(site).origin;

  const homepage = await fetch(site, { headers: { Origin: origin }, cache: 'no-store' });
  const island = homepage.ok ? islandFrom(await homepage.text()) : null;
  const fromIsland = island ? referencesIn(island) : [];
  const fromRepo = committedReferences();

  console.log(
    island
      ? `live content island: ${fromIsland.length} references`
      : 'no content island on the live page (expected before Task 12)',
  );
  console.log(`committed documents: ${fromRepo.length} references`);

  const references = [...new Set([...fromIsland, ...fromRepo])];
  const problems = await sweep(references, origin);
  for (const { url, why } of problems) console.error(`  BROKEN  ${url}  -- ${why}`);
  console.log(`\n${references.length - problems.length}/${references.length} distinct image references resolve on ${site}`);
  // A run that reports 0/0 is a green run that proved nothing, and both halves
  // of the union being empty at once is the only way it happens. Printed above
  // as two separate counts so it is visible, and failed here so it is not
  // merely visible.
  if (references.length === 0) {
    console.error('  BROKEN  the sweep found no references at all -- it swept nothing and passed');
    process.exitCode = 1;
  }
  if (problems.length > 0) process.exitCode = 1;
}
