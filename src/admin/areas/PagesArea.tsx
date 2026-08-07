// The Pages area: the six business pages she can create, and what shows on
// the homepage.
//
// Both panel bodies below were MOVED here from AdminApp.tsx, byte-identical
// apart from imports -- see src/admin/__tests__/panel-snapshots.test.tsx.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import SectionList from '../SectionList';
import TemplateSectionList from '../TemplateSectionList';
import PageList from '../PageList';
import { fetchContent } from '../content';
import { replaceAt, useValidation } from '../useValidation';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { BespokeSection, Page, Section, TemplateSection } from '../../content/types';
import type { AreaProps } from './area-props';

const PagesArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked }) => (
  <>
    <SectionErrorBoundary name="Pages">
      <CollapsibleSection id="pages" heading="Pages" locked={publishLocked}>
        <PagesSection registry={registry} restoreDraft={restoreDraft} stage={stage} />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="Homepage sections">
      <CollapsibleSection id="sections" heading="Homepage sections" locked={publishLocked}>
        <SectionsSection registry={registry} restoreDraft={restoreDraft} stage={stage} />
      </CollapsibleSection>
    </SectionErrorBoundary>
  </>
);

type PagesLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Page[]; sha: string };

// pages.json's own screen (Plan 7, Task 4, Step 3): the dashboard's first
// nested list-of-records -- each Page's own `sections` is itself a list.
// D6 applies here too: Add, never Remove, on the pages themselves (the same
// invariant TemplateSectionList's own header comment documents for
// sections). See PageList.tsx's own header comment for how it reuses
// TemplateSectionList for each page's own nested `sections`, and for the
// GalleryList.tsx `useRowIds` limitation Plan 6's own ledger found (a
// commit path that creates `{...entry, changed}` mints a new object and
// orphans a WeakMap-keyed id) -- and why this screen avoids it by keying
// staged uploads on PATH, not object identity, the same fix EditMode.tsx's
// own `resolveImageTarget` already uses for the identical reason.
function PagesSection({
  registry,
  restoreDraft,
  stage,
}: {
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
  stage: (key: string, file: StagedFile | null) => void;
}) {
  const [state, setState] = useState<PagesLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('pages.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'pages.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('pages.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading pages…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load pages: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: Page[]) {
    registry.updateData('pages.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <>
      <PageList items={items} onChange={commit} problems={problems} stage={stage} />
    </>
  );
}

type SectionsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Section[]; sha: string };

// sections.json's own screen: the seven bespoke entries (reorder/toggle
// only, matching SectionList's own D6-driven contract -- no Add, no Remove,
// see that file's own header comment) PLUS, since Plan 7 Task 4, every
// template section, through TemplateSectionList -- reorder, toggle, Add,
// edit content, still no Remove. Deliberately NOT built on the generic
// ArraySection above for the bespoke half: that component always renders
// RecordList's Add/Remove buttons unconditionally (RecordList itself has no
// prop to hide either one), which would let this screen build a state
// assertSections refuses -- see SectionList.tsx's own header for why
// reorder/toggle alone cannot.
function SectionsSection({
  registry,
  restoreDraft,
  stage,
}: {
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
  stage: (key: string, file: StagedFile | null) => void;
}) {
  const [state, setState] = useState<SectionsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('sections.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'sections.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('sections.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading sections…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load sections: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: Section[]) {
    registry.updateData('sections.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // Plan 7, Task 1: SectionList.tsx only ever shows/permutes the seven
  // bespoke entries (see its own comment) -- `bespokeItems` is that
  // narrowed view. `templateItems` (Task 4) is everything else in the real
  // sections.json array, now its own TemplateSectionList below. Order
  // between the two groups is not preserved across a write (every bespoke
  // entry is written back before every template one) -- both screens'
  // reorder/toggle/Add operate within their own group only, so this is a
  // stable, known limitation, not a regression risk: nothing in either
  // group's own read/write ever depends on interleaving with the other.
  const bespokeItems = items.filter((item): item is BespokeSection => item.kind === 'bespoke');
  const templateItems = items.filter((item): item is TemplateSection => item.kind === 'template');

  return (
    <>
      <SectionList
        items={bespokeItems}
        onChange={(index, next) => commit([...replaceAt(bespokeItems, index, next), ...templateItems])}
        onReorder={(ids) => {
          const byId = new Map(bespokeItems.map((item) => [item.id, item]));
          commit([...ids.map((id) => byId.get(id) as BespokeSection), ...templateItems]);
        }}
        problems={problems}
      />
      <h3 className="mb-4 mt-8 font-['Montserrat'] text-base uppercase tracking-wide text-[#222]">
        Homepage template sections
      </h3>
      <TemplateSectionList
        items={templateItems}
        onChange={(index, next) => commit([...bespokeItems, ...replaceAt(templateItems, index, next)])}
        onReorder={(ids) => {
          const byId = new Map(templateItems.map((item) => [item.id, item]));
          commit([...bespokeItems, ...ids.map((id) => byId.get(id) as TemplateSection)]);
        }}
        onAdd={(section) => commit([...bespokeItems, ...templateItems, section])}
        problems={problems}
        rowPrefix={(index) => `[${bespokeItems.length + index}]`}
        idPrefix="section"
        stage={stage}
      />
    </>
  );
}

export default PagesArea;
