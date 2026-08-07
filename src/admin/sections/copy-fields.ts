// copy.json's pure helpers: how its 34 dotted leaf keys are grouped into
// the sections of the site she recognises, how one leaf is read out of a
// fetched Copy object without assuming its shape, and how one is written
// back without reconstructing anything around it.
//
// Moved out of AdminApp.tsx unchanged. Roughly a hundred lines of pure
// functions that were previously untestable without rendering the entire
// dashboard.
import { COPY_FIELDS } from '../fields';
import type { Copy } from '../../content/types';

// copy.json's own screen -- every leaf COPY_FIELDS (fields.ts) describes,
// grouped by the section of the site each one belongs to. Human names, not
// the raw top-level Copy key -- the same "her vocabulary, not the type's own
// property names" reasoning SectionList.tsx's own SECTION_NAMES documents.
// Deliberately none of these collides with another `role="heading"` element
// already on the page -- confirmed directly (an earlier version used the
// plain "Drinks"/"Press", which collided with the Drinks/Press ArraySection
// headings above and made `getByRole('heading', { name: 'Drinks' })`
// ambiguous). "Atmosphere gallery heading" and "Menu heading" avoid the
// identical collision with GalleryList.tsx's own "Atmosphere" <h3> and any
// future "Menu" heading.
const COPY_SECTION_HEADINGS: Record<string, string> = {
  nav: 'Navigation',
  hero: 'Hero',
  atmosphere: 'Atmosphere gallery heading',
  food: 'Menu heading',
  drinks: 'Drinks copy',
  press: 'Press copy',
  visit: 'Visit',
  footer: 'Footer',
  blogsPage: 'Stories page',
  notFound: 'Not-found page',
};

// Grouped once, at module load, not on every render -- COPY_FIELDS is an
// unchanging, hand-written literal (fields.ts), so the grouping can never change
// between renders either. `Object.keys` preserves the insertion order
// COPY_FIELDS was written in, which is already grouped by section there --
// this just reads that order back out rather than re-deriving or
// alphabetizing it.
export const COPY_GROUPS: { section: string; heading: string; keys: (keyof typeof COPY_FIELDS)[] }[] = (() => {
  const order: string[] = [];
  const groups: Record<string, (keyof typeof COPY_FIELDS)[]> = {};
  (Object.keys(COPY_FIELDS) as (keyof typeof COPY_FIELDS)[]).forEach((key) => {
    const section = key.split('.')[0];
    if (!groups[section]) {
      groups[section] = [];
      order.push(section);
    }
    groups[section].push(key);
  });
  return order.map((section) => ({ section, heading: COPY_SECTION_HEADINGS[section] ?? section, keys: groups[section] }));
})();

// Reads one dotted leaf back out of a fetched Copy object WITHOUT assuming
// its shape -- src/admin/content.ts's own header comment warns that
// `fetchContent`'s `JSON.parse(...) as ContentTypeMap[K]` is an unchecked
// cast, and Task 7's own review found the first crash that unchecked cast
// caused (an unrecognised section id took down the entire admin page, not
// just its own section -- see SectionList.tsx's own comment on the fix).
// copy.json reaching this screen with a section genuinely missing (a
// hand-edited file, a future Copy shape this build predates) must show an
// empty field and let the debounced validator explain what's wrong, not
// throw reading a property off `undefined` and take the whole page down
// with it.
export function leafValue(data: Copy, path: string): string {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : '';
}

// The write side of `leafValue` above -- every COPY_FIELDS key is exactly
// two segments (`section.key`; confirmed directly, none of the 34 keys in
// fields.ts's own COPY_FIELDS has a third dot), so this only ever has to
// rebuild one level of nesting. `{ ...sectionValue, [key]: value }`, never a
// reconstruction from a named list of known keys, is what preserves every
// OTHER key on both the top-level object and the target section -- the same
// "never reconstruct from known fields" guarantee useValidation.ts's own
// `replaceAt` documents for a whole-array update. Refuses to guess at a
// shape for a section that arrived malformed (returns `data` unchanged)
// rather than overwriting whatever WAS there with a brand new, mostly-empty
// object -- the write-side twin of `leafValue`'s own defensive fallback.
export function withLeaf(data: Copy, path: string, value: string): Copy {
  const [section, key] = path.split('.');
  const sectionValue = (data as unknown as Record<string, unknown>)[section];
  if (sectionValue === null || typeof sectionValue !== 'object') return data;
  return {
    ...data,
    [section]: { ...(sectionValue as Record<string, unknown>), [key]: value },
  } as Copy;
}

// U+00A0 (a non-breaking space) renders IDENTICALLY to an ordinary space in
// a browser -- that is the entire reason validateFollowLabelSpacing
// (src/content/validate.ts) exists as a rule at all, and exactly why an
// owner editing this one field by eye or by copy-paste can silently replace
// it with a regular space with nothing on screen looking any different.
// This preview line is the fix: NBSP_MARKER is a visible stand-in character,
// shown only in this read-only preview underneath the real, editable field
// -- the actual input keeps the real character, untouched, so typing in it
// still saves whatever she actually typed.
// Written as the explicit \u00a0 escape, not a literal non-breaking-space
// character sitting invisibly in this source file -- the identical reasoning
// validateFollowLabelSpacing's own comment (src/content/validate.ts) gives
// for the same choice, so the character this preview depends on stays
// legible in a diff instead of looking like an ordinary space.
const NBSP = '\u00a0';
const NBSP_MARKER = '\u2423'; // OPEN BOX -- a common convention for "a space is here"
export function withVisibleNbsp(text: string): string {
  return text.split(NBSP).join(NBSP_MARKER);
}
