import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ImgHTMLAttributes } from 'react';
import { defaultBundle, ContentProvider, type ContentBundle } from '../../content/ContentContext';
import type { Galleries } from '../../content/types';
import { AppRoutes } from '../../App';
import { COPY_FIELDS } from '../fields';

// Fix 2 (independent review of commit cf953d9, Plan 5 Task 1): renderText's
// and renderImage's first argument is a free-floating string at every real
// call site -- nothing before this test checked that a path actually points
// at the value/props it was handed. That gap is provably real: the review
// applied three mutations at once -- a typo ('visit.heading' ->
// 'visit.headingTYPO'), a collision (Drinks.tsx's own `drinks.wine` ->
// `drinks.mocktails`), and a wrong-gallery repoint (PlaceGallery.tsx's
// `galleries.atmosphere.${index}` -> `galleries.ourStory.${index}`) -- and
// got 1592 passed, tsc exit 0. Neither tsc (paths are just strings, and
// Drinks.tsx routes its path through a `path: string` field a source-code
// scrape would have to know to follow) nor the homepage-byte test (a path
// never renders) can see any of the three.
//
// This test mounts the real app, wrapped in a bundle that RECORDS every
// (path, value)/(path, props) pair actually passed, at all three routes the
// app has, then checks each recorded pair against the same bundle it came
// from -- not a hand-typed fixture that could quietly drift from the real
// content.
//
// Placed under src/admin/__tests__/ (not src/content/ or src/test/, where
// the two routes above live) because it imports COPY_FIELDS from
// src/admin/fields.ts, the real source of truth for which dotted paths are
// editable text -- deriving the expected set from it, rather than
// hand-typing a second 31-entry list a future edit to fields.ts could
// silently drift out of sync with, is the same "derive from the real thing,
// don't duplicate it by hand" call src/admin/__tests__/content.test.ts's own
// CONTENT_FILES check already makes. src/test/bundle.test.ts's own
// "nothing outside src/admin imports admin code" gate would flag this file
// as an offender for importing COPY_FIELDS if it lived anywhere else -- it
// scopes to `.tsx?$` files with no `*.test.tsx` carve-out, unlike the
// content-snapshot check in this same directory -- so living inside
// src/admin/ is not just a convenience, it is the only placement this gate
// allows for a file that needs COPY_FIELDS.

interface TextCall {
  path: string;
  value: string;
}

interface ImageCall {
  path: string;
  props: ImgHTMLAttributes<HTMLImageElement>;
}

// The five COPY_FIELDS leaves that never reach renderText: each is wired
// straight to an HTML attribute (an aria-label, or VisitUs.tsx's <iframe
// title>) rather than painted as visible text, so no component has a
// renderText call to make for it. fields.ts's own CopyLeafShape comment
// documents the same five as attribute-bound.
const ATTRIBUTE_ONLY_COPY_FIELDS = new Set([
  'nav.instagramLabel',
  'nav.menuLabel',
  'visit.mapTitle',
  'footer.instagramLabel',
  'footer.linkedinLabel',
]);

function makeRecordingBundle(): { bundle: ContentBundle; textCalls: TextCall[]; imageCalls: ImageCall[] } {
  const textCalls: TextCall[] = [];
  const imageCalls: ImageCall[] = [];
  const bundle: ContentBundle = {
    ...defaultBundle,
    renderText: (path, value) => {
      textCalls.push({ path, value });
      return defaultBundle.renderText(path, value);
    },
    renderImage: (path, props) => {
      imageCalls.push({ path, props });
      return defaultBundle.renderImage(path, props);
    },
  };
  return { bundle, textCalls, imageCalls };
}

// Every renderText path in this app is a dotted key straight into
// `copy` (e.g. 'hero.logoName' -> copy.hero.logoName, 'drinks.wine' ->
// copy.drinks.wine) -- the same flat shape CopyLeafShape (fields.ts)
// declares. A path that does not resolve to a string (a typo, or a path
// that points somewhere `copy` doesn't have) resolves to `undefined`,
// which can never `.toBe()` the real string value a genuine call passed --
// that mismatch is what catches a typo like 'visit.headingTYPO'.
function resolveTextValue(bundle: ContentBundle, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    return node && typeof node === 'object' && key in node ? (node as Record<string, unknown>)[key] : undefined;
  }, bundle.copy);
}

// Every real renderImage call site is one of two shapes: an index into one
// of galleries.json's three arrays, or `<collection>.<id>.image` into
// dishes/drinks/press. A path of neither shape is not a defect this test
// knows how to check -- it throws rather than silently passing, so an
// eighth renderImage call site with a new path shape some day fails loudly
// here instead of going unchecked.
function resolveImageSrc(bundle: ContentBundle, path: string): string | null | undefined {
  const gallery = path.match(/^galleries\.(atmosphere|ourStory|heroCollage)\.(\d+)$/);
  if (gallery) {
    const [, key, index] = gallery;
    return bundle.galleries[key as keyof Galleries][Number(index)]?.src;
  }
  const item = path.match(/^(dishes|drinks|press)\.([^.]+)\.image$/);
  if (item) {
    const [, collection, id] = item;
    const list = bundle[collection as 'dishes' | 'drinks' | 'press'] as { id: string; image: string | null }[];
    return list.find((entry) => entry.id === id)?.image;
  }
  throw new Error(`resolveImageSrc: unrecognized renderImage path shape "${path}"`);
}

function mountAt(route: string, bundle: ContentBundle) {
  render(
    <ContentProvider value={bundle}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </ContentProvider>,
  );
}

describe('every renderText/renderImage call site passes a path that really points at the value it was handed', () => {
  const { bundle, textCalls, imageCalls } = makeRecordingBundle();

  // Mounted once for the whole describe block, not per-test: blogsPage.*
  // only renders at /blogs and notFound.* only at a route nothing matches,
  // so no single route's calls alone ever cover the full 31 -- the three
  // together do.
  beforeAll(() => {
    mountAt('/', bundle);
    mountAt('/blogs', bundle);
    mountAt('/this-route-matches-nothing', bundle);
  });

  it('recorded at least one call of each kind, so the assertions below are not vacuous', () => {
    expect(textCalls.length).toBeGreaterThan(0);
    expect(imageCalls.length).toBeGreaterThan(0);
  });

  it('the recorded renderText paths are exactly the 31 non-attribute COPY_FIELDS keys -- no missing, no extra', () => {
    const expected = Object.keys(COPY_FIELDS).filter((key) => !ATTRIBUTE_ONLY_COPY_FIELDS.has(key));
    expect(expected).toHaveLength(31);
    const recorded = new Set(textCalls.map((call) => call.path));
    expect([...recorded].sort()).toEqual([...expected].sort());
  });

  // Kills both the typo ('visit.heading' -> 'visit.headingTYPO') and the
  // collision (Drinks.tsx's `drinks.wine` -> `drinks.mocktails`, which
  // leaves 'drinks.mocktails' recorded twice -- once with the real
  // mocktails heading, once with the wine heading under the wrong path,
  // and only the second occurrence's resolved value disagrees with what
  // was passed).
  it('every recorded renderText call resolves, against the bundle it was given, to exactly the value it was passed', () => {
    for (const call of textCalls) {
      expect(resolveTextValue(bundle, call.path)).toBe(call.value);
    }
  });

  // Kills the wrong-gallery repoint (PlaceGallery.tsx's
  // `galleries.atmosphere.${index}` -> `galleries.ourStory.${index}`):
  // ourStory and atmosphere are different arrays, so resolving the
  // (mutated) path returns a different src than the one actually rendered.
  it('every recorded renderImage call resolves, against the bundle it was given, to an entry whose src equals props.src', () => {
    for (const call of imageCalls) {
      expect(resolveImageSrc(bundle, call.path)).toBe(call.props.src);
    }
  });
});
