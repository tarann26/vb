import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ItemList, { type ItemRow } from '../ItemList';

const ROWS: ItemRow[] = [
  { id: 'a', name: 'Dish A', needsAttention: false },
  { id: 'b', name: 'Dish B', needsAttention: true },
  { id: 'c', name: 'Dish C', needsAttention: false },
];

it('one row per item, named', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Dish A',
    'Dish B needs attention',
    'Dish C',
  ]);
});

it('clicking a row opens that row, by id', () => {
  const onOpen = vi.fn();
  render(<ItemList rows={ROWS} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dish C' }));
  expect(onOpen).toHaveBeenCalledWith('c');
});

it('a row with a problem says so in its own name', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.getByRole('button', { name: 'Dish B needs attention' })).toBeInTheDocument();
});

it('Add sits above the first row', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} onAdd={() => {}} addLabel="Add a dish" />);
  const add = screen.getByRole('button', { name: 'Add a dish' });
  const first = screen.getByRole('button', { name: 'Dish A' });
  // DOCUMENT_POSITION_FOLLOWING: `first` comes after `add`.
  expect(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('a list that cannot grow has no Add at all', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
});

it('Move up is omitted on the first row and Move down on the last', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} onMove={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Move Dish A up' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Move Dish C down' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Move Dish B up' })).toBeInTheDocument();
});

it('Up and Down report the two positions, and nothing else', () => {
  const onMove = vi.fn();
  render(<ItemList rows={ROWS} onOpen={() => {}} onMove={onMove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Dish C up' }));
  expect(onMove).toHaveBeenCalledWith(2, 1);
});

it('a list with no order has no handle and no move buttons', () => {
  const { container } = render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(container.querySelectorAll('[data-drag-handle]')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
});
