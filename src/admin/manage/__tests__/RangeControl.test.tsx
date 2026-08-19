// The control on its own, apart from the panel that owns the state. What it
// does INSIDE NumbersArea -- which range gets asked for, what gets discarded,
// what the two list cards say at year grain -- is pinned in
// src/admin/areas/__tests__/NumbersArea.test.tsx, because those are claims
// about the panel and not about four buttons.
//
// Nothing here measures a pill's size or its colour. Both are geometry and
// computed style, jsdom has neither, and e2e/numbers-visuals.spec.ts measures
// them in a real browser.
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RangeControl, { RANGE_LABELS } from '../RangeControl';
import type { AnalyticsRange } from '../../../shared/analytics-payload';

function renderControl(overrides: Partial<ComponentProps<typeof RangeControl>> = {}) {
  const onChange = vi.fn();
  render(
    <RangeControl value="30d" onChange={onChange} disabled={false} yearAvailable={false} {...overrides} />,
  );
  return onChange;
}

function group(): HTMLElement {
  return screen.getByRole('group', { name: 'How far back' });
}

describe('RangeControl', () => {
  it('names every range in her words, never in the machine values', () => {
    renderControl({ yearAvailable: true });
    for (const label of Object.values(RANGE_LABELS)) {
      expect(within(group()).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // The machine values never reach the screen.
    expect(group().textContent ?? '').not.toMatch(/7d|30d|90d/);
  });

  it('marks exactly one pill pressed, and it is the one she is on', () => {
    renderControl({ value: '90d', yearAvailable: true });
    const pressed = within(group())
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName('Last 90 days');
  });

  it('hands back the range she picked', async () => {
    const onChange = renderControl();
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(onChange).toHaveBeenCalledWith<[AnalyticsRange]>('7d');
  });

  it('cannot be pressed at all while an answer is on its way', () => {
    renderControl({ disabled: true, yearAvailable: true });
    for (const button of within(group()).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  // PublishBar is one <form> wrapping this whole screen, and a bare <button>
  // inside a form defaults to type="submit" -- which here would mean four more
  // Publish triggers.
  it('declares every pill a button, never a submit', () => {
    renderControl({ yearAvailable: true });
    for (const button of within(group()).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});
