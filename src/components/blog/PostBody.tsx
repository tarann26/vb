// Phase 5. A post's blocks, in order, inside the one column the whole body
// reads in. `max-w-3xl` rather than the `max-w-7xl` every homepage section
// uses: a section is a grid of cards and a post is a column of prose, and
// prose past about 75 characters a line is measurably harder to read.
import { Fragment } from 'react';
import { BlockView } from './blocks';
import type { Block } from '../../content/types';

export interface PostBodyProps {
  blocks: Block[];
}

export default function PostBody({ blocks }: PostBodyProps) {
  return (
    <>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          <BlockView block={block} />
        </Fragment>
      ))}
    </>
  );
}
