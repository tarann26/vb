// The trend chart's SHAPE and its COPY, and nothing else.
//
// NO GEOMETRY ASSERTIONS LIVE HERE. jsdom has no layout engine, so it cannot
// say where the line actually landed, how wide the chart drew, or whether the
// label row fits under it at 390px. Task 23's browser sweep measures the
// drawn result; the arithmetic behind the path strings is pinned in
// chart-geometry.test.ts.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TrendChart from '../TrendChart';
import { seriesLabel, trendCaption } from '../analytics';

describe('TrendChart', () => {
  it('says so rather than drawing a dot when there is one point', () => {
    render(<TrendChart series={[{ date: '2026-08-18', visits: 4, complete: true }]} grain="day" />);
    expect(screen.getByText(/Not enough days yet/)).toBeInTheDocument();
  });

  it('names itself for a screen reader, with the peak in the name', () => {
    render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 4, complete: true },
          { date: '2026-08-18', visits: 9, complete: true },
        ]}
        grain="day"
      />,
    );
    expect(screen.getByRole('img', { name: /Visits over the last 2 days, highest 9/ })).toBeInTheDocument();
  });

  it('never puts NaN in a path attribute', () => {
    // The all-zero series is the state this ships in, and a NaN here is
    // visible as literal text on the page.
    const { container } = render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 0, complete: true },
          { date: '2026-08-18', visits: 0, complete: true },
        ]}
        grain="day"
      />,
    );
    const drawn = container.querySelectorAll('path');
    expect(drawn.length).toBeGreaterThan(0);
    for (const path of drawn) {
      expect(path.getAttribute('d')).not.toContain('NaN');
    }
  });

  it('stars the partial month ON SCREEN, not only in the caption', () => {
    // The caption promises "Months marked * are not complete". Without this
    // row of labels there is no star anywhere and the caption refers to
    // nothing -- which is worse than saying nothing, because it implies she
    // missed a mark that was never drawn.
    render(
      <TrendChart
        series={[
          { date: '2026-07', visits: 300, complete: true },
          { date: '2026-08', visits: 40, complete: false },
        ]}
        grain="month"
      />,
    );
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('August 2026*')).toBeInTheDocument();
  });

  it('does not draw a label row at day grain', () => {
    // Thirty labels under a 390px chart is a smear, and a day has no
    // comparable claim to make about itself.
    const { container } = render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 4, complete: true },
          { date: '2026-08-18', visits: 9, complete: true },
        ]}
        grain="day"
      />,
    );
    expect(container.querySelector('ol')).toBeNull();
  });
});

describe('trendCaption', () => {
  it('says the archive cannot reach back, and from when', () => {
    expect(trendCaption('day', '2026-08-18', false)).toBe(
      'This chart begins on 18 August 2026, when the record started. It cannot reach back before that.',
    );
  });

  it('says something honest before the archive holds anything at all', () => {
    expect(trendCaption('day', null, false)).toBe(
      'This chart fills in from today onwards. It cannot reach back before now.',
    );
  });

  it('names the starting month in words, never a raw date code', () => {
    // `seriesStartsOn` is 'YYYY-MM' at month grain, which the day-grain
    // formatter cannot read and hands back untouched -- printing "2026-06" to
    // a reader who has never seen an ISO date.
    expect(trendCaption('month', '2026-06', false)).toBe(
      'This chart begins on June 2026, when the record started. It cannot reach back before that.',
    );
  });

  it('warns that a starred month is not a whole month', () => {
    expect(trendCaption('month', '2026-06', true)).toContain('Months marked * are not complete.');
  });

  it('does not warn when every month in view is whole', () => {
    expect(trendCaption('month', '2026-06', false)).not.toContain('*');
  });
});

describe('seriesLabel', () => {
  it('stars a partial month and leaves a whole one alone', () => {
    expect(seriesLabel('2026-08', false)).toBe('August 2026*');
    expect(seriesLabel('2026-08', true)).toBe('August 2026');
  });

  it('reads a day-grain bucket as a day, not as a month', () => {
    expect(seriesLabel('2026-08-18', true)).toBe('18 August');
  });
});
