// Undo and redo as pure values, which is the whole reason this is a module
// and not a pile of refs inside the component: every claim below is about
// arrays and object identity, and jsdom's opinion about carets does not enter
// into any of them.
import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, record, redo, undo, type Snapshot } from '../history';
import type { Block } from '../../../content/types';

const A: Snapshot = { blocks: [{ kind: 'paragraph', text: 'a' }], caret: null, at: 0, slot: 'b1/text' };
const B: Snapshot = { blocks: [{ kind: 'paragraph', text: 'ab' }], caret: null, at: 100, slot: 'b1/text' };
const C: Snapshot = {
  blocks: [{ kind: 'paragraph', text: 'ab' }, { kind: 'paragraph', text: '' }],
  caret: null,
  at: 200,
  slot: 'b2/text',
};

describe('record', () => {
  it('collapses a run of typing in one slot into ONE step, keeping the state before the run', () => {
    // The direction is the claim. `past` holding B would mean the first Cmd+Z
    // gave back one character and the second gave back everything before the
    // paragraph, because every restore point between them was discarded.
    const history = record(record(EMPTY_HISTORY, A, false), B, false);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]).toBe(A);
  });

  it('keeps collapsing a long run, and still measures the window from where the run started', () => {
    // Three keystrokes 100ms apart coalesce; the fourth is past the window
    // from A and starts a new step. The window is not refreshed by each key,
    // so an uninterrupted paragraph cannot become one giant undo.
    const typed = [B, { ...B, at: 200 }, { ...B, at: 400 }, { ...B, at: 900 }]
      .reduce((history, snapshot) => record(history, snapshot, false), record(EMPTY_HISTORY, A, false));
    expect(typed.past).toHaveLength(2);
    expect(typed.past[0]).toBe(A);
    expect(typed.past[1].at).toBe(900);
  });

  it('does not coalesce across slots', () => {
    expect(record(record(EMPTY_HISTORY, A, false), { ...C, at: 100 }, false).past).toHaveLength(2);
  });

  it('does not coalesce past the window', () => {
    expect(record(record(EMPTY_HISTORY, A, false), { ...B, at: 5000 }, false).past).toHaveLength(2);
  });

  it('never coalesces a structural step', () => {
    expect(record(record(EMPTY_HISTORY, A, false), { ...B, at: 100 }, true).past).toEqual([A, { ...B, at: 100 }]);
  });

  it('a new step clears the redo branch', () => {
    const back = undo(record(record(EMPTY_HISTORY, A, true), B, true), C);
    expect(back).not.toBeNull();
    expect(back?.history.future).toHaveLength(1);
    expect(record(back!.history, C, true).future).toEqual([]);
  });

  it('a coalesced step clears the redo branch too', () => {
    // She typed. Whatever she had undone is not coming back, and a redo branch
    // that survived a keystroke would put words back in an array that has
    // moved on without them.
    // The undone history has to be left with BOTH a redo branch and a top to
    // coalesce against, or the coalescing arm is never the one that runs and
    // the claim is vacuous.
    const back = undo(record(record(EMPTY_HISTORY, A, true), { ...A, at: 100 }, true), C)!;
    expect(back.history.past).toHaveLength(1);
    expect(back.history.future).toHaveLength(1);
    expect(record(back.history, { ...A, at: 200 }, false).past).toHaveLength(1);
    expect(record(back.history, { ...A, at: 200 }, false).future).toEqual([]);
  });

  it('never grows past its limit', () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 300; i += 1) history = record(history, { ...A, at: i * 1000 }, true);
    expect(history.past).toHaveLength(100);
    // The OLDEST are the ones dropped, so the newest 100 survive.
    expect(history.past[99].at).toBe(299000);
  });
});

describe('undo and redo', () => {
  it('undo hands back the MOST RECENT snapshot, not the oldest', () => {
    // Two steps, deliberately: with a one-element past, `past[0]` and
    // `past[past.length - 1]` are the same object and the mutation this case
    // exists for cannot redden.
    const history = record(record(EMPTY_HISTORY, A, true), B, true);
    expect(undo(history, C)?.restored).toBe(B);
  });

  it('undo can be redone', () => {
    const back = undo(record(EMPTY_HISTORY, A, true), C)!;
    expect(redo(back.history, A)?.restored).toBe(C);
  });

  it('restores the identical block objects, so a staged photo stays attached', () => {
    // The one assertion this whole module is for. stable-names.ts keys its
    // WeakMap on the block object, and a staged photograph's bytes are filed
    // under the name that map returns -- so an undo that handed back a COPY
    // would restore a block whose name is brand new and whose photo the
    // collector has nothing under.
    const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x' };
    const before: Snapshot = { blocks: [photo], caret: null, at: 0, slot: null };
    const back = undo(record(EMPTY_HISTORY, before, true), { blocks: [], caret: null, at: 1, slot: null })!;
    expect(back.restored.blocks[0]).toBe(photo);
  });

  it('undo on an empty history is null, not a throw', () => {
    expect(undo(EMPTY_HISTORY, A)).toBeNull();
    expect(redo(EMPTY_HISTORY, A)).toBeNull();
  });

  it('leaves the history it was handed alone', () => {
    // Every caller holds this in a ref and replaces it wholesale; a mutation
    // in here would be a step that changed under a render.
    const history = record(record(EMPTY_HISTORY, A, true), B, true);
    undo(history, C);
    redo(undo(history, C)!.history, C);
    expect(history.past).toEqual([A, B]);
    expect(history.future).toEqual([]);
  });
});
