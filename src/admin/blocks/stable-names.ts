// A NAME FOR ONE ITEM OF AN ID-LESS LIST THAT SURVIVES THE ITEM BEING MOVED.
//
// Two lists on this screen need it and neither can carry an id: a post's blocks
// (BlockList) and the photos inside one gallery block (BlockFields). An `id`
// key on either would be a key in posts.json -- published, validated, and ours
// to keep forever -- for something no reader of the blog will ever see. So the
// name is held BESIDE the list rather than inside it, keyed on the item object
// itself.
//
// What makes that work is that every reorder and every removal on this screen
// moves the SAME objects: `swapAt`/`moveTo` (reorder.ts) copy the array,
// `Remove` is a `filter`, and an edit is a `map` that replaces one entry. So an
// item dragged from fourth place to first is, to a WeakMap, the identical key
// it always was.
//
// WHY IT EXISTS AT ALL, in one sentence, because the next reader will be
// tempted to simplify it away: a photo she has staged is filed under a key this
// name composes, and while that key was the item's POSITION, moving the item
// left her photo's bytes behind at the old position, where the next pick
// deleted them -- publishing a post that named a photo no file was ever sent
// for.
//
// A WeakMap rather than a counter array parallel to the list, which is the
// other obvious shape: a parallel array has to be re-derived every time the
// list changes from outside the component that holds it (a restored draft, an
// undo, a post reordered above), and each of those re-derivations is another
// chance to hand a photo to the wrong item. This has nothing to re-derive, and
// it cannot leak -- an entry is unreachable the moment its item is.
import { useRef } from 'react';

export interface StableNames {
  // The name this item has had since it first appeared, or a fresh one. Items
  // that are not objects fall back to their position, which is the honest
  // answer for them: a stale draft's `null` in a blocks array is not a WeakMap
  // key at all, renders no fields, and so can never hold a photo.
  nameOf: (item: unknown, index: number) => string;
  // Carry `from`'s name onto `to`, the new object an edit has just produced.
  // Every keystroke replaces an item (`{ ...block, text: next }`), so without
  // this call at each commit site the name would change under a photo already
  // staged -- leaving those bytes filed under a name nothing refers to any
  // more.
  rename: (from: unknown, to: unknown, index: number) => void;
}

function asKey(item: unknown): object | undefined {
  return item !== null && typeof item === 'object' ? (item as object) : undefined;
}

// `prefix` only makes a staged-file key readable when somebody dumps the
// collector ('b' for a block, 'g' for a gallery photo). Nothing reads it back:
// staged.ts stores whatever string it is handed and never parses one.
export function useStableNames(prefix: string): StableNames {
  // Lazily, and not `useRef(new WeakMap())`: the argument form constructs a
  // WeakMap on EVERY render and throws it away on all but the first. Both
  // assignments below happen during render, which is safe here in a way it
  // usually is not -- they are memoisation keyed on object identity, so
  // StrictMode's second pass finds what the first put there and returns the
  // same answer.
  const namesRef = useRef<WeakMap<object, string>>();
  const countRef = useRef(0);
  const names = namesRef.current ?? (namesRef.current = new WeakMap<object, string>());

  const nameOf = (item: unknown, index: number): string => {
    const key = asKey(item);
    if (key === undefined) return `at-${index}`;
    const existing = names.get(key);
    if (existing !== undefined) return existing;
    countRef.current += 1;
    const fresh = `${prefix}${countRef.current}`;
    names.set(key, fresh);
    return fresh;
  };

  return {
    nameOf,
    rename: (from, to, index) => {
      const key = asKey(to);
      if (key !== undefined) names.set(key, nameOf(from, index));
    },
  };
}
