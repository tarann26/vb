// The arithmetic behind a bar's width is pinned in chart-geometry.test.ts.
// What belongs here is the wiring: that this component reads that arithmetic
// correctly, sets the attribute jsdom can actually see, and picks the right
// list element. A COMPUTED width is not a jsdom claim -- there is no row for
// one here, and Task 23's browser sweep carries it instead.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarList from '../BarList';

describe('BarList', () => {
  const rows = [
    { key: '/', label: 'Homepage', value: 2000 },
    { key: '/catering', label: 'Catering', value: 400 },
  ];

  it('shows every row with its own number, formatted for India', () => {
    render(<BarList rows={[...rows, { key: '/x', label: 'X', value: 100000 }]} ordered />);
    expect(screen.getByText('2,000')).toBeInTheDocument();
    // 1,00,000 in en-IN and 100,000 everywhere else -- the value that makes
    // this assertion about the locale rather than about the separator.
    expect(screen.getByText('1,00,000')).toBeInTheDocument();
  });

  it('the leader fills the track and everything else is measured against it', () => {
    render(<BarList rows={rows} ordered />);
    expect(document.querySelector('[data-bar="/"]')).toHaveStyle({ width: '100%' });
    expect(document.querySelector('[data-bar="/catering"]')).toHaveStyle({ width: '20%' });
  });

  it('a single visit still draws a bar', () => {
    render(<BarList rows={[{ key: 'a', label: 'A', value: 900 }, { key: 'b', label: 'B', value: 1 }]} ordered />);
    expect(document.querySelector('[data-bar="b"]')).toHaveStyle({ width: '2%' });
  });

  it('an all-zero list does not emit NaN%', () => {
    render(<BarList rows={[{ key: 'a', label: 'A', value: 0 }]} ordered />);
    const bar = document.querySelector('[data-bar="a"]') as HTMLElement;
    expect(bar.style.width).not.toContain('NaN');
    expect(bar).toHaveStyle({ width: '2%' });
  });

  it('keeps the bars out of the accessibility tree', () => {
    render(<BarList rows={rows} ordered />);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('ranks the pages and does not rank the referrers', () => {
    const { container, rerender } = render(<BarList rows={rows} ordered />);
    expect(container.querySelector('ol')).not.toBeNull();
    rerender(<BarList rows={rows} ordered={false} />);
    expect(container.querySelector('ul')).not.toBeNull();
  });

  it('shows a hostname beside a label when there is one', () => {
    render(<BarList rows={[{ key: 'o:t.co', label: 'Other links', sub: 't.co', value: 3 }]} ordered={false} />);
    expect(screen.getByText('t.co')).toBeInTheDocument();
  });
});
