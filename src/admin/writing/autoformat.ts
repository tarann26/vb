// The five things typing produces, and nothing else.
//
// Each fires only in a PARAGRAPH's own `text` slot: typing "- " inside a list
// item is her writing a dash, not asking for a list inside a list, and typing
// "# " in a photograph's caption is a hash.
//
// A numbered list always starts at 1, whatever number she typed. `numberList`
// carries no start index and blocks.tsx renders it with the browser's own
// numbering, so "7. " opening a list at 1 is the honest behaviour rather than
// a defect -- there is nowhere to store the 7.
import type { Block } from '../../content/types';
import type { Slot } from './slots';

const TRIGGERS: readonly { readonly pattern: RegExp; readonly make: (rest: string) => Block }[] = [
  { pattern: /^\d+\.$/, make: (rest) => ({ kind: 'numberList', items: [rest] }) },
  { pattern: /^[-*]$/, make: (rest) => ({ kind: 'bulletList', items: [rest] }) },
  { pattern: /^#$/, make: (rest) => ({ kind: 'heading', text: rest }) },
  { pattern: /^>$/, make: (rest) => ({ kind: 'quote', text: rest }) },
];

export function autoformat(block: Block, slotKey: Slot['key'], before: string, after: string): Block | null {
  if ((block as { kind?: unknown }).kind !== 'paragraph') return null;
  if (slotKey !== 'text') return null;
  const trigger = TRIGGERS.find((entry) => entry.pattern.test(before));
  return trigger === undefined ? null : trigger.make(after);
}

// THE ESCAPE HATCH, and it is the reflex one: Backspace immediately after a
// conversion puts the trigger characters and the space back, and leaves the
// paragraph a paragraph.
//
// Something has to do this. Without it a sentence that legitimately opens
// "1. " -- a price, a date, a quoted list, "1. 50 for a coffee" -- could never
// be written at all, because every attempt would silently become a numbered
// list. That is the kind of defect nobody reports, because from the outside it
// looks as though the editor is simply like that.
//
// Backspace rather than a backslash prefix, for two reasons. It is what every
// editor that does this already does, so it is the first thing her hands will
// try; and a backslash would have to be a convention she was told about, in a
// surface whose whole point is that it behaves like writing anywhere else.
// Undo would have served too, and it does not exist yet (Task 20) -- when it
// does, this stays, because reaching for undo after a conversion is a second
// reflex and not a replacement for the first.
export function revertFormat(before: string, after: string): Block {
  return { kind: 'paragraph', text: `${before} ${after}` };
}
