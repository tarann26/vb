// The Story & Photos area: the photo galleries, the About prose, and her
// blog.
//
// Two files here plus the Posts panel, one thing to her. The Press panel that
// stood beside them is gone (backlog item 17): the blog superseded it, its
// content file was read by nothing a visitor could reach, and a panel that
// edits a file nothing renders is a place to spend an afternoon for no effect. Every panel body below was MOVED here from
// AdminApp.tsx, byte-identical apart from imports -- see
// src/admin/__tests__/panel-snapshots.test.tsx.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import GalleryList from '../GalleryList';
import StoryForm from '../StoryForm';
import { fetchContent } from '../content';
import { useValidation } from '../useValidation';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Galleries, StoryContent } from '../../content/types';
import type { AreaProps } from './area-props';

const StoryPhotosArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked, previews }) => (
  <>
    <SectionErrorBoundary name="Galleries">
      <CollapsibleSection id="galleries" heading="Galleries" locked={publishLocked}>
        <GallerySection stage={stage} registry={registry} restoreDraft={restoreDraft} previews={previews} />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="About">
      <CollapsibleSection id="story" heading="About" locked={publishLocked}>
        <StorySection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
      </CollapsibleSection>
    </SectionErrorBoundary>
  </>
);

// galleries.json's own screen -- fetches the whole file (atmosphere,
// ourStory, heroCollage all live in the one file) and hands it whole to
// GalleryList.tsx, the same fetch-whole-hold-whole shape ArraySection/
// HoursSection above already use.
type GalleriesLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Galleries; sha: string };

function GallerySection({
  stage,
  registry,
  restoreDraft,
  previews,
}: {
  stage: (key: string, file: StagedFile | null) => void;
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
  previews: ImagePreviews;
}) {
  const [state, setState] = useState<GalleriesLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('galleries.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'galleries.json', loaded, restoreDraft);
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
  const problems = useValidation('galleries.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading galleries…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load galleries: ${state.message}`}
      </p>
    );
  }

  return (
    <>
      <GalleryList
        value={state.data}
        onChange={(next) => {
          registry.updateData('galleries.json', next);
          setState({ status: 'loaded', data: next, sha: state.sha });
        }}
        problems={problems}
        stage={stage}
        previews={previews}
      />
    </>
  );
}

// story.json's own screen -- see StoryForm.tsx's own header comment for why
// the paragraph list is a bespoke component rather than routed through
// FieldsOf/RecordForm.
type StoryLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: StoryContent; sha: string };

function StorySection({
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
  const [state, setState] = useState<StoryLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('story.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'story.json', loaded, restoreDraft);
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
  const problems = useValidation('story.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading the story…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load the story: ${state.message}`}
      </p>
    );
  }

  return (
    <>
      <StoryForm
        value={state.data}
        onChange={(next) => {
          registry.updateData('story.json', next);
          setState({ status: 'loaded', data: next, sha: state.sha });
        }}
        problems={problems}
        stage={stage}
        previews={previews}
      />
    </>
  );
}

export default StoryPhotosArea;
