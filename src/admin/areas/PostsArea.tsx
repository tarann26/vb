// The Posts panel -- Phase 5B. PagesArea/AwardsArea shape for shape:
// SectionErrorBoundary wrapping CollapsibleSection wrapping a section that
// loads through fetchContent, registers via registerLoaded, validates via
// useValidation and commits through registry.updateData.
//
// The heading comes from PANELS.posts (manage/areas.ts) rather than a
// literal, which makes this the first panel whose painted heading actually
// depends on that constant. Every sibling repeats the string, which is why a
// rename there is caught only by panel-snapshots.test.tsx and
// owner-facing-labels.test.tsx -- two files that catch it for reasons
// unrelated to the rename.
//
// The 404 branch: awards.json needed one because no award had ever been
// published. posts.json needs one for a different reason and it is worth
// naming, because it is a WINDOW rather than a first-run state -- Task 9
// moves the live copy to D1, and between that flip and
// scripts/seed-posts-d1.mjs running there is no row. A 404 in that window
// must read as "no posts yet", not as a failure in front of her.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import PostList from '../PostList';
import { PANELS } from '../manage/areas';
import { fetchContent, ContentNotFoundError } from '../content';
import { replaceAt, useValidation } from '../useValidation';
import { fromStagedPhoto } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Post } from '../../content/types';
import type { AreaProps } from './area-props';

const PostsArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked, previews }) => (
  <SectionErrorBoundary name={PANELS.posts.heading}>
    <CollapsibleSection id="posts" heading={PANELS.posts.heading} locked={publishLocked}>
      <PostsSection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
    </CollapsibleSection>
  </SectionErrorBoundary>
);

type PostsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Post[]; sha: string };

function PostsSection({
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
  const [state, setState] = useState<PostsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('posts.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'posts.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ContentNotFoundError) {
          // `sha: ''` is a real, load-bearing sentinel and never a value GET
          // /api/content hands back for any file -- buildPublishRequest
          // (publish.ts) reads it back out and omits `baseSha` entirely for
          // the first publish this makes. Not a placeholder and not a
          // fabricated sha, both of which would break the concurrency guard.
          const data = registerLoaded(registry, 'posts.json', { data: [], sha: '' }, restoreDraft);
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
  const problems = useValidation('posts.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading posts…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load posts: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = state.sha;
  function commit(next: Post[]) {
    registry.updateData('posts.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <PostList
      items={items}
      onChange={(index, next) => commit(replaceAt(items, index, next))}
      onReorder={(ids) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        commit(ids.map((id) => byId.get(id) as Post));
      }}
      onAdd={() => commit([...items, blankPost()])}
      onRemove={(index) => commit(items.filter((_, i) => i !== index))}
      problems={problems}
      onStaged={(key, staged) => stage(`posts.json:${key}`, fromStagedPhoto(staged))}
      previews={previews}
    />
  );
}

// A blank starting point for "Add a post": every required field present, so
// the freshly-added record renders and immediately shows her, through the
// same debounced validation as everything else, exactly what it still needs.
// AwardsArea's blankAward posture, with one difference.
//
// The difference is `date`, and it is pre-filled rather than left empty. A
// date input with nothing in it is the one field on this form whose empty
// state gives her no hint about the format it wants, and today is very
// nearly always the right answer for a post she is writing now. Every other
// field is genuinely better left blank, because the validator's own sentence
// is a better prompt than a made-up value would be.
//
// `blocks: []` on purpose: validatePost refuses an empty block list with
// "has nothing in it yet -- add a paragraph before publishing it", which is
// exactly the sentence that should be on screen next to the block picker the
// moment she adds a post.
function blankPost(): Post {
  return {
    id: crypto.randomUUID(),
    slug: '',
    type: 'story',
    title: '',
    date: new Date().toISOString().slice(0, 10),
    excerpt: '',
    image: '',
    blocks: [],
  };
}

export default PostsArea;
