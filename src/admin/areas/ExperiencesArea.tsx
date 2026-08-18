// The Experiences panel -- Phase 3, Task 8. Follows AwardsArea.tsx's shape
// exactly (see that file's own header): SectionErrorBoundary wrapping
// CollapsibleSection wrapping a section component that loads through
// fetchContent, registers via registerLoaded, validates via useValidation,
// and commits via registry.updateData. The list itself is RecordList over
// EXPERIENCE_FIELDS (fields.ts).
//
// Three differences from AwardsArea, each its own comment below:
//
// 1. No ContentNotFoundError branch. experiences.json is a committed file
//    that has existed since Task 2 (src/content/experiences.json), so
//    fetchContent never 404s for it -- AwardsArea's 404-as-empty-list
//    handling exists only because awards.json is a D1 row that does not
//    exist until the first publish, and copying that branch here would be
//    dead code that reads like a real case.
// 2. onAdd produces a coming-soon item, never a real card -- see
//    blankExperience below.
// 3. onRemove is offered (RecordList always renders it; there is no prop to
//    hide it). That is correct here: a coming-soon item she added is hers to
//    delete, unlike a page, which may have a live URL linked from outside.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import RecordList from '../RecordList';
import Thumbnail from '../manage/Thumbnail';
import { fetchContent } from '../content';
import { EXPERIENCE_FIELDS } from '../fields';
import { replaceAt, useValidation } from '../useValidation';
import { fromStagedPhoto } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Experience } from '../../content/types';
import type { AreaProps } from './area-props';

const ExperiencesArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked, previews }) => (
  <SectionErrorBoundary name="Experiences">
    <CollapsibleSection id="experiences" heading="Experiences" locked={publishLocked}>
      <ExperiencesSection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
    </CollapsibleSection>
  </SectionErrorBoundary>
);

type ExperiencesLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Experience[]; sha: string };

function ExperiencesSection({
  registry,
  restoreDraft,
  stage,
  previews,
}: {
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
  stage: (key: string, file: StagedFile | null) => void;
  previews: ImagePreviews;
}) {
  const [state, setState] = useState<ExperiencesLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('experiences.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'experiences.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // No ContentNotFoundError branch here -- see this file's own header
        // comment for why that 404-as-empty-list case does not apply.
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('experiences.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading experiences…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load experiences: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = state.sha;
  function commit(next: Experience[]) {
    registry.updateData('experiences.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <RecordList<Experience>
      fields={EXPERIENCE_FIELDS}
      items={items}
      onChange={(index, next) => commit(replaceAt(items, index, next))}
      onReorder={(ids) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        commit(ids.map((id) => byId.get(id) as Experience));
      }}
      onAdd={() => {
        const blank = blankExperience();
        commit([...items, blank]);
        return blank.id;
      }}
      onRemove={(index) => commit(items.filter((_, i) => i !== index))}
      noun="coming-soon item"
      itemLabel={(item) => item.title || 'Untitled item'}
      problems={problems}
      onStaged={(key, staged) => stage(`experiences.json:${key}`, fromStagedPhoto(staged))}
      thumbnail={(item) => (
        <Thumbnail path={item.image ?? null} previewKey={`experiences.json:${item.id}:image`} previews={previews} />
      )}
      previews={previews}
      previewKeyPrefix="experiences.json"
      scope="experiences"
    />
  );
}

// The spec's own replacement for "Add a page". A new item is ALWAYS
// coming-soon: `comingSoon: true` and no `link` at all. She cannot create a
// real page (PageList.tsx's own Add button is gone -- see that file's own
// comment), so a freshly added item has nowhere it could legitimately point,
// and validateExperience refuses a not-coming-soon item with no link -- so
// seeding it any other way would hand her a record that is invalid the
// instant it appears.
//
// `image` is `''` rather than omitted, unlike blankAward's optional badge:
// Experience['image'] is required, and an omitted key would fail
// validateKnownKeys' shape check before she ever saw the field. Blank means
// the debounced validation immediately tells her a photo is needed, which is
// the same treatment every other required field on a fresh record gets.
function blankExperience(): Experience {
  return { id: crypto.randomUUID(), title: '', description: '', image: '', comingSoon: true };
}

export default ExperiencesArea;
