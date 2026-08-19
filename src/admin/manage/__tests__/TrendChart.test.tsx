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
    expect(trendCaption('day', '2026-08-18', '2026-08-18', false)).toBe(
      'This chart begins on 18 August 2026, when the record started. It cannot reach back before that.',
    );
  });

  // The defect this pair exists for. The archive's first night backfills
  // ninety days and the default range is thirty, so from day two the record
  // reaches further back than the chart does -- and the sentence used to
  // print the ARCHIVE's earliest day above a chart that begins two months
  // later. She reads a thirty-day chart claiming three months of history and
  // cannot tell a quiet month from a quiet quarter.
  it('names the day the chart actually begins on, not the day the record does', () => {
    expect(trendCaption('day', '2026-07-20', '2026-05-22', false)).toBe(
      'This chart begins on 20 July 2026. The record itself goes back to 22 May 2026.',
    );
  });

  it('does not claim the record started where the chart starts unless it did', () => {
    expect(trendCaption('day', '2026-07-20', '2026-05-22', false)).not.toContain('when the record started');
    expect(trendCaption('day', '2026-07-20', '2026-05-22', false)).not.toContain('cannot reach back');
  });

  it('says something honest before the archive holds anything at all', () => {
    expect(trendCaption('day', null, null, false)).toBe(
      'This chart fills in from today onwards. It cannot reach back before now.',
    );
    // An archive with rows but none inside the range draws no line, so the
    // sentence is about the empty chart rather than about a day nothing is
    // plotted on.
    expect(trendCaption('day', null, '2026-05-22', false)).toBe(
      'This chart fills in from today onwards. It cannot reach back before now.',
    );
  });

  it('names the starting month in words, never a raw date code', () => {
    // Both dates are 'YYYY-MM' at month grain, which the day-grain formatter
    // cannot read and hands back untouched -- printing "2026-06" to a reader
    // who has never seen an ISO date.
    expect(trendCaption('month', '2026-06', '2026-06', false)).toBe(
      'This chart begins on June 2026, when the record started. It cannot reach back before that.',
    );
    expect(trendCaption('month', '2026-06', '2025-11', false)).toBe(
      'This chart begins on June 2026. The record itself goes back to November 2025.',
    );
  });

  it('warns that a starred month is not a whole month', () => {
    expect(trendCaption('month', '2026-06', '2026-06', true)).toContain('Months marked * are not complete.');
    expect(trendCaption('month', '2026-06', '2025-11', true)).toContain('Months marked * are not complete.');
  });

  it('does not warn when every month in view is whole', () => {
    expect(trendCaption('month', '2026-06', '2026-06', false)).not.toContain('*');
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
