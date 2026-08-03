import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordForm from '../RecordForm';
import { ARTICLE_FIELDS, DISH_FIELDS, SITE_FIELDS } from '../fields';
import type { FieldsOf } from '../fields';
import type { ValidationProblem } from '../../content/validate';
import type { Article, Dish } from '../../content/types';

function dish(overrides: Partial<Dish> = {}): Dish {
  return { id: 'bruschetta', name: 'Bruschetta', description: 'Toast, tomato, basil.', image: '/food/bruschetta.webp', tags: [], ...overrides };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a1',
    title: 'Via Bianca reviewed',
    publication: 'Times',
    date: '2026-01-01',
    excerpt: 'An excerpt.',
    url: null,
    image: '/press/a1.webp',
    ...overrides,
  };
}

// A full SiteLeafShape-shaped value -- SiteLeafShape itself isn't exported
// from fields.ts (deliberately: it's a hand-maintained internal projection,
// see that file's own comment), so RecordForm's generic T is inferred here
// from SITE_FIELDS's own type instead of being named directly. Every one of
// its 19 keys is required because RecordForm renders every key `fields`
// declares.
const REAL_SITE = {
  name: 'Via Bianca',
  tagline: 'An Italian kitchen',
  strapline: 'Fresh, seasonal, unfussy.',
  'address.street': '12 Fern Road',
  'address.locality': 'Bengaluru',
  'address.postalCode': '560001',
  'address.country': 'India',
  phones: ['+91 90000 00000'],
  'whatsapp.number': '+91 90000 00000',
  'whatsapp.prefilledMessage': 'Hi, I would like to book a table',
  'socials.instagram': 'https://instagram.com/viabianca',
  'socials.linkedin': null,
  'seo.title': 'Via Bianca',
  'seo.description': 'An Italian kitchen',
  'seo.keywords': 'italian, restaurant',
  'seo.ogImage': '/seo/og.jpg',
  'seo.url': 'https://viabianca.example',
  'seo.locale': 'en_IN',
  copyrightYear: 2026,
};

// A minimal fixture for the non-array-file shapes (bare `key`, and
// `key[i]`/`key[i].sub`), independent of any real content type -- these two
// tests are about RecordForm's OWN matching/banner logic, not about any
// particular file's real fields, so they don't need to track fields.ts's
// actual key list.
interface StoryFixture {
  heading: string;
  paragraphs: string;
}
const STORY_FIXTURE_FIELDS: FieldsOf<StoryFixture> = {
  heading: { label: 'Heading', kind: 'text' },
  paragraphs: { label: 'Paragraphs', kind: 'text' },
};

describe('RecordForm: renders one record, prefilled', () => {
  it('renders a labeled, valued input for every field the descriptor declares', () => {
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText(DISH_FIELDS.id.label)).toHaveValue('bruschetta');
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveValue('Bruschetta');
    expect(screen.getByLabelText(DISH_FIELDS.description.label)).toHaveValue('Toast, tomato, basil.');
    expect(screen.getByLabelText(DISH_FIELDS.image.label)).toHaveValue('/food/bruschetta.webp');
  });

  it('reports the whole record on a change, with only the edited field updated', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const record = dish({ name: '' });
    render(<RecordForm fields={DISH_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    await user.type(screen.getByLabelText(DISH_FIELDS.name.label), 'B');
    expect(onChange).toHaveBeenCalledWith({ ...record, name: 'B' });
  });
});

describe('RecordForm: array-shaped file, exact-index attachment (the brief\'s own example)', () => {
  it("attaches a dish's own problem to its own field, exactly", () => {
    const problems: ValidationProblem[] = [{ field: '[0].name', message: 'this dish needs a name' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish({ name: '' })} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveAccessibleDescription('this dish needs a name');
    // Not merely present in the document -- attached to the field it is
    // actually about, and to no other field. `id` has its own help text
    // (asserted here by name, not just "some description exists"), so its
    // description is that help alone -- the name problem is not on it too.
    expect(screen.getByLabelText(DISH_FIELDS.id.label)).toHaveAccessibleDescription(DISH_FIELDS.id.help);
  });

  it("shows only THIS index's own message, never a different item's, for the identical field name", () => {
    const problems: ValidationProblem[] = [
      { field: '[0].name', message: 'dish 0 needs a name' },
      { field: '[1].name', message: 'dish 1 needs a name' },
    ];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish({ name: '' })} onChange={vi.fn()} problems={problems} />);
    // Confirmed this fails under suffix matching (`field.endsWith('.' +
    // key)`): a suffix match returns BOTH problems for index 0, and the
    // accessible description would then read as a two-message join instead
    // of dish 0's message alone.
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveAccessibleDescription('dish 0 needs a name');
  });

  it("a different array item's problem is neither attached to this form's field nor dumped in this form's banner", () => {
    // It belongs to whichever RecordForm instance renders index 1 --
    // dumping it into index 0's banner would be exactly the cross-item
    // misattribution this task's index-matching rule exists to prevent,
    // just moved from the field into the banner instead.
    const problems: ValidationProblem[] = [{ field: '[1].name', message: 'dish 1 needs a name' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={problems} />);
    expect(screen.queryByText('dish 1 needs a name')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats index 0 as a real index, not as "no index" (0 is falsy in JS)', () => {
    const problems: ValidationProblem[] = [{ field: '[0].name', message: 'dish 0 needs a name' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish({ name: '' })} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveAccessibleDescription('dish 0 needs a name');
  });
});

describe('RecordForm: nothing is ever silently dropped', () => {
  it('renders a file-level problem (field === "") in a form-level banner', () => {
    const problems: ValidationProblem[] = [{ field: '', message: 'dishes.json: the menu needs at least one dish' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByText('dishes.json: the menu needs at least one dish')).toBeInTheDocument();
  });

  it('renders a problem naming THIS index but a field this descriptor does not declare, in the banner', () => {
    const problems: ValidationProblem[] = [{ field: '[0].bogus', message: 'a rule this form has no field for' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByText('a rule this form has no field for')).toBeInTheDocument();
  });

  it('the banner is absent when every problem is accounted for', () => {
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('RecordForm: non-array file (no index) -- bare key, and key[i]/key[i].sub', () => {
  it('matches a bare scalar-field problem by exact key', () => {
    const problems: ValidationProblem[] = [{ field: 'heading', message: 'the story needs a heading' }];
    render(
      <RecordForm fields={STORY_FIXTURE_FIELDS} value={{ heading: '', paragraphs: '' }} onChange={vi.fn()} problems={problems} />,
    );
    expect(screen.getByLabelText('Heading')).toHaveAccessibleDescription('the story needs a heading');
    expect(screen.getByLabelText('Paragraphs')).not.toHaveAccessibleDescription();
  });

  it("matches a key[i]-shaped problem (one item of that field's own array) to the same field", () => {
    const problems: ValidationProblem[] = [{ field: 'paragraphs[1]', message: 'paragraph 2 is blank' }];
    render(
      <RecordForm
        fields={STORY_FIXTURE_FIELDS}
        value={{ heading: 'Our story', paragraphs: '' }}
        onChange={vi.fn()}
        problems={problems}
      />,
    );
    expect(screen.getByLabelText('Paragraphs')).toHaveAccessibleDescription('paragraph 2 is blank');
    // Attached to the field itself, not ALSO duplicated into the form-level
    // banner -- the banner (aria-label "Problems with this file") is
    // distinct from a per-field message's own role="alert".
    expect(screen.queryByRole('alert', { name: 'Problems with this file' })).not.toBeInTheDocument();
  });

  it('still banners a file-level problem for a non-array file', () => {
    const problems: ValidationProblem[] = [{ field: '', message: 'sections.json: hero cannot be disabled' }];
    render(
      <RecordForm fields={STORY_FIXTURE_FIELDS} value={{ heading: 'x', paragraphs: 'y' }} onChange={vi.fn()} problems={problems} />,
    );
    expect(screen.getByText('sections.json: hero cannot be disabled')).toBeInTheDocument();
  });
});

describe('RecordForm: the real SITE_FIELDS descriptor (dotted bare keys, readonly)', () => {
  it('matches a dotted bare-key problem exactly', () => {
    const problems: ValidationProblem[] = [{ field: 'socials.instagram', message: 'the site needs an Instagram link' }];
    render(<RecordForm fields={SITE_FIELDS} value={REAL_SITE} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText(SITE_FIELDS['socials.instagram'].label)).toHaveAccessibleDescription(
      'the site needs an Instagram link',
    );
  });

  it('renders a readonly field (developer-owned) as disabled, with its help always visible', () => {
    render(<RecordForm fields={SITE_FIELDS} value={REAL_SITE} onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText(SITE_FIELDS.name.label);
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Via Bianca');
    expect(input).toHaveAccessibleDescription(SITE_FIELDS.name.help);
  });
});

// Task 7: `publishAt` routes to ScheduleField, not the generic <Field
// kind="date">, specifically so clearing it can delete the key instead of
// writing ''. These tests exercise that through the REAL RecordForm, not
// ScheduleField in isolation (ScheduleField.test.tsx already covers its own
// onChange contract) -- what matters here is that RecordForm actually turns
// ScheduleField's `undefined` into a deleted KEY on the record it hands back.
describe('RecordForm: publishAt renders as ScheduleField, and clearing it deletes the key', () => {
  it('renders publishAt as a real date input, prefilled', () => {
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish({ publishAt: '2026-09-01' })} onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText(DISH_FIELDS.publishAt.label);
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-09-01');
  });

  it('a dish with no publishAt at all renders an empty date input, not the literal string "undefined"', () => {
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText(DISH_FIELDS.publishAt.label)).toHaveValue('');
  });

  it('setting a date reports the whole record with the key present and set', () => {
    const onChange = vi.fn();
    const record = dish();
    render(<RecordForm fields={DISH_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    fireEvent.change(screen.getByLabelText(DISH_FIELDS.publishAt.label), { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenCalledWith({ ...record, publishAt: '2026-09-01' });
  });

  // The brief's own required test, verbatim: set a date, clear it, assert
  // the resulting record has no `publishAt` key at all -- not merely that it
  // reads as `undefined`. MUTATION CHECKED: reverting RecordForm.tsx's
  // `onChange(omitKey(value, key))` back to `onChange({ ...value, [key]:
  // undefined })` (set-to-undefined instead of delete) leaves this test RED
  // -- `toHaveProperty('publishAt')` still passes on `{ publishAt: undefined,
  // ... }`, since the key is still present (Object.hasOwnProperty is true
  // for an own key holding `undefined`); only an actual delete makes
  // `not.toHaveProperty` pass. Confirmed directly by making that exact edit,
  // running this file, and reverting.
  it('clearing a previously-set publishAt DELETES the key, not writes an empty string or undefined value', () => {
    const onChange = vi.fn();
    const record = dish({ publishAt: '2026-09-01', name: 'Bruschetta' });
    render(<RecordForm fields={DISH_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    fireEvent.change(screen.getByLabelText(DISH_FIELDS.publishAt.label), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const published = onChange.mock.calls[0][0] as Dish;
    expect(published).not.toHaveProperty('publishAt');
    expect(Object.keys(published)).not.toContain('publishAt');
    // The literal claim the brief makes: the PUBLISHED JSON has no
    // publishAt key -- checked through an actual JSON.stringify round trip,
    // not just the in-memory object shape.
    expect(JSON.parse(JSON.stringify(published))).not.toHaveProperty('publishAt');
    // Every other field survives untouched -- this is a targeted delete of
    // one key, not a reconstruction of the record.
    expect(published).toEqual({ id: record.id, name: record.name, description: record.description, image: record.image, tags: record.tags });
  });

  // Proves the `String(key) === 'publishAt'` branch is scoped by KEY NAME,
  // not by `kind: 'date'` -- Article's own REQUIRED `date` field shares that
  // kind but must never lose its key when cleared; an empty date there is a
  // validation error ("needs a real date"), not "no date". MUTATION CHECKED:
  // changing RecordForm.tsx's condition to `spec.kind === 'date'` makes this
  // test go red (Article's `date` would also route through ScheduleField and
  // DELETE `date` on clearing, rather than emptying it) -- confirmed
  // directly, then reverted.
  it("clearing Article's own required `date` field (also kind: 'date') empties it, and does NOT delete the key", () => {
    const onChange = vi.fn();
    const record = article({ date: '2026-01-01' });
    render(<RecordForm fields={ARTICLE_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    fireEvent.change(screen.getByLabelText(ARTICLE_FIELDS.date.label), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ ...record, date: '' });
    const published = onChange.mock.calls[0][0] as Article;
    expect(published).toHaveProperty('date', '');
  });

  it('states next to the control that publishing runs on an hourly check, not at midnight', () => {
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByText(/hourly check/i)).toBeInTheDocument();
  });

  it('attaches a publishAt validation problem to the date input, via the real problemsFor matching', () => {
    const problems: ValidationProblem[] = [
      { field: '[0].publishAt', message: 'invalid "publishAt" date "01-09-2026", expected a real calendar date as YYYY-MM-DD' },
    ];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish({ publishAt: '01-09-2026' })} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText(DISH_FIELDS.publishAt.label)).toHaveAccessibleDescription(/invalid "publishAt" date/);
  });
});
