// Plan 7, Task 4, Step 1: "Add a section" -- and the invariant it breaks on
// purpose. SectionList.tsx's own D6-driven header comment is still true for
// the seven bespoke entries (reorder/toggle only, no add, no remove); this
// is the NEW screen, for template sections specifically, that actually adds
// Add. Reused by both AdminApp.tsx's own SectionsSection (the homepage's
// sections.json) and PageList.tsx (each page's own `sections`) -- see
// TemplateSectionListProps' own comment on `rowPrefix` for how the same
// component addresses validation problems correctly in either context.
//
// Still no Remove button anywhere (D6: "nothing is ever deleted, only
// disabled") -- a template section she no longer wants is switched off,
// exactly like a bespoke one.
import { useState } from 'react';
import Field from './Field';
import TemplateContentForm from './TemplateContentForm';
import { TEMPLATE_SECTION_ID_FIELD } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME } from './RecordList';
import type { TemplateSection, TemplateType } from '../content/types';
import type { ValidationProblem } from '../content/validate';
import type { StagedFile } from './staged';

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  text: 'Text',
  itemList: 'Item list',
  gallery: 'Gallery',
  detailBlock: 'Detail block',
};

// A separate literal from TEMPLATE_LABELS above, not `Add a
// ${label.toLowerCase()} section` -- "item list" needs "an", not "a"
// ("Add an item list section"), and deriving grammar from a label meant
// for a different spot (the row's own type tag) is more fragile than
// simply saying what each button reads.
const ADD_BUTTON_LABELS: Record<TemplateType, string> = {
  text: 'Add a text section',
  itemList: 'Add an item list section',
  gallery: 'Add a gallery section',
  detailBlock: 'Add a detail block section',
};

// One TEMPLATE_TYPES-complete literal, the same `Record<TemplateType, true>`
// idiom guards.ts's own TEMPLATE_TYPE_SET documents in full -- adding a
// TemplateType without a matching key here fails to compile, which is what
// keeps TEMPLATE_LABELS (and therefore the four "Add a ___ section" buttons
// below) unable to silently fall one member behind guards.ts's own set.
const TEMPLATE_TYPE_COMPLETENESS: Record<TemplateType, true> = {
  text: true,
  itemList: true,
  gallery: true,
  detailBlock: true,
};
const ADDABLE_TEMPLATES = Object.keys(TEMPLATE_TYPE_COMPLETENESS) as TemplateType[];

// A blank starting point for "Add a ___ section" -- every field a fresh
// TemplateSection needs, present and empty/neutral, the same "renders
// immediately and shows her, via the same debounced validation as
// everything else, exactly what it still needs" contract blankDish/
// blankDrink/blankArticle (AdminApp.tsx) already document. `id` is a fresh
// UUID, not something she types before adding -- TEMPLATE_SECTION_ID_FIELD
// (fields.ts) is rendered on the resulting row so she can rename it
// immediately, the same "add now, refine after" flow Add already has for
// every other record type in this dashboard.
//
// Exported alongside this file's default component export -- the same
// "genuinely needs to live here, not split into a second file just to
// satisfy a lint rule" posture EditMode.tsx's own `buildBundle` takes (see
// that export's comment): PageList.tsx and AdminApp.tsx's own SectionsSection
// both need this exact factory, and `blankTemplateSection` is a pure
// function with no React state or hooks of its own, so Fast Refresh has
// nothing to lose track of here either.
// eslint-disable-next-line react-refresh/only-export-components
export function blankTemplateSection(template: TemplateType): TemplateSection {
  const id = crypto.randomUUID();
  switch (template) {
    case 'text':
      return { kind: 'template', id, enabled: true, template, content: { heading: '', paragraphs: [''] } };
    case 'itemList':
      return { kind: 'template', id, enabled: true, template, content: { heading: '', items: [] } };
    case 'gallery':
      return { kind: 'template', id, enabled: true, template, content: { heading: '', layout: 'scroll', images: [] } };
    case 'detailBlock':
      return { kind: 'template', id, enabled: true, template, content: { heading: '', body: '', facts: [] } };
    default: {
      const _exhaustive: never = template;
      throw new Error(`blankTemplateSection: unknown template "${String(_exhaustive)}"`);
    }
  }
}

export interface TemplateSectionListProps {
  items: TemplateSection[];
  onChange: (index: number, next: TemplateSection) => void;
  onReorder: (ids: string[]) => void;
  onAdd: (section: TemplateSection) => void;
  // The FULL file's problem list, unfiltered -- the same not-pre-filtered
  // contract every list in this dashboard already documents.
  problems: ValidationProblem[];
  // Builds this row's own address in validate.ts's field-naming scheme,
  // from this list's own index -- `(i) => `[${i}]`` for sections.json
  // itself, or `(i) => `[${pageIndex}].sections[${i}]`` for one page's own
  // list (see validateSectionEntry's own comment, validate.ts, for why both
  // shapes share this addressing). Passed in rather than hardcoded so this
  // ONE component serves both callers without knowing which it is.
  rowPrefix: (index: number) => string;
  // DOM id namespacing, the same "file minus extension" role ArraySection's
  // own `scope` plays (AdminApp.tsx) -- e.g. `sections` for the homepage,
  // `page-0-sections` for a page, so two lists on the same admin page never
  // collide on generated ids.
  idPrefix: string;
  stage: (key: string, file: StagedFile | null) => void;
}

function TemplateSectionList({ items, onChange, onReorder, onAdd, problems, rowPrefix, idPrefix, stage }: TemplateSectionListProps) {
  // Which row (by array index) currently shows its own content form --
  // collapsed by default, the same reasoning EditableImage/CollageTile's
  // own single-open-panel-at-a-time posture documents: a homepage with a
  // dozen template sections would otherwise be an unreadable wall of forms
  // the instant this screen loads.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function swap(index: number, otherIndex: number): void {
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    ids[index] = ids[otherIndex];
    ids[otherIndex] = moved;
    onReorder(ids);
  }

  return (
    <div>
      <ul>
        {items.map((section, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isOpen = openIndex === index;
          const path = rowPrefix(index);
          const rowProblems = problems.filter((p) => p.field === path || p.field.startsWith(`${path}.`) || p.field.startsWith(`${path}[`));
          // I3 review fix: keyed on `section.id`, never on `index`. This
          // string is what becomes the STAGE KEY prefix for any photo
          // staged inside this row (via TemplateContentForm's own `idPrefix`
          // prop, below -- see `stage(\`${idPrefix}:item-${index}:image\`,
          // ...)` there). An index-keyed prefix names a POSITION, not a
          // section -- stage a photo on the section at index 0, move it
          // down (a reorder writes new array positions, never new ids), and
          // the section now AT index 0 inherits the first section's own
          // stage-key prefix. Staging a second photo there then evicts the
          // first section's own staged bytes from staged.ts's key->file map
          // (`stage` overwrites by key), while that first section's OWN
          // `contentPath` is already written into sections.json -- publish
          // uploads `Object.keys(staged)`, so the commit ends up pointing at
          // a file that was never uploaded: a broken image on the live
          // homepage. `section.id` names the record itself, stable across a
          // reorder exactly the way every other reorderable list in this
          // dashboard already keys (GalleryList.tsx's own `useRowIds`, or --
          // here -- React's own `key={section.id}` on this very `<li>`,
          // three lines below this one). Safe to use directly in a DOM id
          // string: C1's own fix (guards.ts's assertSectionEntry,
          // validate.ts's validateSectionEntry) now constrains every
          // template section id to the same URL-safe-slug alphabet a page's
          // own slug already uses (letters a-z, numbers, hyphens), so this
          // can never contain whitespace or any character an `id` attribute
          // would choke on.
          const rowId = `${idPrefix}-${section.id}`;
          return (
            <li key={section.id} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <span className="font-['Montserrat'] text-base text-[#222]">{section.id}</span>
                  <span className="ml-2 text-xs text-gray-500">{TEMPLATE_LABELS[section.template]}</span>
                </div>
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move ${section.id} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move ${section.id} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className={MOVE_BUTTON_CLASSNAME}
                  >
                    {isOpen ? 'Close' : 'Edit'}
                  </button>
                </div>
              </div>
              <label htmlFor={`${rowId}-enabled`} className="flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
                <input
                  id={`${rowId}-enabled`}
                  type="checkbox"
                  checked={section.enabled}
                  onChange={(event) => onChange(index, { ...section, enabled: event.target.checked })}
                  className="h-5 w-5 rounded border-gray-300"
                />
                Shown
              </label>
              {isOpen && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <Field
                    id={`${rowId}-id`}
                    spec={TEMPLATE_SECTION_ID_FIELD}
                    value={section.id}
                    onChange={(next) => onChange(index, { ...section, id: next })}
                    problems={rowProblems.filter((p) => p.field === `${path}.id`)}
                  />
                  <TemplateContentForm
                    section={section}
                    onChange={(next) => onChange(index, next)}
                    rowPrefix={path}
                    problems={problems}
                    idPrefix={rowId}
                    stage={stage}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {ADDABLE_TEMPLATES.map((template) => (
          <button
            key={template}
            type="button"
            onClick={() => onAdd(blankTemplateSection(template))}
            className={ADD_BUTTON_CLASSNAME}
          >
            {ADD_BUTTON_LABELS[template]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default TemplateSectionList;
