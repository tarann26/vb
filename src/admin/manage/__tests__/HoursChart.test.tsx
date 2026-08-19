// Attribute assertions, not layout assertions. `x`, `y` and `opacity` are
// what React wrote into the markup, which jsdom reads back honestly; whether
// 168 cells stay legible on a 390px screen is a browser measurement and lives
// in e2e/.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HoursChart from '../HoursChart';

// The same arithmetic the component uses, written out here rather than
// imported: a test that computes its expected position from the constant
// under test would stay green if the constant changed.
const PITCH = 11;
const LABEL_WIDTH = 26;

function cellAt(container: HTMLElement, day: number, hour: number): SVGRectElement | undefined {
  const rects = [...container.querySelectorAll('rect')] as unknown as SVGRectElement[];
  return rects.find(
    (rect) =>
      rect.getAttribute('y') === String(day * PITCH) &&
      rect.getAttribute('x') === String(LABEL_WIDTH + hour * PITCH),
  );
}

describe('HoursChart', () => {
  it('draws a cell for every hour of every day', () => {
    const { container } = render(<HoursChart cells={[]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(168);
  });

  it('paints the busiest hour at full strength and an empty one at none', () => {
    const { container } = render(<HoursChart cells={[{ day: 5, hour: 20, visits: 40 }]} />);

    expect(cellAt(container, 5, 20)?.getAttribute('opacity')).toBe('1');
    expect(cellAt(container, 1, 3)?.getAttribute('opacity')).toBe('0');
  });

  it('makes an hour with one visit look different from a closed hour', () => {
    // The floor. Without it "quiet" and "closed" render identically and the
    // card stops answering the question it exists for.
    const { container } = render(
      <HoursChart
        cells={[
          { day: 5, hour: 20, visits: 400 },
          { day: 2, hour: 3, visits: 1 },
        ]}
      />,
    );

    expect(Number(cellAt(container, 2, 3)?.getAttribute('opacity'))).toBeGreaterThanOrEqual(0.08);
  });

  it('names itself and its timezone for a screen reader', () => {
    render(<HoursChart cells={[]} />);
    expect(screen.getByRole('img', { name: /Indian time/ })).toBeInTheDocument();
  });
});
