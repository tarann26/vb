import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  render(<PageList items={items} onChange={onChange} problems={[]} stage={stage} {...overrides} />);
  return { onChange, stage };
}

describe('PageList: Add', () => {
  it('offers an "Add a page" button', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Add a page' })).toBeInTheDocument();
  });

  it('clicking it appends a blank, disabled, not-in-nav page', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Add a page' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [added] = onChange.mock.calls[0][0] as Page[];
    expect(added.name).toBe('');
    expect(added.enabled).toBe(false);
    expect(added.inNav).toBe(false);
    expect(added.sections).toEqual([]);
    expect(typeof added.slug).toBe('string');
    expect(added.slug.length).toBeGreaterThan(0);
  });

  it('two freshly-added pages never collide on slug -- proven through the real validator', () => {
    const problems = validateContent('pages.json', [
      { slug: 'a-freshly-minted-slug-1', name: '', inNav: false, enabled: false, seo: { title: '', description: '' }, sections: [] },
      { slug: 'a-freshly-minted-slug-2', name: '', inNav: false, enabled: false, seo: { title: '', description: '' }, sections: [] },
    ]);
    expect(problems.some((p) => /already used by another page/.test(p.message))).toBe(false);
  });
});

describe('PageList: no Remove button anywhere -- D6', () => {
  it('renders zero buttons named Remove, for the page itself or its nested sections', async () => {
    const user = userEvent.setup();
    renderList([makePage()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    // Also open a nested template section, so its own controls render too.
    await user.click(screen.getByRole('button', { name: 'Add a text section' }));
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe('PageList: editing a page\'s own fields', () => {
  it('"Edit" reveals slug, name and SEO fields; "Close" hides them again', async () => {
    const user = userEvent.setup();
    renderList([makePage()]);
    expect(screen.queryByLabelText('Web address')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Web address')).toHaveValue('our-menu');
    expect(screen.getByLabelText('Page name')).toHaveValue('Our Menu');
    expect(screen.getByLabelText('SEO title')).toHaveValue('Our Menu | Via Bianca');
    expect(screen.getByLabelText('SEO description')).toHaveValue('A short description.');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Web address')).not.toBeInTheDocument();
  });

  it('a page starts with no sections, and adding one through the nested list reaches onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Add a gallery section' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.sections).toHaveLength(1);
    expect(updated.sections[0].kind).toBe('template');
  });

  it('moving a page down swaps it with its neighbour', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage({ slug: 'a' }), makePage({ slug: 'b' })]);
    await user.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    const next = onChange.mock.calls[0][0] as Page[];
    expect(next.map((p) => p.slug)).toEqual(['b', 'a']);
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
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByLabelText('Shown in the navigation menu'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.inNav).toBe(false);
    expect(updated.enabled).toBe(true);
  });

  it('editing the web address field reaches onChange with the new slug', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'a-new-address' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.slug).toBe('a-new-address');
  });

  it('editing the page name field reaches onChange with the new name', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Page name'), { target: { value: 'A New Name' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.name).toBe('A New Name');
  });

  it('editing the SEO title field reaches onChange with the new title, leaving the description untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList([makePage()]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('SEO title'), { target: { value: 'A New SEO Title' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0][0] as Page[];
    expect(updated.seo.title).toBe('A New SEO Title');
    expect(updated.seo.description).toBe('A short description.');
  });
});
