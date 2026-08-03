import { useState } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceAt, useValidation } from '../useValidation';
import { validateContent } from '../../content/validate';
import RecordList from '../RecordList';
import { DISH_FIELDS, SECTION_FIELDS } from '../fields';
import type { Dish, Section } from '../../content/types';
import dishesJson from '../../content/dishes.json';

// The real, committed menu -- fifteen dishes, every one of them carrying a
// non-empty `tags` array (confirmed directly: `dishesJson.every(d =>
// d.tags.length > 0)`). Used instead of a hand-typed fixture for the
// round-trip tests below so "editing one dish preserves tags on all
// fifteen" (this task's own Definition of Done line) is proven against the
// actual file this dashboard edits, not a stand-in shape that happens to
// look similar.
const REAL_DISHES = dishesJson as Dish[];

function dish(overrides: Partial<Dish> = {}): Dish {
  return { id: 'bruschetta', name: 'Bruschetta', description: 'Toast, tomato, basil.', image: '/food/bruschetta.webp', tags: [], ...overrides };
}

describe('replaceAt: the one building block a whole-file update is allowed to use', () => {
  it('replaces only the item at `index`; every other item comes back as the SAME reference', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const editedB = { id: 'b', changed: true };
    const result = replaceAt([a, b, c], 1, editedB);
    expect(result).toEqual([a, editedB, c]);
    // Not just deep-equal -- the SAME object, proving nothing in this array
    // was rebuilt. A reconstruction that happened to copy every field
    // correctly would still pass a `toEqual` check; it would not pass this
    // one.
    expect(result[0]).toBe(a);
    expect(result[2]).toBe(c);
  });

  it('replacing the first or last item leaves the array the same length', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(replaceAt(items, 0, { id: 'z' })).toEqual([{ id: 'z' }, { id: 'b' }, { id: 'c' }]);
    expect(replaceAt(items, 2, { id: 'z' })).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'z' }]);
  });
});

describe('useValidation: validates the WHOLE file, never the one record she is editing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports nothing before the debounce window has elapsed', () => {
    const { result } = renderHook(({ data }: { data: Dish[] }) => useValidation('dishes.json', data), {
      initialProps: { data: [] },
    });
    expect(result.current).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toEqual([]);
  });

  it("reports the real validator's answer once the debounce window elapses", () => {
    const { result } = renderHook(({ data }: { data: Dish[] }) => useValidation('dishes.json', data), {
      initialProps: { data: [] },
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toEqual(validateContent('dishes.json', []));
    expect(result.current).toEqual([{ field: '', message: 'dishes.json: the menu needs at least one dish' }]);
  });

  it('validates the whole array, not the single record it happens to contain -- the exact call validateContent cannot answer', () => {
    // Confirmed directly against the real validator: passing ONE dish
    // (rather than an array containing it) gets a completely different,
    // file-shape complaint, not a per-field one.
    const oneDish = REAL_DISHES[0];
    expect(validateContent('dishes.json', oneDish)).toEqual([
      { field: '', message: 'dishes.json: expected a list of dishes' },
    ]);

    const { result } = renderHook(({ data }: { data: Dish[] }) => useValidation('dishes.json', data), {
      initialProps: { data: [oneDish] },
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // A real, complete single-dish array is valid -- and specifically NOT
    // the "expected a list of dishes" message a validate-the-record-instead
    // implementation would produce.
    expect(result.current).toEqual([]);
  });

  it('data === undefined (not loaded yet) reports nothing and starts no timer', () => {
    const { result } = renderHook(({ data }: { data: Dish[] | undefined }) => useValidation('dishes.json', data), {
      initialProps: { data: undefined },
    });
    expect(result.current).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toEqual([]);
  });

  // The debounce's whole point, made to actually happen rather than
  // asserted in a comment: she blanks a dish's name, and fixes it again
  // before the tick that would have flagged it ever fires. That tick must
  // be CANCELLED, not merely overtaken by a later one -- otherwise it still
  // fires on the stale, already-abandoned value and briefly shows a problem
  // for something she has already corrected.
  it('never shows a problem for a value she has already fixed by the time the tick would have fired', () => {
    const { result, rerender } = renderHook(({ data }: { data: Dish[] }) => useValidation('dishes.json', data), {
      initialProps: { data: REAL_DISHES },
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toEqual([]); // settled: the real menu is valid

    // She blanks dish 0's name. If this tick were allowed to land, it would
    // report a missing-name problem.
    const broken = replaceAt(REAL_DISHES, 0, { ...REAL_DISHES[0], name: '' });
    rerender({ data: broken });
    act(() => {
      vi.advanceTimersByTime(200); // short of DEBOUNCE_MS -- the broken tick is still pending
    });
    expect(result.current).toEqual([]); // not yet revalidated at all

    // She fixes it again before that tick ever fires.
    rerender({ data: REAL_DISHES });
    act(() => {
      // Exactly the moment the FIRST (broken) timer would have fired, had
      // it not been cancelled by the rerender above -- 400ms after the
      // broken value was set, but only 200ms into the fresh timer the fix
      // started. A version that fails to cancel the stale timer shows the
      // missing-name problem right here, transiently -- checking only the
      // fully-settled end state (400ms after the fix) would let a version
      // like that pass, since the later, correct tick would overwrite it
      // before any assertion ran.
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(200); // now past the fresh timer's own 400ms
    });
    expect(result.current).toEqual([]); // settled correctly, on the FIXED value
  });
});

// ---------------------------------------------------------------------------
// The most valuable test in this plan. She edits one dish; the eventual
// publish (Task 10) sends the whole file. `replaceAt` is what AdminApp uses
// to apply that edit to the in-memory array -- these tests exercise it
// through the REAL RecordList/RecordForm/Field components and a REAL DOM
// interaction, not a hand-rolled reducer standing in for them, so a
// regression in the actual wiring (not just in replaceAt taken in
// isolation) would turn one of these red.

function DishesHarness({ initial }: { initial: Dish[] }) {
  const [items, setItems] = useState(initial);
  return (
    <>
      <RecordList<Dish>
        fields={DISH_FIELDS}
        items={items}
        onChange={(index, next) => setItems((prev) => replaceAt(prev, index, next))}
        onReorder={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        noun="dish"
        itemLabel={(d) => d.name}
        problems={[]}
      />
      {/* Renders the CURRENT in-memory array back out as JSON so a test can
          read exactly what would be published -- this is the `published`
          this task's brief itself names in its own test snippet. */}
      <pre data-testid="published">{JSON.stringify(items)}</pre>
    </>
  );
}

function readPublishedDishes(): (Dish & { futureField?: string })[] {
  return JSON.parse(screen.getByTestId('published').textContent ?? 'null');
}

describe('the whole-file round trip never drops a field', () => {
  it("editing one dish's description preserves EVERY dish's tags -- a field the public site renders nowhere, so a silent drop would have no other symptom", async () => {
    const user = userEvent.setup();
    render(<DishesHarness initial={REAL_DISHES} />);

    const descriptionInputs = screen.getAllByLabelText(DISH_FIELDS.description.label);
    await user.type(descriptionInputs[0], ' Now with extra basil.');

    const published = readPublishedDishes();
    expect(published).toHaveLength(REAL_DISHES.length);
    // The edit itself really landed -- this isn't passing because nothing changed.
    expect(published[0].description).toBe(REAL_DISHES[0].description + ' Now with extra basil.');
    // Every dish's tags, the edited one included, survive exactly.
    published.forEach((published_, i) => {
      expect(published_.tags).toEqual(REAL_DISHES[i].tags);
    });
    // Every OTHER dish is untouched in full, not just its tags -- proving
    // this wasn't a whole-array reconstruction that happened to preserve
    // tags by coincidence.
    published.slice(1).forEach((published_, i) => {
      expect(published_).toEqual(REAL_DISHES[i + 1]);
    });
  });

  it('editing one field preserves a key the Dish type does not declare at all', async () => {
    const user = userEvent.setup();
    // The explicit widening is required -- `value` typed as `Dish` will not
    // admit an unknown key in a literal (FieldsOf<Dish>, src/admin/fields.ts,
    // is total over Dish's own declared keys, so nothing here would even
    // compile without it).
    const withExtra = { ...dish(), futureField: 'x' } as Dish & { futureField: string };
    render(<DishesHarness initial={[withExtra, dish({ id: 'second' })]} />);

    const nameInputs = screen.getAllByLabelText(DISH_FIELDS.name.label);
    await user.type(nameInputs[0], '!');

    const published = readPublishedDishes();
    expect(published[0]).toHaveProperty('futureField', 'x');
    expect(published[0].name).toBe(withExtra.name + '!');
    // The untouched sibling carries no such key of its own -- confirming
    // the extra field is attached to the record that actually had it, not
    // smeared across the whole array by accident.
    expect(published[1]).not.toHaveProperty('futureField');
  });
});

function SectionsHarness({ initial }: { initial: Section[] }) {
  const [items, setItems] = useState(initial);
  return (
    <>
      <RecordList<Section>
        fields={SECTION_FIELDS}
        items={items}
        onChange={(index, next) => setItems((prev) => replaceAt(prev, index, next))}
        onReorder={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        noun="section"
        itemLabel={(s) => s.id}
        problems={[]}
      />
      <pre data-testid="published">{JSON.stringify(items)}</pre>
    </>
  );
}

describe('the whole-file round trip preserves a readonly-descriptor field too', () => {
  it("toggling a section's visibility preserves its readonly id, unchanged", async () => {
    const user = userEvent.setup();
    const initial: Section[] = [
      { id: 'hero', enabled: true },
      { id: 'ourStory', enabled: true },
    ];
    render(<SectionsHarness initial={initial} />);

    // SECTION_FIELDS.id is `kind: 'readonly'` -- rendered disabled, with no
    // way for this interaction to touch it directly. The only thing this
    // test edits is `enabled`.
    const toggles = screen.getAllByLabelText(SECTION_FIELDS.enabled.label);
    await user.click(toggles[1]);

    const published: Section[] = JSON.parse(screen.getByTestId('published').textContent ?? 'null');
    expect(published[1]).toEqual({ id: 'ourStory', enabled: false });
    expect(published[0]).toEqual(initial[0]); // untouched sibling
  });
});
