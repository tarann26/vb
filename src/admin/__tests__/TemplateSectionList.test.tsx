import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TemplateSectionList, { blankTemplateSection } from '../TemplateSectionList';
import { validateContent } from '../../content/validate';
import type { TemplateSection } from '../../content/types';

const BESPOKE_SEVEN = [
  { kind: 'bespoke' as const, id: 'hero' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'ourStory' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'atmosphere' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'food' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'drinks' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'press' as const, enabled: true },
  { kind: 'bespoke' as const, id: 'visit' as const, enabled: true },
];

function textSection(id: string): TemplateSection {
  return { kind: 'template', id, enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } };
}

function renderList(items: TemplateSection[] = [], overrides: Partial<Parameters<typeof TemplateSectionList>[0]> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  const onAdd = vi.fn();
  const stage = vi.fn();
  render(
    <TemplateSectionList
      items={items}
      onChange={onChange}
      onReorder={onReorder}
      onAdd={onAdd}
      problems={[]}
      rowPrefix={(i) => `[${7 + i}]`}
      idPrefix="section"
      stage={stage}
      {...overrides}
    />,
  );
  return { onChange, onReorder, onAdd, stage };
}

describe('TemplateSectionList: Add', () => {
  it('offers an "Add a ___ section" button for every template type', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Add a text section' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add an item list section' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a gallery section' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a detail block section' })).toBeInTheDocument();
  });

  it('clicking "Add a text section" calls onAdd with a valid, blank text TemplateSection', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderList();
    await user.click(screen.getByRole('button', { name: 'Add a text section' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0][0] as TemplateSection;
    expect(added.kind).toBe('template');
    expect(added.template).toBe('text');
    expect(added.enabled).toBe(true);
    expect(typeof added.id).toBe('string');
    expect(added.id.length).toBeGreaterThan(0);
  });

  // The real, load-bearing proof Task 4 Step 1 asks for: a freshly-added
  // section's own UUID id can never collide with anything, but a fresh
  // section she then RENAMES to an id that's already taken must be refused
  // -- proven here through the real validateContent, not a hand-rolled
  // assertion, so this can never quietly drift from what the Worker itself
  // enforces on publish.
  it('blankTemplateSection never collides with the seven bespoke ids or with itself, added twice', () => {
    // Blank content legitimately has real validation problems of its own
    // (a fresh section needs a heading, etc. -- exactly what the debounced
    // validator is FOR, telling her what's still missing) -- what this test
    // actually proves is narrower and load-bearing: none of those problems
    // is ever an id collision or duplicate, which two independently-minted
    // crypto.randomUUID() ids structurally cannot produce.
    const a = blankTemplateSection('text');
    const b = blankTemplateSection('itemList');
    const problems = validateContent('sections.json', [...BESPOKE_SEVEN, a, b]);
    expect(problems.some((p) => /collides with a built-in section|already used by another section|duplicate section id/.test(p.message))).toBe(
      false,
    );
  });

  it('renaming a template section to an id that collides with a built-in section is refused by the real validator', () => {
    const collision = { ...textSection('food') };
    const problems = validateContent('sections.json', [...BESPOKE_SEVEN, collision]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /collides with a built-in section/.test(p.message))).toBe(true);
  });

  it('two template sections sharing an id are refused by the real validator', () => {
    const problems = validateContent('sections.json', [...BESPOKE_SEVEN, textSection('promo'), textSection('promo')]);
    expect(problems.some((p) => p.field === '[8].id' && /already used by another section/.test(p.message))).toBe(true);
  });
});

describe('TemplateSectionList: no Remove button anywhere -- D6', () => {
  it('renders zero buttons named Remove, even with sections present', () => {
    renderList([textSection('a'), textSection('b')]);
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe('TemplateSectionList: reorder and toggle', () => {
  it('moving a section down swaps it with its neighbour, by id order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList([textSection('a'), textSection('b'), textSection('c')]);
    await user.click(screen.getByRole('button', { name: 'Move a down' }));
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('toggling "Shown" flips enabled without touching anything else', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([textSection('a')]);
    await user.click(screen.getByLabelText('Shown'));
    expect(onChange).toHaveBeenCalledWith(0, { ...textSection('a'), enabled: false });
  });

  it('names move buttons per section, omitted at the ends', () => {
    renderList([textSection('a'), textSection('b')]);
    expect(screen.queryByRole('button', { name: 'Move a up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move a down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move b up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move b down' })).not.toBeInTheDocument();
  });
});

describe('TemplateSectionList: editing content', () => {
  it('clicking "Edit" reveals the section\'s own id field and content form, "Close" hides it again', async () => {
    const user = userEvent.setup();
    renderList([textSection('a')]);
    expect(screen.queryByLabelText('Section name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Section name')).toBeInTheDocument();
    expect(screen.getByLabelText('Heading')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Section name')).not.toBeInTheDocument();
  });

  it('shows a validation problem addressed to this row\'s own id field', async () => {
    const user = userEvent.setup();
    const items = [textSection('a')];
    render(
      <TemplateSectionList
        items={items}
        onChange={vi.fn()}
        onReorder={vi.fn()}
        onAdd={vi.fn()}
        problems={[{ field: '[7].id', message: '"a" is already used by another section' }]}
        rowPrefix={(i) => `[${7 + i}]`}
        idPrefix="section"
        stage={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('"a" is already used by another section')).toBeInTheDocument();
  });
});
