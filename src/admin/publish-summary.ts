// The two sentences that describe unpublished work, and which one owns
// which words.
//
// There are now two places on /edit/manage that have to say something about
// unsaved changes: the publish bar, right next to the button that publishes
// them, and the status strip in the header, which exists because the screen
// "says nothing about the state of things". They sit a couple of inches
// apart, so two NEARLY identical sentences differing only in a trailing
// clause would read as a bug rather than as two statements.
//
// So they are split by what they are ABOUT, and they are written so they
// cannot be mistaken for a duplicated string: one counts sections and ends
// in an instruction, the other names the files and ends in a state.
import { CONTENT_FILE_LABELS } from './content';
import type { ContentFileName } from './content';

// The bar's own sentence, about the ACTION. Lifted out of PublishBar.tsx
// byte-identically -- including the em-dashed "— ready to publish." -- and
// imported back there, so its own 1600-line test file keeps passing with no
// edits at all. If any case in PublishBar.test.tsx goes red, this lift is
// wrong; that is the point of moving it unchanged rather than improving it
// on the way past.
export function barSummary(dirtyCount: number, stagedCount: number): string {
  const total = dirtyCount + stagedCount;
  if (total === 0) return 'No changes to publish yet.';
  const parts: string[] = [];
  if (dirtyCount > 0) parts.push(`${dirtyCount} ${dirtyCount === 1 ? 'section' : 'sections'} edited`);
  if (stagedCount > 0) parts.push(`${stagedCount} ${stagedCount === 1 ? 'file' : 'files'} staged`);
  return `${parts.join(', ')} — ready to publish.`;
}

// The strip's own sentence, about the STATE. It takes the dirty file NAMES
// rather than a count, and renders them through the same
// CONTENT_FILE_LABELS map the publish confirmation already uses, because
// once five areas can hide each other from one another a count is the least
// useful form there is: it tells her something is unsaved without telling
// her where, and the question she actually has after tapping Pages is
// whether the thing she typed in Menu survived.
//
// "Section" is a component name and "staged" is a git word. Neither is hers,
// so neither appears here.
//
// At zero it reads "Nothing waiting to be published" and never the empty
// string: a blank strip is indistinguishable from a broken one, which is the
// complaint this whole header exists to answer.
export function stripSummary(dirtyFiles: ContentFileName[], stagedCount: number): string {
  const names = dirtyFiles.map((file) => CONTENT_FILE_LABELS[file]);
  const photos = stagedCount === 0 ? '' : `${stagedCount} ${stagedCount === 1 ? 'photo or PDF' : 'photos or PDFs'} waiting`;

  if (names.length === 0) {
    return photos === '' ? 'Nothing waiting to be published' : `${photos} to be published`;
  }

  const list = joinWithAnd(names);
  const verb = names.length === 1 ? 'has' : 'have';
  const sentence = `${list} ${verb} changes you haven't published yet`;
  return photos === '' ? sentence : `${sentence} · ${photos}`;
}

// "Dishes", "Dishes and Drinks", "Dishes, Drinks and Opening hours". No
// Oxford comma, matching how the rest of this dashboard's copy is written.
function joinWithAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
