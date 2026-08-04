// Plan 7, Task 4, Step 3: pages.json's own screen -- the dashboard's first
// nested list-of-records. Every page is one row (Add, never Remove -- D6),
// and each page's own `sections` is itself an addable/reorderable list,
// rendered through TemplateSectionList.tsx unchanged (the exact same
// component the homepage's own template sections use, see that file's own
// header comment on why it is shared rather than forked).
//
// GalleryList.tsx's own `useRowIds` (a WeakMap keyed on object identity) is
// NOT reused here, on purpose -- Plan 6's own ledger found its limit: a
// commit path that creates `{...entry, changed}` mints a fresh object and
// silently orphans a WeakMap-keyed id, evicting the wrong staged upload.
// EditMode.tsx's own `resolveImageTarget` sidesteps the identical problem
// by keying a staged photo on its renderImage PATH instead -- stable across
// an edit because it names a SLOT (this page, this section, this image
// index), not an object reference. Every `stage(...)` call in this file and
// in TemplateContentForm.tsx follows that same precedent: `page-<index>:...`
// or `<sectionRowId>:item-<n>:image`, never an id minted from a WeakMap.
import { useState } from 'react';
import Field from './Field';
import SectionList from './SectionList';
import TemplateSectionList from './TemplateSectionList';
import { PAGE_FIELDS, PAGE_SEO_FIELDS } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME } from './RecordList';
import type { BespokeSection, Page, TemplateSection } from '../content/types';
import type { ValidationProblem } from '../content/validate';
import type { StagedFile } from './staged';

export interface PageListProps {
  items: Page[];
  onChange: (next: Page[]) => void;
  // The FULL pages.json problem list, unfiltered -- the same
  // not-pre-filtered contract every list in this dashboard already
  // documents.
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
}

// A blank starting point for "Add a page" -- name and SEO fields start
// empty (the debounced validator explains what's still needed, the same
// "renders immediately" contract every other Add already has), `inNav` and
// `enabled` both start FALSE so a freshly-added, still-unfinished page
// cannot appear on the live site or in its nav by accident -- unlike a
// dish or a drink, a half-written PAGE is a URL a visitor (or a crawler)
// could actually land on.
function blankPage(): Page {
  return {
    slug: crypto.randomUUID(),
    name: '',
    inNav: false,
    enabled: false,
    seo: { title: '', description: '' },
    sections: [],
  };
}

function PageList({ items, onChange, problems, stage }: PageListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function swap(index: number, otherIndex: number): void {
    const next = items.slice();
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  function patchAt(index: number, patch: Partial<Page>): void {
    onChange(items.map((page, i) => (i === index ? { ...page, ...patch } : page)));
  }

  return (
    <div>
      <ul>
        {items.map((page, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isOpen = openIndex === index;
          const pagePrefix = `[${index}]`;
          const pageProblems = problems.filter(
            (p) => p.field === pagePrefix || p.field.startsWith(`${pagePrefix}.`) || p.field.startsWith(`${pagePrefix}[`),
          );
          const idPrefix = `page-${index}`;
          return (
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <span className="font-['Montserrat'] text-base text-[#222]">{page.name || 'Untitled page'}</span>
                  <span className="ml-2 text-xs text-gray-500">{`/${page.slug}`}</span>
                </div>
                <div className="flex gap-2">
                  {!isFirst && (
                    <button type="button" aria-label={`Move page ${index + 1} up`} onClick={() => swap(index, index - 1)} className={MOVE_BUTTON_CLASSNAME}>
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button type="button" aria-label={`Move page ${index + 1} down`} onClick={() => swap(index, index + 1)} className={MOVE_BUTTON_CLASSNAME}>
                      Down
                    </button>
                  )}
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenIndex(isOpen ? null : index)} className={MOVE_BUTTON_CLASSNAME}>
                    {isOpen ? 'Close' : 'Edit'}
                  </button>
                </div>
              </div>
              <label htmlFor={`${idPrefix}-enabled`} className="flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
                <input
                  id={`${idPrefix}-enabled`}
                  type="checkbox"
                  checked={page.enabled}
                  onChange={(event) => patchAt(index, { enabled: event.target.checked })}
                  className="h-5 w-5 rounded border-gray-300"
                />
                Shown on the site
              </label>
              {isOpen && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <Field
                    id={`${idPrefix}-slug`}
                    spec={PAGE_FIELDS.slug}
                    value={page.slug}
                    onChange={(next) => patchAt(index, { slug: next })}
                    problems={pageProblems.filter((p) => p.field === `${pagePrefix}.slug`)}
                  />
                  <Field
                    id={`${idPrefix}-name`}
                    spec={PAGE_FIELDS.name}
                    value={page.name}
                    onChange={(next) => patchAt(index, { name: next })}
                    problems={pageProblems.filter((p) => p.field === `${pagePrefix}.name`)}
                  />
                  <label htmlFor={`${idPrefix}-inNav`} className="mb-4 flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
                    <input
                      id={`${idPrefix}-inNav`}
                      type="checkbox"
                      checked={page.inNav}
                      onChange={(event) => patchAt(index, { inNav: event.target.checked })}
                      className="h-5 w-5 rounded border-gray-300"
                    />
                    Shown in the navigation menu
                  </label>
                  <Field
                    id={`${idPrefix}-seo-title`}
                    spec={PAGE_SEO_FIELDS.title}
                    value={page.seo.title}
                    onChange={(next) => patchAt(index, { seo: { ...page.seo, title: next } })}
                    problems={pageProblems.filter((p) => p.field === `${pagePrefix}.seo.title`)}
                  />
                  <Field
                    id={`${idPrefix}-seo-description`}
                    spec={PAGE_SEO_FIELDS.description}
                    value={page.seo.description}
                    onChange={(next) => patchAt(index, { seo: { ...page.seo, description: next } })}
                    problems={pageProblems.filter((p) => p.field === `${pagePrefix}.seo.description`)}
                  />
                  <h4 className="mb-2 mt-4 font-['Montserrat'] text-sm uppercase tracking-wide text-[#222]">This page's sections</h4>
                  {(() => {
                    // A page's own `sections` may mix bespoke and template
                    // entries (Page's own comment, types.ts -- reusing, say,
                    // `visit`'s map-and-hours block on a new page is a real,
                    // supported shape, just not one this screen offers an
                    // "add a bespoke section" affordance for -- there is no
                    // picker UI for it anywhere in this plan, only the
                    // content model's own support for a hand-authored one).
                    // Kept bespoke-first, template-second, on every write --
                    // the same convention AdminApp.tsx's own SectionsSection
                    // documents for sections.json, so `rowPrefix` below can
                    // compute each template row's real index in the
                    // underlying array without re-deriving the split.
                    const pageBespoke = page.sections.filter((s): s is BespokeSection => s.kind === 'bespoke');
                    const pageTemplate = page.sections.filter((s): s is TemplateSection => s.kind === 'template');
                    function commitSections(bespoke: BespokeSection[], template: TemplateSection[]) {
                      patchAt(index, { sections: [...bespoke, ...template] });
                    }
                    return (
                      <>
                        {pageBespoke.length > 0 && (
                          <SectionList
                            items={pageBespoke}
                            onChange={(bi, next) => commitSections(pageBespoke.map((s, i) => (i === bi ? next : s)), pageTemplate)}
                            onReorder={(ids) => {
                              const byId = new Map(pageBespoke.map((s) => [s.id, s]));
                              commitSections(ids.map((id) => byId.get(id) as BespokeSection), pageTemplate);
                            }}
                            // Recorded limitation, not an oversight: a
                            // bespoke section reused on a page has no
                            // per-page validation problem this screen
                            // addresses today (there is no "add a bespoke
                            // section to a page" affordance for one to ever
                            // reach validateContent from here in the first
                            // place -- see this block's own comment above).
                            problems={[]}
                          />
                        )}
                        <TemplateSectionList
                          items={pageTemplate}
                          onChange={(ti, next) => commitSections(pageBespoke, pageTemplate.map((s, i) => (i === ti ? next : s)))}
                          onReorder={(ids) => {
                            const byId = new Map(pageTemplate.map((s) => [s.id, s]));
                            commitSections(pageBespoke, ids.map((id) => byId.get(id) as TemplateSection));
                          }}
                          onAdd={(section) => commitSections(pageBespoke, [...pageTemplate, section])}
                          problems={problems}
                          rowPrefix={(ti) => `${pagePrefix}.sections[${pageBespoke.length + ti}]`}
                          idPrefix={`${idPrefix}-sections`}
                          stage={stage}
                        />
                      </>
                    );
                  })()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => onChange([...items, blankPage()])} className={ADD_BUTTON_CLASSNAME}>
        Add a page
      </button>
    </div>
  );
}

export default PageList;
