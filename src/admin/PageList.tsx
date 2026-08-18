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
//
// Task 6: PageList moves to ItemList + EditorSheet, the same list+editor
// shape every other panel in this dashboard has taken. Open state is keyed
// on the page's own `slug`, not its array index -- editing the slug field
// re-points it in the same tick (below), the same "key on the thing she can
// change" rule Task 4 already applied to a menu id.
import { useState } from 'react';
import Field from './Field';
import SectionList from './SectionList';
import TemplateSectionList from './TemplateSectionList';
import EditorSheet from './manage/EditorSheet';
import ItemList, { type ItemRow } from './manage/ItemList';
import { PAGE_FIELDS, PAGE_SEO_FIELDS } from './fields';
import type { BespokeSection, Page, TemplateSection } from '../content/types';
import type { ValidationProblem } from '../content/validate';
import type { StagedFile } from './staged';
import type { ImagePreviews } from './previews';

export interface PageListProps {
  items: Page[];
  onChange: (next: Page[]) => void;
  // The FULL pages.json problem list, unfiltered -- the same
  // not-pre-filtered contract every list in this dashboard already
  // documents.
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
  // Forwarded, untouched, to the TemplateContentForm this list renders --
  // whose item-list and gallery-image rows DO get a thumbnail. This list's
  // OWN rows deliberately get none: a page and a homepage section have no
  // image field, and a placeholder box on a row that can never hold a
  // picture is decoration.
  previews?: ImagePreviews;
}

function PageList({ items, onChange, problems, stage, previews }: PageListProps) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const openIndex = openSlug === null ? -1 : items.findIndex((p) => p.slug === openSlug);
  const open = openIndex === -1 ? undefined : items[openIndex];

  function patchAt(index: number, patch: Partial<Page>): void {
    onChange(items.map((page, i) => (i === index ? { ...page, ...patch } : page)));
  }

  const problemsOf = (index: number): ValidationProblem[] => {
    const pagePrefix = `[${index}]`;
    return problems.filter(
      (p) => p.field === pagePrefix || p.field.startsWith(`${pagePrefix}.`) || p.field.startsWith(`${pagePrefix}[`),
    );
  };

  // The partition (D4): `shown` is everything the open editor's own fields
  // will place; `banner` is everything else, which with no editor open is
  // EVERY page's own problems.
  const shown = open === undefined ? [] : problemsOf(openIndex);
  const banner = problems.filter((p) => !shown.includes(p));

  const rows: ItemRow[] = items.map((page, index) => ({
    id: page.slug,
    name: page.name || page.slug,
    needsAttention: problemsOf(index).length > 0,
  }));

  const idPrefix = open === undefined ? '' : `page-${openIndex}`;
  const pagePrefix = open === undefined ? '' : `[${openIndex}]`;

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with this list"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* No `onMove`: the staged key every `stage(...)` call in this file and
          in TemplateContentForm.tsx composes is `page-<index>:...`,
          positional (see this file's own header comment). Reordering pages
          while an upload is staged already orphans it today under the old
          Up/Down buttons -- adding drag here would widen that same hole
          rather than open a new one, and this task is not the place to fix
          the key shape. `onAdd` is also omitted: "Add a page" was removed
          deliberately (see the comment that used to sit at the foot of this
          file, below), and the button PageList shows is never more than the
          four real pages plus their own editors. */}
      <ItemList rows={rows} onOpen={setOpenSlug} />

      {open !== undefined && (
        <EditorSheet title={open.name || open.slug} onClose={() => setOpenSlug(null)}>
          <label htmlFor={`${idPrefix}-enabled`} className="flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
            <input
              id={`${idPrefix}-enabled`}
              type="checkbox"
              checked={open.enabled}
              onChange={(event) => patchAt(openIndex, { enabled: event.target.checked })}
              className="h-5 w-5 rounded border-gray-300"
            />
            Shown on the site
          </label>
          {/* M4 review fix: turning this off stops the page from being
              REACHABLE (it 404s, drops out of the nav and the sitemap),
              but its name, address, SEO text and section content still
              ship inside the published site's own code either way.
              Nothing in this dashboard withholds content from the
              published bundle -- everything committed is published --
              so "hidden" here means unreachable, never secret, and this
              sentence has to say so rather than implying a privacy the
              site cannot give her. Written directly here, not in
              PAGE_FIELDS.enabled's own `help` (fields.ts) -- this
              checkbox is hand-rolled, not routed through Field, so a
              FieldSpec's own `help` string is never rendered for it. */}
          <p className="mb-4 mt-1 max-w-md font-['Montserrat'] text-xs text-gray-500">
            Turning this off stops visitors from reaching the page and removes it from the navigation menu and the
            sitemap -- but its address, name, SEO text and section content are still part of the published
            site's own code either way. It is hidden, not private: do not put anything here you would mind a
            determined visitor reading.
          </p>
          <Field
            id={`${idPrefix}-slug`}
            spec={PAGE_FIELDS.slug}
            value={open.slug}
            onChange={(next) => {
              // Re-points the open key in the SAME tick the slug changes, so
              // the editor she is looking at does not read as having closed
              // out from under her -- the same move Task 4 Step 2 makes for a
              // menu id.
              patchAt(openIndex, { slug: next });
              setOpenSlug(next);
            }}
            problems={shown.filter((p) => p.field === `${pagePrefix}.slug`)}
          />
          <Field
            id={`${idPrefix}-name`}
            spec={PAGE_FIELDS.name}
            value={open.name}
            onChange={(next) => patchAt(openIndex, { name: next })}
            problems={shown.filter((p) => p.field === `${pagePrefix}.name`)}
          />
          <label htmlFor={`${idPrefix}-inNav`} className="mb-4 flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
            <input
              id={`${idPrefix}-inNav`}
              type="checkbox"
              checked={open.inNav}
              onChange={(event) => patchAt(openIndex, { inNav: event.target.checked })}
              className="h-5 w-5 rounded border-gray-300"
            />
            Shown in the navigation menu
          </label>
          <Field
            id={`${idPrefix}-seo-title`}
            spec={PAGE_SEO_FIELDS.title}
            value={open.seo.title}
            onChange={(next) => patchAt(openIndex, { seo: { ...open.seo, title: next } })}
            problems={shown.filter((p) => p.field === `${pagePrefix}.seo.title`)}
          />
          <Field
            id={`${idPrefix}-seo-description`}
            spec={PAGE_SEO_FIELDS.description}
            value={open.seo.description}
            onChange={(next) => patchAt(openIndex, { seo: { ...open.seo, description: next } })}
            problems={shown.filter((p) => p.field === `${pagePrefix}.seo.description`)}
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
            const pageBespoke = open.sections.filter((s): s is BespokeSection => s.kind === 'bespoke');
            const pageTemplate = open.sections.filter((s): s is TemplateSection => s.kind === 'template');
            function commitSections(bespoke: BespokeSection[], template: TemplateSection[]) {
              patchAt(openIndex, { sections: [...bespoke, ...template] });
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
                  previews={previews}
                />
              </>
            );
          })()}
        </EditorSheet>
      )}

      {/* "Add a page" was removed deliberately (Phase 3, and the spec's own
          decision, not an implementation choice): a general page builder is
          the thing that makes a dashboard frightening to a non-technical
          owner. She still edits every word, price, fact and photo on the
          four real pages above; what she cannot do is create a fifth. "Add
          a coming-soon item" in the Experiences panel is what took its place
          -- a carousel card with a photo, a title and a description and no
          route behind it -- and Taran builds a real page when one is
          genuinely needed.

          Removing the BUTTON, not the capability underneath: PageList still
          commits whatever array it is handed, so a page added by any other
          means still renders, and validatePages still checks it. This is a
          UI decision enforced at the UI, which is the right layer for it --
          putting a "maximum four pages" rule in the validator would refuse a
          page Taran added on purpose. */}
    </div>
  );
}

export default PageList;
