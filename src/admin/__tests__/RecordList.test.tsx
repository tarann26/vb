import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordList from '../RecordList';
import { DISH_FIELDS } from '../fields';
import type { Dish } from '../../content/types';
import { validateContent, type ValidationProblem } from '../../content/validate';

// The identical fake XHR double PhotoField.test.tsx defines -- needed here
// for a REAL upload through the full RecordList -> RecordForm -> Field ->
// PhotoField chain, not a synthetic stand-in for what onStaged would report.
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  sentForm: FormData | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.sentForm = body;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function jpegFile(name = 'photo.jpg'): File {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...new TextEncoder().encode('JFIF')]);
  return new File([bytes], name, { type: 'image/jpeg' });
}

function dish(id: string, name: string): Dish {
  return { id, name, description: `${name}, described.`, image: `/food/${id}.webp`, tags: [] };
}

const THREE_DISHES: Dish[] = [dish('negroni', 'Negroni'), dish('spritz', 'Spritz'), dish('bellini', 'Bellini')];

function renderList(overrides: Partial<Parameters<typeof RecordList<Dish>>[0]> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  const onAdd = vi.fn(() => 'new-id');
  const onRemove = vi.fn();
  const result = render(
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
  return { onChange, onReorder, onAdd, onRemove, rerender: result.rerender };
}

describe('RecordList: a row opens the editor on that record', () => {
  it('clicking a row opens a dialog named after that record, prefilled with its own value', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Spritz' }));

    const dialog = screen.getByRole('dialog', { name: 'Spritz' });
    expect(within(dialog).getByLabelText(DISH_FIELDS.name.label)).toHaveValue('Spritz');
  });

  it('reports the index and the full record on a change, without touching any other item', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Spritz' }));

    const nameInput = screen.getByLabelText(DISH_FIELDS.name.label);
    await user.type(nameInput, '!');
    expect(onChange).toHaveBeenCalledWith(1, { ...THREE_DISHES[1], name: 'Spritz!' });
  });

  // A controlled-list harness that mirrors what every real caller does
  // (ArraySection.tsx, AwardsArea.tsx, ExperiencesArea.tsx): mint the
  // blank record's id, commit it into the array THIS COMPONENT owns, and
  // hand the same id back. RecordList itself has no way to add to `items`
  // -- it is controlled -- so proving "Add opens the editor on the record
  // it just added" for real (not merely that some dialog opens) needs a
  // caller that actually behaves like one.
  it('Add opens the editor on the record it just added', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [items, setItems] = useState(THREE_DISHES);
      return (
        <RecordList<Dish>
          fields={DISH_FIELDS}
          items={items}
          onChange={(index, next) => setItems((prev) => prev.map((item, i) => (i === index ? next : item)))}
          onReorder={vi.fn()}
          onAdd={() => {
            const blank: Dish = { id: 'new-id', name: '', description: '', image: '', tags: [] };
            setItems((prev) => [...prev, blank]);
            return blank.id;
          }}
          onRemove={vi.fn()}
          noun="dish"
          itemLabel={(d) => d.name || 'Untitled dish'}
          problems={[]}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add a dish' }));

    expect(screen.getByRole('dialog', { name: 'Untitled dish' })).toBeInTheDocument();
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveValue('');
  });

  it('Done closes the editor and leaves the list', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Spritz' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Negroni' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spritz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bellini' })).toBeInTheDocument();
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

  // D3/the by-ID tracking rule: reordering while an editor is open must not
  // swap which record she is editing under her hands. Proven by actually
  // re-rendering with the reordered array (the real caller's own next
  // step, per `onReorder`'s controlled-list contract) and confirming the
  // dialog is STILL titled after the record she opened, not whatever now
  // sits at the index she originally opened.
  it('moving a row up while its editor is open keeps the same record open', async () => {
    const user = userEvent.setup();
    const { onReorder, rerender } = renderList();
    await user.click(screen.getByRole('button', { name: 'Spritz' }));
    expect(screen.getByRole('dialog', { name: 'Spritz' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move Spritz up' }));
    expect(onReorder).toHaveBeenCalledWith(['spritz', 'negroni', 'bellini']);

    const reordered = [THREE_DISHES[1], THREE_DISHES[0], THREE_DISHES[2]];
    rerender(
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={reordered}
        onChange={vi.fn()}
        onReorder={onReorder}
        onAdd={() => 'new-id'}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Spritz' })).toBeInTheDocument();
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

  // Review finding (fix round 1): the original version of this case also
  // queried `queryByRole('button', { name: /^Remove/ })` -- structurally
  // unfalsifiable, since no Remove-named control exists anywhere in
  // ItemList/RecordList regardless of `items`, and duplicated below by "there
  // is no Remove on any row", which IS falsifiable (a mutation that restores
  // the button reddens it). What an empty list actually has to prove -- and
  // could fail to -- is that it renders zero rows, not a phantom one.
  it('an empty list still renders the add button and no rows', () => {
    renderList({ items: [] });
    expect(screen.getByRole('button', { name: 'Add a dish' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-item-row]')).toHaveLength(0);
  });

  // D8: delete lives inside the editor and asks once -- never on the row.
  it('there is no Remove on any row', () => {
    renderList();
    expect(screen.queryByRole('button', { name: /^Remove /i })).toBeNull();
  });

  it('Delete removes the record she opened, not the first one', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList();
    await user.click(screen.getByRole('button', { name: 'Bellini' }));
    await user.click(screen.getByRole('button', { name: 'Delete Bellini' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete bellini' }));

    expect(onRemove).toHaveBeenCalledWith(2);
  });
});

describe('RecordList: the aggregate guarantee -- closing an editor must not hide a validation problem', () => {
  // D4's partition, restated: `shown` is whatever the open editor's own
  // RecordForm will place (on a field or in ITS OWN banner); `banner` is
  // everything else. With no editor open, `shown` is empty and every
  // problem -- including one naming an index that isn't even rendered --
  // lands in the list's own banner, plus marks its row "needs attention".
  it('with every editor closed, a problem on the third dish is still on screen', () => {
    const problems: ValidationProblem[] = [{ field: '[2].name', message: 'this dish needs a name' }];
    renderList({ problems });

    expect(screen.getByRole('alert', { name: 'Problems with this list' })).toBeInTheDocument();
    expect(screen.getByText('this dish needs a name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bellini needs attention' })).toBeInTheDocument();
  });

  it('a problem naming an index that does not exist is still on screen', () => {
    const problems: ValidationProblem[] = [{ field: '[9].name', message: 'dish 9 needs a name' }];
    renderList({ problems });

    expect(screen.getByRole('alert', { name: 'Problems with this list' })).toBeInTheDocument();
    expect(screen.getByText('dish 9 needs a name')).toBeInTheDocument();
  });

  it('a file-level problem appears exactly once while an editor is open', async () => {
    const user = userEvent.setup();
    const problems: ValidationProblem[] = [{ field: '', message: 'the menu needs at least one dish' }];
    renderList({ problems });
    await user.click(screen.getByRole('button', { name: 'Negroni' }));

    expect(screen.getAllByText('the menu needs at least one dish')).toHaveLength(1);
  });

  it('the aggregate banner is absent when every problem is claimed by the open editor', async () => {
    const user = userEvent.setup();
    const problems: ValidationProblem[] = [{ field: '[0].name', message: 'negroni needs a name' }];
    renderList({ problems });
    // Negroni's own row carries the "needs attention" marker too (D4's
    // per-row half), so its accessible name includes it.
    await user.click(screen.getByRole('button', { name: 'Negroni needs attention' }));

    expect(screen.queryByRole('alert', { name: 'Problems with this list' })).not.toBeInTheDocument();
    // ...and it IS shown, just inside the open editor rather than the list.
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveAccessibleDescription('negroni needs a name');
  });

  // I6 review finding (carried from before this task): `[9]` above is far
  // past THREE_DISHES' own length (3) -- the one index that actually
  // separates ">= itemCount" from "> itemCount" is `[3]`, one past the
  // LAST real item, exactly the shape "she removes the last row while a
  // 400ms debounce computed against the longer array is in flight"
  // produces.
  it('surfaces a problem at the EXACT boundary index (itemCount itself), not only ones far past it', () => {
    const problems: ValidationProblem[] = [{ field: '[3].name', message: 'dish 3 needs a name' }];
    renderList({ problems });
    expect(screen.getByRole('alert', { name: 'Problems with this list' })).toBeInTheDocument();
    expect(screen.getByText('dish 3 needs a name')).toBeInTheDocument();
  });
});

// Critical review finding (carried from before this task): when NO editor
// is open at all, a problem's own field shape stopped mattering -- there is
// no open RecordForm to have "not claimed" it FOR, so every problem is
// unclaimed. Proven first against the REAL validator, not a hand-typed
// string standing in for it: this is EXACTLY the state
// `validateContent('dishes.json', [])` reaches by construction
// (validateDishes' own empty-array check, src/content/validate.ts) -- she
// deletes her last dish, publishes, gets a 422 back, and this was the one
// message the dashboard is supposed to show her for it.
describe('RecordList: an EMPTY list still surfaces every problem -- there is no editor open to claim ANY of them', () => {
  it("surfaces the real validator's own empty-dishes-list message", () => {
    const problems = validateContent('dishes.json', []);
    expect(problems).toEqual([{ field: '', message: 'the menu needs at least one dish' }]);
    renderList({ items: [], problems });
    expect(screen.getByRole('alert', { name: 'Problems with this list' })).toBeInTheDocument();
    expect(screen.getByText('the menu needs at least one dish')).toBeInTheDocument();
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

// Task 9's wiring. Proven through a REAL upload (FakeXHR), through the
// ENTIRE real chain (PhotoField -> Field -> RecordForm -> RecordList's own
// `onStaged`) -- not a synthetic StagedPhoto object handed straight to a
// mock, which would prove nothing about whether the chain in between is
// actually connected. Every case here opens the record's row FIRST: since
// Task 3, a record's own fields (its PhotoField included) mount only while
// its editor is open.
describe("RecordList: Task 9's collector wiring -- a staged photo reaches onStaged with a real, item-scoped key", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keys the staged file \"<item id>:<field key>\", and BOTH onChange (the record's contentPath) and onStaged (the actual bytes) fire", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onStaged = vi.fn();
    render(
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={THREE_DISHES}
        onChange={onChange}
        onReorder={vi.fn()}
        onAdd={() => 'new-id'}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
        onStaged={onStaged}
      />,
    );

    // Spritz is index 1 -- picking on ITS photo field, not the first item's,
    // is what proves the key is built from the ITEM's own id, not always
    // index 0.
    await user.click(screen.getByRole('button', { name: 'Spritz' }));
    const photoInput = screen.getByLabelText(DISH_FIELDS.image.label);
    await user.upload(photoInput, jpegFile());
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/abc123abc123.jpg', contentPath: '/food/abc123abc123.webp' });

    // The record's own field: a path, not the bytes.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(1, { ...THREE_DISHES[1], image: '/food/abc123abc123.webp' }));
    // The collector: the ACTUAL bytes, under a real assets-source/ path --
    // not just "onChange happened", which alone would be exactly the "worse
    // than the text box" defect the brief warns a missing collector causes.
    // `expect.any(String)` would pass on `content: ''` -- and an EMPTY
    // string is exactly the defect this assertion exists to catch (the
    // bytes silently dropped while the path/encoding still look right).
    // Confirmed directly (review finding): mutating PhotoField.tsx's own
    // `content: bytesToBase64(bytes)` to `content: ''` left a
    // string-typed assertion here green. A real base64 shape -- not the
    // exact encoded value, which duplicates base64.test.ts's own coverage
    // of `bytesToBase64` -- is what a caller of this collector actually
    // needs to trust: non-empty, and shaped like base64.
    await waitFor(() =>
      expect(onStaged).toHaveBeenCalledWith(
        'spritz:image',
        expect.objectContaining({
          path: 'assets-source/food/abc123abc123.jpg',
          encoding: 'base64',
          content: expect.stringMatching(/^[A-Za-z0-9+/=]{8,}$/),
        }),
      ),
    );
  });

  it('staging photos on two DIFFERENT records produces two DISTINCT keys, neither overwriting the other', async () => {
    const user = userEvent.setup();
    const onStaged = vi.fn();
    render(
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={THREE_DISHES}
        onChange={vi.fn()}
        onReorder={vi.fn()}
        onAdd={() => 'new-id'}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
        onStaged={onStaged}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Negroni' }));
    const firstPhotoInput = screen.getByLabelText(DISH_FIELDS.image.label);
    await user.upload(firstPhotoInput, jpegFile('a.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    await waitFor(() => expect(onStaged).toHaveBeenCalledWith('negroni:image', expect.objectContaining({ path: 'assets-source/food/aaa111aaa111.jpg' })));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Bellini' }));
    const secondPhotoInput = screen.getByLabelText(DISH_FIELDS.image.label);
    await user.upload(secondPhotoInput, jpegFile('b.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    FakeXHR.instances[1].respond(200, { path: 'assets-source/food/bbb222bbb222.jpg', contentPath: '/food/bbb222bbb222.webp' });
    await waitFor(() => expect(onStaged).toHaveBeenCalledWith('bellini:image', expect.objectContaining({ path: 'assets-source/food/bbb222bbb222.jpg' })));

    // Both calls actually happened -- the second pick did not silently
    // replace or cancel the first one's own report.
    expect(onStaged).toHaveBeenCalledWith('negroni:image', expect.objectContaining({ path: 'assets-source/food/aaa111aaa111.jpg' }));
  });

  it('rendering the list with NO onStaged prop still renders PhotoField (never silently falls back to a text box)', async () => {
    const user = userEvent.setup();
    render(
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={THREE_DISHES}
        onChange={vi.fn()}
        onReorder={vi.fn()}
        onAdd={() => 'new-id'}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Negroni' }));
    expect(screen.getByLabelText(DISH_FIELDS.image.label)).toHaveAttribute('type', 'file');
  });
});
