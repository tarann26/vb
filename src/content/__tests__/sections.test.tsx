import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../../App';
import { copy, story, sections, assertSections } from '../index';
import type { SectionId, BespokeSection } from '../index';

// Plan 7, Task 1: `sections` is now `Section[]` (bespoke | template) --
// this whole test file is about the seven bespoke, component-backed
// sections specifically (their markers, their anchors, their document
// order), so it narrows once, here, rather than at every call site below.
// Real, committed sections.json has no template entries today, so this
// changes nothing about what the tests below actually exercise.
const BESPOKE_SECTIONS: BespokeSection[] = sections.filter(
  (s): s is BespokeSection => s.kind === 'bespoke',
);

// One piece of owner-editable text that renders only inside that section's
// own component -- used to prove a section did (or didn't) render, without
// pinning wording a dashboard edit is free to change. Typed
// `Record<SectionId, string>` for the same reason App.tsx's own dispatch
// map is: dropping a section here is a `tsc` failure, not silently reduced
// coverage.
const MARKER: Record<SectionId, string> = {
  hero: copy.hero.reserveButton,
  ourStory: story.heading,
  atmosphere: copy.atmosphere.heading,
  food: copy.food.heading,
  drinks: copy.drinks.heading,
  experiences: copy.experiences.heading,
  press: copy.press.heading,
  awards: copy.awards.heading,
  visit: copy.visit.heading,
};

// Structural roots -- the DOM element each section renders, per the plan's
// own SectionId/anchor mapping table (deliberately not the same strings as
// the SectionId itself). `hero` has no id, class, or test attribute of its
// own in the live markup; giving it one was considered (a `data-testid`,
// the same pattern NavBar.tsx already uses for `desktop-nav-links`/
// `mobile-nav-panel`) and rejected -- it would touch Hero.tsx, and this
// plan's zero-visual-change bar has been verified across review rounds by
// comparing the built homepage's `container.innerHTML` byte-for-byte
// (53473 bytes); a `data-testid` attribute is invisible to a viewer but is
// still real markup, and adding one measurably changed that count (checked
// directly: 53492 bytes, +19, exactly `data-testid="hero"`'s length).
// `SECTION_SELECTOR.hero` therefore stays `'h1'` -- real production markup,
// used only for the document-order check below -- and hero's marker check
// is handled separately (see sectionMarkerPresent) without production
// changes.
//
// Used two ways below: to check *document order*, and (for six of the
// seven ids) to *scope* the MARKER lookup to that section's own subtree
// instead of the whole document. Scoping is what makes a marker assertion
// trustworthy on its own: `story.heading` ("Our Story") and
// `copy.visit.heading` ("Visit Us") are each, coincidentally, identical to
// their own nav link's label, which renders in <nav> whenever the
// *section* is enabled regardless of whether the section's own component
// rendered anything at all. An unscoped `screen.queryByText` lookup for
// either marker is satisfied by the nav link alone, so it stays "found"
// even when the section's own component is stubbed to render nothing --
// verified directly: stubbing OurStory or VisitUs to `() => null` left an
// unscoped lookup passing, and only a separate structural check (document
// order) caught it. Scoping to the section's own root -- which the nav
// link is never inside -- closes that gap for those markers, present and
// future, without relying on any of today's copy happening to be unique.
const SECTION_SELECTOR: Record<SectionId, string> = {
  hero: 'h1',
  ourStory: '#our-story',
  atmosphere: '#gallery',
  food: '#menu',
  drinks: '#drinks',
  experiences: '#experiences',
  press: '#blogs',
  awards: '#awards',
  visit: '#visit',
};

const SECTION_IDS: SectionId[] = BESPOKE_SECTIONS.map((s) => s.id);

function sectionRoot(id: SectionId): HTMLElement | null {
  return document.querySelector<HTMLElement>(SECTION_SELECTOR[id]);
}

// Whether `id`'s marker text is present. Six of the seven ids scope the
// lookup to that section's own root (see the SECTION_SELECTOR comment
// above for why); `hero`'s root selector (`h1`) is a *descendant* of
// Hero's content, not a container of it -- `copy.hero.reserveButton`
// ("Reserve a Table") isn't inside the <h1> -- so scoping within it would
// wrongly report "absent" even when Hero renders normally. hero instead
// gets an unscoped, whole-document lookup, which is safe because
// `reserveButton` is verified to render nowhere else on the page (`grep
// -rn "reserveButton" src/components/*.tsx` -- one hit, Hero.tsx) -- so
// stubbing Hero to render nothing genuinely removes every instance of that
// text, not just the one inside some root this check isn't scoped to. This
// is the one marker not future-proofed against a later collision the way
// the other six are (a deliberate trade against touching Hero.tsx's
// production markup); if `copy.hero.reserveButton` is ever changed to
// match text elsewhere on the page, this check would need re-auditing.
function sectionMarkerPresent(id: SectionId): boolean {
  if (id === 'hero') {
    return screen.queryAllByText(MARKER.hero).length > 0;
  }
  const root = sectionRoot(id);
  if (!root) return false;
  return within(root).queryAllByText(MARKER[id]).length > 0;
}

function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

// Resolves each id's structural root in the current document and asserts
// they appear in exactly the given order.
function assertDocumentOrder(ids: SectionId[]): void {
  const nodes = ids.map((id) => {
    const node = sectionRoot(id);
    if (!node) {
      throw new Error(`Expected a "${SECTION_SELECTOR[id]}" element for section "${id}"`);
    }
    return node;
  });
  for (let i = 1; i < nodes.length; i += 1) {
    expect(isBefore(nodes[i - 1], nodes[i])).toBe(true);
  }
}

afterEach(() => {
  vi.doUnmock('../../content');
  vi.resetModules();
});

describe('homepage sections', () => {
  it('renders every enabled section, in sections.json order', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const enabledIds = BESPOKE_SECTIONS.filter((s) => s.enabled).map((s) => s.id);
    enabledIds.forEach((id) => {
      expect(sectionMarkerPresent(id)).toBe(true);
    });
    assertDocumentOrder(enabledIds);
  });

  // assertCopy only checks `href` is shaped like a "#"-prefixed fragment
  // (see content/index.ts) -- it has no way to know, at import time, whether
  // that fragment names a real, currently-enabled anchor in the rendered
  // page. A typo like "#galery" (missing an 'l') passes that shape check
  // and every other gate, but produces a nav link that does nothing when
  // clicked. This closes that gap against the real DOM: every nav link
  // whose section is currently enabled must resolve to an actual element.
  it('every visible nav link points at a real anchor in the rendered homepage', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const enabledIds = new Set(sections.filter((s) => s.enabled).map((s) => s.id));
    copy.nav.links
      .filter((link) => enabledIds.has(link.section))
      .forEach((link) => {
        expect(document.querySelector(link.href)).not.toBeNull();
      });
  });

  // The test above alone would pass even if HomePage ignored `enabled`
  // entirely, or if a section's dispatch entry silently rendered nothing (or
  // the *wrong* component) for every section except whichever one this
  // suite happened to check. That's exactly what shipped before this fix:
  // only `atmosphere` had dedicated coverage, so stubbing any of the other
  // six components to `() => null`, or wiring `press` to `NewsPress` instead
  // of `BlogTeaser`, passed the full suite. Running this once per
  // disableable SectionId (hero excluded -- assertSections forbids
  // disabling it, covered separately below) closes that gap: every section
  // gets a turn as the one that's "off", with every other enabled section
  // (and, where it has one, the disabled section's nav link) checked in the
  // same run -- each via the scoped `sectionMarkerPresent`, so a bystander
  // check genuinely tests that bystander's own component, not just whether
  // its marker text happens to appear anywhere on the page.
  it.each(SECTION_IDS.filter((id) => id !== 'hero'))(
    'omits %s (and its nav link, if any) when disabled, and renders every other enabled section',
    async (targetId) => {
      vi.resetModules();
      vi.doMock('../../content', async () => {
        const actual = await vi.importActual<typeof import('../../content')>('../../content');
        return {
          ...actual,
          // Every section except targetId is forced *enabled* here,
          // regardless of what today's real sections.json happens to have
          // toggled -- otherwise this test is only valid by coincidence
          // (when every other section happens to already be on), which is
          // exactly the invariance-under-content-edit hazard this whole fix
          // exists to close. Confirmed by running this suite against a real
          // sections.json with `atmosphere` disabled: without this line,
          // five of these six cases fail on an unrelated section's marker,
          // for a content reason, not a regression.
          sections: actual.sections.map((s) => ({ ...s, enabled: s.id !== targetId })),
        };
      });
      const { HomePage: MockedHomePage } = await import('../../App');
      render(
        <MemoryRouter>
          <MockedHomePage />
        </MemoryRouter>,
      );

      SECTION_IDS.forEach((id) => {
        expect(sectionMarkerPresent(id)).toBe(id !== targetId);
      });

      const link = copy.nav.links.find((l) => l.section === targetId);
      if (link) {
        expect(screen.queryByRole('link', { name: link.label })).toBeNull();
      }
    },
  );

  // Catches HomePage rendering sections in some fixed order -- declaration
  // order, SECTION_COMPONENTS's key order, alphabetical -- instead of
  // actually following `sections`' own array order. The fixture below
  // scrambles that order relative to today's sections.json, so this only
  // passes if the rendered order genuinely tracks the array.
  it('follows sections.json order, not any fixed declaration order', async () => {
    const scrambled: SectionId[] = ['visit', 'atmosphere', 'hero', 'press', 'food', 'ourStory', 'drinks'];
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        // Every section forced enabled here too, for the same reason as the
        // disable-loop test above: this must hold regardless of today's
        // real toggle state, not just when everything happens to be on.
        sections: scrambled.map((id) => ({ kind: 'bespoke' as const, id, enabled: true })),
      };
    });
    const { HomePage: MockedHomePage } = await import('../../App');
    render(
      <MemoryRouter>
        <MockedHomePage />
      </MemoryRouter>,
    );

    assertDocumentOrder(scrambled);
  });
});

describe('assertSections', () => {
  it('rejects a disabled hero', () => {
    const bad = sections.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    expect(() => assertSections(bad)).toThrow(/hero/);
  });

  it('rejects a missing hero', () => {
    expect(() => assertSections(sections.filter((s) => s.id !== 'hero'))).toThrow(/hero/);
  });

  // Previously only `hero`'s presence was checked, so a sections.json that
  // lost any other section entirely (e.g. a partial dashboard write) was
  // valid input -- that section just silently stopped existing anywhere.
  it('rejects a sections list missing a non-hero section', () => {
    expect(() => assertSections(sections.filter((s) => s.id !== 'visit'))).toThrow(/visit/);
  });

  it('rejects a duplicate id', () => {
    expect(() => assertSections([...sections, { kind: 'bespoke', id: 'food', enabled: true }])).toThrow(/food/);
  });

  // A dashboard-authored HTML form is the classic source of this bug: a
  // checkbox serialized as the string "false" instead of the boolean
  // `false` is truthy in JS, so a section the owner switched off would keep
  // rendering with the guard weakened to accept it (Plan 4 writes this file
  // from exactly such a form).
  it('rejects a non-boolean "enabled" value, such as the string "false"', () => {
    const bad = sections.map((s) => (s.id === 'food' ? { ...s, enabled: 'false' } : s));
    expect(() => assertSections(bad)).toThrow(/"enabled" must be a boolean.*food/);
  });

});
