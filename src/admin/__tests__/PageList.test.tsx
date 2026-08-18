import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PageList from '../PageList';
import { validateContent } from '../../content/validate';
import type { Page } from '../../content/types';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    slug: 'our-menu',
    name: 'Our Menu',
    inNav: true,
    enabled: true,
    seo: { title: 'Our Menu | Via Bianca', description: 'A short description.' },
    sections: [],
    ...overrides,
  };
}

function renderList(items: Page[] = [], overrides: Partial<Parameters<typeof PageList>[0]> = {}) {
  const onChange = vi.fn();
  const stage = vi.fn();
  const view = render(<PageList items={items} onChange={onChange} problems={[]} stage={stage} {...overrides} />);
  return { onChange, stage, rerender: view.rerender };
}

// A row's accessible name is its own text plus, when it has one, a trailing
// " needs attention" marker (ItemList.tsx) -- so opening a clean row is a
// plain name match and nothing here needs to know about that marker unless
// it is the thing under test.
async function openRow(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name }));
}

// Phase 3, Task 8: "Add a page" was removed deliberately -- PageList.tsx's
// own comment where the button used to sit explains why. The inverse
// assertion below is the one that keeps the button from quietly returning:
// a regression that restores it renders a control this test would otherwise
// never look for.
describe('PageList: no "Add a page" control, and the four real pages stay editable', () => {
  it('renders no control matching /add a page/i', () => {
    renderList([makePage({ slug: 'a' }), makePage({ slug: 'b' }), makePage({ slug: 'c' }), makePage({ slug: 'd' })]);
    expect(screen.queryByRole('button', { name: /add a page/i })).not.toBeInTheDocument();
  });

  it('the existing four pages are all still editable, one at a time (PageList only ever opens one editor)', async () => {
    const user = userEvent.setup();
    const pages = [
      makePage({ slug: 'a', name: 'Page A' }),
      makePage({ slug: 'b', name: 'Page B' }),
      makePage({ slug: 'c', name: 'Page C' }),
      makePage({ slug: 'd', name: 'Page D' }),
    ];
    const { onChange } = renderList(pages);
    expect(screen.getAllByRole('button', { name: /^Page [A-D]$/ })).toHaveLength(4);

    async function editAndRename(index: number) {
      await openRow(user, pages[index].name);
      const nameField = screen.getByLabelText('Page name');
      expect(nameField).not.toBeDisabled();
      expect((nameField as HTMLInputElement).value).toBe(pages[index].name);
      fireEvent.change(nameField, { target: { value: `${pages[index].name}, Revised` } });
      const calls = onChange.mock.calls as Array<[Page[]]>;
      const [updated] = calls[calls.length - 1];
      expect(updated).toHaveLength(4);
      expect(updated[index].name).toBe(`${pages[index].name}, Revised`);
      await user.click(screen.getByRole('button', { name: 'Done' }));
    }

    await editAndRename(0);
    await editAndRename(1);
    await editAndRename(2);
    await editAndRename(3);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('two pages never collide on slug -- proven through the real validator', () => {
    const problems = validateContent('pages.json', [
      { slug: 'a-slug-1', name: '', inNav: false, enabled: false, seo: { title: '', description: '' }, sections: [] },
      { slug: 'a-slug-2', name: '', inNav: false, enabled: false, seo: { title: '', description: '' }, sections: [] },
    ]);
    expect(problems.some((p) => /already used by another page/.test(p.message))).toBe(false);
  });
});

describe('PageList: no Remove button anywhere -- D6', () => {
  it('renders zero buttons named Remove, for the page itself or its nested sections', async () => {
    const user = userEvent.setup();
    renderList([makePage()]);
    await openRow(user, 'Our Menu');
    // Also open a nested template section, so its own controls render too.
    await user.click(screen.getByRole('button', { name: 'Add a text section' }));
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe('PageList: editing a page\'s own fields', () => {
  it('opening a row reveals slug, name and SEO fields; "Done" hides them again', async () => {
    const user = userEvent.setup();
    renderList([makePage()]);
    expect(screen.queryByLabelText('Web address')).not.toBeInTheDocument();
    await openRow(user, 'Our Menu');
    expect(screen.getByLabelText('Web address')).toHaveValue('our-menu');
    expect(screen.getByLabelText('Page name')).toHaveValue('Our Menu');
    expect(screen.getByLabelText('SEO title')).toHaveValue('Our Menu | Via Bianca');
    expect(screen.getByLabelText('SEO description')).toHaveValue('A short description.');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Web address')).not.toBeInTheDocument();
  });

  it('a page starts with no sections, and adding one through the nested list reaches onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await openRow(user, 'Our Menu');
    await user.click(screen.getByRole('button', { name: 'Add a gallery section' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.sections).toHaveLength(1);
    expect(updated.sections[0].kind).toBe('template');
  });
});

// Step 5's decision, recorded here as a test rather than only in the file's
// own comment: pages.json's staged upload keys are `page-<index>:...`
// (positional), so this list passes no `onMove` at all, and there is
// nothing left in the UI to reorder a page with. The old "moving a page
// down swaps it with its neighbour" case is gone along with the Up/Down
// buttons it drove -- there is no successor assertion, because there is no
// longer a control that could regress.
describe('PageList: pages cannot be reordered from this list', () => {
  it('renders no Move button for any page', () => {
    renderList([makePage({ slug: 'a', name: 'Page A' }), makePage({ slug: 'b', name: 'Page B' })]);
    expect(screen.queryByRole('button', { name: /move/i })).not.toBeInTheDocument();
  });
});

// I2 review finding: every control below is wired by hand, through
// PageList's own `patchAt`, rather than through RecordForm's already-proven
// generic wiring -- and nothing in this file exercised any of the five
// before this fix. Each test here is deliberately narrow (one control, one
// resulting field), the same shape TemplateSectionList's own "toggling
// 'Shown' flips enabled without touching anything else" test already takes,
// which is what makes each one able to fail on its own if its OWN control's
// wiring breaks, not just when the screen as a whole stops working.
//
// Mutation-tested, one control at a time (each control's own onChange
// replaced with a no-op that never calls patchAt): every test below went
// red on its own control's mutation and stayed green on the other four,
// confirmed directly, reverted.
describe("PageList: every one of a page's own write controls actually reaches onChange (I2)", () => {
  it('toggling "Shown on the site" flips enabled, leaving every other field untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage({ enabled: true })]);
    await openRow(user, 'Our Menu');
    await user.click(screen.getByLabelText('Shown on the site'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.enabled).toBe(false);
    expect(updated.slug).toBe('our-menu');
    expect(updated.name).toBe('Our Menu');
  });

  it('toggling "Shown in the navigation menu" flips inNav, leaving every other field untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage({ inNav: true })]);
    await openRow(user, 'Our Menu');
    await user.click(screen.getByLabelText('Shown in the navigation menu'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.inNav).toBe(false);
    expect(updated.enabled).toBe(true);
  });

  it('editing the web address field reaches onChange with the new slug', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await openRow(user, 'Our Menu');
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'a-new-address' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.slug).toBe('a-new-address');
  });

  it('editing the page name field reaches onChange with the new name', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await openRow(user, 'Our Menu');
    fireEvent.change(screen.getByLabelText('Page name'), { target: { value: 'A New Name' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.name).toBe('A New Name');
  });

  it('editing the SEO title field reaches onChange with the new title, leaving the description untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await openRow(user, 'Our Menu');
    fireEvent.change(screen.getByLabelText('SEO title'), { target: { value: 'A New SEO Title' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.seo.title).toBe('A New SEO Title');
    expect(updated.seo.description).toBe('A short description.');
  });
});

// The mutation table's five new cases.
describe('PageList: rows, attention markers and the slug re-point (mutation table)', () => {
  it('a page with no name still has a clickable row', async () => {
    const user = userEvent.setup();
    renderList([makePage({ name: '', slug: 'no-name-yet' })]);
    const row = screen.getByRole('button', { name: 'no-name-yet' });
    await user.click(row);
    expect(screen.getByLabelText('Web address')).toHaveValue('no-name-yet');
  });

  it('with the editor closed, a page\'s own problem is still on screen', () => {
    renderList([makePage({ slug: 'a', name: 'Page A' })], {
      problems: [{ field: '[0].name', message: 'this page needs a name' }],
    });
    const banner = screen.getByRole('alert', { name: 'Problems with this list' });
    expect(within(banner).getByText('this page needs a name')).toBeInTheDocument();
    // The other half of D4's partition: a per-row marker, on the row itself,
    // independent of the banner above.
    expect(screen.getByRole('button', { name: 'Page A needs attention' })).toBeInTheDocument();
  });

  it('renaming a page\'s address leaves its editor open', async () => {
    const user = userEvent.setup();
    const page = makePage({ slug: 'our-menu' });
    const { onChange, rerender } = renderList([page]);
    await openRow(user, 'Our Menu');
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'a-new-address' } });

    // The real caller (PagesArea) re-renders with whatever `onChange`
    // reported -- the same controlled-list contract RecordList.test.tsx's
    // own "moving a row while its editor is open" case exercises, and the
    // only way a bare-component test can observe a re-point that only
    // matters once the slug this editor is keyed on has actually moved.
    const [next] = onChange.mock.calls[onChange.mock.calls.length - 1] as [Page[]];
    rerender(<PageList items={next} onChange={onChange} problems={[]} stage={vi.fn()} />);

    // Still open, on the SAME record, after its own key changed underneath
    // it -- the field is still on screen and still holds the value she just
    // typed, not reset to whatever the (now stale) old slug pointed at.
    expect(screen.getByLabelText('Web address')).toHaveValue('a-new-address');
    expect(screen.getByLabelText('Page name')).toBeInTheDocument();
  });

  it('the row is a button and holds no other control', () => {
    renderList([makePage({ slug: 'a', name: 'Page A' })]);
    // With the editor closed, the checkbox is nowhere on screen at all --
    // not just absent from inside the row's own button, which alone
    // wouldn't catch a checkbox rendered as the row's SIBLING the way the
    // pre-Task-6 version of this file did.
    expect(screen.queryByRole('checkbox')).toBeNull();
    const row = screen.getByRole('button', { name: 'Page A' });
    expect(within(row).queryByRole('checkbox')).toBeNull();
  });
});
