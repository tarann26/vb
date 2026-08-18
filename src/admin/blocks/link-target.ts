// The one sentence that tells her what a link target may look like, and the
// one refusal that repeats it. Written once because the prompt asks for it and
// the refusal quotes it, and those two drifting apart is how a control comes to
// ask for one thing and complain about another.
//
// In its OWN module rather than exported from InlineTextField.tsx, which is
// where it lived while that file was the only caller. The writing surface's
// link control asks the same three questions and has to ask them in the same
// words, and a component file that also exports constants breaks Fast Refresh
// for itself -- eslint's `react-refresh/only-export-components`, which is a
// warning the moment the export is added. A file holding two strings has no
// such problem.
//
// It names `https://` and not `http://`, while isSafeHref accepts both. That
// gap is deliberate and it runs in the safe direction: the advice is narrower
// than the check, so the check can only ever accept something she was not told
// to try -- never refuse something she was told to try. The alternative is to
// teach a chef about a second, worse scheme so that a sentence and a regular
// expression match, and every site she will link to serves the first one.
export const TARGET_SHAPES =
  'a full web address starting with https://, or the address of a page on this site starting with /';

// Refused targets, in her words. The empty case gets its own opening clause
// because `"" will not work as a link` is a sentence about nothing: pressing OK
// on an empty box is a real thing she did and deserves to be described.
export function linkRefusal(target: string): string {
  const opening = target === '' ? 'Nothing was pasted in, so this' : `"${target}"`;
  return `${opening} will not work as a link. Use ${TARGET_SHAPES}`;
}
