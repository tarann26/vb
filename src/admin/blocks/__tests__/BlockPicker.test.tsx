import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockPicker from '../BlockPicker';
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS } from '../block-meta';
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
