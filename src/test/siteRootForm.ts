import { IMAGE_BASE } from '../shared/image-host';

// Text with every migrated photograph reference turned back into the path it
// was written from, undoing the 2026-08-21 migration's substitution and
// nothing else. `decodeURI` reverses the `encodeURI` that
// scripts/rewrite-image-refs.mjs applies, so the five filenames carrying a
// space round-trip.
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
//
// THE LOOKBEHIND IS WHAT KEEPS THAT SECOND PROMISE, and it became load-bearing
// the day the destination stopped being a hostname. While the substitution
// produced `https://img.viabiancarestaurant.com/food/x.webp`, matching the
// bare host string was enough -- nobody else's URL contains it. The
// substitution now produces `/images/food/x.webp`, and `/images/` is a
// perfectly ordinary run of characters inside somebody else's URL:
// `https://evil.example/images/x.webp` would otherwise be quietly rewritten
// to `https://evil.example/x.webp`, and an assertion that exists to fail on a
// photograph served from another website would start passing. So a match must
// begin where a reference begins -- at the start of the text, or after
// whitespace, a quote, a backtick or an opening paren -- and never in the
// middle of a longer path.
export function siteRootForm(text: string): string {
  const prefix = IMAGE_BASE.replace(/[.]/g, '\\.');
  const pattern = new RegExp(`(?<![^\\s"'\`(])${prefix}/[^"'\`()\\s]+`, 'g');
  return text.replace(pattern, (reference) => decodeURI(reference.slice(IMAGE_BASE.length)));
}
