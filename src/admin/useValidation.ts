// Validates the whole in-memory file on a debounce tick, and the one small
// helper AdminApp uses to apply a record edit to it without reconstructing
// anything.
//
// Why "the whole file", not the record she is actually editing:
// validateContent (src/content/validate.ts) cannot validate one record.
// validateDishes/validateDrinks/validatePress all require an array --
// `validateContent('dishes.json', oneDish)` returns
// `[{ field: '', message: 'expected a list of dishes' }]`, not
// a per-field answer for that one dish -- and press.json's ordering rule and
// drinks.json's retired-name rule are file-scoped by construction: neither
// can be decided from one record in isolation. So the screen that owns a
// file (AdminApp, via a plain `useState<T[]>`) holds that file's whole
// value in memory, and this hook re-validates THAT value, every tick --
// never a slice of it. The resulting `ValidationProblem[]` is exactly the
// shape `RecordList`/`RecordForm` already expect (Task 4's `problemsFor`,
// Task 5's aggregate banner): pass it straight through, unfiltered.
//
// *** THIS IS A LATENCY OPTIMISATION, NOT A TRUST BOUNDARY. *** The Worker
// re-validates the identical content with the identical `validateContent`,
// server-side, on every `POST /api/publish`, and IS the authority: it
// refuses to commit whatever this hook would have called invalid, whether
// or not this hook ran, ran correctly, or ran in this browser at all. This
// client-side pass exists only so she sees "this dish needs a name" while
// she is still typing, instead of after a round trip. A check that runs
// only in this browser is trivially bypassed by anything that isn't this
// dashboard -- a stale cached bundle, a disabled script, or a handcrafted
// request straight to the API -- so it can never be the thing standing
// between an invalid write and a commit. Never let this hook's result gate
// what a publish is ALLOWED to send -- only use it to tell her sooner what
// that request would already refuse.
import { useEffect, useState } from 'react';
import { validateContent, type ValidationProblem } from '../content/validate';
import type { ContentFileName, ContentTypeMap } from './content';

// She types fast; validating on every keystroke would flash "this dish
// needs a name" mid-word, for a value she is still in the middle of typing.
// 400ms is long enough to sit out a keystroke, short enough that a pause to
// think still reads as "as she types," not as a stall.
const DEBOUNCE_MS = 400;

// `data` is owned by the caller (a `useState` in whatever screen edits this
// file), not by this hook -- this hook only ever reads it, on a timer, and
// reports what `validateContent` said about the value that was current when
// the timer fired.
//
// `data === undefined` means "not loaded yet" (the screen's own
// `GET /api/content`, Task 3's `fetchContent`, hasn't resolved). That
// short-circuits to `[]` rather than starting a timer that would otherwise
// hand back `validateContent`'s answer for `undefined` -- noise with no
// field on screen for her to see it attached to, and gone the instant real
// data arrives regardless.
export function useValidation<K extends ContentFileName>(
  file: K,
  data: ContentTypeMap[K] | undefined,
  current?: unknown,
): ValidationProblem[] {
  const [problems, setProblems] = useState<ValidationProblem[]>([]);

  useEffect(() => {
    if (data === undefined) {
      setProblems([]);
      return;
    }
    const timer = setTimeout(() => {
      setProblems(validateContent(file, data, current));
    }, DEBOUNCE_MS);
    // Cancelled, not merely superseded, the moment `data` changes again
    // before this timer fires -- e.g. she fixes the very value that would
    // have failed, before the first tick ever ran. Without this cleanup the
    // STALE timer would still fire on the OLD, already-abandoned value and
    // briefly show a problem for something she has already corrected --
    // "a problem shown for a value she has already fixed is its own
    // defect." useEffect's cleanup, run before every subsequent
    // invocation (and on unmount), is what guarantees at most one pending
    // timer exists for this file at a time. See useValidation.test.ts's
    // fake-timer tests, which make this race actually happen rather than
    // asserting it in a comment.
    return () => clearTimeout(timer);
  }, [file, data, current]);

  return problems;
}

// Replaces the item at `index`; every other item is returned as the SAME
// reference it came in with, not rebuilt. `next` is whatever `RecordForm`'s
// own `onChange` produced (`{ ...value, [key]: next }`,
// src/admin/RecordForm.tsx) -- already a full copy of the record with one
// key changed, unknown keys and all -- so the only way a whole-file update
// could still drop something is by reconstructing `next` (or a sibling)
// from a fixed list of known keys instead of returning what it was given.
// `FieldsOf<T>` (src/admin/fields.ts) being total over every key `T`
// declares hides this risk rather than removing it: a field the public site
// doesn't render (`Dish.tags`), a field whose descriptor is `readonly`
// (disabled in the form, but still a real value on the record), and a key
// the type doesn't declare at all are all still just properties sitting on
// `next` -- and "rebuild the record from its known fields," the
// natural-looking alternative to this one-line `.map`, would silently drop
// every one of them. See this file's own test for the failure this exists
// to prevent: editing one dish's description would delete `tags` from it
// (and any hand-added field, from whichever dish carried one), with no
// throw and no 422 anywhere to say so.
export function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}
