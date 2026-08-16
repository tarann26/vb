// The Story & Photos area: the photo galleries, the About prose, and
// press coverage.
//
// Three files, one thing to her. Every panel body below was MOVED here from
// AdminApp.tsx, byte-identical apart from imports -- see
// src/admin/__tests__/panel-snapshots.test.tsx.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import ArraySection from '../sections/ArraySection';
import { registerLoaded } from '../sections/register-loaded';
import GalleryList from '../GalleryList';
import StoryForm from '../StoryForm';
import { fetchContent } from '../content';
import { ARTICLE_FIELDS } from '../fields';
import { useValidation } from '../useValidation';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Article, Galleries, StoryContent } from '../../content/types';
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
        <StorySection registry={registry} restoreDraft={restoreDraft} />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="Press">
      <CollapsibleSection id="press" heading="Press" locked={publishLocked}>
        <ArraySection<Article>
          file="press.json"
          load={() => fetchContent('press.json')}
          heading="Press"
          noun="article"
          fields={ARTICLE_FIELDS}
          itemLabel={(article) => article.title || 'Untitled article'}
          makeBlank={blankArticle}
          imageField={{ key: 'image', path: (article) => article.image }}
          previews={previews}
          stage={stage}
          registry={registry}
          restoreDraft={restoreDraft}
        />
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

function StorySection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
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
      />
    </>
  );
}

// A blank starting point for "Add an article" -- every required field
// present and empty/neutral, so the freshly-added record renders and
// immediately shows her, through the same debounced validation as everything
// else, exactly what it still needs.
function blankArticle(): Article {
  return { id: crypto.randomUUID(), title: '', publication: '', date: '', excerpt: '', url: null, image: '' };
}

export default StoryPhotosArea;
