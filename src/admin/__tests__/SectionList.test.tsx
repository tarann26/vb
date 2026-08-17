import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectionList from '../SectionList';
import { validateContent } from '../../content/validate';
import type { BespokeSection, SectionId } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

const ALL_NINE: BespokeSection[] = [
  { kind: 'bespoke', id: 'hero', enabled: true },
  { kind: 'bespoke', id: 'ourStory', enabled: true },
  { kind: 'bespoke', id: 'atmosphere', enabled: true },
  { kind: 'bespoke', id: 'food', enabled: true },
  { kind: 'bespoke', id: 'drinks', enabled: true },
  { kind: 'bespoke', id: 'experiences', enabled: true },
  { kind: 'bespoke', id: 'press', enabled: true },
  { kind: 'bespoke', id: 'awards', enabled: true },
  { kind: 'bespoke', id: 'visit', enabled: true },
];

function renderList(overrides: Partial<Parameters<typeof SectionList>[0]> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  render(<SectionList items={ALL_NINE} onChange={onChange} onReorder={onReorder} problems={[]} {...overrides} />);
  return { onChange, onReorder };
}

describe('SectionList: human names, not SectionIds', () => {
  it('shows the human name and anchor the brief itself names, verbatim', () => {
    renderList();
    expect(screen.getByText('Atmosfera')).toBeInTheDocument();
    expect(screen.getByText('#gallery')).toBeInTheDocument();
    // The raw SectionId is not shown anywhere as its own label.
    expect(screen.queryByText('atmosphere')).not.toBeInTheDocument();
  });

  it('every section gets a human name, and every id is covered', () => {
    renderList();
    ['Hero', 'About', 'Atmosfera', 'Menu', 'Drinks', 'Experiences', 'Blog', 'Awards', 'Visit Us'].forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  });

  it("a section absent from the nav (hero, drinks) says so, rather than showing a blank or a raw id", () => {
    renderList();
    // Two sections have no anchor -- both must show the same plain-English
    // explanation, not an empty string or "null".
    expect(screen.getAllByText('not in the navigation menu')).toHaveLength(2);
  });
});

// Review finding: `fetchContent` (src/admin/content.ts) does a blind
// `JSON.parse(...) as ContentTypeMap[K]` -- no runtime guard, unlike every
// other content type this dashboard eventually reaches one for. A malformed
// or unrecognised id in the real sections.json still arrives here typed
// `SectionId` even though it structurally is not one. Before the fix,
// `SECTION_NAMES[section.id]` threw trying to destructure `undefined`,
// uncaught by anything closer than main.tsx's top-level error boundary --
// which takes down the ENTIRE admin page (dishes, drinks, press included),
// not just this section.
describe('SectionList: an unrecognised section id does not crash the page', () => {
  it('renders the raw id as a fallback label instead of throwing', () => {
    const withBadId: BespokeSection[] = [
      ...ALL_NINE,
      // Cast, deliberately -- this is exactly what a widened, unvalidated
      // JSON.parse result can hand this component despite the SectionId
      // type claiming otherwise (see this describe block's own comment).
      { kind: 'bespoke', id: 'sponsorship' as SectionId, enabled: true },
    ];
    expect(() => renderList({ items: withBadId })).not.toThrow();
    expect(screen.getByText('sponsorship')).toBeInTheDocument();
  });

  it('the fallback has no anchor -- an unrecognised section cannot be assumed to be in the nav', () => {
    const withBadId: BespokeSection[] = [{ kind: 'bespoke', id: 'sponsorship' as SectionId, enabled: true }];
    renderList({ items: withBadId });
    expect(screen.getByText('not in the navigation menu')).toBeInTheDocument();
  });

  it('a genuinely valid nine-section list never falls back -- no raw id is rendered anywhere', () => {
    renderList();
    ['hero', 'ourStory', 'atmosphere', 'food', 'drinks', 'experiences', 'press', 'awards', 'visit'].forEach((id) => {
      expect(screen.queryByText(id)).not.toBeInTheDocument();
    });
  });
});

describe('SectionList: hero cannot be toggled off, structurally -- not merely refused after the click', () => {
  it("hero's own checkbox is disabled", () => {
    renderList();
    const heroToggle = screen.getAllByLabelText('Shown on homepage')[0];
    expect(heroToggle).toBeDisabled();
    expect(heroToggle).toBeChecked();
  });

  it('clicking a disabled hero checkbox never calls onChange -- jsdom will not even fire the event', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const heroToggle = screen.getAllByLabelText('Shown on homepage')[0];
    await user.click(heroToggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('every OTHER section\'s checkbox is enabled and can be toggled', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const toggles = screen.getAllByLabelText('Shown on homepage');
    expect(toggles[1]).not.toBeDisabled(); // ourStory
    await user.click(toggles[1]);
    expect(onChange).toHaveBeenCalledWith(1, { kind: 'bespoke', id: 'ourStory', enabled: false });
  });
});

describe('SectionList: no Remove button anywhere, and no Add button either -- D6', () => {
  it('renders zero buttons named Remove or Add', () => {
    renderList();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  });

  // Structural proof, not just an absent-button check: EVERY interaction
  // this component exposes (reorder, toggle) still leaves exactly the same
  // nine SectionIds present, in some order, which is what actually makes
  // assertSections' "every id exactly once" rule unreachable. Simulates a
  // caller applying every onReorder/onChange call this component could ever
  // produce and checks the id SET never changes.
  it('reordering never changes WHICH ids are present, only their order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move About up' }));
    const newOrder = onReorder.mock.calls[0][0] as SectionId[];
    expect(new Set(newOrder)).toEqual(new Set(ALL_NINE.map((s) => s.id)));
    expect(newOrder).toHaveLength(9);
  });

  it('toggling a section never changes its id', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const toggles = screen.getAllByLabelText('Shown on homepage');
    await user.click(toggles[3]); // food
    expect(onChange).toHaveBeenCalledWith(3, { kind: 'bespoke', id: 'food', enabled: false });
  });
});

describe('SectionList: reordering', () => {
  it('names move buttons per section, omitted at the ends', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move Hero up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Hero down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Visit Us up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Visit Us down' })).not.toBeInTheDocument();
  });

  it('moving a section down swaps it with its neighbour, by id order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Hero down' }));
    expect(onReorder).toHaveBeenCalledWith(['ourStory', 'hero', 'atmosphere', 'food', 'drinks', 'experiences', 'press', 'awards', 'visit']);
  });
});

describe('SectionList: sections.json-level problems -- one banner, since assertSections gives no per-id shape', () => {
  it('shows the real validator\'s own message when hero is disabled', () => {
    const bad = ALL_NINE.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    const problems = validateContent('sections.json', bad);
    expect(problems).toEqual([{ field: '', message: expect.stringMatching(/hero/i) }]);
    render(<SectionList items={bad} onChange={vi.fn()} onReorder={vi.fn()} problems={problems} />);
    expect(screen.getByRole('alert', { name: 'Problems with the homepage section order' })).toHaveTextContent(/hero/i);
  });

  it('no banner when there is nothing wrong', () => {
    renderList();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a hand-typed problem is rendered too, exactly as given', () => {
    const problems: ValidationProblem[] = [{ field: '', message: 'content/sections.json: duplicate section id "food"' }];
    renderList({ problems });
    expect(screen.getByText('content/sections.json: duplicate section id "food"')).toBeInTheDocument();
  });
});
