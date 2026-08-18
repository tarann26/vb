// Phase 5. One React component per block kind, dispatched through one
// exhaustive switch -- so an eleventh kind added to BlockContentMap
// (src/content/types.ts) is a `tsc -b` failure naming this file, not a block
// that silently renders nothing on a live page. The same guarantee
// src/App.tsx's own renderSection has for template sections.
//
// EVERY class below except `list-decimal` was already in the shipped
// stylesheet before this task, verified against a real `npx vite build` of
// main at 1184f5a. `list-decimal` is the phase's only new rule, +38 bytes
// against a 145-byte budget, and it is load-bearing: Tailwind's preflight
// ships `ol,ul,menu{list-style:none;margin:0;padding:0}`, so an ordered list
// with no marker utility renders as unnumbered lines. `list-disc` was
// already present (RecordList.tsx's problem banner uses it).
//
// Nothing here uses a slant utility, a bold utility or a monospace utility:
// preflight already slants <em>, bolds <strong> and monospaces <code>. See
// Inline.tsx.
import { type ReactNode } from 'react';
import Inline from './Inline';
import { formatArticleDate } from '../../content/article-date';
import type { Block } from '../../content/types';

const BLOCK_SPACING = 'mb-6';
const PROSE = "font-['Open_Sans'] text-gray-700 leading-relaxed";
const LIST = `${BLOCK_SPACING} pl-5 space-y-2 ${PROSE}`;

function Paragraph({ text }: { text: string }) {
  return <p className={`${BLOCK_SPACING} ${PROSE}`}><Inline text={text} /></p>;
}

// h2, never h1. The post's own title is the page's single h1 (PostPage.tsx);
// a level field on the block would let her produce an h4 under an h2 with
// nothing in between, which is a real accessibility defect and buys a
// distinction she has no reason to want.
function Heading({ text }: { text: string }) {
  return (
    <h2 className={`mt-10 mb-4 font-['Montserrat'] text-2xl font-bold text-ink`}>
      <Inline text={text} />
    </h2>
  );
}

function Items({ items }: { items: string[] }): ReactNode {
  return items.map((item, i) => (
    <li key={i}>
      <Inline text={item} />
    </li>
  ));
}

interface ListNode { text: string; children: ListNode[] }

// The flat pair the storage keeps -- words in one array, depths in another --
// read back as the tree HTML needs, because a sub-list is a list INSIDE the
// item above it and not a sibling of it. A `<ul>` whose parent is another
// `<ul>` is invalid markup that browsers and screen readers each repair their
// own way.
//
// `levels` absent means every item sits at depth 0, which is every list
// committed before nesting existed, so this returns them unchanged.
//
// THE CLAMP TO `stack.length` IS LOAD-BEARING, not defensive tidiness. A
// `levels` of `[0, 2]` passes both boundaries -- each entry is a whole number
// inside the cap and the two arrays are the same length -- and without the
// clamp `stack[depth - 1]` is `undefined` on the second item and the whole
// post page throws instead of rendering. One step of nesting is the honest
// reading of a jump nobody could have produced by pressing Tab.
function nest(items: string[], levels: number[] | undefined): ListNode[] {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  items.forEach((text, i) => {
    const depth = Math.min(levels?.[i] ?? 0, stack.length);
    const node: ListNode = { text, children: [] };
    stack.length = depth;
    if (depth === 0) roots.push(node);
    else stack[depth - 1].children.push(node);
    stack.push(node);
  });
  return roots;
}

// A sub-list wears the same element and the same marker as the list it sits
// in, and its own step of padding. Every one of these four utilities already
// has a rule in the shipped sheet -- `pl-5` and `space-y-2` from LIST above,
// `mt-2` from the figure caption below -- so nesting costs no new rule. It
// deliberately does not repeat BLOCK_SPACING: that is the gap BETWEEN blocks,
// and a sub-list is inside one.
const NESTED_LIST = 'mt-2 pl-5 space-y-2';

// One <li> per node, with the whole sub-tree INSIDE the item it belongs to.
// A <ul> that is a direct child of another <ul> is invalid markup, and
// browsers and screen readers each repair it their own way.
function ListTree({ nodes, tag, markerClass }: { nodes: ListNode[]; tag: 'ul' | 'ol'; markerClass: string }): ReactNode {
  const Tag = tag;
  return nodes.map((node, i) => (
    <li key={i}>
      <Inline text={node.text} />
      {node.children.length > 0 && (
        <Tag className={`${markerClass} ${NESTED_LIST}`}>
          <ListTree nodes={node.children} tag={tag} markerClass={markerClass} />
        </Tag>
      )}
    </li>
  ));
}

function Figure({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className={BLOCK_SPACING}>
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-2xl object-cover" />
      {/* No empty figcaption for an uncaptioned photo: an empty element is
          still an element to a screen reader, and the caption is genuinely
          optional (validatePosts never requires one). */}
      {caption.trim().length > 0 && (
        <figcaption className={`mt-2 text-center font-['Open_Sans'] text-sm text-gray-500`}>
          <Inline text={caption} />
        </figcaption>
      )}
    </figure>
  );
}

export function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return <Paragraph text={block.text} />;
    case 'heading':
      return <Heading text={block.text} />;
    case 'bulletList':
      return (
        <ul className={`list-disc ${LIST}`}>
          <ListTree nodes={nest(block.items, block.levels)} tag="ul" markerClass="list-disc" />
        </ul>
      );
    case 'numberList':
      return (
        <ol className={`list-decimal ${LIST}`}>
          <ListTree nodes={nest(block.items, block.levels)} tag="ol" markerClass="list-decimal" />
        </ol>
      );
    case 'image':
      return <Figure src={block.src} alt={block.alt} caption={block.caption ?? ''} />;
    case 'gallery':
      // Three columns from the 640px breakpoint up, not the 768px one: a
      // class for the smaller breakpoint already ships in this bundle and
      // one for the larger would be a new rule. Two across on a phone, three
      // from 640px up. A fixed height rather than an aspect-ratio utility
      // for the same reason.
      return (
        <div className={`${BLOCK_SPACING} grid grid-cols-2 sm:grid-cols-3 gap-4`}>
          {block.images.map((image, i) => (
            <img
              key={i}
              src={image.src}
              alt={image.alt}
              loading="lazy"
              className="w-full h-40 object-cover rounded-lg"
            />
          ))}
        </div>
      );
    case 'quote':
      return (
        <blockquote className={`${BLOCK_SPACING} border-l-4 border-brand pl-4`}>
          <p className={`font-['Open_Sans'] text-lg text-gray-700 leading-relaxed`}>
            <Inline text={block.text} />
          </p>
          {(block.attribution ?? '').trim().length > 0 && (
            <cite className={`mt-2 block font-['Montserrat'] text-sm text-accent`}>
              <Inline text={block.attribution ?? ''} />
            </cite>
          )}
        </blockquote>
      );
    case 'ingredients':
      return (
        <div className={`${BLOCK_SPACING} rounded-2xl bg-cream p-6`}>
          <h3 className={`mb-3 font-['Montserrat'] text-lg font-bold text-ink`}>{block.heading}</h3>
          <ul className={`list-disc pl-5 space-y-2 ${PROSE}`}>{Items({ items: block.items })}</ul>
        </div>
      );
    case 'steps':
      // An ORDERED list, and that is the entire difference from ingredients
      // above: the order of a step is information, the order of an
      // ingredient is not.
      return (
        <div className={`${BLOCK_SPACING} rounded-2xl bg-cream p-6`}>
          <h3 className={`mb-3 font-['Montserrat'] text-lg font-bold text-ink`}>{block.heading}</h3>
          <ol className={`list-decimal pl-5 space-y-3 ${PROSE}`}>{Items({ items: block.items })}</ol>
        </div>
      );
    case 'citation':
      return (
        <p className={`${BLOCK_SPACING} rounded-lg border border-gray-200 p-4 font-['Open_Sans'] text-sm text-gray-600`}>
          {`${block.publication}, ${formatArticleDate(block.date)}`}
          {block.url !== null && (
            <>
              {' '}
              <a
                href={block.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline hover:text-accent-dark"
              >
                Read it
              </a>
            </>
          )}
        </p>
      );
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}
