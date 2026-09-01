import { IMAGE_HOST } from '../shared/image-host';

// Text with every image-host URL turned back into the site-root path it was
// written from, undoing the 2026-08-21 migration's substitution and nothing
// else. `decodeURI` reverses the `encodeURI` that scripts/rewrite-image-refs.mjs
// applies, so the five filenames carrying a space round-trip.
//
// WHY ANY TEST WANTS THIS. A handful of assertions in this repository pin a
// photograph by name: the compiled D1 floor against the committed fallback
// file, and the two hero-collage tiles src/admin/__tests__/EditMode.test.tsx
// drives. Each of them is asking WHICH photograph, never which spelling of
// it, and the migration changes only the spelling. Read through this on both
// sides, those assertions say the same thing before the rewrite has run and
// after, which is what keeps the rewrite's own commit green. They would
// otherwise be four more files a human has to remember to edit inside the
// riskiest commit in the plan, and forgetting one is a red branch.
//
// It is not a licence to be vague. On a value that has not moved this is the
// identity function, so nothing is loosened today; on a value that moved to
// SOMEBODY ELSE'S host it is also the identity function, so a mistyped host
// still fails every assertion it used to fail.
export function siteRootForm(text: string): string {
  const pattern = new RegExp(`${IMAGE_HOST.replace(/[.]/g, '\\.')}/[^"'\`()\\s]+`, 'g');
  return text.replace(pattern, (url) => decodeURI(url.slice(IMAGE_HOST.length)));
}
