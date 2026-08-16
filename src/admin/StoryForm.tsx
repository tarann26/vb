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
import { CHEF_FIELDS, STORY_HEADING_FIELD } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import { fromStagedPhoto, type StagedFile } from './staged';
import type { ImagePreviews } from './previews';
import type { StoryContent } from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface StoryFormProps {
  value: StoryContent;
  onChange: (next: StoryContent) => void;
  // The FULL story.json problem list, unfiltered -- the same contract every
  // other list/form in this dashboard already documents on its own
  // `problems` prop.
  problems: ValidationProblem[];
  // Phase 4: the byline's portrait is a real upload, so this form now needs
  // the same two seams every other photo-carrying screen already takes.
  // The key shape is `story.json:chef:portrait` -- file, then record, then
  // field, exactly the convention staged.ts's own comment records for
  // ArraySection and GalleryList.
  stage: (key: string, file: StagedFile | null) => void;
  previews: ImagePreviews;
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

function StoryForm({ value, onChange, problems, stage, previews }: StoryFormProps) {
  const headingProblems = problems.filter((p) => p.field === 'heading');
  const chefProblems = problems.filter((p) => p.field.startsWith('chef.'));

  // Defends against exactly the gap this task exists to close: an /edit
  // draft saved before `chef` existed on StoryContent restores through
  // registerLoaded's own unchecked `draftEntry.data as ContentTypeMap[K]`
  // cast (register-loaded.ts) with NO `chef` key at all, so `value.chef` is
  // `undefined` at runtime despite `StoryContent`'s type saying otherwise.
  // Reading `value.chef.name` straight off `value` would throw during
  // render -- and the only error boundary between this component and the
  // page is per-SECTION (SectionErrorBoundary's own header comment on
  // exactly this class of bug) -- so an unguarded read would not leave her
  // with four fixable `chef.*` fields, it would take the WHOLE About panel
  // down, heading and paragraphs included, which is worse than the
  // no-form-UI gap this task is closing. validateStory
  // (src/content/validate.ts) already treats a missing `chef` the same way,
  // through its own `asRecord()` fallback; this mirrors that at the read
  // boundary rather than inventing a second rule.
  const chef = value.chef ?? { name: '', role: '', portrait: '', portraitAlt: '' };

  // The bare `paragraphs` message (validateStory's "the About section needs
  // at least one paragraph", only reachable when the list IS empty) plus any
  // indexed problem naming a paragraph this screen isn't currently
  // rendering -- the same "nowhere else for this to go" reasoning
  // RecordList's own unclaimedProblems documents.
  const banner = problems.filter((p) => {
    if (p.field === 'heading') return false;
    if (p.field.startsWith('chef.')) return false;
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
      {/* Above the heading and the paragraphs: this is the part of the About
          panel she can finish without reading anything, and putting it under
          six textareas would mean scrolling past the hard part to reach the
          easy one. */}
      <div className="mb-6 rounded border border-gray-200 p-4">
        <Field
          id="story-chef-name"
          spec={CHEF_FIELDS.name}
          value={chef.name}
          onChange={(next) => onChange({ ...value, chef: { ...chef, name: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.name')}
        />
        <Field
          id="story-chef-role"
          spec={CHEF_FIELDS.role}
          value={chef.role}
          onChange={(next) => onChange({ ...value, chef: { ...chef, role: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.role')}
        />
        <Field
          id="story-chef-portrait"
          spec={CHEF_FIELDS.portrait}
          value={chef.portrait}
          onChange={(next) => onChange({ ...value, chef: { ...chef, portrait: next ?? '' } })}
          onStaged={(staged) => stage('story.json:chef:portrait', fromStagedPhoto(staged))}
          previews={previews}
          previewKey="story.json:chef:portrait"
          // Review finding: the live site (OurStory.tsx) shows this photo
          // as a circle, not the dashboard's default square. She judges her
          // own crop by what she sees while editing -- `rounded-full` is
          // not new CSS, it is already shipped for OurStory.tsx's own
          // byline and many other circular elements across the site.
          previewClassName="mb-2 h-24 w-24 rounded-full border border-gray-300 object-cover"
          problems={chefProblems.filter((p) => p.field === 'chef.portrait')}
        />
        <Field
          id="story-chef-portrait-alt"
          spec={CHEF_FIELDS.portraitAlt}
          value={chef.portraitAlt}
          onChange={(next) => onChange({ ...value, chef: { ...chef, portraitAlt: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.portraitAlt')}
        />
      </div>

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
          aria-label="Problems with the About section's paragraphs"
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
