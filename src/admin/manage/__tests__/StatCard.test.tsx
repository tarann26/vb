// The comparison arithmetic itself is table-tested in comparison.test.ts.
// What belongs here is the wiring: that this component turns a Change into
// the right sentence and picks the right colour class for it, not a claim
// about layout or computed style -- there is no row for either here.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCard from '../StatCard';
import { changeBetween } from '../comparison';

describe('StatCard', () => {
  it('shows the number and what it is', () => {
    render(<StatCard label="Visits" value="about 4,100 visits" change={changeBetween(4100, 3300, true)} unit="visits" />);
    expect(screen.getByText('Visits')).toBeInTheDocument();
    expect(screen.getByText('about 4,100 visits')).toBeInTheDocument();
  });

  it('says the direction in words, not only in colour', () => {
    render(<StatCard label="Visits" value="about 4,100 visits" change={changeBetween(4100, 3300, true)} unit="visits" />);
    expect(screen.getByText('24% more visits than the period before.')).toBeInTheDocument();
  });

  it('says why it cannot compare rather than showing nothing', () => {
    render(<StatCard label="Visits" value="about 9 visits" change={changeBetween(9, 2, true)} unit="visits" />);
    expect(screen.getByText('Not enough of the period before to compare visits against.')).toBeInTheDocument();
  });
});
