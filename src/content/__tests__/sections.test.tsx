import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../../App';
import { copy, sections, assertSections } from '../index';

describe('homepage sections', () => {
  it('renders every enabled section and no disabled one', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText(copy.atmosphere.heading)).toBeInTheDocument();
  });

  // The test above alone would pass even if HomePage ignored `enabled`
  // entirely and just rendered every section unconditionally -- it only
  // proves enabled sections show up, not that disabling one has any effect.
  // This test mocks the content module (rather than editing sections.json)
  // so it exercises the toggle regardless of what's enabled in the real
  // file today, and checks both the section and its nav link disappear.
  it('omits a disabled section and its nav link', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        sections: actual.sections.map((s) =>
          s.id === 'atmosphere' ? { ...s, enabled: false } : s),
      };
    });
    const { HomePage } = await import('../../App');
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(copy.atmosphere.heading)).toBeNull();
    expect(
      screen.queryByRole('link', { name: copy.nav.links.find((l) => l.section === 'atmosphere')!.label }),
    ).toBeNull();
  });
});

afterEach(() => {
  vi.doUnmock('../../content');
  vi.resetModules();
});

describe('assertSections', () => {
  it('rejects a disabled hero', () => {
    const bad = sections.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    expect(() => assertSections(bad)).toThrow(/hero/);
  });

  it('rejects a missing hero', () => {
    expect(() => assertSections(sections.filter((s) => s.id !== 'hero'))).toThrow(/hero/);
  });

  it('rejects a duplicate id', () => {
    expect(() => assertSections([...sections, { id: 'food', enabled: true }])).toThrow(/food/);
  });
});
