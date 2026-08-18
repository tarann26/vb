// The other half of dom-inline.ts: markdown source into an editable slot's
// DOM, element by element. Same rule -- no markup string is ever constructed,
// and this module names no parsing sink (src/test/html-sinks.test.ts).
import { parseInline, type InlineNode } from '../../content/markdown';

const TAG_OF: Record<'strong' | 'em' | 'strike' | 'underline', string> = {
  strong: 'strong', em: 'em', strike: 's', underline: 'u',
};

function inlineNodeToDom(node: InlineNode, doc: Document): Node {
  switch (node.kind) {
    case 'text':
      return doc.createTextNode(node.value);
    case 'code': {
      const el = doc.createElement('code');
      el.appendChild(doc.createTextNode(node.value));
      return el;
    }
    case 'strong': case 'em': case 'strike': case 'underline': {
      const el = doc.createElement(TAG_OF[node.kind]);
      node.children.forEach((child) => el.appendChild(inlineNodeToDom(child, doc)));
      return el;
    }
    case 'link': {
      const el = doc.createElement('a');
      // The parser already refused anything isSafeHref does not accept
      // (markdown.ts:302), so this attribute can only hold a passed target.
      el.setAttribute('href', node.href);
      node.children.forEach((child) => el.appendChild(inlineNodeToDom(child, doc)));
      return el;
    }
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

// Replaces everything in the slot. The caller is responsible for never
// calling this on a slot that currently holds the caret -- WritingSurface.tsx
// owns that rule, and EditableText.tsx:109-124 is where it was first paid for.
export function writeInline(hostEl: HTMLElement, source: string): void {
  const doc = hostEl.ownerDocument;
  hostEl.textContent = '';
  parseInline(source).forEach((node) => hostEl.appendChild(inlineNodeToDom(node, doc)));
}
