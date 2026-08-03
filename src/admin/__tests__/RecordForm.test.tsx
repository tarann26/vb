import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordForm from '../RecordForm';
import { DISH_FIELDS, SITE_FIELDS } from '../fields';
import type { FieldsOf } from '../fields';
import type { ValidationProblem } from '../../content/validate';
import type { Dish } from '../../content/types';

function dish(overrides: Partial<Dish> = {}): Dish {
  return { id: 'bruschetta', name: 'Bruschetta', description: 'Toast, tomato, basil.', image: '/food/bruschetta.webp', tags: [], ...overrides };
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
