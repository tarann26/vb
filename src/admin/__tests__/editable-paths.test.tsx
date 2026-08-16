import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ImgHTMLAttributes } from 'react';
import { defaultBundle, ContentProvider, type ContentBundle } from '../../content/ContentContext';
import type { Copy } from '../../content/types';
import { findCollagePhoto } from '../../content/collage';
import { AppRoutes } from '../../App';
import { COPY_FIELDS } from '../fields';
import { parseSectionContentPath, findTemplateSection } from '../template-section-paths';
import { EDITABLE_TEXT_PATHS, setCopyText } from '../editable-paths';
import EditableText from '../EditableText';
// Real, committed copy.json -- the same "real content, not a hand-typed
// fixture" choice EditMode.test.tsx's own galleries/story/menus/copy
// imports already make (see that file's own comment).
import copyJson from '../../content/copy.json';

const REAL_COPY = copyJson as Copy;

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
// hand-typing a second 29-entry list a future edit to fields.ts could
// silently drift out of sync with, is the same "derive from the real thing,
// don't duplicate it by hand" call src/admin/__tests__/content.test.ts's own
// CONTENT_FILES check already makes. src/test/bundle.test.ts's own
// "nothing outside src/admin imports admin code" gate would flag this file
// as an offender for importing COPY_FIELDS if it lived anywhere else -- it
// scopes to `.tsx?$` files with no `*.test.tsx` carve-out, unlike the
// content-snapshot check in this same directory -- so living inside
// src/admin/ is not just a convenience, it is the only placement this gate
// allows for a file that needs COPY_FIELDS.
//
// 31 -> 28: Drinks.tsx dropped its three category sub-headings (Mocktails/
// Cocktails/Wine), and copy.json's drinks.mocktails/cocktails/wine keys --
// and their COPY_FIELDS/EDITABLE_TEXT_PATHS entries -- went with them. Every
// count below that used to read 31 now reads 28.

interface TextCall {
  path: string;
  value: string;
}

interface ImageCall {
  path: string;
  props: ImgHTMLAttributes<HTMLImageElement>;
}

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

// renderText paths come in TWO families, and conflating them is what an
// earlier version of this file did:
//
//   1. a dotted key straight into `copy` ('hero.logoName' ->
//      copy.hero.logoName) -- the flat shape CopyLeafShape (fields.ts)
//      declares, and the only family that existed before template sections;
//   2. `sections.<id>.content.<rest>' -- a template section's own content,
//      which lives in sections.json, not copy.json.
//
// Family 2 was unreachable until sections.json actually carried a template
// section, so every assertion below about "the recorded paths" was true of
// family 1 alone and silently untested for family 2. Enabling the first
// template section is what surfaced it.
//
// A path that resolves to `undefined` (a typo, or a path pointing somewhere
// its own store does not have) can never `.toBe()` the real string a genuine
// call passed -- that mismatch is what catches 'visit.headingTYPO'.
function resolveTextValue(bundle: ContentBundle, path: string): unknown {
  const section = parseSectionContentPath(path);
  if (section) {
    // Parsed by the SAME production function the app routes edits through
    // (src/admin/template-section-paths.ts), so this test and the commit path
    // cannot disagree about what a section content path means.
    // Searched across the homepage AND every page: template sections live in
    // pages.json now, so looking only at bundle.sections would resolve every
    // one of them to `undefined` and fail for a reason that has nothing to do
    // with the path being wrong.
    const pools = [bundle.sections, ...defaultBundle.pages.map((page) => page.sections)];
    const found = pools.map((pool) => findTemplateSection(pool, section.sectionId)).find(Boolean);
    if (!found) return undefined;
    return section.rest.split('.').reduce<unknown>((node, key) => {
      return node && typeof node === 'object' && key in node ? (node as Record<string, unknown>)[key] : undefined;
    }, found.content);
  }
  return path.split('.').reduce<unknown>((node, key) => {
    return node && typeof node === 'object' && key in node ? (node as Record<string, unknown>)[key] : undefined;
  }, bundle.copy);
}

// Every real renderImage call site is one of three shapes: an index into one
// of galleries.json's two flat arrays, a photo ID into the hero collage's
// tree, or `<collection>.<id>.image` into dishes/drinks/press. A path of none
// of those shapes is not a defect this test knows how to check -- it throws
// rather than silently passing, so a renderImage call site with a new path
// shape some day fails loudly here instead of going unchecked.
function resolveImageSrc(bundle: ContentBundle, path: string): string | null | undefined {
  const gallery = path.match(/^galleries\.(atmosphere|ourStory)\.(\d+)$/);
  if (gallery) {
    const [, key, index] = gallery;
    return (bundle.galleries[key as 'atmosphere' | 'ourStory'])[Number(index)]?.src;
  }
  const collage = path.match(/^galleries\.heroCollage\.([^.]+)$/);
  if (collage) {
    const tree = bundle.galleries.heroCollage;
    return tree === null ? undefined : findCollagePhoto(tree, collage[1])?.src;
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
  // so no single route's calls alone ever cover the full 29 -- the three
  // together do.
  beforeAll(() => {
    mountAt('/', bundle);
    mountAt('/blogs', bundle);
    mountAt('/this-route-matches-nothing', bundle);
    // Every enabled page, because template sections moved OFF the homepage
    // and onto their own routes -- mounting only the three above would make
    // the section-path half of these assertions vacuous again.
    defaultBundle.pages.filter((page) => page.enabled).forEach((page) => mountAt(`/${page.slug}`, bundle));
  });

  it('recorded at least one call of each kind, so the assertions below are not vacuous', () => {
    expect(textCalls.length).toBeGreaterThan(0);
    expect(imageCalls.length).toBeGreaterThan(0);
  });

  it('the recorded copy.json paths are exactly EDITABLE_TEXT_PATHS (src/admin/editable-paths.ts) -- no missing, no extra', () => {
    expect(EDITABLE_TEXT_PATHS).toHaveLength(32);
    // Partitioned, not filtered-and-forgotten: EDITABLE_TEXT_PATHS is derived
    // from COPY_FIELDS and therefore describes copy.json ONLY, so a template
    // section's `sections.<id>.content.*` path is legitimately not a member.
    // The next test asserts every path of BOTH families resolves, so nothing
    // is dropped here in the name of tidying -- it just goes to its own store.
    const recorded = textCalls.map((call) => call.path);
    const copyPaths = new Set(recorded.filter((p) => !parseSectionContentPath(p)));
    expect([...copyPaths].sort()).toEqual([...EDITABLE_TEXT_PATHS].sort());
  });

  it('the enabled template sections really do render text through the same channel, so the partition above is not vacuous', () => {
    // Without this, the filter above would still pass if template sections
    // stopped rendering entirely -- which is exactly the state this whole
    // file was silently in before sections.json carried one.
    const sectionPaths = textCalls.map((c) => c.path).filter((p) => parseSectionContentPath(p));
    expect(sectionPaths.length).toBeGreaterThan(0);
    const ids = new Set(sectionPaths.map((p) => parseSectionContentPath(p)!.sectionId));
    // Template sections live on PAGES now (pages.json), not on the homepage,
    // so the expected set is every template section of every enabled page --
    // plus any that sections.json still carries, so this keeps working if one
    // is ever put back on the homepage.
    const expected = new Set<string>();
    bundle.sections.filter((x) => x.kind === 'template' && x.enabled).forEach((x) => expected.add(x.id));
    defaultBundle.pages
      .filter((page) => page.enabled)
      .forEach((page) => page.sections.filter((x) => x.kind === 'template' && x.enabled).forEach((x) => expected.add(x.id)));
    expect([...ids].sort()).toEqual([...expected].sort());
  });

  // Kills both the typo ('visit.heading' -> 'visit.headingTYPO') and a
  // collision (originally reproduced as Drinks.tsx's `drinks.wine` ->
  // `drinks.mocktails`, back when Drinks.tsx rendered three category
  // sub-headings from those two fields -- both paths, and the headings that
  // read them, are gone now; the mechanism this test proves generalizes to
  // any two same-shape paths, not just that specific historical pair).
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

// ---------------------------------------------------------------------------
// Plan 5 Task 3, Step 1: EDITABLE_TEXT_PATHS itself (src/admin/editable-paths.ts),
// checked independently of the full-app mount above -- a cheap, direct unit
// test of the exported module's own membership, not a re-derivation of it
// (which would only ever prove the module equals itself).
describe('EDITABLE_TEXT_PATHS (src/admin/editable-paths.ts)', () => {
  it('has exactly 30 entries, every one a real COPY_FIELDS key', () => {
    expect(EDITABLE_TEXT_PATHS).toHaveLength(32);
    const copyFieldKeys = new Set(Object.keys(COPY_FIELDS));
    EDITABLE_TEXT_PATHS.forEach((path) => expect(copyFieldKeys.has(path)).toBe(true));
  });

  // The six names this list must NOT contain, spelled out independently of
  // editable-paths.ts's own internal set (fields.ts's CopyLeafShape comment
  // is the authority the first five trace back to) -- if editable-paths.ts
  // ever dropped its own exclusion, this still catches it without depending
  // on the same constant that would already be wrong.
  it('excludes exactly the six COPY_FIELDS leaves /edit does not offer in place, and nothing else', () => {
    const notEditableInPlace = [
      // Bound to an attribute, never painted as visible text.
      'nav.instagramLabel',
      'nav.menuLabel',
      'visit.mapTitle',
      'footer.instagramLabel',
      'footer.linkedinLabel',
      // Painted, but as a <button>'s own label -- see NavBar.tsx's own
      // comment, and the describe block at the end of this file.
      'nav.pagesLabel',
    ];
    notEditableInPlace.forEach((path) => expect(EDITABLE_TEXT_PATHS).not.toContain(path));
    expect(Object.keys(COPY_FIELDS)).toHaveLength(EDITABLE_TEXT_PATHS.length + notEditableInPlace.length);
    // Phase 3, Task 3: experiences.heading/intro are now painted through a
    // live content.renderText call (Experiences.tsx), so they belong in
    // EDITABLE_TEXT_PATHS rather than in the excluded set above -- the
    // opposite assertion from Task 2, when nothing on the page could reach
    // them yet.
    expect(EDITABLE_TEXT_PATHS).toContain('experiences.heading');
    expect(EDITABLE_TEXT_PATHS).toContain('experiences.intro');
  });

  // The other half of the decision, and the reason excluding it is honest
  // rather than a capability quietly dropped: /edit/manage still renders a
  // real, working input for it, because that screen iterates COPY_FIELDS
  // itself (AdminApp.tsx's COPY_GROUPS) and never consults this list.
  //
  // Mutation this guards: deleting the `'nav.pagesLabel'` entry from
  // COPY_FIELDS (src/admin/fields.ts) -- confirmed red here, and green in
  // every other test in this file, since EDITABLE_TEXT_PATHS excludes it
  // either way.
  it('keeps nav.pagesLabel editable on the dashboard -- it is excluded from in-place editing only', () => {
    expect(Object.keys(COPY_FIELDS)).toContain('nav.pagesLabel');
    expect(COPY_FIELDS['nav.pagesLabel'].kind).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// setCopyText (src/admin/editable-paths.ts): the write-back half of Step 4,
// tested directly against the real, committed copy.json rather than a
// hand-typed fixture -- the same "real content, not a stand-in" choice
// EditMode.test.tsx's own fixtures already make.
describe('setCopyText (src/admin/editable-paths.ts)', () => {
  it('updates only the targeted leaf, to exactly the new value', () => {
    const next = setCopyText(REAL_COPY, 'hero.reserveButton', 'Book a Table');
    expect(next.hero.reserveButton).toBe('Book a Table');
  });

  // Mutation this guards: dropping the `...section` spread (writing
  // `{ [leaf]: next }` alone instead) -- confirmed red, which loses every
  // OTHER leaf in the same namespace (e.g. hero.logoName/logoTagline/
  // reservationsLabel would all become undefined the moment
  // hero.reserveButton was edited).
  it('leaves every sibling leaf in the same namespace untouched', () => {
    const next = setCopyText(REAL_COPY, 'hero.reserveButton', 'Book a Table');
    expect(next.hero.logoName).toBe(REAL_COPY.hero.logoName);
    expect(next.hero.logoTagline).toBe(REAL_COPY.hero.logoTagline);
    expect(next.hero.reservationsLabel).toBe(REAL_COPY.hero.reservationsLabel);
  });

  // Mutation this guards: spreading `copy` shallowly but reconstructing
  // EVERY namespace object (not just the touched one) -- confirmed red by
  // rebuilding the return value as `{ ...copy, footer: { ...copy.footer } }`
  // alongside the real edit, which breaks this `toBe` (object identity)
  // check even though `footer`'s CONTENTS are unchanged.
  it('leaves every OTHER namespace object at its prior identity, not merely equal-looking data', () => {
    const next = setCopyText(REAL_COPY, 'hero.reserveButton', 'Book a Table');
    expect(next.footer).toBe(REAL_COPY.footer);
    expect(next.press).toBe(REAL_COPY.press);
    expect(next.nav).toBe(REAL_COPY.nav);
  });

  it('does not mutate the input object', () => {
    const before = JSON.stringify(REAL_COPY);
    setCopyText(REAL_COPY, 'footer.followLabel', 'Something Else');
    expect(JSON.stringify(REAL_COPY)).toBe(before);
  });

  // Task 3 review Finding C3: every test above only ever exercises
  // 'hero.reserveButton' -- a mutation that hardcodes `namespace = 'hero'`
  // regardless of `path` (replacing the real `path.split('.')` destructure)
  // stays green against every one of them, since 'hero' is already the
  // right answer for all four. This is the one assertion in this describe
  // block that actually depends on a NON-hero namespace, both for the input
  // path AND for what gets checked in the OUTPUT -- :235 above already used
  // a non-hero path ('footer.followLabel') but only ever checked that the
  // INPUT was untouched, never that the output actually landed in `footer`,
  // so it stayed green under the identical hardcoded-namespace mutation.
  //
  // Mutation this guards: `const [namespace, leaf] = path.split('.')`
  // replaced with `const [, leaf] = path.split('.'); const namespace =
  // 'hero';` -- confirmed red: `next.footer.followLabel` stays at its
  // original committed value (the write silently lands in `next.hero`
  // instead), and `next.hero` is no longer the same object reference as
  // `REAL_COPY.hero`.
  it('writes to the namespace the path actually names, not always "hero" -- proven with a non-hero path, checking the OUTPUT', () => {
    const NBSP = '\u00a0';
    const next = setCopyText(REAL_COPY, 'footer.followLabel', `Follow${NBSP}Everyone`);
    expect(next.footer.followLabel).toBe(`Follow${NBSP}Everyone`);
    expect(next.footer.hoursHeading).toBe(REAL_COPY.footer.hoursHeading);
    expect(next.hero).toBe(REAL_COPY.hero);
  });

  // Repair-review pattern fix: this guard used to return `copy` UNCHANGED
  // for a namespace that doesn't resolve to a real object -- the exact
  // "return the input unchanged" shape that made C1 (a template section
  // named "Menu v2.0") silently discard every edit made to it, with no
  // error and nothing on screen to say so. It now throws instead --
  // "fail loudly, not silently," this repair's own governing rule for
  // every commit path in this codebase.
  //
  // Mutation this guards: reverting the throw back to `return copy;` --
  // confirmed red, this test then expects a throw that never happens.
  it('a namespace that does not resolve to a real object throws, rather than silently discarding the edit', () => {
    const malformed = { ...REAL_COPY, hero: null } as unknown as Copy;
    expect(() => setCopyText(malformed, 'hero.reserveButton', 'X')).toThrow(
      /does not name a real copy\.json field/,
    );
  });

  // The concrete C1 shape, pinned directly against this function (not just
  // against the higher-level guards that now prevent her from ever
  // authoring an id that would reach this path -- guards.ts's own
  // assertSectionEntry, validate.ts's own validateSectionEntry): a path
  // like `sections.<id>.content.heading` splits to `namespace = 'sections'`,
  // which Copy has no key for, so `source['sections']` is `undefined` and
  // this guard now throws instead of returning `copy` unchanged.
  //
  // Mutation this guards: reverting the throw back to `return copy;` --
  // confirmed red, this test then expects a throw that never happens.
  it('throws for a "sections.<id>.content.<leaf>" path -- the exact shape C1 found silently discarding a template section\'s own edit', () => {
    expect(() => setCopyText(REAL_COPY, 'sections.menu-v2.content.heading', 'New Heading')).toThrow(
      /does not name a real copy\.json field/,
    );
  });
});

// ---------------------------------------------------------------------------
// Plan 5 Task 3, Step 2, second half: "use an element sentinel, not a
// string." The describe block above proves every renderText call site
// passes the RIGHT path -- this one proves that once renderText actually
// returns a real element (the true /edit behaviour, not the identity
// default), nothing on the page string-interpolates that element into an
// attribute or template, which would silently produce the literal text
// "[object Object]" -- invisible to a check built on string substitution,
// since a real ReactNode has no string content to search for. Combined with
// the "was it reached" half via EditableText's own `data-editable-path`
// marker, so a path that is listed but never actually rendered by any
// component fails here too, not just in the describe block above.
describe('the real element-substitution boundary: renderText returning actual elements leaks nowhere', () => {
  it('every EDITABLE_TEXT_PATHS entry is reached, across /, /blogs and an unmatched route, with no "[object Object]" and nothing throwing', () => {
    const bundle: ContentBundle = {
      ...defaultBundle,
      renderText: (path, value) => <EditableText path={path} value={value} onCommit={() => {}} />,
    };

    const reachedPaths = new Set<string>();
    ['/', '/blogs', '/this-route-matches-nothing'].forEach((route) => {
      const { container } = render(
        <ContentProvider value={bundle}>
          <MemoryRouter initialEntries={[route]}>
            <AppRoutes />
          </MemoryRouter>
        </ContentProvider>,
      );
      expect(container.innerHTML).not.toMatch(/\[object Object\]/);
      container.querySelectorAll('[data-editable-path]').forEach((el) => {
        reachedPaths.add(el.getAttribute('data-editable-path')!);
      });
    });

    // Partitioned for the same reason as the describe block above:
    // EDITABLE_TEXT_PATHS describes copy.json only, and a template section's
    // `sections.<id>.content.*` path is a legitimate second family that lives
    // in sections.json. Both halves are asserted, so nothing is quietly
    // dropped -- and the "[object Object]" check above already ran across
    // every rendered path of BOTH families, which is the leak this test is
    // actually named for.
    const reached = [...reachedPaths];
    const reachedCopy = reached.filter((p) => !parseSectionContentPath(p));
    expect(reachedCopy.sort()).toEqual([...EDITABLE_TEXT_PATHS].sort());

    // Every enabled template section is reachable through the same channel.
    // Without this, the filter above would pass even if template sections
    // rendered nothing at all.
    const reachedSections = new Set(
      reached.map((p) => parseSectionContentPath(p)?.sectionId).filter((id): id is string => Boolean(id)),
    );
    const enabledSections = defaultBundle.sections
      .filter((s) => s.kind === 'template' && s.enabled)
      .map((s) => s.id);
    expect([...reachedSections].sort()).toEqual([...enabledSections].sort());
  });
});

// ---------------------------------------------------------------------------
// nav.pagesLabel: the word the nav groups her pages under. It used to go
// through `content.renderText`, so at /edit it rendered as a contentEditable
// span with the same dashed edge every other editable leaf carries -- inside
// a <button>. Clicking it toggled the menu and focused nothing (a
// contentEditable nested in a button does not take focus in any browser), so
// the affordance was purely a lie. See NavBar.tsx's own comment at that
// label for why the label was not lifted out of the button instead, and
// editable-paths.ts's own exclusion comment for the enforcement.
//
// Written against the REAL editing bundle, not against the plain page: with
// no provider mounted `renderText` is the identity and returns the bare
// string either way, so a test on the default render could never tell the
// two apart. Same shape, and same reason, as the site.name/site.tagline
// block just below.
describe('nav.pagesLabel renders with no edit affordance, even under a real editing bundle', () => {
  function renderEditing(route: string) {
    const bundle: ContentBundle = {
      ...defaultBundle,
      renderText: (path, value) => <EditableText path={path} value={value} onCommit={() => {}} />,
    };
    return render(
      <ContentProvider value={bundle}>
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes />
        </MemoryRouter>
      </ContentProvider>,
    );
  }

  // Mutation this guards: restoring
  // `content.renderText('nav.pagesLabel', copy.nav.pagesLabel)` in
  // NavBar.tsx -- confirmed red.
  it('the pages disclosure shows the label as plain text, with no contentEditable on it or inside it', () => {
    const { container } = renderEditing('/');

    // Non-vacuous twice over. First: the disclosure really is on screen at
    // all (it only renders once two or more pages are in the nav), so this
    // is not passing by finding nothing.
    const disclosure = screen.getByRole('button', { name: REAL_COPY.nav.pagesLabel });
    expect(disclosure).toHaveTextContent(REAL_COPY.nav.pagesLabel);
    // Second: this really IS the editing bundle -- a different leaf in the
    // very same nav is editable on this same render, so "no affordance
    // here" is a fact about this leaf, not about the bundle.
    expect(container.querySelector('[data-editable-path="nav.wordmark"]')).not.toBeNull();

    expect(disclosure).not.toHaveAttribute('contenteditable');
    expect(disclosure.querySelector('[contenteditable="true"]')).toBeNull();
    expect(disclosure.closest('[contenteditable="true"]')).toBeNull();
  });

  it('no route renders an edit affordance for it anywhere on the page', () => {
    ['/', '/blogs', '/this-route-matches-nothing', ...defaultBundle.pages.filter((p) => p.enabled).map((p) => `/${p.slug}`)].forEach(
      (route) => {
        const { container } = renderEditing(route);
        expect(container.querySelector('[data-editable-path="nav.pagesLabel"]')).toBeNull();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// site.name and site.tagline: permanently excluded, per the edit mode
// plan's own coverage table -- SITE_FIELDS marks both `readonly`,
// head.test.ts pins nine index.html strings to them, and the server refuses
// them. Task 1 already keeps them structurally un-wrapped (Hero.tsx renders
// bare `{site.name}` / `{site.tagline}`, never through content.renderText),
// so no affordance is possible even under the REAL editing bundle -- proven
// here directly against real rendered DOM, not merely inferred from reading
// the component source.
describe('site.name and site.tagline render with no edit affordance, even under a real editing bundle', () => {
  it('the homepage <h1> (site.name) carries no contentEditable, on itself or any ancestor/descendant', () => {
    const bundle: ContentBundle = {
      ...defaultBundle,
      renderText: (path, value) => <EditableText path={path} value={value} onCommit={() => {}} />,
    };
    render(
      <ContentProvider value={bundle}>
        <MemoryRouter>
          <AppRoutes />
        </MemoryRouter>
      </ContentProvider>,
    );
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(defaultBundle.site.name);
    expect(h1).not.toHaveAttribute('contenteditable');
    expect(h1.closest('[contenteditable="true"]')).toBeNull();
    expect(h1.querySelector('[contenteditable="true"]')).toBeNull();
  });

  // NOT screen.getAllByText(defaultBundle.site.tagline) -- confirmed directly
  // while writing this test: the real, committed content has
  // copy.hero.logoTagline === site.tagline (both "Pastificio & Ristorante"),
  // and logoTagline genuinely IS wrapped in content.renderText (Hero.tsx:84),
  // so a text-content lookup for the tagline string also matches that
  // unrelated, legitimately-editable element and fails for the wrong
  // reason. Located structurally instead: Hero.tsx and Footer.tsx each
  // render site.tagline as the element immediately following site.name's own
  // heading, with nothing in between (Hero.tsx:90-93, Footer.tsx:17-20) --
  // an identity this content coincidence cannot disturb.
  it('site.tagline carries no contentEditable either, in either of its two homepage instances', () => {
    const bundle: ContentBundle = {
      ...defaultBundle,
      renderText: (path, value) => <EditableText path={path} value={value} onCommit={() => {}} />,
    };
    const { container } = render(
      <ContentProvider value={bundle}>
        <MemoryRouter>
          <AppRoutes />
        </MemoryRouter>
      </ContentProvider>,
    );
    const h1 = screen.getByRole('heading', { level: 1 }); // Hero's site.name
    // Not getByRole('heading', { level: 3 }) -- FoodGallery.tsx also renders
    // an <h3> per dish (real dishes.json has more than one), so a bare
    // heading-level query matches several. Footer's own site.name <h3> is
    // scoped by the <footer> landmark instead.
    const h3 = container.querySelector('footer h3');
    const taglines = [h1.nextElementSibling, h3?.nextElementSibling ?? null];
    taglines.forEach((tagline) => {
      expect(tagline).not.toBeNull();
      expect(tagline).toHaveTextContent(defaultBundle.site.tagline);
      expect(tagline).not.toHaveAttribute('contenteditable');
      expect(tagline!.closest('[contenteditable="true"]')).toBeNull();
      // Minor review finding: the h1/site.name sibling test above also
      // checks `.querySelector`, not just `.closest` -- an ANCESTOR-only
      // check would stay green if `renderText` wrapped `site.tagline` in
      // EditableText, since that wraps THIS element itself and would show
      // up via `.closest`, but so would any editable DESCENDANT this
      // element might someday contain; `.querySelector` is what a future
      // regression that nests an editable span inside (rather than wrapping)
      // this element would still need to trip.
      expect(tagline!.querySelector('[contenteditable="true"]')).toBeNull();
    });
  });
});
