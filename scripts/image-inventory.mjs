// What has to move, counted from reality rather than from a list somebody
// maintained. THREE populations, and the third is the one a naive script
// misses entirely:
//
//   1. src/content/*.json -- 71 strings, 70 of which move (the 71st is
//      site.json's /og-image.jpg, which stays on this origin; see the plan's
//      decision D10).
//   2. Code -- src/index.css, src/components/Hero.tsx, ChefGallery.tsx,
//      SignatureMocktails.tsx and a doc comment in src/content/types.ts.
//      Ten today. The doc comment counts because
//      src/content/__tests__/assets.test.ts scans comments too.
//   3. THE LIVE COPIES OF story.json AND posts.json, which are D1 rows and
//      NOT the committed files. worker/store.ts's D1_ONLY_PATHS routes both
//      there, so src/content/posts.json on disk is a fallback floor that may
//      be months behind what the site serves. A rewrite that reads the
//      committed file rewrites a document nobody is reading and leaves the
//      live one pointing at a path that is about to stop existing.
//
// THE CENSUS IN THE PLAN SAYS 69 AND 9. IT IS WRONG, AND THE PLAN'S OWN
// INSTRUCTION AT THIS STEP IS TO STOP AND RECONCILE RATHER THAN TO EDIT THE
// PATTERN UNTIL IT AGREES. Reconciled here, measured against the tree:
//
//   - The plan derived 69 with `grep -ohE '"/[^"]*\.(webp|jpg|jpeg|png|svg)"'`,
//     which has no `pdf` alternative. ASSET_PATH_PATTERN does, and so does the
//     guardrail it is pinned against. The two extra strings are menus.json's
//     [0].file and [1].file, the two menu PDFs -- real references, and ones
//     that really do move (decision D10 sends them to the bucket at Task 19,
//     and objectsFor below already gives them their own `menu` kind).
//   - The tenth code reference is SignatureMocktails.tsx's download link for
//     the food menu PDF, which the plan's line-by-line list of nine skipped.
//     assets.test.ts already knows about it by name.
//
// So the counts are 71 content, 10 code, 4 D1: eighty-five references, of
// which eighty-four move. Undercounting by three is exactly the shape of
// failure this file exists to prevent, so the numbers here are the measured
// ones and scripts/__tests__/image-inventory.test.mjs pins them.
//
// Every effect is a parameter so scripts/__tests__/image-inventory.test.mjs
// can drive the whole thing with no filesystem and no network.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CONTENT_DIR = join('src', 'content');

// Named rather than globbed. A glob over src/**/*.ts{,x} would sweep in every
// test fixture in the repository -- there are dozens of '/food/tielle.webp'
// strings under __tests__ -- and none of those is a reference the site
// serves. These five files are the whole population, measured by
//   grep -rnE '/(food|hero|atmosphere|our_story|mocktails|press|experiences|team)/' src \
//     | grep -v __tests__
// and the test below asserts the count so a sixth appearing is a red suite
// rather than a silent miss.
export const CODE_FILES = [
  'src/index.css',
  'src/components/Hero.tsx',
  'src/components/ChefGallery.tsx',
  'src/components/SignatureMocktails.tsx',
  'src/content/types.ts',
];

// The same two expressions src/content/__tests__/assets.test.ts uses, copied
// deliberately rather than imported: that file is TypeScript inside a vitest
// project and this is plain ESM run by `node`. They are pinned against each
// other by the test below, which reads assets.test.ts as text and asserts both
// source strings appear in it -- so a change to either end is a red test, not
// a silent divergence.
export const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg|pdf)$/i;
export const CODE_ASSET_PATTERN = /["'`(](\/[^"'`()\n]+\.(?:jpg|jpeg|png|webp|avif|svg|pdf))["'`)]/gi;

export function collectFromJson(value, file, found, pointer = '') {
  if (typeof value === 'string') {
    if (ASSET_PATH_PATTERN.test(value)) found.push({ file, pointer, path: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectFromJson(item, file, found, `${pointer}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectFromJson(item, file, found, pointer === '' ? key : `${pointer}.${key}`);
    }
  }
}

export function collectFromCode(source, file, found) {
  // A FRESH regex per call. CODE_ASSET_PATTERN carries /g, so a shared
  // instance holds lastIndex between calls and skips the first match of every
  // file after the first one -- a defect that loses exactly one reference per
  // file and is invisible in a total.
  const pattern = new RegExp(CODE_ASSET_PATTERN.source, 'gi');
  let line = 1;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    while (cursor < match.index) {
      if (source[cursor] === '\n') line += 1;
      cursor += 1;
    }
    found.push({ file, pointer: `line ${line}`, path: match[1] });
  }
}

// The live bodies, over the public read endpoint -- no D1 credentials, no
// wrangler, no secret. GET /api/published?path=posts.json is
// worker/published.ts's PUBLIC_FILES allowlist, which already serves exactly
// the three D1-only documents to anybody.
//
// awards.json is fetched too and is expected to contribute ZERO image
// references (an Award's image is optional and none is set). It is fetched
// anyway rather than assumed empty, because "we were sure it had none" is not
// a sentence this migration can afford about a document the repository does
// not contain.
const LIVE_DOCUMENTS = ['story.json', 'posts.json', 'awards.json'];

export async function fetchLiveDocuments(origin, fetchImpl = fetch) {
  const out = [];
  for (const name of LIVE_DOCUMENTS) {
    const response = await fetchImpl(`${origin}/api/published?path=${name}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    // NOT a warning that gets skipped past. If a live copy cannot be read, the
    // inventory is incomplete in exactly the way that ships a broken
    // photograph, and an incomplete inventory MUST NOT BE WRITTEN TO DISK AT
    // ALL. A file on disk is read later by somebody who was not here.
    if (!response.ok) throw new Error(`could not read the live ${name}: HTTP ${response.status}`);
    const text = await response.text();
    // x-content-source tells us whether D1 answered or the compiled floor did.
    // A 'snapshot' answer means D1 was unreachable at this moment and the body
    // is the floor -- which is the committed file, which is the thing this
    // fetch exists to avoid reading. That is a refusal too.
    const source = response.headers.get('x-content-source');
    if (source !== 'd1' && source !== 'cache') {
      throw new Error(`the live ${name} answered from "${source}", not from D1 -- rerun when D1 is reachable`);
    }
    out.push({ name, body: JSON.parse(text), source: 'd1' });
  }
  return out;
}

// Every file under assets-source/, originals and the one print PDF alike.
// Not filtered by extension: the `source/` prefix is an archive of what was
// handed over, and a file this walk skipped is a file no later re-encode can
// find.
export function walkSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walkSources(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

export function objectsFor(references, sourceFiles) {
  const keys = new Map();
  for (const { path } of references) {
    if (path === '/og-image.jpg') continue;            // decision D10: stays here
    if (path.startsWith('/favicon') || path.startsWith('/apple-touch-icon') || path.startsWith('/icon-')) continue;
    keys.set(path.slice(1), { key: path.slice(1), kind: path.startsWith('/menus/') ? 'menu' : 'derivative' });
  }
  for (const file of sourceFiles) {
    const key = 'source/' + relative('assets-source', file).split(sep).join('/');
    keys.set(key, { key, kind: 'original' });
  }
  return [...keys.values()].sort((a, b) => a.key.localeCompare(b.key));
}

if (import.meta.filename === process.argv[1]) {
  const origin = process.argv.includes('--origin')
    ? process.argv[process.argv.indexOf('--origin') + 1]
    : 'https://viabiancarestaurant.com';

  const references = [];
  for (const name of readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.json'))) {
    collectFromJson(JSON.parse(readFileSync(join(CONTENT_DIR, name), 'utf8')), join(CONTENT_DIR, name), references);
  }
  const committed = references.length;
  for (const file of CODE_FILES) collectFromCode(readFileSync(file, 'utf8'), file, references);
  const code = references.length - committed;

  // Throws rather than falls back. See fetchLiveDocuments.
  const live = await fetchLiveDocuments(origin);
  const before = references.length;
  for (const { name, body } of live) collectFromJson(body, `d1:${name}`, references);
  for (let i = before; i < references.length; i++) references[i].source = 'd1';
  for (let i = 0; i < before; i++) references[i].source = 'committed';

  const sources = walkSources('assets-source');
  process.stdout.write(JSON.stringify({
    builtAt: new Date().toISOString(),
    origin,
    references,
    counts: { content: committed, code, d1: references.length - before, distinct: new Set(references.map((r) => r.path)).size },
    objects: objectsFor(references, sources),
  }, null, 2) + '\n');
}
