import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditorSheet from '../EditorSheet';

function open(props: Partial<React.ComponentProps<typeof EditorSheet>> = {}) {
  const onClose = vi.fn();
  const onDelete = vi.fn();
  render(
    <EditorSheet title="Aglio e Pepperoncini" onClose={onClose} onDelete={onDelete} deleteLabel="Delete Aglio e Pepperoncini" {...props}>
      <input aria-label="Name" defaultValue="Aglio e Pepperoncini" />
    </EditorSheet>,
  );
  return { onClose, onDelete };
}

it('is a modal dialog named after the item', () => {
  open();
  expect(screen.getByRole('dialog', { name: 'Aglio e Pepperoncini' })).toHaveAttribute('aria-modal', 'true');
});

it('puts focus inside itself when it opens', () => {
  open();
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
});

it('Done closes it', () => {
  const { onClose } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Escape closes it', () => {
  const { onClose } = open();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Tab past the last control comes back to the first', () => {
  open();
  const done = screen.getByRole('button', { name: 'Done' });
  const del = screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' });
  del.focus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
  expect(document.activeElement).toBe(done);
});

it('Delete asks once before it deletes', () => {
  const { onDelete } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete aglio e pepperoncini' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

it('an editor with no onDelete shows no delete control at all', () => {
  open({ onDelete: undefined });
  expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
});
