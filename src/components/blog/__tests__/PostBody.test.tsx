import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PostBody from '../PostBody';
import type { Block } from '../../../content/types';

const BLOCKS: Block[] = [
  { kind: 'heading', text: 'First' },
  { kind: 'paragraph', text: 'Second' },
  { kind: 'numberList', items: ['Third'] },
];

describe('PostBody', () => {
  it('renders every block in order', () => {
    const { container } = render(
      <MemoryRouter>
        <PostBody blocks={BLOCKS} />
      </MemoryRouter>,
    );
    const tags = [...container.querySelectorAll('h2, p, ol')].map((el) => el.tagName.toLowerCase());
    expect(tags).toEqual(['h2', 'p', 'ol']);
  });

  it('renders nothing at all for an empty block list, rather than an empty wrapper', () => {
    const { container } = render(
      <MemoryRouter>
        <PostBody blocks={[]} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe('');
  });
});
