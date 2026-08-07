// Two sentences about the same unsaved work, pinned separately, because the
// whole reason they are two functions is that they must not converge into
// one string rendered twice.
import { describe, expect, it } from 'vitest';
import { barSummary, stripSummary } from '../publish-summary';

describe('barSummary -- the bar, about the action', () => {
  // Byte-identical to the strings PublishBar.test.tsx already expects. If
  // one of these ever needs changing, that file is where the change has to
  // be justified, not here.
  it('says nothing is pending at zero', () => {
    expect(barSummary(0, 0)).toBe('No changes to publish yet.');
  });

  it('counts sections, singular and plural', () => {
    expect(barSummary(1, 0)).toBe('1 section edited — ready to publish.');
    expect(barSummary(2, 0)).toBe('2 sections edited — ready to publish.');
  });

  it('counts staged files, singular and plural', () => {
    expect(barSummary(0, 1)).toBe('1 file staged — ready to publish.');
    expect(barSummary(0, 3)).toBe('3 files staged — ready to publish.');
  });

  it('joins the two with a comma', () => {
    expect(barSummary(2, 1)).toBe('2 sections edited, 1 file staged — ready to publish.');
  });
});

describe('stripSummary -- the header, about the state', () => {
  it('never returns the empty string, because a blank strip reads as broken', () => {
    expect(stripSummary([], 0)).toBe('Nothing waiting to be published');
  });

  it('NAMES the files rather than counting sections', () => {
    expect(stripSummary(['dishes.json'], 0)).toBe("Dishes has changes you haven't published yet");
    expect(stripSummary(['dishes.json', 'site.json'], 0)).toBe(
      "Dishes and Opening hours have changes you haven't published yet",
    );
    expect(stripSummary(['dishes.json', 'drinks.json', 'site.json'], 0)).toBe(
      "Dishes, Drinks and Opening hours have changes you haven't published yet",
    );
  });

  it('uses her word for a staged upload, never "staged"', () => {
    expect(stripSummary([], 1)).toBe('1 photo or PDF waiting to be published');
    expect(stripSummary([], 2)).toBe('2 photos or PDFs waiting to be published');
    expect(stripSummary(['dishes.json'], 1)).toBe(
      "Dishes has changes you haven't published yet · 1 photo or PDF waiting",
    );
  });

  it('shares no sentence with barSummary at any input the two can both see', () => {
    const inputs: [string[], number][] = [
      [[], 0],
      [['dishes.json'], 0],
      [['dishes.json', 'drinks.json'], 2],
    ];
    inputs.forEach(([files, staged]) => {
      const strip = stripSummary(files as never, staged);
      expect(strip).not.toBe(barSummary(files.length, staged));
      // The two are told apart at a glance by the trailing clause the bar
      // owns and the strip must never grow.
      expect(strip).not.toContain('ready to publish');
    });
  });
});
