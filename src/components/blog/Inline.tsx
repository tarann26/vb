// Phase 5. One markdown string, rendered as React elements.
//
// This is the half of the XSS boundary that faces the DOM.
// src/content/markdown.ts turns the string into an AST of plain values; this
// turns those values into elements. React sets every text child through
// textContent, which never re-parses -- so a <script> a visitor pasted into
// a comment, or the owner pasted out of an email, is six words on a page.
// src/test/html-sinks.test.ts is what keeps that true, by failing the build
// if any shipped module so much as NAMES a parsing sink.
//
// It renders a bare fragment with no wrapper element, so the caller owns the
// surrounding tag -- a paragraph block wraps it in <p>, a list item in <li>,
// a heading in <h2>. A wrapper here would make a heading contain a paragraph.
//
// NO CLASS on <strong>, <em>, <code>, <s> or <u>, and that is measured rather
// than stylistic. Tailwind's preflight already ships `b,strong{font-weight:bolder}`
// and `code,kbd,samp,pre{font-family:ui-monospace,...}`, and has no `em` rule
// at all, so <em> is slanted by the browser's own default. Adding the three
// obvious utilities would cost 0, 26 and 111 bytes of stylesheet against a
// 145-byte budget for no visible change whatsoever. The same holds for the
// two marks Task 13 added: preflight has no `s` or `u` rule either, so the
// line through and the line under come from the browser, and a full rebuild
// measured the entry stylesheet unmoved at 38836 bytes with these two cases
// present.
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { parseInline, type InlineNode } from '../../content/markdown';

const LINK_CLASSNAME = 'text-accent underline hover:text-accent-dark';
const CODE_CLASSNAME = 'rounded-sm bg-brand/15 px-1';

function renderNodes(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, i));
}

function renderNode(node: InlineNode, key: number): ReactNode {
  switch (node.kind) {
    case 'text':
      // A bare string inside an array needs no key -- React only warns for
      // elements. src/test/no-missing-react-keys.test.tsx checks the real
      // rendered output rather than the source, so this is safe and checked.
      return node.value;
    case 'strong':
      return <strong key={key}>{renderNodes(node.children)}</strong>;
    case 'em':
      return <em key={key}>{renderNodes(node.children)}</em>;
    case 'strike':
      return <s key={key}>{renderNodes(node.children)}</s>;
    case 'underline':
      return <u key={key}>{renderNodes(node.children)}</u>;
    case 'code':
      return (
        <code key={key} className={CODE_CLASSNAME}>
          {node.value}
        </code>
      );
    case 'link':
      // Two kinds of link, told apart by the leading slash the parser has
      // already validated. A site-relative one goes through react-router so
      // a reader following it from inside a post keeps their session, their
      // scroll restoration and the bundle they already downloaded; an
      // off-site one is a plain anchor with the same target/rel pair
      // BlogTeaser.tsx has always used.
      return node.href.startsWith('/') ? (
        <Link key={key} to={node.href} className={LINK_CLASSNAME}>
          {renderNodes(node.children)}
        </Link>
      ) : (
        <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASSNAME}>
          {renderNodes(node.children)}
        </a>
      );
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

export interface InlineProps {
  text: string;
}

export default function Inline({ text }: InlineProps) {
  return <Fragment>{renderNodes(parseInline(text))}</Fragment>;
}
