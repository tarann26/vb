import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// Task 9's wiring. Proven through a REAL upload (FakeXHR), through the
// ENTIRE real chain (PhotoField -> Field -> RecordForm -> RecordList's own
// `onStaged`) -- not a synthetic StagedPhoto object handed straight to a
// mock, which would prove nothing about whether the chain in between is
// actually connected. This is the exact guard the brief asks for by name:
// "assert the publish payload contains the assets-source/ entry, not just
// the contentPath in the record."
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
        onAdd={vi.fn()}
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
    const photoInputs = screen.getAllByLabelText(DISH_FIELDS.image.label);
    await user.upload(photoInputs[1], jpegFile());
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
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
        onStaged={onStaged}
      />,
    );

    const photoInputs = screen.getAllByLabelText(DISH_FIELDS.image.label);
    await user.upload(photoInputs[0], jpegFile('a.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    FakeXHR.instances[0].respond(200, { path: 'assets-source/food/aaa111aaa111.jpg', contentPath: '/food/aaa111aaa111.webp' });
    await waitFor(() => expect(onStaged).toHaveBeenCalledWith('negroni:image', expect.objectContaining({ path: 'assets-source/food/aaa111aaa111.jpg' })));

    await user.upload(photoInputs[2], jpegFile('b.jpg'));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    FakeXHR.instances[1].respond(200, { path: 'assets-source/food/bbb222bbb222.jpg', contentPath: '/food/bbb222bbb222.webp' });
    await waitFor(() => expect(onStaged).toHaveBeenCalledWith('bellini:image', expect.objectContaining({ path: 'assets-source/food/bbb222bbb222.jpg' })));

    // Both calls actually happened -- the second pick did not silently
    // replace or cancel the first one's own report.
    expect(onStaged).toHaveBeenCalledWith('negroni:image', expect.objectContaining({ path: 'assets-source/food/aaa111aaa111.jpg' }));
  });

  it('rendering the list with NO onStaged prop still renders PhotoField (never silently falls back to a text box)', () => {
    render(
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={THREE_DISHES}
        onChange={vi.fn()}
        onReorder={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
      />,
    );
    expect(screen.getAllByLabelText(DISH_FIELDS.image.label)[0]).toHaveAttribute('type', 'file');
  });
});
