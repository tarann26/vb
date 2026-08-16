import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordForm from '../RecordForm';
import { ARTICLE_FIELDS, DISH_FIELDS, EXPERIENCE_FIELDS, SITE_FIELDS } from '../fields';
import type { FieldsOf } from '../fields';
import { validateContent } from '../../content/validate';
import type { ValidationProblem } from '../../content/validate';
import type { Article, Dish, Experience } from '../../content/types';

function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'gifting',
    title: 'Gifting',
    description: 'Hampers for every occasion.',
    image: '/experiences/gifting.webp',
    comingSoon: true,
    ...overrides,
  };
}

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
    const { container } = render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText(DISH_FIELDS.id.label)).toHaveValue('bruschetta');
    expect(screen.getByLabelText(DISH_FIELDS.name.label)).toHaveValue('Bruschetta');
    expect(screen.getByLabelText(DISH_FIELDS.description.label)).toHaveValue('Toast, tomato, basil.');
    // `image` renders PhotoField (Task 9), a file input -- a real browser
    // (and jsdom) never reports a `.value` for `type="file"` beyond an
    // empty string, so the record's own current value is only observable
    // through PhotoField's own preview <img>, not `toHaveValue`.
    expect(screen.getByLabelText(DISH_FIELDS.image.label)).toHaveAttribute('type', 'file');
    expect(container.querySelector('img')).toHaveAttribute('src', '/food/bruschetta.webp');
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
    const problems: ValidationProblem[] = [{ field: '', message: 'the menu needs at least one dish' }];
    render(<RecordForm fields={DISH_FIELDS} index={0} value={dish()} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByText('the menu needs at least one dish')).toBeInTheDocument();
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

// Article's `date` is the one remaining `kind: 'date'` field in this
// dashboard, and it is REQUIRED -- clearing it must report the empty string
// and keep the key, so validateContent can then say "this article needs a
// real date". ARTICLE_FIELDS.date carries no `optional: true`, so it stays on
// RecordForm's plain generic set path (`{ ...value, [key]: next }`); this
// pins that a date field is unaffected by the `optional`-only deletion path
// below, rather than being special-cased into a deletion the way the retired
// scheduling field once was.
describe('RecordForm: clearing a required date field empties it and keeps the key', () => {
  it("clearing Article's own `date` reports '' and does NOT delete the key", () => {
    const onChange = vi.fn();
    const record = article({ date: '2026-01-01' });
    render(<RecordForm fields={ARTICLE_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    fireEvent.change(screen.getByLabelText(ARTICLE_FIELDS.date.label), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ ...record, date: '' });
    const published = onChange.mock.calls[0][0] as Article;
    expect(published).toHaveProperty('date', '');
  });
});

// The owner-facing dead end the final branch review found (Important 2):
// EXPERIENCE_FIELDS.link is `optional: true`, so clearing "Opens page" must
// now delete the key rather than commit `link: ''`. Reproduced against the
// same shape the review walked in the real dashboard -- an item that already
// has a real link, cleared back out -- and against `validateExperience`
// itself, not just RecordForm's own output, so this fails if either the
// deletion or the validator's `!== undefined` gate regresses.
describe('RecordForm: clearing an `optional: true` field deletes the key, not just its value', () => {
  it('clearing a filled-in "Opens page" box removes the `link` key entirely', () => {
    const onChange = vi.fn();
    const record = experience({ comingSoon: false, link: '/catering' });
    render(<RecordForm fields={EXPERIENCE_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);
    fireEvent.change(screen.getByLabelText(EXPERIENCE_FIELDS.link.label), { target: { value: '' } });

    const published = onChange.mock.calls[0][0] as Experience;
    expect('link' in published).toBe(false);
    // Not merely absent from this one assertion's view -- genuinely gone
    // from the object RecordForm reported, the same distinction this file's
    // own `withField` comment draws against `{ ...value, link: undefined }`.
    expect(Object.keys(published)).not.toContain('link');
  });

  it('typing into a coming-soon item\'s empty "Opens page" box and clearing it back out leaves no `link` key', () => {
    // The exact gesture the review reproduced against `mockEditBackend`:
    // Gifting starts coming-soon with no `link` at all (`blankExperience`'s
    // own shape), she types a page, then deletes what she typed.
    const onChange = vi.fn();
    let record = experience({ comingSoon: true });
    expect('link' in record).toBe(false);
    const { rerender } = render(
      <RecordForm fields={EXPERIENCE_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />,
    );
    const input = screen.getByLabelText(EXPERIENCE_FIELDS.link.label);
    fireEvent.change(input, { target: { value: '/x' } });
    record = onChange.mock.calls[0][0] as Experience;
    expect(record.link).toBe('/x');
    rerender(<RecordForm fields={EXPERIENCE_FIELDS} index={0} value={record} onChange={onChange} problems={[]} />);

    fireEvent.change(screen.getByLabelText(EXPERIENCE_FIELDS.link.label), { target: { value: '' } });
    const final = onChange.mock.calls[1][0] as Experience;
    expect('link' in final).toBe(false);
  });

  it('the record clearing produces raises no `link` problem from the real validator, on either side of the pair rule', () => {
    // The bug's own symptom, reproduced through the actual validator rather
    // than RecordForm's output alone: before this fix, a coming-soon item
    // with `link: ''` failed BOTH the blank-link check and the pair rule at
    // once. This asserts the cleared record -- comingSoon true, no `link`
    // key -- raises neither.
    const cleared = experience({ comingSoon: true });
    const problems = validateContent('experiences.json', [cleared]);
    expect(problems.filter((p) => p.field.endsWith('.link'))).toEqual([]);

    // And the mirror case the pair rule exists for -- comingSoon false with
    // a real link -- is also clean, so this isn't passing by only ever
    // exercising the coming-soon half.
    const linked = experience({ comingSoon: false, link: '/catering' });
    const linkedProblems = validateContent('experiences.json', [linked]);
    expect(linkedProblems.filter((p) => p.field.endsWith('.link'))).toEqual([]);
  });
});
