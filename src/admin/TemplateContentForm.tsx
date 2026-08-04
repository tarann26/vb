// Plan 7, Task 4, Step 2: one TemplateSection's own `content`, dispatched by
// `template` -- the first place this dashboard renders a genuinely
// DISCRIMINATED descriptor (see fields.ts's own header comment on the four
// TEXT_TEMPLATE_FIELDS/ITEM_LIST_TEMPLATE_FIELDS/GALLERY_TEMPLATE_FIELDS/
// DETAIL_BLOCK_TEMPLATE_FIELDS for why there is no single FieldsOf<TemplateContent>).
// `section` is threaded through WHOLE (not split into `template`/`content`
// props) so TypeScript keeps `section.content`'s type tied to
// `section.template` all the way to the onChange call below -- see
// TemplateSection's own comment (types.ts) for the mapped-type trick that
// makes that narrowing hold together at every call site, this one included.
import Field from './Field';
import PhotoField from './PhotoField';
import {
  TEXT_TEMPLATE_FIELDS,
  ITEM_LIST_TEMPLATE_FIELDS,
  GALLERY_TEMPLATE_FIELDS,
  GALLERY_LAYOUT_FIELD,
  DETAIL_BLOCK_TEMPLATE_FIELDS,
  TEMPLATE_LIST_ITEM_FIELDS,
  TEMPLATE_FACT_FIELDS,
  WHATSAPP_BUTTON_FIELDS,
} from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import type { StagedFile } from './staged';
import { fromStagedPhoto } from './staged';
import type {
  TemplateSection,
  TemplateListItem,
  GalleryImage,
  TemplateFact,
  TemplateWhatsAppButton,
} from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface TemplateContentFormProps {
  section: TemplateSection;
  onChange: (next: TemplateSection) => void;
  // The row's own path prefix in validate.ts's addressing, e.g. `[2]` for
  // sections.json's third entry, or `[1].sections[0]` for a page's own
  // first section -- see validateSectionEntry's own comment
  // (src/content/validate.ts) for why both shapes share this exact scheme.
  // This component appends `.content` itself and narrows `problems`
  // (the FULL, unfiltered file list -- the same not-pre-filtered contract
  // every list in this dashboard already documents) down to what's inside
  // it.
  rowPrefix: string;
  problems: ValidationProblem[];
  idPrefix: string;
  stage: (key: string, file: StagedFile | null) => void;
}

function matches(field: string, path: string): boolean {
  return field === path || field.startsWith(`${path}[`) || field.startsWith(`${path}.`);
}

function leafProblems(problems: ValidationProblem[], path: string): ValidationProblem[] {
  return problems.filter((p) => p.field === path);
}

// The same "delete the key, don't set it to undefined" contract
// RecordForm.tsx's own `omitKey` and TemplateSectionList.tsx's own
// `omitPublishAt` already document in full: `{ ...content, whatsapp:
// undefined }` LEAVES THE KEY PRESENT with an undefined value (`'whatsapp'
// in result` stays true), which is not the same in-memory shape as never
// having had one, even though `JSON.stringify` happens to make the two
// look identical once serialized. Generic over every template's own
// content shape (all four carry an optional `whatsapp`), so the four call
// sites below share one implementation instead of four copies.
function withWhatsApp<T extends { whatsapp?: TemplateWhatsAppButton }>(
  content: T,
  whatsapp: TemplateWhatsAppButton | undefined,
): T {
  if (whatsapp === undefined) {
    const clone = { ...content };
    delete clone.whatsapp;
    return clone;
  }
  return { ...content, whatsapp };
}

function TemplateContentForm({ section, onChange, rowPrefix, problems, idPrefix, stage }: TemplateContentFormProps) {
  const contentPath = `${rowPrefix}.content`;
  const contentProblems = problems.filter((p) => matches(p.field, contentPath));
  const headingProblems = leafProblems(contentProblems, `${contentPath}.heading`);

  function renderWhatsApp(whatsapp: TemplateWhatsAppButton | undefined, onWhatsAppChange: (next: TemplateWhatsAppButton | undefined) => void) {
    const included = whatsapp !== undefined;
    const current: TemplateWhatsAppButton = whatsapp ?? { label: '', message: '' };
    const path = `${contentPath}.whatsapp`;
    return (
      <div className="mt-6 rounded border border-gray-200 p-4">
        <label className="mb-3 flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
          <input
            type="checkbox"
            checked={included}
            onChange={(event) => onWhatsAppChange(event.target.checked ? current : undefined)}
            className="h-5 w-5 rounded border-gray-300"
          />
          Include a WhatsApp button
        </label>
        {included && (
          <>
            <Field
              id={`${idPrefix}-whatsapp-label`}
              spec={WHATSAPP_BUTTON_FIELDS.label}
              value={current.label}
              onChange={(next) => onWhatsAppChange({ ...current, label: next })}
              problems={leafProblems(contentProblems, `${path}.label`)}
            />
            <Field
              id={`${idPrefix}-whatsapp-message`}
              spec={WHATSAPP_BUTTON_FIELDS.message}
              value={current.message}
              onChange={(next) => onWhatsAppChange({ ...current, message: next })}
              problems={leafProblems(contentProblems, `${path}.message`)}
            />
          </>
        )}
      </div>
    );
  }

  // A `switch` on the discriminant, matching every other exhaustive
  // dispatch in this plan (App.tsx's `renderSection`, guards.ts's
  // `assertTemplateContent`) -- not for its own sake, but because getting
  // this file's own narrowing to hold needed BOTH changes together,
  // confirmed directly: `section` (the component's own parameter) loses
  // its narrowed type the moment it is read inside a CLOSURE passed to
  // another function -- `renderWhatsApp`'s own callback argument here,
  // below -- regardless of whether the surrounding dispatch is `switch` or
  // sequential `if`s (TS's narrowing-through-closures rule doesn't trust a
  // parameter, only a `const` never reassigned). `self`, a fresh `const`
  // alias assigned once at the top of each case, is what actually fixes
  // it -- every `onChange({ ...self, ... })` below reads `self`, never
  // `section`, for exactly that reason.
  switch (section.template) {
  case 'text': {
    const self = section;
    const { content } = self;
    const path = `${contentPath}.paragraphs`;
    return (
      <div>
        <Field
          id={`${idPrefix}-heading`}
          spec={TEXT_TEMPLATE_FIELDS.heading}
          value={content.heading}
          onChange={(next) => onChange({ ...self, content: { ...content, heading: next } })}
          problems={headingProblems}
        />
        <ul>
          {content.paragraphs.map((paragraph, index) => (
            <li key={index} className="mb-3 rounded border border-gray-200 p-3">
              <div className="mb-2 flex gap-2">
                {index > 0 && (
                  <button
                    type="button"
                    aria-label={`Move paragraph ${index + 1} up`}
                    className={MOVE_BUTTON_CLASSNAME}
                    onClick={() => {
                      const next = content.paragraphs.slice();
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      onChange({ ...self, content: { ...content, paragraphs: next } });
                    }}
                  >
                    Up
                  </button>
                )}
                {index < content.paragraphs.length - 1 && (
                  <button
                    type="button"
                    aria-label={`Move paragraph ${index + 1} down`}
                    className={MOVE_BUTTON_CLASSNAME}
                    onClick={() => {
                      const next = content.paragraphs.slice();
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      onChange({ ...self, content: { ...content, paragraphs: next } });
                    }}
                  >
                    Down
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove paragraph ${index + 1}`}
                  className={REMOVE_BUTTON_CLASSNAME}
                  onClick={() =>
                    onChange({ ...self, content: { ...content, paragraphs: content.paragraphs.filter((_, i) => i !== index) } })
                  }
                >
                  Remove
                </button>
              </div>
              <Field
                id={`${idPrefix}-paragraph-${index}`}
                spec={{ label: `Paragraph ${index + 1}`, kind: 'textarea' }}
                value={paragraph}
                onChange={(next) =>
                  onChange({ ...self, content: { ...content, paragraphs: content.paragraphs.map((p, i) => (i === index ? next : p)) } })
                }
                problems={problems.filter((p) => p.field === `${path}[${index}]`)}
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={ADD_BUTTON_CLASSNAME}
          onClick={() => onChange({ ...self, content: { ...content, paragraphs: [...content.paragraphs, ''] } })}
        >
          Add a paragraph
        </button>
        {renderWhatsApp(content.whatsapp, (whatsapp) => onChange({ ...self, content: withWhatsApp(content, whatsapp) }))}
      </div>
    );
  }

  case 'itemList': {
    const self = section;
    const { content } = self;
    return (
      <div>
        <Field
          id={`${idPrefix}-heading`}
          spec={ITEM_LIST_TEMPLATE_FIELDS.heading}
          value={content.heading}
          onChange={(next) => onChange({ ...self, content: { ...content, heading: next } })}
          problems={headingProblems}
        />
        <ul>
          {content.items.map((item, index) => {
            const itemPath = `${contentPath}.items[${index}]`;
            function patchItem(patch: Partial<TemplateListItem>) {
              onChange({
                ...self,
                content: { ...content, items: content.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) },
              });
            }
            return (
              <li key={index} className="mb-3 rounded border border-gray-200 p-3">
                <div className="mb-2 flex gap-2">
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move item ${index + 1} up`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.items.slice();
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onChange({ ...self, content: { ...content, items: next } });
                      }}
                    >
                      Up
                    </button>
                  )}
                  {index < content.items.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move item ${index + 1} down`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.items.slice();
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onChange({ ...self, content: { ...content, items: next } });
                      }}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove item ${index + 1}`}
                    className={REMOVE_BUTTON_CLASSNAME}
                    onClick={() => onChange({ ...self, content: { ...content, items: content.items.filter((_, i) => i !== index) } })}
                  >
                    Remove
                  </button>
                </div>
                <PhotoField
                  id={`${idPrefix}-item-${index}-image`}
                  label="Photo"
                  category="atmosphere"
                  value={item.image}
                  onChange={(next) => patchItem({ image: next ?? '' })}
                  onStaged={(staged) => stage(`${idPrefix}:item-${index}:image`, fromStagedPhoto(staged))}
                  problems={leafProblems(problems, `${itemPath}.image`)}
                />
                <Field
                  id={`${idPrefix}-item-${index}-name`}
                  spec={TEMPLATE_LIST_ITEM_FIELDS.name}
                  value={item.name}
                  onChange={(next) => patchItem({ name: next })}
                  problems={leafProblems(problems, `${itemPath}.name`)}
                />
                <Field
                  id={`${idPrefix}-item-${index}-description`}
                  spec={TEMPLATE_LIST_ITEM_FIELDS.description}
                  value={item.description}
                  onChange={(next) => patchItem({ description: next })}
                  problems={leafProblems(problems, `${itemPath}.description`)}
                />
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className={ADD_BUTTON_CLASSNAME}
          onClick={() => onChange({ ...self, content: { ...content, items: [...content.items, { image: '', name: '', description: '' }] } })}
        >
          Add an item
        </button>
        {renderWhatsApp(content.whatsapp, (whatsapp) => onChange({ ...self, content: withWhatsApp(content, whatsapp) }))}
      </div>
    );
  }

  case 'gallery': {
    const self = section;
    const { content } = self;
    return (
      <div>
        <Field
          id={`${idPrefix}-heading`}
          spec={GALLERY_TEMPLATE_FIELDS.heading}
          value={content.heading}
          onChange={(next) => onChange({ ...self, content: { ...content, heading: next } })}
          problems={headingProblems}
        />
        <Field
          id={`${idPrefix}-layout`}
          spec={GALLERY_LAYOUT_FIELD}
          value={content.layout}
          onChange={(next) => onChange({ ...self, content: { ...content, layout: next } })}
          problems={leafProblems(contentProblems, `${contentPath}.layout`)}
        />
        <ul>
          {content.images.map((image, index) => {
            const imagePath = `${contentPath}.images[${index}]`;
            function patchImage(patch: Partial<GalleryImage>) {
              onChange({
                ...self,
                content: { ...content, images: content.images.map((im, i) => (i === index ? { ...im, ...patch } : im)) },
              });
            }
            return (
              <li key={index} className="mb-3 rounded border border-gray-200 p-3">
                <div className="mb-2 flex gap-2">
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move image ${index + 1} up`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.images.slice();
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onChange({ ...self, content: { ...content, images: next } });
                      }}
                    >
                      Up
                    </button>
                  )}
                  {index < content.images.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move image ${index + 1} down`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.images.slice();
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onChange({ ...self, content: { ...content, images: next } });
                      }}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove image ${index + 1}`}
                    className={REMOVE_BUTTON_CLASSNAME}
                    onClick={() => onChange({ ...self, content: { ...content, images: content.images.filter((_, i) => i !== index) } })}
                  >
                    Remove
                  </button>
                </div>
                <PhotoField
                  id={`${idPrefix}-image-${index}-src`}
                  label="Photo"
                  category="atmosphere"
                  value={image.src}
                  onChange={(next) => patchImage({ src: next ?? '' })}
                  onStaged={(staged) => stage(`${idPrefix}:image-${index}:src`, fromStagedPhoto(staged))}
                  problems={leafProblems(problems, `${imagePath}.src`)}
                />
                <Field
                  id={`${idPrefix}-image-${index}-alt`}
                  spec={{ label: 'Alt text', kind: 'text', help: 'Describes the photo for screen readers and search engines.' }}
                  value={image.alt}
                  onChange={(next) => patchImage({ alt: next })}
                  problems={leafProblems(problems, `${imagePath}.alt`)}
                />
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className={ADD_BUTTON_CLASSNAME}
          onClick={() => onChange({ ...self, content: { ...content, images: [...content.images, { src: '', alt: '' }] } })}
        >
          Add a photo
        </button>
        {renderWhatsApp(content.whatsapp, (whatsapp) => onChange({ ...self, content: withWhatsApp(content, whatsapp) }))}
      </div>
    );
  }

  // section.template === 'detailBlock' -- the last TemplateType member.
  // Matching guards.ts's own assertTemplateContent (the identical
  // reasoning is spelled out there): a fifth TemplateType added without a
  // `case` here falls through to `default` below and fails to compile.
  case 'detailBlock': {
    const self = section;
    const { content } = self;
    return (
      <div>
        <Field
          id={`${idPrefix}-heading`}
          spec={DETAIL_BLOCK_TEMPLATE_FIELDS.heading}
          value={content.heading}
          onChange={(next) => onChange({ ...self, content: { ...content, heading: next } })}
          problems={headingProblems}
        />
        <Field
          id={`${idPrefix}-body`}
          spec={DETAIL_BLOCK_TEMPLATE_FIELDS.body}
          value={content.body}
          onChange={(next) => onChange({ ...self, content: { ...content, body: next } })}
          problems={leafProblems(contentProblems, `${contentPath}.body`)}
        />
        <ul>
          {content.facts.map((fact, index) => {
            const factPath = `${contentPath}.facts[${index}]`;
            function patchFact(patch: Partial<TemplateFact>) {
              onChange({
                ...self,
                content: { ...content, facts: content.facts.map((f, i) => (i === index ? { ...f, ...patch } : f)) },
              });
            }
            return (
              <li key={index} className="mb-3 rounded border border-gray-200 p-3">
                <div className="mb-2 flex gap-2">
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move fact ${index + 1} up`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.facts.slice();
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onChange({ ...self, content: { ...content, facts: next } });
                      }}
                    >
                      Up
                    </button>
                  )}
                  {index < content.facts.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move fact ${index + 1} down`}
                      className={MOVE_BUTTON_CLASSNAME}
                      onClick={() => {
                        const next = content.facts.slice();
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onChange({ ...self, content: { ...content, facts: next } });
                      }}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove fact ${index + 1}`}
                    className={REMOVE_BUTTON_CLASSNAME}
                    onClick={() => onChange({ ...self, content: { ...content, facts: content.facts.filter((_, i) => i !== index) } })}
                  >
                    Remove
                  </button>
                </div>
                <Field
                  id={`${idPrefix}-fact-${index}-label`}
                  spec={TEMPLATE_FACT_FIELDS.label}
                  value={fact.label}
                  onChange={(next) => patchFact({ label: next })}
                  problems={leafProblems(problems, `${factPath}.label`)}
                />
                <Field
                  id={`${idPrefix}-fact-${index}-value`}
                  spec={TEMPLATE_FACT_FIELDS.value}
                  value={fact.value}
                  onChange={(next) => patchFact({ value: next })}
                  problems={leafProblems(problems, `${factPath}.value`)}
                />
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className={ADD_BUTTON_CLASSNAME}
          onClick={() => onChange({ ...self, content: { ...content, facts: [...content.facts, { label: '', value: '' }] } })}
        >
          Add a fact
        </button>
        {renderWhatsApp(content.whatsapp, (whatsapp) => onChange({ ...self, content: withWhatsApp(content, whatsapp) }))}
      </div>
    );
  }

  default: {
    const _exhaustive: never = section;
    return _exhaustive;
  }
  }
}

export default TemplateContentForm;
