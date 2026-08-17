// One dashboard section, foldable, with its heading as the control.
//
// The problem, in the owner's own terms: /edit/manage renders all ten
// sections fully expanded, so reaching the last one means scrolling past
// every dish, every drink and every article. Ten headings and a chevron each
// is the whole fix.
//
// Two decisions here are load-bearing, and both are about what "closed"
// means.
//
// 1. Closed HIDES the content; it never unmounts it. `hidden` on a wrapper
//    div, not `{open && children}`. Every section on this dashboard holds
//    its own fetched data, its own edits and its own load state in local
//    React state (AdminApp.tsx's ArraySection/SectionsSection/HoursSection/
//    ...), and each re-fetches from GET /api/content on mount and calls
//    `registerLoaded`, which writes the SERVER value back into the shared
//    registry. Unmounting a section she had edited and remounting it when
//    she opened it again would therefore not merely lose a scroll position
//    -- it would silently overwrite her unpublished edit with the committed
//    content, the exact class of vanishing-edit bug this codebase has
//    already fixed twice (src/admin/content.ts's own header comment, and
//    AdminApp.tsx's own 401-relogin comment). Folding a section is a change
//    of what she can SEE, and must never be a change of what exists.
//
//    The `hidden` ATTRIBUTE rather than a utility class: it costs the
//    shipped stylesheet nothing (the UA sheet already carries
//    `[hidden] { display: none }`), and this wrapper carries no display
//    utility of its own that could win the cascade against it.
//
// 2. Closed is the DEFAULT. A remembered-only version would leave the very
//    first visit -- and every visit from a device or browser she has not
//    used before -- exactly as long as it was, which is the complaint. The
//    cost of that choice is that a section which has something to say is
//    saying it out of sight, and that is what `problemMarker` below exists
//    to answer: a section whose own content is currently reporting a
//    problem (a failed load, a validation message) says so in its header,
//    where it is readable while folded. Without that, a dishes.json that
//    would not load looked exactly like a dishes.json she had simply not
//    opened yet.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { loadSectionOpen, saveSectionOpen } from './open-sections';

export interface CollapsibleSectionProps {
  // Stable across renames of `heading`: this is the localStorage key's own
  // suffix (open-sections.ts), so changing it silently forgets whatever she
  // had open. Never derived from `heading` for that reason.
  id: string;
  heading: string;
  // The editing pause, while a publish POST is open (AdminApp's
  // `publishLocked`). It reaches the <fieldset> around `children` below and
  // deliberately NOT the fold toggle -- see that element's own comment.
  locked?: boolean;
  children: React.ReactNode;
}

// Matches the `<h2>` string every dashboard section used to carry inline, so
// this component is a lift rather than a restyle -- confirmed against the
// shipped stylesheet, which gains no rule from any of this. The spacing
// classes are applied separately below, because a folded section wants far
// less of it: the open spacing (`mb-4` under the heading, `mb-10` under the
// section) is sized to separate BODIES of content, and applying it to ten
// bodiless headings in a row turns the whole point of folding them -- a
// short list she can read at a glance -- back into something she has to
// scroll.
const HEADING_CLASSNAME = "font-['Montserrat'] text-lg uppercase tracking-wide text-ink";

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ id, heading, locked, children }) => {
  // Lazy initializer: read once, on the very first render, so the section
  // paints in the state she left it in rather than opening and then folding
  // a frame later.
  const [open, setOpen] = useState<boolean>(() => loadSectionOpen(id));
  const [hasProblem, setHasProblem] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Whether this section's own content is currently reporting something --
  // `role="alert"` is what every section in this dashboard already uses for
  // a failed load and for a validation banner, so this needs no new
  // plumbing through nine components and cannot drift out of sync with
  // them.
  //
  // A MutationObserver, not a re-read on render: an alert appears when a
  // SECTION's own state changes (its fetch rejects, its debounced validation
  // pass finishes), and that re-renders the child alone -- this component
  // is never told. Watching the subtree is what makes the header's marker
  // arrive at the same moment the message it is standing in for does.
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const read = () => setHasProblem(contentEl.querySelector('[role="alert"]') !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(contentEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
    return () => observer.disconnect();
  }, []);

  function toggle() {
    setOpen((previous) => {
      const next = !previous;
      saveSectionOpen(id, next);
      return next;
    });
  }

  const panelId = `section-panel-${id}`;

  return (
    // A cheap, stable hook for a test to wait on. Every dashboard test that
    // needs a panel currently finds it by role AND accessible name over the
    // whole shell, which polls a getComputedStyle sweep every 50ms and starves
    // the render it is waiting for -- the root cause of both timeouts this
    // project has had, one of which failed a Cloudflare build. A `[data-panel]`
    // lookup is 0.6ms. The expensive assertion still happens; it just happens
    // ONCE, after this attribute says the panel is mounted.
    //
    // A data attribute rather than a class: it costs no CSS rule, and the
    // stylesheet has 107 bytes of headroom.
    <section data-panel={id} className={open ? 'mb-10' : 'mb-2'}>
      <h2 className={`${open ? 'mb-4' : ''} ${HEADING_CLASSNAME}`}>
        {/* `type="button"`, and that is not cosmetic: on /edit/manage this
            renders inside the one <form> PublishBar's Publish button
            submits (see PublishBarProps' own `children` comment), and an
            unlabelled <button> inside a form defaults to `type="submit"` --
            so folding a section would have opened the publish confirmation
            instead.

            Review finding (Minor): this toggle sits OUTSIDE the `locked`
            fieldset below, and the fieldset lives here rather than as one
            wrapper around all ten sections in AdminApp for exactly that
            reason. It used to be inside that wrapper, and the native
            disabled cascade reaches every form control under a disabled
            fieldset -- including a <button> -- so for the length of a
            publish POST (up to PublishBar's own 60s cap) every heading on
            this dashboard was inert. The one carve-out HTML offers is the
            disabled fieldset's own first <legend>, which cannot hold ten
            headings, so the fieldset had to move rather than the toggle.

            That is not a hole in the pause: the pause exists so an edit
            cannot be typed into a file whose publish is already in flight,
            and folding a section changes only what she can SEE. It is also
            the moment it matters most -- a section whose file fails to load
            while folded renders the "needs attention — open it to see"
            marker below, naming an action the heading was refusing. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span>{heading}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-5 w-5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      {/* Rendered OUTSIDE the <h2> deliberately: an accessible name is
          computed from an element's whole subtree, so putting this inside
          the heading would rename it from "Dishes" to "Dishes needs
          attention" the moment anything went wrong -- moving a heading
          every test and every screen-reader user identifies it by, exactly
          when she most needs to find it. Shown only while folded; once the
          section is open, the real message is right there and this would be
          saying the same thing twice. */}
      {hasProblem && !open && (
        <p role="status" className="mb-4 font-['Montserrat'] text-sm text-red-600">
          Something in this section needs attention — open it to see.
        </p>
      )}
      <div id={panelId} ref={contentRef} hidden={!open}>
        {/* One <fieldset> per section, not a `disabled` prop threaded
            through thirteen editor components. The native disabled cascade
            covers every form control underneath it -- Field inputs,
            RecordList's Add/Remove/Move, SectionList's toggles, HoursField,
            StoryForm, GalleryList, PageList, the template forms, PhotoField
            and PdfField -- without touching any of them. A partial lock
            would be worse than none: a page where three of six controls
            respond reads as broken, not as busy.

            Ten of these rather than one around all ten sections, so the
            heading above stays live; the visible result is that what dims
            is exactly what stopped responding, and the headings she can
            still use do not. Inline style rather than classes, so this
            costs nothing against the stylesheet's byte ceiling (the
            precedent is CollageTile.tsx, which chose an inline style over a
            class string for exactly that reason). `minInlineSize: 0` is
            required, not decorative: the UA stylesheet gives every fieldset
            `min-inline-size: min-content`, which visibly changes this
            layout at narrow widths, and `minWidth: 0` is not a reliable
            override for it. The border/padding/margin resets are the same
            story.

            The opacity is what says "this area is busy"; per-control
            disabled styling would be the wrong lever, since RecordList's
            move buttons document that they have no disabled variant at all
            and would look live while doing nothing. `aria-busy` is the same
            statement for a screen reader. */}
        <fieldset
          disabled={locked}
          aria-busy={locked}
          style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0, opacity: locked ? 0.6 : undefined }}
        >
          {children}
        </fieldset>
      </div>
    </section>
  );
};

export default CollapsibleSection;
