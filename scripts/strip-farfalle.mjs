// One-off, run once, committed for the record rather than for reuse.
//
// Hand-editing the tree was the alternative and it is the wrong one: removing
// a photo is not a delete. A split left with one child has to collapse into
// that child, and a split left with two or more has to redistribute the
// removed photo's share across its siblings. removeCollagePhoto already does
// both, is already tested, and is what the dashboard's own remove button
// calls -- so running it here means the committed JSON is reachable by the
// same code path the editor would have produced.
//
// Four of these five removals collapse a split, which is why the result needs
// a look in a browser afterwards. See e2e/hero-collage-after-farfalle.spec.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { countCollagePhotos, removeCollagePhoto } from '../src/content/collage.ts';

const PATH = 'src/content/galleries.json';
const FARFALLE = ['photo-4', 'photo-5', 'photo-9', 'photo-14', 'photo-16'];

const galleries = JSON.parse(readFileSync(PATH, 'utf8'));
const before = countCollagePhotos(galleries.heroCollage);

let tree = galleries.heroCollage;
for (const id of FARFALLE) {
  const next = removeCollagePhoto(tree, id);
  if (next === tree) throw new Error(`refused to remove ${id} -- it returned the tree unchanged`);
  tree = next;
}

const after = countCollagePhotos(tree);
if (after !== before - FARFALLE.length) {
  throw new Error(`expected ${before - FARFALLE.length} photos, got ${after}`);
}

galleries.heroCollage = tree;
writeFileSync(PATH, JSON.stringify(galleries, null, 2) + '\n');
console.log(`removed ${FARFALLE.length}: ${before} photos -> ${after}`);
