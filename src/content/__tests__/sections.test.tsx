import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../../App';
import { copy, story, sections, assertSections } from '../index';
import type { SectionId } from '../index';

// One piece of owner-editable text that renders only inside that section's
// own component -- used to prove a section did (or didn't) render, without
// pinning wording a dashboard edit is free to change. Typed
// `Record<SectionId, string>` for the same reason App.tsx's own dispatch
// map is: dropping a section here is a `tsc` failure, not silently reduced
// coverage.
//
// hero's marker is deliberately `reserveButton`, not `copy.hero.logoName`
// ("Via Bianca") -- logoName collides with `copy.nav.wordmark`, which is
// also "Via Bianca" and renders unconditionally in Navbar regardless of
// whether Hero itself renders. Verified: with Hero stubbed to render
// nothing, a `logoName`-based marker check still finds "Via Bianca" (via
// the wordmark) and passes vacuously; only the document-order check below
// then catches the stub, which means the marker check contributes zero
// coverage for hero specifically. `reserveButton` ("Reserve a Table")
// appears nowhere outside Hero.tsx.
const MARKER: Record<SectionId, string> = {
  hero: copy.hero.reserveButton,
  ourStory: story.heading,
  atmosphere: copy.atmosphere.heading,
  food: copy.food.heading,
  drinks: copy.drinks.heading,
  press: copy.press.heading,
  visit: copy.visit.heading,
};

// Structural anchors -- the DOM `id` each section renders, per the plan's
// own SectionId/anchor mapping table (deliberately not the same strings as
// the SectionId itself). Used only to check *document order*, never
// content, so unlike MARKER these must NOT be owner-editable text: the plan
// forbids renaming these ids (bookmarked URLs), so pinning them here carries
// none of the content-coupling hazard pinning copy.json prose would.
// `hero` has no id of its own -- its <section> is unannotated -- but it's
// the only section that renders an <h1>, so that's used as its anchor.
const SECTION_SELECTOR: Record<SectionId, string> = {
  hero: 'h1',
  ourStory: '#our-story',
  atmosphere: '#gallery',
  food: '#menu',
  drinks: '#drinks',
  press: '#blogs',
  visit: '#visit',
};

const SECTION_IDS: SectionId[] = sections.map((s) => s.id);

function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

// Resolves each id's structural anchor in the current document and asserts
// they appear in exactly the given order.
function assertDocumentOrder(ids: SectionId[]): void {
  const nodes = ids.map((id) => {
    const node = document.querySelector(SECTION_SELECTOR[id]);
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

    const enabledIds = sections.filter((s) => s.enabled).map((s) => s.id);
    enabledIds.forEach((id) => {
      expect(screen.queryAllByText(MARKER[id]).length).toBeGreaterThan(0);
    });
    assertDocumentOrder(enabledIds);
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
  // same run.
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
        const present = screen.queryAllByText(MARKER[id]).length > 0;
        expect(present).toBe(id !== targetId);
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
        sections: scrambled.map((id) => ({ id, enabled: true })),
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
    expect(() => assertSections([...sections, { id: 'food', enabled: true }])).toThrow(/food/);
  });
});
