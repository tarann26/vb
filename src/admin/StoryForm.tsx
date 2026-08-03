// story.json's own screen: one heading plus an ordered paragraph list, with
// add/remove/reorder on the list -- Kind<string[]> only offers 'tags' for a
// `string[]` value (Field.tsx), which renders the WHOLE array as one
// comma-joined line. Fine for HOURS_FIELDS.days (two-letter codes) or
// SITE_FIELDS.phones (a handful of short numbers); wrong for six real
// paragraphs of prose (src/content/story.json), each one long enough to need
// its own <textarea> and its own per-paragraph validation message. This
// component is the bespoke array-of-textareas UI that gap needs, the same
// way GalleryList.tsx is bespoke rather than routed through RecordList.
//
// The no-trailing-ellipsis rule (validateStory, src/content/validate.ts)
// needs no rendering of its own here -- it already comes back as an ordinary
// `paragraphs[i]` ValidationProblem, which lands on the SAME paragraph field
// every other per-paragraph message does (a blank paragraph, or eventually a
// server-side rejection), through the same debounced `problems` prop every
// other screen in this dashboard already surfaces inline.
import Field from './Field';
import { STORY_HEADING_FIELD } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import type { StoryContent } from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface StoryFormProps {
  value: StoryContent;
  onChange: (next: StoryContent) => void;
  // The FULL story.json problem list, unfiltered -- the same contract every
  // other list/form in this dashboard already documents on its own
  // `problems` prop.
  problems: ValidationProblem[];
}

// `paragraphs[N]` -- validateStory's own shape for a single paragraph's
// problem (blank, or trailing off with an ellipsis). Paragraphs have no
// stable id (StoryContent.paragraphs is a plain `string[]`, src/content/types.ts),
// so -- like HoursField.tsx's own HOURS_ITEM -- this is keyed by array
// index, a second, independently-written regex rather than a shared one:
// unifying it with GalleryList.tsx's own `itemOf` (a different field shape,
// `key[i].sub`, not `key[i]` alone) would either miss this shape or wrongly
// match the other.
const PARAGRAPH_ITEM = /^paragraphs\[(\d+)\]$/;

function paragraphIndexOf(field: string): number | undefined {
  const found = field.match(PARAGRAPH_ITEM);
  return found === null ? undefined : Number(found[1]);
}

function StoryForm({ value, onChange, problems }: StoryFormProps) {
  const headingProblems = problems.filter((p) => p.field === 'heading');

  // The bare `paragraphs` message (validateStory's "the story needs at
  // least one paragraph", only reachable when the list IS empty) plus any
  // indexed problem naming a paragraph this screen isn't currently
  // rendering -- the same "nowhere else for this to go" reasoning
  // RecordList's own unclaimedProblems documents.
  const banner = problems.filter((p) => {
    if (p.field === 'heading') return false;
    if (p.field === 'paragraphs') return true;
    const index = paragraphIndexOf(p.field);
    return index === undefined || index < 0 || index >= value.paragraphs.length;
  });

  function swap(index: number, otherIndex: number) {
    const next = value.paragraphs.slice();
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange({ ...value, paragraphs: next });
  }

  return (
    <div>
      <Field
        id="story-heading"
        spec={STORY_HEADING_FIELD}
        value={value.heading}
        onChange={(next) => onChange({ ...value, heading: next })}
        problems={headingProblems}
      />

      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with the story's paragraphs"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {value.paragraphs.map((paragraph, index) => {
          const isFirst = index === 0;
          const isLast = index === value.paragraphs.length - 1;
          const rowProblems = problems.filter((p) => paragraphIndexOf(p.field) === index);
          return (
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move paragraph ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move paragraph ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove paragraph ${index + 1}`}
                  onClick={() => onChange({ ...value, paragraphs: value.paragraphs.filter((_, i) => i !== index) })}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  Remove
                </button>
              </div>
              <Field
                id={`story-paragraph-${index}`}
                spec={{ label: `Paragraph ${index + 1}`, kind: 'textarea' }}
                value={paragraph}
                onChange={(next) =>
                  onChange({ ...value, paragraphs: value.paragraphs.map((p, i) => (i === index ? next : p)) })
                }
                problems={rowProblems}
              />
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => onChange({ ...value, paragraphs: [...value.paragraphs, ''] })}
        className={ADD_BUTTON_CLASSNAME}
      >
        Add a paragraph
      </button>
    </div>
  );
}

export default StoryForm;
