import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditorSheet from '../EditorSheet';

function open(props: Partial<React.ComponentProps<typeof EditorSheet>> = {}) {
  const onClose = vi.fn();
  const onDelete = vi.fn();
  render(
    <EditorSheet title="Aglio e Pepperoncini" onClose={onClose} onDelete={onDelete} deleteLabel="Delete Aglio e Pepperoncini" {...props}>
      <input aria-label="Name" defaultValue="Aglio e Pepperoncini" />
    </EditorSheet>,
  );
  return { onClose, onDelete };
}

it('is a modal dialog named after the item', () => {
  open();
  expect(screen.getByRole('dialog', { name: 'Aglio e Pepperoncini' })).toHaveAttribute('aria-modal', 'true');
});

it('puts focus inside itself when it opens', () => {
  open();
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
});

// AND ON THE FIRST CONTROL OF THE RECORD, not on Done. Done precedes
// `children` in the panel's DOM, so a panel-wide "first focusable" query
// opened every editor on this dashboard with the control that CLOSES it
// focused -- her first keystroke, if it was Enter, shut the editor she had
// just opened. Nothing is lost when that happens (edits go into the staged
// draft), which is why this is small; it is still not where a keyboard user
// wants to start.
it('opens with the keyboard on the record’s first field, not on Done', () => {
  open();
  expect(document.activeElement).toBe(screen.getByLabelText('Name'));
});

// The fallback, and it is not hypothetical: a record whose editor is a block
// of read-only text has nothing in `children` to focus, and focus has to stay
// inside a modal dialog either way.
it('falls back to Done for an editor whose fields hold nothing focusable', () => {
  render(
    <EditorSheet title="Nothing to edit" onClose={vi.fn()}>
      <p>Nothing to edit here yet.</p>
    </EditorSheet>,
  );
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
});

it('Done closes it', () => {
  const { onClose } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Escape closes it', () => {
  const { onClose } = open();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Tab past the last control comes back to the first', () => {
  open();
  const done = screen.getByRole('button', { name: 'Done' });
  const del = screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' });
  del.focus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
  expect(document.activeElement).toBe(done);
});

// The other half of the trap: Shift+Tab off the FIRST control has to wrap to
// the LAST one, not escape the dialog. Untested until now -- deleting the
// `event.shiftKey && (active === first || active === panelRef.current)`
// branch (EditorSheet.tsx:81-83) reddened nothing, 48 files / 1158 tests
// still green, because only the forward wrap above was ever pinned.
it('Shift+Tab off the first control wraps to the last one, not out of the dialog', () => {
  open();
  const done = screen.getByRole('button', { name: 'Done' });
  const del = screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' });
  done.focus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(del);
});

// The other half of the SAME branch: focus never having left the dialog's
// own container at all (exactly the state right after open, before any Tab
// -- see the mount effect above) is `active === panelRef.current`, not
// `active === first`. Shift+Tab from there has to wrap to the last control
// too, not do nothing.
it('Shift+Tab with focus still on the dialog container itself (never yet moved to a control) wraps to the last one', () => {
  open();
  const dialog = screen.getByRole('dialog');
  const del = screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' });
  dialog.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(del);
});

// The publish-pause path this file's own comment (EditorSheet.tsx:74-76)
// names: every control loses the ability to actually receive focus once an
// ancestor `<fieldset disabled>` (CollapsibleSection's own lock) wraps this
// editor. Confirmed by reading the code rather than assumed: the `focusable`
// array is filtered by `!el.hasAttribute('disabled')` -- literal-attribute
// presence, not the fieldset CASCADE's "actually disabled" state, which
// never sets that attribute on a descendant. So `focusable.length === 0` is
// not actually reachable this way (Done never carries a literal `disabled`
// attribute of its own); what a real publish pause produces instead is
// `document.activeElement` landing on neither `first` nor `last` (every
// candidate is cascade-disabled and un-focusable), which the `else if`'s
// condition simply does not match -- Tab does nothing, silently, which is
// the safe failure mode. What both paths actually promise, and what is
// worth pinning either way, is that Escape still closes: a keydown on this
// div is not itself a form control, so the disabled cascade never reaches
// the listener.
it('Escape still closes it even when every control is disabled by an ancestor fieldset (the publish pause)', () => {
  const onClose = vi.fn();
  render(
    <fieldset disabled>
      <EditorSheet title="Aglio e Pepperoncini" onClose={onClose} onDelete={vi.fn()} deleteLabel="Delete Aglio e Pepperoncini">
        <input aria-label="Name" defaultValue="Aglio e Pepperoncini" />
      </EditorSheet>
    </fieldset>,
  );
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Delete asks once before it deletes', () => {
  const { onDelete } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Aglio e Pepperoncini' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete aglio e pepperoncini' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

it('an editor with no onDelete shows no delete control at all', () => {
  open({ onDelete: undefined });
  expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
});
