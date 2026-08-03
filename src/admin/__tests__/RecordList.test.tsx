import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordList from '../RecordList';
import { DISH_FIELDS } from '../fields';
import type { Dish } from '../../content/types';
import { validateContent, type ValidationProblem } from '../../content/validate';

function dish(id: string, name: string): Dish {
  return { id, name, description: `${name}, described.`, image: `/food/${id}.webp`, tags: [] };
}

const THREE_DISHES: Dish[] = [dish('negroni', 'Negroni'), dish('spritz', 'Spritz'), dish('bellini', 'Bellini')];

function renderList(overrides: Partial<Parameters<typeof RecordList<Dish>>[0]> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <RecordList<Dish>
      fields={DISH_FIELDS}
      items={THREE_DISHES}
      onChange={onChange}
      onReorder={onReorder}
      onAdd={onAdd}
      onRemove={onRemove}
      noun="dish"
      itemLabel={(d) => d.name}
      problems={[]}
      {...overrides}
    />,
  );
  return { onChange, onReorder, onAdd, onRemove };
}

describe('RecordList: renders one RecordForm per item, in order', () => {
  it('renders a labeled input for every item, prefilled with its own value', () => {
    renderList();
    const nameInputs = screen.getAllByLabelText(DISH_FIELDS.name.label);
    expect(nameInputs.map((el) => (el as HTMLInputElement).value)).toEqual(['Negroni', 'Spritz', 'Bellini']);
  });

  it("reports the index and the full record on a change, without touching any other item", async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const [, secondNameInput] = screen.getAllByLabelText(DISH_FIELDS.name.label);
    await user.type(secondNameInput, '!');
    expect(onChange).toHaveBeenCalledWith(1, { ...THREE_DISHES[1], name: 'Spritz!' });
  });
});

describe('RecordList: move buttons are named per item, and omitted at the ends', () => {
  it('names each move button after its own item, not a shared generic label', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Move Spritz up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Spritz down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Negroni down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Bellini up' })).toBeInTheDocument();
  });

  // The first item has nowhere to move up to, and the last has nowhere to
  // move down to -- a disabled-but-present button would still read as a
  // live control to a screen reader, the exact "unassociated control"
  // failure this task's brief calls out for identically-named buttons, just
  // moved onto a dead one instead of a duplicate one.
  it('omits the up button on the first item and the down button on the last', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move Negroni up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Bellini down' })).not.toBeInTheDocument();
  });

  it('a single-item list has neither an up nor a down button for it', () => {
    renderList({ items: [THREE_DISHES[0]] });
    expect(screen.queryByRole('button', { name: 'Move Negroni up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Negroni down' })).not.toBeInTheDocument();
  });

  it('thirty-eight items produce thirty-eight distinctly-named move-down buttons, not one shared label', () => {
    const many = Array.from({ length: 38 }, (_, i) => dish(`d${i}`, `Dish ${i}`));
    renderList({ items: many });
    // getByRole would throw on an ambiguous (duplicate) accessible name --
    // reaching this line at all is part of what the test proves.
    expect(screen.getByRole('button', { name: 'Move Dish 0 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Dish 37 up' })).toBeInTheDocument();
    expect(screen.getAllByText('Down')).toHaveLength(37); // every item except the last
    expect(screen.getAllByText('Up')).toHaveLength(37); // every item except the first
  });
});

describe('RecordList: reordering hands back the new id ORDER, and never mutates items itself', () => {
  it('moving the first item down swaps it with its neighbour', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Negroni down' }));
    expect(onReorder).toHaveBeenCalledWith(['spritz', 'negroni', 'bellini']);
  });

  it('moving the last item up swaps it with its neighbour', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Bellini up' }));
    expect(onReorder).toHaveBeenCalledWith(['negroni', 'bellini', 'spritz']);
  });

  it('moving the middle item up moves it ahead of its predecessor only', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Spritz up' }));
    expect(onReorder).toHaveBeenCalledWith(['spritz', 'negroni', 'bellini']);
  });
});

describe('RecordList: add and remove', () => {
  it('the add button is labelled after the noun and calls onAdd with no arguments', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderList();
    await user.click(screen.getByRole('button', { name: 'Add a dish' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith();
  });

  it('each item has its own, individually-named remove button', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList();
    await user.click(screen.getByRole('button', { name: 'Remove Spritz' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('an empty list still renders the add button and no remove/move buttons', () => {
    renderList({ items: [] });
    expect(screen.getByRole('button', { name: 'Add a dish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe('RecordList: the aggregate guarantee -- a problem no mounted RecordForm claims must not vanish', () => {
  // The exact scenario the task's brief proves by hand: a list currently
  // rendering only indices 0-2 (THREE_DISHES) with a problem on `[40].name`
  // -- e.g. the debounce-tick/remove race Task 6 introduces, where
  // `problems` was computed against a longer array than what's mounted
  // right now. Every one of the three mounted RecordForms independently
  // concludes "not my index" and drops it (confirmed: this is exactly what
  // RecordForm.tsx's own `belongsToAnotherIndex` does) -- RecordList is the
  // only thing that still has it.
  it('surfaces a problem whose index is past the end of the rendered array, in a top-level banner', () => {
    const problems: ValidationProblem[] = [{ field: '[40].name', message: 'dish 40 needs a name' }];
    renderList({ problems });
    expect(screen.getByRole('alert', { name: 'Problems with items no longer shown' })).toBeInTheDocument();
    expect(screen.getByText('dish 40 needs a name')).toBeInTheDocument();
  });

  it('does not lose it even when validating against a MUCH longer array than is rendered', () => {
    const problems: ValidationProblem[] = [{ field: '[99].name', message: 'dish 99 needs a name' }];
    renderList({ items: [THREE_DISHES[0]], problems });
    expect(screen.getByText('dish 99 needs a name')).toBeInTheDocument();
  });

  it('a problem naming an index that IS rendered goes to that item alone, not to the top-level banner', () => {
    const problems: ValidationProblem[] = [{ field: '[1].name', message: 'spritz needs a name' }];
    renderList({ problems });
    // Attached to Spritz's own field...
    const nameInputs = screen.getAllByLabelText(DISH_FIELDS.name.label);
    expect(nameInputs[1]).toHaveAccessibleDescription('spritz needs a name');
    // ...and NOT duplicated into RecordList's own top-level banner.
    expect(screen.queryByRole('alert', { name: 'Problems with items no longer shown' })).not.toBeInTheDocument();
  });

  // A generic file-level rule, deliberately NOT the specific "the menu needs
  // at least one dish" message: that message can only ever be produced by
  // the real validator for an EMPTY array (see validateDishes,
  // src/content/validate.ts), which can never coexist with THREE_DISHES
  // below -- a review of this task's first draft correctly called out that
  // testing this exact string against a non-empty list tests a
  // configuration the real bug (see the "empty list" describe block below)
  // cannot occur in. This test is about a DIFFERENT property: that a
  // file-level problem, when at least one RecordForm IS mounted, is left to
  // each RecordForm's own banner rather than also being duplicated into
  // RecordList's aggregate one.
  it('a file-level problem (field === "") is left to each RecordForm\'s own banner, not duplicated here', () => {
    const problems: ValidationProblem[] = [{ field: '', message: 'dishes.json: some file-level rule failed' }];
    renderList({ problems });
    // Shown (by each RecordForm's own banner) -- but RecordList's own
    // aggregate banner must not ALSO claim it; unclaimedProblems only
    // concerns indexed problems that landed on an index nobody renders.
    expect(screen.queryByRole('alert', { name: 'Problems with items no longer shown' })).not.toBeInTheDocument();
    expect(screen.getAllByText('dishes.json: some file-level rule failed').length).toBeGreaterThan(0);
  });

  it('the aggregate banner is absent when every problem is claimed by a rendered item', () => {
    const problems: ValidationProblem[] = [{ field: '[0].name', message: 'negroni needs a name' }];
    renderList({ problems });
    expect(screen.queryByRole('alert', { name: 'Problems with items no longer shown' })).not.toBeInTheDocument();
  });
});

// Critical review finding: when NO RecordForm is mounted at all (an empty
// list), a problem's own field shape stopped mattering -- there is no
// sibling form left to have "not claimed" it FOR, so the earlier
// `index !== undefined && index >= itemCount` check dropped every problem
// that didn't happen to look like `[N].key` too. Proven first against the
// REAL validator, not a hand-typed string standing in for it: this is
// EXACTLY the state `validateContent('dishes.json', [])` reaches by
// construction (validateDishes' own empty-array check, src/content/validate.ts) --
// she deletes her last dish, publishes, gets a 422 back, and this was the
// one message the dashboard is supposed to show her for it.
describe('RecordList: an EMPTY list still surfaces every problem -- nothing is mounted to claim ANY of them', () => {
  it('surfaces the real validator\'s own empty-dishes-list message', () => {
    const problems = validateContent('dishes.json', []);
    expect(problems).toEqual([{ field: '', message: 'dishes.json: the menu needs at least one dish' }]);
    renderList({ items: [], problems });
    expect(screen.getByRole('alert', { name: 'Problems with items no longer shown' })).toBeInTheDocument();
    expect(screen.getByText('dishes.json: the menu needs at least one dish')).toBeInTheDocument();
  });

  // Every shape a problem's `field` can take, all dropped before the fix --
  // not just the file-level `''` case above. `[-1].name` and `[abc].name`
  // are the review's own examples: the first is a real (if nonsensical)
  // array-item shape `arrayIndexOf` parses to a real negative number; the
  // second doesn't match the `[N].` pattern at all (`arrayIndexOf` returns
  // `undefined` for it, same as a bare non-array-item field), so it used to
  // fall through exactly like `heading` did.
  it.each([
    ['a negative index', '[-1].name'],
    ['a non-numeric index', '[abc].name'],
    ['a bare non-array key', 'heading'],
  ])('surfaces a problem shaped as %s (field %s)', (_label, field) => {
    const problems: ValidationProblem[] = [{ field, message: `problem for ${field}` }];
    renderList({ items: [], problems });
    expect(screen.getByText(`problem for ${field}`)).toBeInTheDocument();
  });
});
