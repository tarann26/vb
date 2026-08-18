import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockPicker from '../BlockPicker';
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS, INSERT_MENU_KINDS } from '../block-meta';
import { BLOCK_KINDS } from '../../../content/guards';

describe('BlockPicker', () => {
  // Derived from BLOCK_KINDS, so a kind added to the model with no branch in
  // BlockFields cannot reach the picker without failing here first. The
  // ordering matters too: the two she reaches for constantly come first.
  it('offers exactly the kinds the model has, in a deliberate order', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names.length).toBe(BLOCK_KINDS.length);
    BLOCK_KINDS.forEach((kind) => {
      expect(names.some((name) => name.includes(BLOCK_KIND_LABELS[kind])), `${kind} is not offered`).toBe(true);
    });
    expect(names[0]).toContain(BLOCK_KIND_LABELS.paragraph);
    expect(names[1]).toContain(BLOCK_KIND_LABELS.heading);
  });

  // The narrow list is taken verbatim. The failure this rules out is the one
  // the runtime reconciliation would cause if it were applied to a caller's
  // own list: the six missing kinds appended back on, so the writing surface's
  // insert menu becomes a second copy of the whole picker sitting under a
  // toolbar that already offers those six.
  it('offers exactly the kinds a caller narrows it to, and appends nothing to them', () => {
    render(<BlockPicker onPick={vi.fn()} kinds={INSERT_MENU_KINDS} />);
    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names.length).toBe(INSERT_MENU_KINDS.length);
    INSERT_MENU_KINDS.forEach((kind) => {
      expect(names.some((name) => name.includes(BLOCK_KIND_LABELS[kind])), `${kind} is not offered`).toBe(true);
    });
    // Named rather than counted as well, because the count alone would pass a
    // list that had swapped one of the four for a kind the toolbar covers.
    // `image` is deliberately not asserted by substring: its label is "Photo",
    // which is a substring of the gallery's own "Photo grid".
    expect(names.some((name) => name.includes(BLOCK_KIND_LABELS.paragraph))).toBe(false);
    expect(names.some((name) => name.includes(BLOCK_KIND_LABELS.quote))).toBe(false);
  });

  it('hands back a narrowed kind she clicked, not the first one in the model', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BlockPicker onPick={onPick} kinds={INSERT_MENU_KINDS} />);
    await user.click(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.citation) }));
    expect(onPick).toHaveBeenCalledWith('citation');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('says what each one is for, not just what it is called', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    BLOCK_KINDS.forEach((kind) => {
      expect(screen.getByText(BLOCK_KIND_HELP[kind])).toBeInTheDocument();
    });
  });

  it('hands back the kind she clicked, not the one next to it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BlockPicker onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.ingredients) }));
    expect(onPick).toHaveBeenCalledWith('ingredients');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('every button is a real button, so Enter and Space both work', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    screen.getAllByRole('button').forEach((button) => {
      expect(button.tagName.toLowerCase()).toBe('button');
      expect(button).toHaveAttribute('type', 'button');
    });
  });
});
