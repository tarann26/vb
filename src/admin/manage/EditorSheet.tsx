// One editor, two layouts: a full-screen sheet on a phone, a centred dialog
// on a laptop. The difference is CSS alone (the sm: breakpoint, 640px), not
// a matchMedia read -- ManageShell reads the viewport once and never again
// (readWideViewport), which is right for a layout chosen at mount and wrong
// for one that must survive a rotation while the editor is open.
//
// NOT PORTALLED, unlike PublishBar's ConfirmPanel. Two things depend on this
// staying inside the panel's own DOM: CollapsibleSection's
// `<fieldset disabled>` (the publish pause reaches this editor only through
// the native cascade) and CollapsibleSection's MutationObserver on
// `[role="alert"]` (the folded "needs attention" marker). A portal leaves
// both behind. Fixed positioning positions against the viewport regardless
// of DOM depth, and nothing between ManageShell's root and a panel body
// establishes a containing block -- pinned in e2e/editor-surface.spec.ts,
// because that is a computed-style claim and jsdom has no layout engine.
import React, { useEffect, useRef, useState } from 'react';
import { REMOVE_BUTTON_CLASSNAME } from '../RecordList';

export interface EditorSheetProps {
  title: string; // names the dialog; also the visible heading
  onClose: () => void; // Done, Escape
  onDelete?: () => void; // absent => this editor cannot delete
  deleteLabel?: string; // e.g. "Delete Aglio e Pepperoncini"
  children: React.ReactNode; // the record's own fields, unchanged
}

// Inline, not utilities: a translucent ink backdrop and a stacking level are
// two rules this stylesheet does not carry. The same escape hatch
// CollapsibleSection's fieldset reset and BlockList's drag handle take.
//
// 60 because nothing in this repo is at 60 (PublishBar.tsx:1088-1092). It is
// NOT chosen to beat the publish confirmation: ManageShell's root is a
// stacking context (ManageShell.tsx:269), the confirmation is portalled to
// the document body, and it therefore wins whatever number sits here.
const OVERLAY_STYLE: React.CSSProperties = { backgroundColor: 'rgba(34,34,34,0.4)', zIndex: 60 };

// Stretched full-screen by the flex parent on a phone; the auto margin
// un-stretches it and centres it on both axes at 640px and up. (An auto
// cross-margin is what suppresses the stretch; an explicit auto height would
// be a no-op rule against a 107-byte margin, so there isn't one.)
const PANEL_CLASSNAME =
  'w-full overflow-y-auto bg-white p-4 sm:m-auto sm:w-[32rem] sm:max-h-[85vh] sm:rounded';

const DONE_BUTTON_CLASSNAME =
  "rounded bg-brand px-4 py-2 font-['Montserrat'] text-sm uppercase tracking-wide text-ink transition hover:bg-brand-dark";

// Everything a Tab can land on inside the panel. Wider than ConfirmPanel's
// button sweep, because this one holds real inputs.
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

const EditorSheet: React.FC<EditorSheetProps> = ({ title, onClose, onDelete, deleteLabel, children }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Delete asks once. It is the only irreversible control on this surface and
  // it sits within thumb reach on a phone; the spec moved it off the row
  // precisely so a mis-tap while scrolling cannot reach it, and a
  // single-press Delete inside the editor reopens that hole one level down.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => !el.hasAttribute('disabled'),
    );
    // Empty while a publish is in flight: the fieldset above disables every
    // control in here. Escape still closes -- a keydown on this div is not a
    // form control and the disabled cascade does not reach it.
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 flex" style={OVERLAY_STYLE}>
      {/* No backdrop-click close: on a phone the backdrop is most of the
          screen and a mis-tap while scrolling a long form would shut it. The
          two ways out are Done and Escape, and both are deliberate. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={PANEL_CLASSNAME}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="font-['Montserrat'] text-base uppercase tracking-wide text-accent">{title}</h3>
          <button type="button" onClick={onClose} className={DONE_BUTTON_CLASSNAME}>
            Done
          </button>
        </div>
        {children}
        {onDelete !== undefined && (
          <div className="mt-6 border-t border-gray-200 pt-4">
            {confirming ? (
              <button type="button" onClick={onDelete} className={REMOVE_BUTTON_CLASSNAME}>
                {`Yes, ${(deleteLabel ?? 'delete this').toLowerCase()}`}
              </button>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={REMOVE_BUTTON_CLASSNAME}>
                {deleteLabel ?? 'Delete this'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorSheet;
