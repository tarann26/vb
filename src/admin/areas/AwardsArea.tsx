// The Awards panel -- Phase 2, Task 11, and the dashboard's first screen
// over a D1-backed file. It follows PagesArea.tsx's shape exactly (see that
// file's own header): SectionErrorBoundary wrapping CollapsibleSection
// wrapping a section component that loads through fetchContent, registers
// via registerLoaded, validates via useValidation, and commits via
// registry.updateData. The list itself is RecordList with RecordForm
// fields, the same id-carrying-record-with-an-optional-photo shape
// press.json's own screen already uses (StoryPhotosArea.tsx) -- AWARD_FIELDS
// (fields.ts) mirrors ARTICLE_FIELDS field for field.
//
// Rendered from the `pages` area (manage/areas.ts's own PANELS/AREAS), after
// "What shows on the homepage": Awards is a homepage section (SectionId
// 'awards', src/content/types.ts) the same way the bespoke/template sections
// above it are, so it belongs in "what shows on the homepage" to her, not in
// a sixth area of its own.
//
// The one real difference from every sibling screen: a brand-new document.
// `fetchContent('awards.json')` 404s (content.ts's own ContentNotFoundError)
// until the very first award is ever published -- every OTHER content file
// this dashboard reads has existed since before this feature did, so this
// is the first load effect anywhere in src/admin/ that has to treat "the
// file does not exist" as a normal, expected state rather than a failure.
// Treated as an empty list, sha `''` -- see publish.ts's own
// `buildPublishRequest` comment for why that empty string, not a fabricated
// or omitted sha, is what a first-ever publish of this file has to carry
// through the registry for the write side to stay safe.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import RecordList from '../RecordList';
import Thumbnail from '../manage/Thumbnail';
import { fetchContent, ContentNotFoundError } from '../content';
import { AWARD_FIELDS } from '../fields';
import { replaceAt, useValidation } from '../useValidation';
import { fromStagedPhoto } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Award } from '../../content/types';
import type { AreaProps } from './area-props';

const AwardsArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked, previews }) => (
  <SectionErrorBoundary name="Awards">
    <CollapsibleSection id="awards" heading="Awards" locked={publishLocked}>
      <AwardsSection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
    </CollapsibleSection>
  </SectionErrorBoundary>
);

type AwardsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Award[]; sha: string };

function AwardsSection({
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
  const [state, setState] = useState<AwardsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('awards.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'awards.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // The one branch every sibling screen doesn't need: a 404 here means
        // no award has ever been published, not a failure -- see this
        // file's own header comment. `sha: ''` is a real, load-bearing
        // sentinel (never a value GET /api/content itself hands back for
        // any file), not a placeholder -- registerLoaded/register carries
        // it into the registry exactly like any other sha, and
        // buildPublishRequest (publish.ts) is what reads it back out and
        // omits `baseSha` entirely for the first publish this makes.
        if (error instanceof ContentNotFoundError) {
          const data = registerLoaded(registry, 'awards.json', { data: [], sha: '' }, restoreDraft);
          setState({ status: 'loaded', data, sha: '' });
          return;
        }
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('awards.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading awards…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load awards: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = state.sha;
  function commit(next: Award[]) {
    registry.updateData('awards.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <RecordList<Award>
      fields={AWARD_FIELDS}
      items={items}
      onChange={(index, next) => commit(replaceAt(items, index, next))}
      onReorder={(ids) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        commit(ids.map((id) => byId.get(id) as Award));
      }}
      onAdd={() => {
        const blank = blankAward();
        commit([...items, blank]);
        return blank.id;
      }}
      onRemove={(index) => commit(items.filter((_, i) => i !== index))}
      noun="award"
      itemLabel={(award) => award.title || 'Untitled award'}
      problems={problems}
      onStaged={(key, staged) => stage(`awards.json:${key}`, fromStagedPhoto(staged))}
      thumbnail={(award) => (
        <Thumbnail path={award.image ?? null} previewKey={`awards.json:${award.id}:image`} previews={previews} />
      )}
      previews={previews}
      previewKeyPrefix="awards.json"
      scope="awards"
    />
  );
}

// A blank starting point for "Add an award" -- every required field present
// and empty, so the freshly-added record renders and immediately shows her,
// through the same debounced validation as everything else, exactly what it
// still needs. `image` is omitted entirely, not set to `''`: Award['image']
// is optional (types.ts), and validateAward (src/content/validate.ts) only
// objects to a PRESENT-but-blank image, never an absent one -- see
// AWARD_FIELDS.image's own comment (fields.ts) for why nothing in this
// dashboard's own UI can produce that state on her behalf regardless.
function blankAward(): Award {
  return { id: crypto.randomUUID(), title: '', awardedBy: '', year: '' };
}

export default AwardsArea;
