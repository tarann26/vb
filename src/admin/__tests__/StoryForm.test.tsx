import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoryForm from '../StoryForm';
import { NO_IMAGE_PREVIEWS } from '../previews';
import { validateContent } from '../../content/validate';
import type { StoryContent } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

const CHEF = {
  name: 'Kamalika Anand',
  role: 'Chef and owner',
  portrait: '/team/kamalika-anand.webp',
  portraitAlt: 'Chef Kamalika Anand',
};

const STORY: StoryContent = {
  heading: 'Our Story',
  paragraphs: ['First paragraph, a real sentence.', 'Second paragraph, also real.'],
  chef: CHEF,
};

function renderForm(overrides: Partial<Parameters<typeof StoryForm>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <StoryForm
      value={STORY}
      onChange={onChange}
      problems={[]}
      stage={vi.fn()}
      previews={NO_IMAGE_PREVIEWS}
      {...overrides}
    />,
  );
  return { onChange };
}

// A real state setter feeding StoryForm's own `value` prop back to itself,
// not a bare spy -- multi-keystroke typing (userEvent.clear + userEvent.type)
// against a controlled input whose `value` prop never changes reverts to
// that fixed prop after every keystroke (HoursField.test.tsx's own comment
// on the identical trap), so a single-keystroke assertion after clearing
// would silently observe the field snapping back to its ORIGINAL value with
// the typed character appended, not the character alone. Field.test.tsx's
// own ControlledField exists for the same reason; this is that same pattern
// for StoryForm rather than a single bare Field.
function ControlledStoryForm({ onChange }: { onChange: (next: StoryContent) => void }) {
  const [value, setValue] = useState(STORY);
  return (
    <StoryForm
      value={value}
      problems={[]}
      stage={vi.fn()}
      previews={NO_IMAGE_PREVIEWS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('StoryForm: renders the heading and every paragraph, prefilled', () => {
  it('shows the heading and both paragraphs', () => {
    renderForm();
    expect(screen.getByLabelText('Heading')).toHaveValue('Our Story');
    expect(screen.getByLabelText('Paragraph 1')).toHaveValue('First paragraph, a real sentence.');
    expect(screen.getByLabelText('Paragraph 2')).toHaveValue('Second paragraph, also real.');
  });

  it('editing the heading reports the whole StoryContent object, paragraphs untouched', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'A New Heading' } });
    expect(onChange).toHaveBeenCalledWith({ ...STORY, heading: 'A New Heading' });
  });

  it("editing paragraph 2 reports the whole array, only that paragraph changed, paragraph 1 the SAME reference", () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByLabelText('Paragraph 2'), { target: { value: 'Edited second paragraph.' } });
    expect(onChange).toHaveBeenCalledWith({ ...STORY, paragraphs: [STORY.paragraphs[0], 'Edited second paragraph.'] });
  });
});

describe('StoryForm: add, remove, and reorder paragraphs', () => {
  it('names move buttons per paragraph, omitted at the ends', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Move paragraph 1 up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move paragraph 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move paragraph 2 up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move paragraph 2 down' })).not.toBeInTheDocument();
  });

  it('moving paragraph 1 down swaps the two paragraphs', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Move paragraph 1 down' }));
    expect(onChange).toHaveBeenCalledWith({ ...STORY, paragraphs: [STORY.paragraphs[1], STORY.paragraphs[0]] });
  });

  // Proven against the REAL validator, not just asserted by name: an
  // earlier version of this test's own title claimed "fails validation
  // until filled in" without ever calling validateContent, which could
  // stay true even if validateStory's blank check regressed.
  it('"Add a paragraph" appends a blank paragraph, which the real validator flags until she fills it in', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Add a paragraph' }));
    const next = { ...STORY, paragraphs: [...STORY.paragraphs, ''] };
    expect(onChange).toHaveBeenCalledWith(next);
    expect(validateContent('story.json', next)).toEqual([{ field: 'paragraphs[2]', message: 'paragraph 3 is blank' }]);
  });

  it('"Remove paragraph 1" drops only that paragraph, leaving the other intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Remove paragraph 1' }));
    expect(onChange).toHaveBeenCalledWith({ ...STORY, paragraphs: [STORY.paragraphs[1]] });
  });
});

// The brief's own instruction: "the no-trailing-ellipsis rule already lives
// in validateContent; surface it inline rather than at publish." Proven
// against the REAL validator, through the SAME debounced `problems` prop
// every other field in this dashboard already uses -- not a rule this
// component invents or re-checks itself.
describe('StoryForm: the ellipsis rule is surfaced inline, from the real validator, not re-implemented here', () => {
  it('a paragraph trailing off with "..." shows the real validator\'s own message on that paragraph', () => {
    const trailing: StoryContent = { heading: 'Our Story', paragraphs: ['This trails off...'], chef: CHEF };
    const problems = validateContent('story.json', trailing);
    expect(problems).toEqual([{ field: 'paragraphs[0]', message: expect.stringMatching(/trails off with an ellipsis/) }]);

    render(<StoryForm value={trailing} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.getByLabelText('Paragraph 1')).toHaveAccessibleDescription(expect.stringMatching(/trails off with an ellipsis/));
  });

  it('a paragraph ending in a real sentence has no problem attached', () => {
    const problems = validateContent('story.json', STORY);
    expect(problems).toEqual([]);
    render(<StoryForm value={STORY} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('StoryForm: an EMPTY paragraph list still surfaces the real validator\'s own message', () => {
  it('shows "the About section needs at least one paragraph" when every paragraph is removed', () => {
    const empty: StoryContent = { heading: 'Our Story', paragraphs: [], chef: CHEF };
    const problems = validateContent('story.json', empty);
    expect(problems).toEqual([{ field: 'paragraphs', message: 'the About section needs at least one paragraph' }]);
    render(<StoryForm value={empty} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.getByRole('alert', { name: "Problems with the story's paragraphs" })).toHaveTextContent(
      'the About section needs at least one paragraph',
    );
  });
});

describe("StoryForm: a blank heading's own message attaches to the heading, not the paragraph banner", () => {
  it('shows "the About section needs a heading" on the heading field only', () => {
    const blankHeading: StoryContent = { heading: '', paragraphs: STORY.paragraphs, chef: CHEF };
    const problems = validateContent('story.json', blankHeading);
    expect(problems).toEqual([{ field: 'heading', message: 'the About section needs a heading' }]);
    render(<StoryForm value={blankHeading} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.getByLabelText('Heading')).toHaveAccessibleDescription('the About section needs a heading');
    expect(screen.queryByRole('alert', { name: "Problems with the story's paragraphs" })).not.toBeInTheDocument();
  });
});

describe('StoryForm: a problem naming a paragraph index past the end of what is rendered still surfaces, in the banner', () => {
  it('surfaces a stale paragraphs[N] problem for an index no longer rendered', () => {
    const problems: ValidationProblem[] = [{ field: 'paragraphs[9]', message: 'a stale problem for a paragraph no longer here' }];
    renderForm({ problems });
    expect(screen.getByRole('alert', { name: "Problems with the story's paragraphs" })).toHaveTextContent(
      'a stale problem for a paragraph no longer here',
    );
  });
});

describe('the chef byline fields', () => {
  it('shows her name, her role and her photo above the paragraphs', () => {
    const { container } = render(
      <StoryForm value={STORY} onChange={vi.fn()} problems={[]} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />,
    );
    expect(screen.getByLabelText('Your name')).toHaveValue(STORY.chef.name);
    expect(screen.getByLabelText('What you are')).toHaveValue(STORY.chef.role);
    expect(screen.getByLabelText('Description of your photo')).toHaveValue(STORY.chef.portraitAlt);
    // PhotoField renders its own label and file input rather than a text
    // box holding the path -- see Field.tsx's own dispatch comment.
    expect(screen.getByLabelText('Your photo')).toBeInTheDocument();
    // Review finding: `getByLabelText('Your photo')` alone proves the FIELD
    // is wired, not that the PREVIEW <img> actually reads `chef.portrait`
    // rather than a hardcoded literal that happens to match STORY's own
    // fixture value -- a hardcoded string is indistinguishable from a real
    // binding unless the assertion checks the rendered src against a value
    // this test does not also hand the component through some other channel.
    // Proven directly: pinning `spec={CHEF_FIELDS.portrait}` `value=` to a
    // literal (e.g. '/team/some-other-hardcoded-photo.webp') left every
    // OTHER assertion in this file green -- only this line catches it.
    expect(container.querySelector('img')).toHaveAttribute('src', STORY.chef.portrait);
  });

  it('edits her name without disturbing the paragraphs', async () => {
    const onChange = vi.fn();
    render(<ControlledStoryForm onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText('Your name'));
    await userEvent.type(screen.getByLabelText('Your name'), 'K');
    expect(onChange).toHaveBeenLastCalledWith({
      ...STORY,
      chef: { ...STORY.chef, name: 'K' },
    });
  });

  it('edits the role line', async () => {
    const onChange = vi.fn();
    render(<ControlledStoryForm onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText('What you are'));
    await userEvent.type(screen.getByLabelText('What you are'), 'C');
    expect(onChange).toHaveBeenLastCalledWith({ ...STORY, chef: { ...STORY.chef, role: 'C' } });
  });

  // Routed to the right field, not dumped in the banner: validateStory
  // emits 'chef.name', and StoryForm's existing paragraph banner catches
  // everything it does not recognise -- so a chef problem with no home
  // would silently appear in a box labelled "Problems with the About
  // section's paragraphs".
  it("shows a chef problem on the chef's own field, not in the paragraph banner", () => {
    const problems = [{ field: 'chef.name', message: 'the About section needs your name' }];
    render(<StoryForm value={STORY} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.getByText('the About section needs your name')).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: /paragraphs/i })).toBeNull();
  });

  it('still routes a paragraph problem to its paragraph', () => {
    const problems = [{ field: 'paragraphs[1]', message: 'paragraph 2 is blank' }];
    render(<StoryForm value={STORY} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
    expect(screen.getByText('paragraph 2 is blank')).toBeInTheDocument();
  });
});
