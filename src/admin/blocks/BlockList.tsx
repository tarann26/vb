// Phase 5B, Task 4: the block half of the problem partition, and only that.
// Task 5 turns this into the real per-block editor.
//
// It exists in this shape rather than as an empty component because
// PostList.tsx filters block problems out of the post form in this same
// commit, and a filter with nothing on the other side of it is a silent
// loss -- the failure RecordList's own unclaimedProblems comment calls
// worse than a message in the wrong place. So from the first commit, every
// message reaches her; Task 5 only improves WHERE.
import { blockProblemOf } from './block-problems';
import type { Block } from '../../content/types';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

export interface BlockListProps {
  blocks: Block[];
  // Which post in the list, so this component can pick its own problems out
  // of the whole file's list without the caller pre-slicing (the same
  // "hand it everything" contract RecordList takes, for the same reason).
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

// Three names destructured out of seven declared, and the interface keeps all
// seven on purpose: Task 5 needs the final shape so PostList's call site never
// changes again, and eslint's no-unused-vars only objects to a name actually
// bound here. Deleting the four from the interface would be the change this
// avoids.
export default function BlockList({ postIndex, problems }: BlockListProps) {
  const mine = problems.filter((p) => blockProblemOf(p.field)?.post === postIndex);
  if (mine.length === 0) return null;
  return (
    <div
      role="alert"
      aria-label="Problems with this post’s content"
      className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
    >
      <ul className="list-disc pl-5">
        {mine.map((p, i) => (
          <li key={i}>{p.message}</li>
        ))}
      </ul>
    </div>
  );
}
