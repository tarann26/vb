# `/edit` redesign: lists, one editor, one writing surface — plus the blog index, the phone washes, and the Drive photographs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard usable without scrolling — every content panel becomes a compact list of thumbnail-and-name rows, and clicking a row opens one editor surface over the page. Make writing a post feel like writing anywhere else — one continuous writing column over the existing block array, with a toolbar, real keyboard behaviour, undo, and pasted text stripped to plain words. Then give `/blog` the filter, sort and search a reader expects, make the section washes visible on a phone, and finally put the Google Drive photographs onto the live site.

**Architecture:** Four sections, executed in the order written. **A** adds two new admin components — `EditorSheet` (a `position: fixed`, deliberately un-portalled dialog) and `ItemList` (a row list with the drag handle and keyboard fallback lifted out of `BlockList`) — and re-shapes the thirteen panels around them. Nothing about the publish model moves: every editor still commits through `registry.updateData(file, next)`, `PublishBar` still persists `vb:draft:v1`, and nothing reaches the live site until Publish. **B** replaces `BlockList`'s box-per-block editor with `src/admin/writing/`, an array-authoritative column: the `Block[]` stays the single source of truth, each text-bearing field is its own `contenteditable` host, and three small pure modules (`inline-source.ts`, `dom-inline.ts`, `inline-dom.ts`) carry values between markdown source and DOM so `stable-names.ts`'s staged-photo identity survives every keystroke. **C** adds pure list operations to `src/components/blog/posts.ts` and wires three control rows into `BlogIndex`, then replaces the near-white section backgrounds with two measured wash tokens. **D** enumerates the Drive shoot by owner, fetches a full-frame preview of every image, looks at each one, and commits repo-sized WebP intermediates that `npm run images` encodes down — the originals never enter the repository.

**Tech Stack:** React 18 + TypeScript (solution-style project references), Vite, Tailwind (JIT, content-scanned), Vitest + jsdom (`src/`, `scripts/`, `worker/`), Playwright (`e2e/`), Cloudflare Pages + Workers + D1, sharp via `scripts/images.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-18-admin-redesign-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section. The first block is copied verbatim from the project rules and is non-negotiable.

- `npx tsc -b --noEmit` is the ONLY typecheck that works here (solution-style tsconfig).
- Every test must be able to fail, proven by mutating the code and watching it go red. This project has shipped four unfalsifiable assertions and every one hid a real bug.
- jsdom has no layout engine. Rendering, geometry, occlusion and computed-style claims go in `e2e/`, never `src/test/`.
- Tailwind's content scanner is a plain text extractor with no JS parser: never write a bare utility-class-looking token in a comment.
- Playwright runs only when nothing else runs; port 8080 is shared.
- Never mention AI or list any AI as co-author anywhere, including commit messages.
- Brand blue #C8D8E8 is a SURFACE colour only (1.45:1 on white). Foreground text on light backgrounds uses accent #9D4949 (6.03:1).
- `npm test` and `npm run test:deploy` are DIFFERENT commands with different file sets; only test:deploy runs on Cloudflare.
- A push to main deploys Pages only. Worker changes need `npx wrangler deploy` separately, and that command REPLACES the Worker's route list with exactly what wrangler.toml declares.
- Entry CSS is 38593 bytes against a 38700 ceiling in src/test/bundle.post-build.test.ts. This work REQUIRES raising that ceiling; the plan must raise it to a measured number and must never delete the check.

Three more, specific to this plan:

- **The CSS ceiling is raised three times, each to a measured number, and never deleted.** Task 12 raises it after the list work, Task 27 after the writing surface, Task 36 after the washes. Each raise is a number read off `wc -c dist/assets/index-*.css` on that branch with the added rules accounted for one by one in the file's ledger; a raise "to be safe" is a defect. Section D must move it by **zero bytes** — it adds no markup and no class, so any movement there is a leaked utility token in a comment and is fixed, not accommodated.
- **The hero collage is never touched.** `galleries.json`'s `heroCollage` key, `assets-source/hero/`, `public/hero/` and `/hero/brick.webp` are out of scope for every task in this plan. Task 43 asserts the `heroCollage` subtree is unchanged; Task 47 re-checks the committed photo count of 11 that `src/test/no-missing-react-keys.test.tsx:115` pins.
- **An unidentifiable photograph is left unnamed rather than guessed.** In Section D, `matchesContentId` may only be set when `confidence === 'certain'`, and `certain` requires a named visual detail in the judgement's `notes`. A wrong photograph on a menu item is worse than no photograph, and nothing downstream can catch it — every other guard checks that a path resolves, not that the food is the right food.

Two standing hazards worth restating because several tasks trip over them:

- **`e2e/` is in no tsconfig project.** `tsconfig.json` references `tsconfig.app.json` (`include: ["src"]`), `tsconfig.node.json` and `tsconfig.worker.json`. `npx tsc -b --noEmit` typechecks not one line of any `e2e/*.spec.ts`. Their types are checked by eslint and by Playwright at runtime only.
- **`tsconfig.app.json` sets `noUnusedLocals`.** A function whose only call site a task deletes is a hard `tsc -b` failure, not a lint warning. Several tasks below delete a helper for exactly this reason.

---

## Decisions this plan makes where the spec is silent

Each is restated inside the task that implements it; they are collected so a reviewer can reject one without reading the whole plan.

**D1 — The editor is not portalled.** `PublishBar`'s `ConfirmPanel` uses `createPortal` (`PublishBar.tsx:1155`, `:1250`). `EditorSheet` must not, and the reason is `CollapsibleSection.tsx:224-230`: the publish pause is a single `<fieldset disabled={locked}>` wrapping each panel's children, relying on the native disabled cascade. A portalled editor leaves that subtree, so during a publish every field inside it stays live — a partial lock, which that file's own comment calls worse than none. Rendering inline with `position: fixed` keeps the editor a descendant of the fieldset (cascade reaches it) and of `CollapsibleSection`'s `contentRef` (its `MutationObserver` on `[role="alert"]` still drives the folded marker) while positioning against the viewport. Verified by grep: the only `transform` anywhere in `src/admin/**/*.tsx` is the chevron's `rotate-180` inside a toggle button (`CollapsibleSection.tsx:179`), which is not an ancestor of a panel body, so nothing establishes a competing containing block. That is a computed-style claim and it is pinned in `e2e/editor-surface.spec.ts` (Task 11).

**D2 — `zIndex: 60`, and the publish confirmation wins by containment, not by number.** `ManageShell`'s root is `<div className="relative z-10 …">` (`ManageShell.tsx:269`), so everything the editor renders into sits inside that stacking context and its z-index is not comparable to `ConfirmPanel`'s 70 — the panel is portalled to `document.body` and beats the whole z-10 subtree unconditionally, whatever number the sheet carries. There is also **no fixed publish bar**: `PublishBar`'s bar is an in-flow `<div className="mx-auto mb-8 max-w-3xl rounded border …">` (`:925`). 60 is chosen because nothing in the repo is at 60 (`PublishBar.tsx:1088-1092`), not because it beats anything.

**D3 — The editor holds no buffer.** Every keystroke calls the same `onChange` the inline form calls today, which reaches `commit()` → `registry.updateData`. *Done* only closes. Nothing is saved on Done, nothing is discarded on Escape, because nothing is held back. This is what keeps `dirtyDraftMap`, `buildPublishRequest`, `isDirty`, `AreaNav`'s unsaved dots and the whole `vb:draft:v1` path byte-for-byte unchanged.

**D4 — Closing an editor must not hide a validation problem.** With one editor open, nine of ten records' fields are unmounted and their `role="alert"` messages with them. Every list therefore carries a list-level `role="alert"` banner of every problem the open editor is *not* showing, plus a per-row "needs attention" marker. The partition is by reference (`shown` / `banner`) — never in both places, never in neither, the same guarantee `RecordForm.tsx:146-159` documents.

**D5 — The block array stays authoritative; the DOM never decides where one block ends and the next begins.** One giant `contenteditable` would need three conversions that do not exist and would rebuild `Block[]` from the DOM on every keystroke, producing all-new objects and detaching every staged photo from `stable-names.ts`'s `WeakMap` — the exact defect documented at `BlockList.tsx:261-292`. Instead each text-bearing slot is its own editable host, an edit is `{ ...block, text: next }` (`stable-names.ts:38`), and `rename(from, to, index)` (`BlockList.tsx:442`) carries the name across.

**D6 — Round-tripping is proven as render-equivalence, not byte-equality.** `parseInline` is not injective (`markdown.test.ts:88-101` pins seven non-round-trippable inputs). The theorem is: for every source `s`, `parseInline(serializeInline(parseInline(s)))` deep-equals `parseInline(s)` once adjacent text siblings are merged at every level.

**D7 — The homepage wash sections are positioned so the brick overlay paints beneath them.** `src/index.css:163-173` paints a fixed, full-viewport `body::before` of `/hero/brick.webp` at `opacity: 0.1`, `z-index: 0`. Nothing positions `#root`, so by paint order that pseudo-element sits **above** every non-positioned section background and contributes a ~14.5-point mean drop of its own (brick channel means `(132.3, 110.0, 88.8)` at 0.1 over white). `Drinks.tsx:13` already carries `relative`, so that one section is already untinted and reads fine. Task 34 adds `relative` to the other homepage sections in scope, which makes the overlay uniformly beneath all of them, makes the token arithmetic and the rendered pixel agree, and removes the sampling noise a textured overlay would put into every measurement. *Cost, stated:* the brick texture no longer shows through those eight sections — it remains behind the hero, the page margins and every other page. The alternative (leave the overlay on top) makes the measured value depend on which brick pixel the sample lands in, which is not a number anything can hold.

**D8 — Delete lives inside the editor and asks once.** The spec moves delete off the row so a mis-tap while scrolling cannot reach it; a single-press Delete inside the editor reopens that hole one level down.

**D9 — Storage for the Drive photographs is a repo-sized WebP intermediate, not the original and not the derivative.** R2 is billing-gated, so the repository is the storage. `.gitignore` ignores `/public/*/` and `scripts/images.mjs`'s `prune()` (`:68-89`) deletes any `.webp` under `public/<category>/` with no source, so a committed derivative is erased by the next `npm run images` — which is the Cloudflare build command. What is committed is `assets-source/<category>/<slug>.webp` at 1600px/q90 (measured 168KB on a real frame); `npm run images` encodes that to `public/<category>/<slug>.webp` at 1000px/q78 (measured 47KB). The cost is one extra encode generation, and it is not hidden.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/admin/manage/EditorSheet.tsx` | The one editor surface: full-screen sheet on a phone, centred dialog on a laptop, focus trap, two-press delete. Not portalled (D1). |
| `src/admin/manage/ItemList.tsx` | The one list: thumbnail + name row, Add at the top, drag handle plus Up/Down fallback. |
| `src/admin/manage/drag-row.ts` | `HANDLE_CLASSNAME` / `HANDLE_STYLE` / `DRAGGING_STYLE`, moved out of `BlockList` so both lists share one string. |
| `src/content/inline-source.ts` | `serializeInline(InlineNode[]) → markdown source`. The inverse direction `markdown.ts` never had. |
| `src/admin/writing/dom-inline.ts` | One editable slot's DOM subtree read back as `InlineNode[]`. Reads the tree, never a markup string. |
| `src/admin/writing/inline-dom.ts` | Markdown source into a slot's DOM, element by element. |
| `src/admin/writing/slots.ts` | `slotsOf(block)` / `withSlot(block, key, source)` — how the surface addresses one editable field inside one block. |
| `src/admin/writing/structure.ts` | Enter, Backspace and Tab as pure functions over `Block[]`. |
| `src/admin/writing/autoformat.ts` | The five typing triggers, as a pure function. |
| `src/admin/writing/marks.ts` | Bold/italic/underline/strike/link/clear, built as elements — never `document.execCommand`. |
| `src/admin/writing/history.ts` | Undo and redo over the block array, with coalescing. |
| `src/admin/writing/paste.ts` | Plain clipboard text split into the paragraphs it obviously is. |
| `src/admin/writing/WritingSurface.tsx` | The column. Props byte-identical to `BlockListProps`. |
| `src/admin/writing/WritingToolbar.tsx` | Twelve buttons and one file-picker label. |
| `src/content/__tests__/photo-sources.test.ts` | What Phase 6 guarantees about committed image sources, forever. |
| `scripts/drive-import.mjs` | The committed encode recipe for the Drive import. |
| `e2e/editor-surface.spec.ts`, `e2e/writing-surface.spec.ts`, `e2e/blog-controls.spec.ts`, `e2e/section-washes.spec.ts`, `e2e/phase6-photos.spec.ts` | Everything jsdom cannot honestly assert. |
| `e2e/drag.ts` | `startDragging`, exported out of `block-editor.spec.ts` before that file is deleted. |

**Modified**

| File | Change |
|---|---|
| `src/admin/RecordList.tsx`, `GalleryList.tsx`, `PageList.tsx`, `PostList.tsx`, `SectionList.tsx`, `StoryForm.tsx` | List + editor, or (SectionList) a hand-rolled row sharing `drag-row.ts`. |
| `src/admin/areas/MenuArea.tsx`, `DetailsArea.tsx`, `AwardsArea.tsx`, `ExperiencesArea.tsx`, `PostsArea.tsx`, `src/admin/sections/ArraySection.tsx` | `onAdd` returns the new record's id; Menu PDFs and Words on the site become lists. |
| `src/admin/blocks/BlockList.tsx`, `BlockPicker.tsx`, `block-meta.ts` | Three constants move out; the picker gains an optional `kinds`; `INSERT_MENU_KINDS` is pinned. |
| `src/content/markdown.ts`, `Inline.tsx`, `types.ts`, `guards.ts`, `validate.ts`, `blocks.tsx` | Two new inline marks, the About length limit, optional list nesting. |
| `src/components/blog/posts.ts`, `BlogIndex.tsx` | Filter, sort, search; `pageOf` becomes `pageSlice`. |
| `tailwind.config.js`, `PlaceGallery.tsx`, `Drinks.tsx`, `Experiences.tsx`, `BlogSection.tsx`, `OurStory.tsx`, `VisitUs.tsx`, `FoodGallery.tsx`, `Awards.tsx`, `templates/ItemListSection.tsx` | Two measured wash tokens; `relative` so the brick overlay paints beneath (D7). |
| `src/content/dishes.json`, `drinks.json`, `galleries.json`, `experiences.json`, `press.json` | The Drive photographs, attached. |
| `src/test/bundle.post-build.test.ts`, `homepage-bytes.test.tsx`, `palette.test.ts`, `hosting.test.ts` | Measured ceilings and ledger entries. |

**Deleted**

| File | Why |
|---|---|
| `e2e/block-editor.spec.ts` | Task 25 swaps `PostList` off `BlockList`; the spec describes a component no longer mounted. `POSTS_PANEL` and `startDragging` are lifted out first. |

---

# Section A — Lists and the editor surface

Everything in this section is behind `/edit`, in the lazily-loaded admin chunk (`src/App.tsx:34`, `lazy(() => import('./admin/AdminApp'))`). **No task here changes a byte the public site renders**, with one exception called out in Task 10 (a validator the Worker also runs).

---

## Task 1: `EditorSheet`, the one editor surface

**Files:**
- Create: `src/admin/manage/EditorSheet.tsx`
- Create: `src/admin/manage/__tests__/EditorSheet.test.tsx`

**Interfaces:**
- Consumes: `REMOVE_BUTTON_CLASSNAME` from `src/admin/RecordList.tsx`.
- Produces, for Tasks 3–9:
```ts
export interface EditorSheetProps {
  title: string;                 // names the dialog; also the visible heading
  onClose: () => void;           // Done, Escape
  onDelete?: () => void;         // absent => this editor cannot delete
  deleteLabel?: string;          // e.g. "Delete Aglio e Pepperoncini"
  children: React.ReactNode;     // the record's own fields, unchanged
}
declare const EditorSheet: React.FC<EditorSheetProps>;
export default EditorSheet;
```

- [ ] **Step 1: The module header and the constants**

```tsx
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
```

- [ ] **Step 2: The component body — focus-in, Escape/Tab, the two-press delete**

```tsx
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
```

- [ ] **Step 3: The render**

Every button is `type="button"` — this renders inside the one `<form>` `PublishBar`'s Publish button submits (`PublishBar.tsx:916-923`), and an unlabelled `<button>` there defaults to `type="submit"`.

```tsx
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
```

- [ ] **Step 4: The tests, all jsdom-honest (none asks about geometry)**

```tsx
import { describe, expect, it, vi } from 'vitest';
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
```

- [ ] **Step 5: `npx tsc -b --noEmit && npx eslint src/admin/manage/EditorSheet.tsx && npm test -- --run src/admin/manage/__tests__/EditorSheet.test.tsx`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `role="dialog"` → `role="region"` | "is a modal dialog named after the item" |
| delete the `useEffect` that calls `.focus()` | "puts focus inside itself when it opens" |
| Escape branch returns without calling `onClose()` | "Escape closes it" |
| drop the `!event.shiftKey && active === last` branch | "Tab past the last control comes back to the first" |
| `useState(true)` for `confirming` | "Delete asks once before it deletes" |
| render the delete block unconditionally with `onDelete ?? (() => {})` | "an editor with no onDelete shows no delete control at all" |
| replace `deleteLabel ?? 'Delete this'` with the bare string `'Delete'` | "Delete asks once…" — the name lookup finds nothing |

Not asserted here, and said rather than implied: `event.preventDefault()` on Escape, `zIndex: 60`, the auto-margin centring, and the fixed-positioning containing-block claim. All are browser-only and live in Task 11. A jsdom mutation row for any of them would predict a failure that cannot happen.

**If this task is wrong:** the OWNER opens a dish and lands on a dialog she cannot leave with the keyboard, or one that deletes on a single tap. A VISITOR sees nothing.

---

## Task 2: The shared drag row, and `ItemList`

**Files:**
- Create: `src/admin/manage/drag-row.ts`
- Create: `src/admin/manage/ItemList.tsx`
- Create: `src/admin/manage/__tests__/ItemList.test.tsx`
- Modify: `src/admin/blocks/BlockList.tsx` (delete three local constants, import them instead — no DOM change)

**Interfaces:**
- Consumes: `MOVE_BUTTON_CLASSNAME` (`src/admin/RecordList.tsx:111`).
- Produces:
```ts
// src/admin/manage/drag-row.ts
export const HANDLE_CLASSNAME: string;
export const HANDLE_STYLE: React.CSSProperties;   // { cursor: 'move' }
export const DRAGGING_STYLE: React.CSSProperties; // { opacity: 0.5 }

// src/admin/manage/ItemList.tsx
export interface ItemRow {
  id: string;                        // React key AND the editor's identity
  name: string;
  thumbnail?: React.ReactNode;       // omitted => this list has no pictures at all
  needsAttention: boolean;
}
export interface ItemListProps {
  rows: ItemRow[];
  onOpen: (id: string) => void;
  onMove?: (from: number, to: number) => void;  // absent => this list has no order
  onAdd?: () => void;                           // absent => this list cannot grow
  addLabel?: string;
}
declare function ItemList(props: ItemListProps): JSX.Element;
export default ItemList;
```

- [ ] **Step 1: Move the three constants**

Create `src/admin/manage/drag-row.ts` by **moving** `HANDLE_CLASSNAME`, `HANDLE_STYLE` and `DRAGGING_STYLE` out of `BlockList.tsx:89-141` verbatim, comments included, and add one line to the header:

```ts
// Moved out of BlockList.tsx unchanged when the dashboard's own lists grew
// the same handle. Shared rather than retyped for the reason RecordList's
// MOVE_BUTTON_CLASSNAME export already records: a single-character-off
// utility string is a NEW class to Tailwind's scanner, and the stylesheet
// has no room for one.
```

- [ ] **Step 2: Point `BlockList` at it**

Delete those three declarations from `BlockList.tsx` and add `import { DRAGGING_STYLE, HANDLE_CLASSNAME, HANDLE_STYLE } from '../manage/drag-row';`. Nothing else in that file changes — the rendered DOM is identical, so `BlockList.test.tsx` and `e2e/block-editor.spec.ts` stay green as written.

- [ ] **Step 3: `src/admin/manage/ItemList.tsx`**

The interfaces are declared **in this file** (they are its public contract) and there is no `moveTo` import — `ItemList` reports `(from, to)` and never reorders anything, the same controlled-list contract `RecordList.tsx:134-145` documents. `noUnusedLocals` would reject an unused import.

```tsx
// A content panel's list: a small square picture and the item's name, one
// row each, and nothing else. Clicking a row opens its editor.
//
// The row is a <button>, not a <li> with a click handler: it must be
// reachable by Tab and by Enter, and it must announce itself as something
// that does a thing. The drag handle sits OUTSIDE that button so a drag
// cannot end in a click that opens the editor she was trying to move.
//
// Add sits at the TOP. The spec's own reason: on a list of thirty-eight
// drinks the Add button at the bottom is a scroll away from the only screen
// that would send her looking for it.
import React, { useState } from 'react';
import { MOVE_BUTTON_CLASSNAME } from '../RecordList';
import { DRAGGING_STYLE, HANDLE_CLASSNAME, HANDLE_STYLE } from './drag-row';

export interface ItemRow {
  id: string;
  name: string;
  thumbnail?: React.ReactNode;
  needsAttention: boolean;
}

export interface ItemListProps {
  rows: ItemRow[];
  onOpen: (id: string) => void;
  onMove?: (from: number, to: number) => void;
  onAdd?: () => void;
  addLabel?: string;
}

const ROW_CLASSNAME =
  "flex min-w-0 flex-1 items-center gap-3 rounded p-2 text-left font-['Montserrat'] text-sm text-ink transition hover:bg-brand/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const ADD_ROW_CLASSNAME =
  "mb-3 w-full rounded border-2 border-dashed border-brand py-2 font-['Montserrat'] text-sm uppercase tracking-wide text-accent transition hover:bg-brand/10";

function ItemList({ rows, onOpen, onMove, onAdd, addLabel }: ItemListProps) {
  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <div>
      {onAdd !== undefined && (
        <button type="button" onClick={() => onAdd()} className={ADD_ROW_CLASSNAME}>
          {addLabel ?? 'Add'}
        </button>
      )}
      <ul data-item-list="rows">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-item-row={row.id}
            className="mb-1 flex items-center gap-1 rounded border border-gray-200"
            style={dragging === index ? DRAGGING_STYLE : undefined}
            onDragOver={(event) => {
              if (dragging === null || onMove === undefined) return;
              // preventDefault is what makes an element a valid drop target
              // at all. No jsdom test can see it; e2e/editor-surface.spec.ts
              // is what covers it.
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (dragging === null || onMove === undefined) return;
              event.preventDefault();
              if (dragging !== index) onMove(dragging, index);
              setDragging(null);
            }}
          >
            {onMove !== undefined && (
              <span
                aria-hidden="true"
                draggable
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.setData('text/plain', String(index));
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragging(null)}
                className={HANDLE_CLASSNAME}
                style={HANDLE_STYLE}
                data-drag-handle={index}
                title={`Drag to move ${row.name}`}
              >
                ⠿
              </span>
            )}
            <button type="button" onClick={() => onOpen(row.id)} className={ROW_CLASSNAME}>
              {row.thumbnail}
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {/* Part of the button's own accessible NAME, not a separate
                  element: a marker beside a row is something a screen reader
                  reaches only after the row, and this is the reason to open
                  it. The leading space is load-bearing -- jsdom computes a
                  bare span as display:inline, so dom-accessibility-api
                  inserts no separator of its own and the name would read
                  "Dish Bneeds attention". No `role` on it either:
                  CollapsibleSection's observer watches for role="alert", and
                  the list's own banner is what should drive the folded
                  marker, once. */}
              {row.needsAttention && <span className="text-xs text-red-600">{' needs attention'}</span>}
            </button>
            {onMove !== undefined && index > 0 && (
              <button
                type="button"
                aria-label={`Move ${row.name} up`}
                onClick={() => onMove(index, index - 1)}
                className={MOVE_BUTTON_CLASSNAME}
              >
                Up
              </button>
            )}
            {onMove !== undefined && index < rows.length - 1 && (
              <button
                type="button"
                aria-label={`Move ${row.name} down`}
                onClick={() => onMove(index, index + 1)}
                className={MOVE_BUTTON_CLASSNAME}
              >
                Down
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ItemList;
```

- [ ] **Step 4: `src/admin/manage/__tests__/ItemList.test.tsx`**

```tsx
const ROWS: ItemRow[] = [
  { id: 'a', name: 'Dish A', needsAttention: false },
  { id: 'b', name: 'Dish B', needsAttention: true },
  { id: 'c', name: 'Dish C', needsAttention: false },
];

it('one row per item, named', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Dish A', 'Dish B needs attention', 'Dish C',
  ]);
});

it('clicking a row opens that row, by id', () => {
  const onOpen = vi.fn();
  render(<ItemList rows={ROWS} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dish C' }));
  expect(onOpen).toHaveBeenCalledWith('c');
});

it('a row with a problem says so in its own name', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.getByRole('button', { name: 'Dish B needs attention' })).toBeInTheDocument();
});

it('Add sits above the first row', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} onAdd={() => {}} addLabel="Add a dish" />);
  const add = screen.getByRole('button', { name: 'Add a dish' });
  const first = screen.getByRole('button', { name: 'Dish A' });
  // DOCUMENT_POSITION_FOLLOWING: `first` comes after `add`.
  expect(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('a list that cannot grow has no Add at all', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
});

it('Move up is omitted on the first row and Move down on the last', () => {
  render(<ItemList rows={ROWS} onOpen={() => {}} onMove={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Move Dish A up' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Move Dish C down' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Move Dish B up' })).toBeInTheDocument();
});

it('Up and Down report the two positions, and nothing else', () => {
  const onMove = vi.fn();
  render(<ItemList rows={ROWS} onOpen={() => {}} onMove={onMove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Dish C up' }));
  expect(onMove).toHaveBeenCalledWith(2, 1);
});

it('a list with no order has no handle and no move buttons', () => {
  const { container } = render(<ItemList rows={ROWS} onOpen={() => {}} />);
  expect(container.querySelectorAll('[data-drag-handle]')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
});
```

- [ ] **Step 5: `npx tsc -b --noEmit && npx eslint . && npm test -- --run src/admin/manage/__tests__/ItemList.test.tsx src/admin/blocks/__tests__/BlockList.test.tsx`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `onOpen(row.id)` → `onOpen(String(index))` | "clicking a row opens that row, by id" |
| delete the `row.needsAttention && …` span | "a row with a problem says so in its own name" |
| drop the leading space from the marker string | "one row per item, named" and "a row with a problem says so in its own name" |
| move the Add button below the `<ul>` | "Add sits above the first row" |
| render Add unconditionally with `onAdd ?? (() => {})` | "a list that cannot grow has no Add at all" |
| `index > 0 &&` → `disabled={index === 0}` on Move up | "Move up is omitted on the first row and Move down on the last" |
| `onMove(index, index - 1)` → `onMove(index - 1, index)` | "Up and Down report the two positions, and nothing else" |
| render the drag handle unconditionally | "a list with no order has no handle and no move buttons" |
| in `BlockList.tsx`, import `HANDLE_STYLE` but keep a local `{ cursor: 'grab' }` | `e2e/block-editor.spec.ts:270` `'the handle shows a move cursor, which is its only affordance'` — **e2e only; jsdom cannot read a computed cursor** |

**PREDICTED WEAK, stated rather than hidden:** the drop handler's `onMove(dragging, index)` is untestable in jsdom. React's synthetic `dragStart` reads `event.dataTransfer.setData`, and jsdom's `DragEvent` carries no usable `DataTransfer` — the reason `e2e/block-editor.spec.ts:1-13` exists and `BlockList.test.tsx` never fires a drag. There is deliberately **no** jsdom mutation row for it; Task 11 covers it with a real Chromium drag, and `reorder.test.ts`'s exhaustive `moveTo` cases cover the arithmetic.

**If this task is wrong:** the OWNER sees a list whose rows do nothing when clicked, or a Move button on the first row that reorders nothing. A VISITOR sees nothing.

---

## Task 3: `RecordList` becomes list + editor (dishes, drinks, press, awards, experiences)

**Files:**
- Modify: `src/admin/RecordList.tsx`
- Modify: `src/admin/sections/ArraySection.tsx`, `src/admin/areas/AwardsArea.tsx`, `src/admin/areas/ExperiencesArea.tsx`
- Modify: `src/admin/__tests__/RecordList.test.tsx`
- Re-record: 5 keys in `src/admin/__tests__/__snapshots__/panel-snapshots.test.tsx.snap`

**Interfaces:**
- Consumes: `EditorSheet` (Task 1), `ItemList`/`ItemRow` (Task 2), `moveTo` (`src/admin/blocks/reorder.ts:46`).
- Produces, changed from today:
```ts
// RecordListProps<T>, one breaking change:
onAdd: () => string;   // WAS: () => void. Returns the id of the record it just added,
                       // so the list can open the editor on it. Every caller already
                       // mints that id (crypto.randomUUID inside its blank* factory).
```
Everything else on `RecordListProps` (`fields`, `items`, `onChange`, `onReorder`, `onRemove`, `onStaged`, `scope`, `thumbnail`, `previews`, `previewKeyPrefix`, `noun`, `itemLabel`, `problems`) keeps its exact current signature.

- [ ] **Step 1: `onAdd` returns the new id**

```ts
  // Returns the id of the record it added. Add and Edit are ONE surface --
  // the spec's own rule, so there is no separate "new item" form to drift
  // from the edit form -- and this list has no way to spot the new record in
  // the array it is handed back (`items` arrives on a later render, and an
  // id-diff would guess wrong on a duplicate). Every caller mints the id in
  // its own blank* factory already; it just stopped throwing it away.
  onAdd: () => string;
```

- [ ] **Step 2: Replace the body with list + editor, and delete two now-dead helpers**

`unclaimedProblems` (its only call site was `RecordList.tsx:150`) and the local `swap` (`:139-145`) both lose their callers here. `tsconfig.app.json` sets `noUnusedLocals`, so **both must be deleted** or `npx tsc -b --noEmit` fails with TS6133. The reference partition below subsumes what `unclaimedProblems` did: a problem naming an index that does not exist matches no `shown` entry and therefore lands in the banner.

```tsx
  const [openId, setOpenId] = useState<string | null>(null);
  // By ID, never by index. Reordering while an editor is open must not swap
  // which record she is editing under her hands.
  const openIndex = openId === null ? -1 : items.findIndex((item) => item.id === openId);
  const open = openIndex === -1 ? undefined : items[openIndex];

  // The partition: `shown` is everything the open editor's RecordForm will
  // place, on a field or in its own banner; `banner` is everything else,
  // which with no editor open is EVERYTHING -- including any problem naming
  // an index that does not exist. By reference, so nothing is counted twice
  // and nothing is dropped.
  const shown = open === undefined ? [] : problems.filter((p) => arrayIndexOf(p.field) === openIndex);
  const banner = problems.filter((p) => !shown.includes(p));

  const rows: ItemRow[] = items.map((item, index) => ({
    id: item.id,
    name: itemLabel(item),
    thumbnail: thumbnail?.(item),
    needsAttention: problems.some((p) => arrayIndexOf(p.field) === index),
  }));

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          // No plural: the real nouns are dish, drink, article, award and
          // "coming-soon item", and `${noun}s` renders "dishs" on the first
          // of them. This is owner-facing text.
          aria-label="Problems with this list"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ItemList
        rows={rows}
        onOpen={setOpenId}
        onMove={(from, to) => onReorder(moveTo(items, from, to).map((item) => item.id))}
        onAdd={() => setOpenId(onAdd())}
        addLabel={`Add a ${noun}`}
      />

      {open !== undefined && (
        <EditorSheet
          title={itemLabel(open)}
          onClose={() => setOpenId(null)}
          onDelete={() => {
            onRemove(openIndex);
            setOpenId(null);
          }}
          deleteLabel={`Delete ${itemLabel(open)}`}
        >
          <RecordForm<T>
            fields={fields}
            index={openIndex}
            value={open}
            onChange={(next) => onChange(openIndex, next)}
            problems={shown}
            onStaged={onStaged ? (fieldKey, staged) => onStaged(`${open.id}:${fieldKey}`, staged) : undefined}
            previews={previews}
            previewKeyPrefix={previewKeyPrefix === undefined ? undefined : `${previewKeyPrefix}:${open.id}`}
            scope={scope}
          />
        </EditorSheet>
      )}
    </div>
  );
```

Add imports: `useState`, `EditorSheet`, `ItemList`, `type ItemRow`, `moveTo`. Delete the now-unused `MOVE_BUTTON_CLASSNAME` *usage* but **keep the export** — `SectionList`, `HoursField`, `StoryForm`, `PostList`, `BlockList`, `PageList`, `TemplateSectionList` and now `ItemList` import it.

- [ ] **Step 3: The three callers return the id**

`ArraySection.tsx`:
```tsx
        onAdd={() => {
          const blank = makeBlank();
          commit([...items, blank]);
          return blank.id;
        }}
```
Same shape in `AwardsArea.tsx` (`blankAward()`) and `ExperiencesArea.tsx` (`blankExperience()`).

- [ ] **Step 4: Rewrite `src/admin/__tests__/RecordList.test.tsx`, deletions and inversions enumerated**

This file has roughly 28 cases and the new partition **inverts three of them**. Do not discover this by running it — make each change deliberately:

| Existing case | What happens to it |
|---|---|
| `:164` "each item has its own remove button" | **Delete.** Remove is now inside the editor (D8), asserted by the new "there is no Remove on any row". |
| `:200` "a problem naming an index that IS rendered goes to that item alone, not to the top-level banner" | **Invert.** With no editor open no index is rendered, so it goes to the banner *and* marks its row. Rewrite as the two new cases below. |
| `:221` "a file-level problem is left to each RecordForm's own banner, not duplicated here" | **Invert.** The list banner now carries it while no editor is open, and exactly one copy exists while one is. |
| `:231` "the aggregate banner is absent when every problem is claimed" | **Rewrite.** "Claimed" now means "the open editor is showing it"; with nothing open, nothing is claimed. |
| the collector-wiring `describe` at `:297-410` | **Re-point.** `PhotoField` renders only for the open record, so every case there must click a row (or Add) first. |

New and changed cases:

```tsx
it('a row opens the editor on that record', async () => { /* click "Dish B"; a dialog named "Dish B" with Dish B's name in the Name box */ });
it('Add opens the editor on the record it just added', async () => { /* onAdd returns 'new-id'; a dialog, Name box empty */ });
it('Done closes the editor and leaves the list', async () => { /* dialog gone, three rows still there */ });
it('with every editor closed, a problem on the third dish is still on screen', () => {
  // problems: [{ field: '[2].name', message: 'this dish needs a name' }]
  // the list banner contains that message AND the third row says "needs attention"
});
it('a problem naming an index that does not exist is still on screen', () => {
  // problems: [{ field: '[9].name', ... }] with three items -- lands in the banner
});
it('a file-level problem appears exactly once while an editor is open', () => {
  // problems: [{ field: '', message: 'the menu needs at least one dish' }]
  // open row 0; getAllByText(message) has length 1
});
it('Delete removes the record she opened, not the first one', () => {
  // open row 2, Delete, confirm; onRemove called with 2
});
it('moving a row up while its editor is open keeps the same record open', () => {
  // open 'Dish C'; click "Move Dish C up"; re-render reordered; dialog still named 'Dish C'
});
it('there is no Remove on any row', () => {
  expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
});
```

- [ ] **Step 5: Re-record five snapshot keys and nothing else**

```
CI=true npm test -- --run src/admin/__tests__/panel-snapshots.test.tsx   # expect 5 red: Dishes, Drinks, Press, Awards, Experiences
npm test -- --run src/admin/__tests__/panel-snapshots.test.tsx -u
CI=true npm test -- --run src/admin/__tests__/panel-snapshots.test.tsx   # expect green
```
The `CI=true` runs are not optional: without it vitest silently *writes* a missing snapshot and `npm run gate` never sets `CI` (`areas.test.tsx:205-212`). Confirm in the diff that exactly five keys moved and the other eight are byte-identical.

- [ ] **Step 6: `npx tsc -b --noEmit && npx eslint . && npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| a caller's `onAdd` returns `''` | "Add opens the editor on the record it just added" |
| `problems={shown}` → `problems={problems}` on the editor's `RecordForm` | "a file-level problem appears exactly once while an editor is open" |
| `banner` filters to only out-of-range indices | "with every editor closed, a problem on the third dish is still on screen" |
| `onRemove(openIndex)` → `onRemove(0)` | "Delete removes the record she opened, not the first one" |
| `openId` state becomes an index | "moving a row up while its editor is open keeps the same record open" |
| `needsAttention` → `false` | "with every editor closed…" (the row half) |
| restore the per-row Remove button | "there is no Remove on any row" |
| any change to a rendered field, label or id inside the editor | the five re-recorded snapshot keys, under `CI=true` |

**If this task is wrong:** the OWNER taps Add and gets a row she cannot open, or deletes the wrong dish, or — the quiet one — publishes a dish with a blank name because the only message about it was inside an editor she never opened. A VISITOR sees the consequence of that last one on the live menu, which is why the banner partition has a mutation row of its own.

**Browser-only:** that the editor visually covers the list, that hover highlights a row, and that the 48px thumbnail box still measures 46–50px inside the new row. `e2e/dashboard-sections.spec.ts:230-243` already asserts the box and "controls to the right, inside the viewport" — Task 11 re-points it at the new row rather than deleting it.

---

## Task 4: Menu PDFs — a list of three, each opening its editor

**Files:**
- Modify: `src/admin/areas/MenuArea.tsx` (`MenusSection`, `:115-225`)
- Modify: `src/admin/manage/Thumbnail.tsx` (its header states a rule this task reverses)
- Modify: `src/admin/__tests__/thumbnail-rows.test.tsx`
- Re-record: the `Menu PDFs (menus)` snapshot key

**Interfaces:** consumes `EditorSheet`, `ItemList`, `ItemRow`, and `Thumbnail` (which `MenuArea.tsx` does **not** import today — add it). Produces nothing new.

- [ ] **Step 1: The open state goes beside the existing `useState`, not beside the banner**

`MenusSection` returns early at `:149-158` (`loading`, `error`). `const banner = problems.filter(...)` is at `:173`, *after* those returns, so a hook declared there would take the count from 3 to 4 on the loading→loaded transition: "Rendered more hooks than during the previous render", plus a hard `react-hooks/rules-of-hooks` failure under `npx eslint .`. Put it beside the existing `useState` at `:124`, before the `useEffect`:

```tsx
  const [openId, setOpenId] = useState<string | null>(null);
```

Then, after the early returns, derive:

```tsx
  const openIndex = openId === null ? -1 : items.findIndex((item) => item.id === openId);
  const open = openIndex === -1 ? undefined : items[openIndex];

  const rows: ItemRow[] = items.map((menu, index) => ({
    id: menu.id,
    name: menu.label || menu.id,
    // The one row type in this dashboard with a placeholder and no possible
    // picture, and it is the spec's own named example: a menu PDF's row must
    // occupy the same width as a dish's so the two lists read as the same
    // kind of thing. Rendering a first page needs pdf.js in the admin bundle
    // for a 48px picture, which is not a trade this makes.
    thumbnail: <Thumbnail path={null} />,
    needsAttention: problems.some((p) => arrayIndexOf(p.field) === index),
  }));
```

- [ ] **Step 2: Replace the `<ul>…</ul>` block (`:194-222`) with the list and the sheet**

Menus has no Add and no Remove today (`MenuArea.tsx:81-89`) and gains neither, so `onAdd` and `onMove` are both omitted and the editor gets no `onDelete`.

```tsx
      <ItemList rows={rows} onOpen={setOpenId} />
      {open !== undefined && (
        <EditorSheet title={open.label || open.id} onClose={() => setOpenId(null)}>
          <Field
            id={`menu-${openIndex}-id`}
            spec={MENU_FIELDS.id}
            value={open.id}
            onChange={(next) => {
              commit(replaceAt(items, openIndex, { ...open, id: next }));
              // MENU_FIELDS.id is editable, so renaming a menu changes the
              // key this editor is open on. Re-point it in the same tick or
              // findIndex loses the record mid-edit and the sheet closes.
              setOpenId(next);
            }}
            problems={problemsFor(problems, openIndex, 'id')}
          />
          <Field
            id={`menu-${openIndex}-label`}
            spec={MENU_FIELDS.label}
            value={open.label}
            onChange={(next) => commit(replaceAt(items, openIndex, { ...open, label: next }))}
            problems={problemsFor(problems, openIndex, 'label')}
          />
          <PdfField
            id={`menu-${openIndex}-file`}
            label="PDF file"
            name={menuNameFor(open)}
            value={open.file}
            onChange={(next) => commit(replaceAt(items, openIndex, { ...open, file: next ?? '' }))}
            onStaged={(staged) => stage(`menus.json:${open.id}:file`, fromStagedMenuPdf(staged))}
            problems={problemsFor(problems, openIndex, 'file')}
          />
        </EditorSheet>
      )}
```

- [ ] **Step 3: Widen the banner to the same partition Task 3 uses**

`MenuArea.tsx:173-177` banners only the unrendered indices; with the editor closed, no index is rendered.

```tsx
  const shown = open === undefined ? [] : problems.filter((p) => arrayIndexOf(p.field) === openIndex);
  const banner = problems.filter((p) => !shown.includes(p));
```

- [ ] **Step 4: `Thumbnail.tsx`'s header, and `thumbnail-rows.test.tsx`**

`src/admin/manage/Thumbnail.tsx:6-9` states as a rule that "Menus (PDFs), Pages, Homepage sections, Opening hours and Page copy have none". Rewrite that line for Menus, naming the spec's own reason (aligned rows). Then move `Menu PDFs` out of the "no thumbnail at all" `it.each` (`thumbnail-rows.test.tsx:157`) and add:

```tsx
it('Menu PDF rows carry the neutral placeholder, never a picture', async () => {
  markEveryAreaSeeded();
  stubFetchWithPhotos();
  renderDashboard('/edit/manage/menu');
  const el = await openPanel('Menu PDFs', 'menus');
  const found = thumbnails(el);
  expect(found).toHaveLength(MENUS.length);
  expect(found.every((node) => node.tagName === 'DIV')).toBe(true);   // the placeholder box, not an <img>
});
```

**Pages stays in the no-thumbnail list** (`:158`): the spec names an award and a menu PDF, not a page, and every Pages row would carry the identical box — the decoration argument the original comment makes, which still holds inside one list.

- [ ] **Step 5: Re-record `Menu PDFs (menus)` with `CI=true`** (the same three-command sequence as Task 3 Step 5).

- [ ] **Step 6: `npx tsc -b --noEmit && npx eslint . && npm test -- --run src/admin/__tests__/thumbnail-rows.test.tsx src/admin/__tests__/panel-snapshots.test.tsx`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `thumbnail: <Thumbnail path={null} />` → `undefined` | "Menu PDF rows carry the neutral placeholder" (`toHaveLength`) |
| `thumbnail: <Thumbnail path="/menus/food-menu.pdf" />` | same test's `every(node => node.tagName === 'DIV')` |
| drop `setOpenId(next)` from the id field | new case "renaming a menu leaves its editor open" — type in the Id box, `getByRole('dialog')` still there |
| revert the banner to the old index-window filter | new case "with the editor closed, a problem on the second menu is still on screen" |
| declare `useState` after the early returns | `npx eslint .` (`react-hooks/rules-of-hooks`), and the panel throws on the loading→loaded transition |
| add an `onAdd` to the `ItemList` call | new case `expect(within(panel).queryByRole('button', { name: /^Add/ })).toBeNull()` — write it, because `menus.json` has no add path and `validateMenus` has no shape for a blank one |

**If this task is wrong:** the OWNER cannot replace the food menu PDF before service, or replaces it on the wrong row. A VISITOR downloads the wrong menu from the homepage.

---

## Task 5: Galleries — three lists, three editors

**Files:**
- Modify: `src/admin/GalleryList.tsx`
- Modify: `src/admin/__tests__/GalleryList.test.tsx`
- Modify: `src/admin/__tests__/thumbnail-rows.test.tsx` (one lookup re-pointed — see Step 5)
- Re-record: the `Galleries (galleries)` snapshot key (1487 lines today, `:2102-3588`)

**Interfaces:** consumes `EditorSheet`, `ItemList`, `ItemRow`. `GalleryListProps` is unchanged.

- [ ] **Step 1: Row ids**

`GalleryImage` has no `id` (`GalleryList.tsx:1-10` — this is why it never used `RecordList`). `ItemRow.id` is a string, and this file already mints per-row ids through its own `useRowIds` ref: use `rowIdFor(image)` for atmosphere and ourStory, and `photo.id` for hero-collage photos, which do carry one (`CollagePhoto`, `types.ts:107-112`).

- [ ] **Step 2: One open key for all three lists**

```tsx
  // `${prefix}:${rowId}`, one state for all three lists: two editors open at
  // once would be two dialogs claiming aria-modal, and the second would trap
  // focus inside the first.
  const [openKey, setOpenKey] = useState<string | null>(null);
```

- [ ] **Step 3: One local `PhotoRows` component per list**

Factor the per-list rendering into `function PhotoRows({ prefix, images, onChangeList, category, heading })` returning `<ItemList>` plus a conditional `<EditorSheet>` holding today's `PhotoField` + `alt` `Field` pair verbatim. The staged-key composition (`galleries.json:${prefix}:${rowId}:src` at `:274`; `galleries.json:heroCollage:${photoId}:src` at `:363`) must be copied **character for character** — `dirtyDraftMap`'s scrubbing (`publish.ts:381-404`), `clearSent`, `Thumbnail`'s `previewKey` and `PhotoField`'s `previews.set` all key off it.

- [ ] **Step 4: The mapping for Add, Remove and Move, which three existing tests assert by name**

`GalleryImageList` renders `Add an atmosphere photo` (`:290`), `Remove ${heading} photo ${index + 1}` (`:239`) and `Move ${heading} photo ${n} up`/`down` (`:219`, `:229`), and `GalleryList.test.tsx:169, 176, 183` assert all three by those names. The mapping is:

| Today | After | Test change |
|---|---|---|
| `Add an atmosphere photo` (a bare button under the list) | `ItemList`'s `addLabel`, at the top | unchanged name, so `:169` keeps working — but assert it renders **above** the first row, as in Task 2 |
| `Remove ${heading} photo ${n}` on the row | `EditorSheet`'s `onDelete`, `deleteLabel={`Remove ${heading} photo ${n}`}` | `:176` must open the row first, then find the same label inside the dialog, then confirm |
| `Move ${heading} photo ${n} up/down` | `ItemList` generates `Move ${row.name} up/down` from the row's name | `:183` is renamed to the alt-derived name; keep the same two-position assertion |

Row name: `image.alt || 'Photo with no description yet'`. Alt text is the only human string a gallery image has, and a blank alt is also a validation failure (`validate.ts:465-482`), so the fallback name and the "needs attention" marker appear together, which is correct.

- [ ] **Step 5: Hero-collage rows keep no thumbnail, and the test that checks that must be re-pointed**

`thumbnail-rows.test.tsx:96` ("the hero collage rows carry none") keeps its claim, but **not** its lookup: it finds the collage row via `getAllByLabelText('Photo')` and `.closest('li')`, and the `PhotoField` now lives inside a dialog rather than an `<li>`. Re-point it at `[data-item-row]` and assert the row carries no `[data-thumbnail]`.

- [ ] **Step 6: Apply the `shown`/`banner` partition to each of the three lists' `bannerFor` outputs**, so a blank alt on photo seven is on screen with every editor closed.

- [ ] **Step 7: Re-record `Galleries (galleries)` with `CI=true`, then `npx tsc -b --noEmit && npx eslint . && npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `galleries.json:${prefix}:${rowId}:src` → `galleries.json:${rowId}:src` | the staged-photo case in the Galleries tests ("the photo she picked shows on the row she picked it for") — if no such case exists, **write it first**; the key shape has no compiler link and `staged.ts` accepts any string |
| one `openKey` → one `useState` per list | new case "opening an Our Story photo closes the atmosphere one" |
| `image.alt \|\| 'Photo with no description yet'` → `image.alt` | new case "a photo with no description still has a row you can click" |
| add a `thumbnail` to the hero-collage rows | `thumbnail-rows.test.tsx` "the hero collage rows carry none", re-pointed per Step 5 |
| revert one list's banner to the old `bannerFor` | new case "with every editor closed, a blank photo description is still on screen" |
| move Add below the list | the re-pointed `:169` position assertion |

**If this task is wrong:** the OWNER stages a photo that publishes onto a different tile, or publishes a gallery image with no alt text. A VISITOR on a screen reader gets an unnamed photograph; a sighted VISITOR may get the wrong one.

**Browser-only:** nothing new. The hero collage's geometry specs read `galleries.json` and the public page, not this panel — confirm with `grep -l "manage" e2e/collage-*.spec.ts` before assuming.

---

## Task 6: Pages — one row per page, its sections inside the editor

**Files:**
- Modify: `src/admin/PageList.tsx`
- Modify: `src/admin/__tests__/PageList.test.tsx`
- Re-record: the `Pages (pages)` snapshot key (15 lines today — `pages.json` is `[]` in the fixture)

**Interfaces:** consumes `EditorSheet`, `ItemList`, `ItemRow`. `PageListProps` unchanged. `PageList` already holds `const [openIndex, setOpenIndex] = useState<number | null>(null)` at **`:46`**; this task replaces that index with the page's own `slug`.

- [ ] **Step 1: Key the open state on the slug**

`const [openSlug, setOpenSlug] = useState<string | null>(null)`, with `openIndex` derived by `items.findIndex((p) => p.slug === openSlug)`. Editing the slug field must re-point it in the same tick, exactly as Task 4 Step 2 does for a menu id.

- [ ] **Step 2: Rows**

```tsx
{ id: page.slug, name: page.name || page.slug, needsAttention: pageProblems.length > 0 }
```

`Page` is `{ slug, name, inNav, enabled, seo, sections }` (`src/content/types.ts:552-559`) — there is **no `title`** field; `PageList.tsx:76` already uses `page.name || 'Untitled page'`, and `page.seo.title` is a different thing. **No thumbnail** — see Task 4 Step 4 for why Pages keeps none, and leave `thumbnail-rows.test.tsx:158`'s Pages case untouched.

`needsAttention` reuses the page-scoped filter the file already computes (`PageList.tsx:68-70`):
```tsx
const pagePrefix = `[${index}]`;
const pageProblems = problems.filter(
  (p) => p.field === pagePrefix || p.field.startsWith(`${pagePrefix}.`) || p.field.startsWith(`${pagePrefix}[`),
);
```

- [ ] **Step 3: The `Shown on the site` checkbox moves into the editor**

Every `PageList` row carries a live checkbox and its explanatory `<p>` (`:95-122`), outside the `isOpen` block. `ItemList`'s row **is** a `<button>`, and a checkbox inside a button is nested interactive content, which no browser resolves the way either control expects. Two options; this plan takes the first:

1. **Move the checkbox into the editor** (chosen). The spec's row is "a small square thumbnail and the item's name. Nothing else", and Pages is listed as list + editor. Cost: turning a page off is now two taps instead of one.
2. Hand-roll the row as Task 8 does for `SectionList`. Rejected here because `SectionList` has *no* editor and the toggle is its only control, which is not true of Pages.

Move the `<input type="checkbox">` and its `<p>` into `EditorSheet`'s children unchanged, and re-point whichever `PageList.test.tsx` case asserts the toggle so it opens the row first.

- [ ] **Step 4: The page's fields and its nested `TemplateSectionList` move into the sheet unchanged**

`TemplateSectionList` keeps its `rowPrefix`/`idPrefix`/`stage`/`previews` bindings verbatim — the staged key shape (`page-<index>:...`, `PageList.tsx:14-18`) must not move, because `dirtyDraftMap`'s counterpart lookup keys off it.

- [ ] **Step 5: Decide `onMove` by reading the staged key, and record the reason**

That key is `page-<index>`, positional. Re-read `PageList.tsx:14-18` and every `stage(...)` call site in `TemplateContentForm.tsx`:

- If any key is index-derived (expected), **pass no `onMove`** and keep the Up/Down buttons off too, matching today's local `swap` (`:48-54`) — which is then deleted, because `noUnusedLocals`. Write the reason into the file: reordering pages while an upload is staged already orphans it today; adding drag would widen a hole rather than open a new one, and this task is not the place to fix the key shape.
- If every key is slug-derived, pass `onMove={(from, to) => onChange(moveTo(items, from, to))}`, delete `swap`, and delete this paragraph.

- [ ] **Step 6: Re-record `Pages (pages)` with `CI=true`; `npx tsc -b --noEmit && npx eslint . && npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `openSlug` → `openIndex` state | new case "moving a page while its editor is open keeps the same page open" — **only if Step 5 chose to pass `onMove`; delete this row otherwise** rather than let it predict an impossible failure |
| `name: page.name \|\| page.slug` → `name: page.name` | new case "a page with no name still has a clickable row" |
| `needsAttention` → `false` | new case "with the editor closed, a page's own problem is still on screen" |
| drop `setOpenSlug(next)` from the slug field | new case "renaming a page's address leaves its editor open" |
| leave the checkbox on the row | new case "the row is a button and holds no other control": `expect(within(row).queryByRole('checkbox')).toBeNull()` |

**If this task is wrong:** the OWNER edits the wrong page's sections, or cannot turn a page off. A VISITOR sees a template page with another page's content on it.

---

## Task 7: Posts — one row per post, meta and blocks inside the editor

**Files:**
- Modify: `src/admin/PostList.tsx`, `src/admin/areas/PostsArea.tsx`
- Modify: `src/admin/__tests__/PostList.test.tsx`
- Modify: `e2e/block-editor.spec.ts` (three helpers, not one)
- Re-record: the `Posts (posts)` snapshot key

**Interfaces:** consumes `EditorSheet`, `ItemList`, `ItemRow`. `PostListProps.onAdd` changes to `() => string` to match Task 3; `PostsArea.tsx:120` becomes `onAdd={() => { const blank = blankPost(); commit([...items, blank]); return blank.id; }}`.

- [ ] **Step 1: `const [openId, setOpenId] = useState<string | null>(null)`, keyed on `post.id`** (posts carry a real id, so no re-pointing dance).

- [ ] **Step 2: Rows, counting block problems as well as meta ones**

```tsx
{
  id: post.id,
  name: post.title || 'Untitled post',
  thumbnail: <Thumbnail path={post.image ?? null} previewKey={`posts.json:${post.id}:image`} previews={previews} />,
  needsAttention:
    problems.some((p) => arrayIndexOf(p.field) === index) ||
    problems.some((p) => blockProblemOf(p.field)?.post === index),
}
```

`block-problems.ts:18`'s `BLOCK_PROBLEM` regex gives the post index for a block problem; `arrayIndexOf` gives it for a meta field. Both halves are needed.

- [ ] **Step 3: Move `RecordForm<PostMeta>` and `BlockList` into the sheet unchanged**, including `data-testid="post-form"` and every `onStaged` key (`posts.json:${post.id}:${field}`). **Do not touch `BlockList`** — Section B replaces its contents in place, inside this same editor.

- [ ] **Step 4: Extract today's focus walk, then have the jump open an editor first**

`PostList.tsx:114`'s `FIRST_PROBLEM_SELECTOR = '[aria-describedby*="-error"], [role="alert"]'` is queried with `querySelector` in document order across the whole panel (**the query is at `PostList.tsx:190`**), and the "Take me to the first one" button (`:214-235`) depends on it. With the editor closed there are no field-level errors in the DOM, so the button would land on the list banner and go no further.

There is no `focusFirstProblem` function today — the existing body **is** `goToFirstProblem` (`:189-210`). Extract that body verbatim as `focusFirstProblem()`, then:

```tsx
  function goToFirstProblem() {
    const firstBad = items.findIndex(
      (_, index) =>
        problems.some((p) => arrayIndexOf(p.field) === index) ||
        problems.some((p) => blockProblemOf(p.field)?.post === index),
    );
    if (firstBad === -1) return;
    if (openId !== items[firstBad].id) setOpenId(items[firstBad].id);
    // After the editor has rendered its fields, not before -- the selector
    // walk finds nothing in a DOM that has not painted them yet.
    requestAnimationFrame(() => focusFirstProblem());
  }
```
(`requestAnimationFrame` is stubbed by jsdom and fires; assert with `await waitFor`.)

- [ ] **Step 5: `e2e/block-editor.spec.ts` — three helpers move, not one**

`POSTS_PANEL = '[data-area="story"]:not([hidden]) [data-panel="posts"]'` (`:31`) still resolves. But the post form and `BlockList` are no longer inside an `<li>`, so:

- `openPostsPanel` (`:38-56`) gains a click on a row and a wait for the dialog:
```ts
  await page.locator(`${POSTS_PANEL} [data-item-row]`).first().click();
  await page.locator(`${POSTS_PANEL} [role="dialog"]`).waitFor();
```
- `addPost` (`:62-68`) counts `panel.locator('li:has([data-testid="post-form"])')` and asserts `before + 1`. Re-point it at `[data-item-row]` for the count, and have it open the **last** row afterwards (it works on the newest post, which is why it must not reuse `openPostsPanel`'s first-row click).
- `kindsOf` (`:73-77`) reads `[data-drag-handle]` inside that `<li>`. Re-point it at `[role="dialog"] [data-drag-handle]`.

All four cited assertions (`:218` `'a block dragged onto another one lands there, and the others slide'`, `:251`, `:270` `'the handle shows a move cursor, which is its only affordance'`, `:283`) run through these helpers and must keep testing exactly what they test.

- [ ] **Step 6: Re-record `Posts (posts)` with `CI=true`; `npx tsc -b --noEmit && npx eslint . && npm test -- --run`. Then, when nothing else is running: `npm run test:e2e -- block-editor`.**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop the `blockProblemOf(...)` half of `needsAttention` | new case "a post whose only problem is inside a block still says needs attention" |
| `goToFirstProblem` calls `focusFirstProblem()` without opening the editor | existing "Take me to the first one" case, re-pointed to assert focus lands on a real field inside the dialog |
| `onAdd` returns `''` | new case "Add a post opens the editor on the new post" |
| revert the three e2e helpers | `e2e/block-editor.spec.ts:218` — no handle exists until a post is open. **e2e only, and `npm test` will not catch it** |
| `id: post.id` → `id: post.slug` | new case "clicking the second untitled post opens the second one" — both slugs are `''` from `blankPost`, so `findIndex` resolves to the first and the wrong editor opens. (React still renders both rows on a duplicate key, so a "both have a row" assertion would stay green — this is the falsifiable form.) |

**If this task is wrong:** the OWNER writes a post into the wrong record, or the "take me to the problem" button dead-ends. A VISITOR sees nothing until a broken post is published; `validatePost` server-side still refuses one with no blocks.

---

## Task 8: What shows on the homepage — drag the rows, keyboard fallback intact

**Files:**
- Modify: `src/admin/SectionList.tsx`
- Modify: `src/admin/__tests__/SectionList.test.tsx`
- Re-record: the `What shows on the homepage (sections)` snapshot key (`:4236-4729`)

**Interfaces:** consumes `drag-row.ts` and `moveTo` only — **no `ItemList`, no `EditorSheet`**. The spec: "No editor — the only things to change are order and on/off, and both belong on the row." `SectionListProps` is unchanged.

- [ ] **Step 1: State why this one panel does not use the shared list, in the file**

```tsx
// The one list panel that does NOT use ItemList, and the reason is
// structural rather than stylistic: every row here carries a live checkbox
// (`Shown on homepage`), and ItemList's row IS a <button> -- a checkbox
// inside a button is nested interactive content, which no browser resolves
// the way either control expects. This panel takes the same drag handle and
// the same dimming from drag-row.ts, so the two lists still behave
// identically under a finger; it just does not share the row element.
```

- [ ] **Step 2: Add the drag handlers**

`const [dragging, setDragging] = useState<number | null>(null)`; wrap each `<li>` with the `onDragOver`/`onDrop` pair from Task 2 Step 3; put the handle span (`HANDLE_CLASSNAME`, `HANDLE_STYLE`, `data-drag-handle={index}`, ``title={`Drag to move ${name}`}``) before the name.

```tsx
              onDrop={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                if (dragging !== index) onReorder(moveTo(items, dragging, index).map((s) => s.id));
                setDragging(null);
              }}
```

- [ ] **Step 3: Keep `swap`, keep both Up and Down buttons exactly as they are** (`:86-92`, `:142-161`). The spec is explicit: "including the fallback — dragging is not the only way to move something." A `hidden`-attribute or breakpoint-gated variant is not acceptable; `BlockList.tsx:120-126` records why the handle stays visible on a phone rather than costing a breakpoint rule.

- [ ] **Step 4: Hero's disabled toggle (`:169`) and its explanatory `<p>` (`:175-179`) stay untouched** — that is the by-construction half of `assertSections`' rules.

- [ ] **Step 5: Re-record the snapshot key with `CI=true`; `npx tsc -b --noEmit && npx eslint . && npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| delete both Up/Down buttons, leaving only the handle | `SectionList.test.tsx:154` `'moving a section down swaps it with its neighbour, by id order'` (and `:146`, the omitted-at-the-ends naming) |
| `moveTo(...)` → `swapAt(...)` in `onDrop` | `e2e/editor-surface.spec.ts` "dragging the last homepage section to the top slides the others" — **e2e only.** jsdom cannot fire a usable `dragStart` |
| remove `disabled={isHero}` from the hero toggle | `SectionList.test.tsx:89` `"hero's own checkbox is disabled"` (and `:96`) |
| add an `onOpen`/editor to this panel | new case `expect(within(panel).queryByRole('dialog')).toBeNull()` after clicking a row — write this, because otherwise "no editor" is a claim nothing holds |

**If this task is wrong:** the OWNER reorders the homepage into an order she did not choose, or cannot reorder it on a phone at all. A VISITOR sees the homepage sections in the wrong order — the most visible failure in this section.

**Browser-only:** the drag itself, the dimmed row in flight, and the handle's cursor. All in Task 11.

---

## Task 9: Words on the site — a row per section, a sheet of its strings

**Files:**
- Modify: `src/admin/areas/DetailsArea.tsx` (`CopySection`, `:138-237`)
- Modify: `src/admin/sections/copy-fields.ts` (one comment, no logic)
- Create: `src/admin/sections/__tests__/copy-fields.test.ts` (this directory does not exist yet; `copy-fields.ts` has no test file at all)
- Modify: `src/admin/__tests__/owner-facing-labels.test.tsx` **only if** an assertion there reads copy group headings — check before editing
- Re-record: the `Words on the site (copy)` snapshot key (`:4730-5468`, the largest of the thirteen)

**Interfaces:** consumes `EditorSheet`, `ItemList`, `ItemRow`. `COPY_GROUPS` (`copy-fields.ts:42`) is already the row list this needs: ten groups, each `{ section, heading, keys }`.

- [ ] **Step 1: The open state goes beside the existing `useState` at `DetailsArea.tsx:139`**

`CopySection` returns early at `:164-173`. A hook declared after those returns changes the hook count between renders and fails `react-hooks/rules-of-hooks` — the same trap as Task 4 Step 1. Declare `const [openSection, setOpenSection] = useState<string | null>(null)` at `:139`, and derive `const openGroup = COPY_GROUPS.find((g) => g.section === openSection)` after the returns.

- [ ] **Step 2: Rows, one per group, no thumbnail**

```tsx
  const rows: ItemRow[] = rows0.map((group) => ({
    id: group.section,
    name: group.heading,
    needsAttention: group.fields.some((f) => f.problems.length > 0),
  }));
```
where `rows0` is today's `rows` constant (`:193-196`) — rename it so the two do not collide.

- [ ] **Step 3: Replace the `rows.map(...)` render block (`:214-234`) with the list plus the sheet**

```tsx
      <ItemList rows={rows} onOpen={setOpenSection} />
      {openGroup !== undefined && (
        <EditorSheet title={openGroup.heading} onClose={() => setOpenSection(null)}>
          {rows0
            .find((g) => g.section === openGroup.section)!
            .fields.map(({ key, problems: fieldProblems }) => (
              <div key={key}>
                <Field
                  id={`copy-${key}`}
                  spec={COPY_FIELDS[key]}
                  value={leafValue(state.data, key)}
                  onChange={(next) => commit(withLeaf(state.data, key, next))}
                  problems={fieldProblems}
                />
                {key === 'footer.followLabel' && (
                  <p className="-mt-3 mb-4 text-xs text-gray-500">
                    {`Shown with its non-breaking space marked: ${withVisibleNbsp(leafValue(state.data, key))}`}
                  </p>
                )}
              </div>
            ))}
        </EditorSheet>
      )}
```

- [ ] **Step 4: Narrow `matched` to the open group, or a closed group's problem vanishes**

`CopySection`'s `matched` Set (`:187-192`) is built by `leafProblems(key)` over **every** group's keys at `rows0` construction time — before any rendering — so a leaf problem in a closed group is `matched` and therefore excluded from the banner. That is now a silent loss.

```tsx
  // Only the group whose sheet is open can claim a leaf problem, because
  // only its Fields are mounted. Every other leaf problem falls to the
  // banner below -- the same rule this dashboard's other twelve panels
  // follow, restated for a panel whose rows are groups rather than records.
  const openGroupMatched = new Set(
    openGroup === undefined ? [] : openGroup.keys.flatMap((key) => leafProblems(key)),
  );
  const banner = problems.filter((p) => !openGroupMatched.has(p));
```

- [ ] **Step 5: The heading-collision comment, and a test for it**

`copy-fields.ts:16-22` records that group headings were chosen so none collides with another `role="heading"` on the page. `EditorSheet` renders the title as an `<h3>`, and the group heading is now *also* an `ItemList` row button name, so `getByRole('button', { name: 'Footer' })` is new. Extend that comment with the button collision, then create `src/admin/sections/__tests__/copy-fields.test.ts`:

```ts
it('no copy group heading collides with a panel heading', () => {
  const panelHeadings = new Set(Object.values(PANELS).map((p) => p.heading));
  COPY_GROUPS.forEach((g) => expect(panelHeadings.has(g.heading)).toBe(false));
});
```
(`PANELS` is in `src/admin/manage/areas.ts` and carries `.heading`; verified today that none of the ten group headings collides.)

- [ ] **Step 6: Re-record `Words on the site (copy)` with `CI=true`; `npx tsc -b --noEmit && npx eslint . && npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| revert `matched` to the all-groups version | new case "a problem in a closed group is still on screen" (blank `hero.headline`, open no group, assert the message is in the banner) |
| `needsAttention` → `false` | new case "the group holding the problem says needs attention" |
| render every group's `Field`s instead of only the open one | new case "opening Footer shows Footer's strings and not the Hero's" (`queryByLabelText` for a hero leaf's label returns null) |
| rename a `COPY_SECTION_HEADINGS` value to `'Opening hours'` | the new copy-fields collision test |
| declare `openSection` after the early returns | `npx eslint .` (`react-hooks/rules-of-hooks`) |

**If this task is wrong:** the OWNER edits the homepage headline and it goes into the footer, or a copy problem she must fix before publishing is invisible. A VISITOR sees the wrong words on the homepage, or a 422 stops the publish and the site stays stale.

---

## Task 10: About — the enforced length limit; Opening hours — pinned unchanged

**Files:**
- Modify: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`
- Modify: `src/admin/StoryForm.tsx`, `src/admin/__tests__/StoryForm.test.tsx`
- Modify: `src/admin/__tests__/thumbnail-rows.test.tsx` (one added case for hours)
- Re-record: the `About (story)` snapshot key (`:3-414`)

**Interfaces:**
```ts
// src/content/validate.ts, at MODULE scope (validateStory is declared at :348;
// :373-384 is the paragraph loop inside it)
export const ABOUT_MAX_CHARS = 2000;
```
Consumed by `StoryForm.tsx` for the live counter, so the number exists once.

**About does NOT become a list.** The spec's per-panel table gives About one shape — "The writing surface, with an enforced length limit" — and does not put it behind a row. This task delivers the limit and the counter against today's paragraph textareas; Section B replaces the textarea stack inside `StoryForm` in place, and the counter and the validator survive that replacement untouched. That is the seam.

- [ ] **Step 1: Measure the committed content first**

```
node -e "const s=require('./src/content/story.json');console.log(s.paragraphs.join(' ').length)"
```
This prints **1366** today (6 paragraphs: 265, 419, 373, 166, 92, 46). Re-run it on the branch rather than trusting this line.

- [ ] **Step 2: The constant, at module scope in `validate.ts`**

```ts
// The About section's own budget, in characters across every paragraph.
// The section is a fixed slab on the homepage (OurStory.tsx) and its
// neighbours are laid out around it; there is no scroll inside it, so a
// third again as much prose does not make the section taller, it makes the
// page's rhythm wrong.
//
// 2000 rather than a round-sounding number: the committed About is 1366
// characters (six paragraphs, measured on this branch), and this leaves
// roughly half again as much. Whitespace counts, because whitespace takes
// space on the page. The heading and the chef byline do not -- neither
// grows with the prose.
export const ABOUT_MAX_CHARS = 2000;
```

- [ ] **Step 3: The rule, inside `validateStory` after the per-paragraph loop**

```ts
  const aboutLength = Array.isArray(story.paragraphs)
    ? story.paragraphs.filter((p): p is string => typeof p === 'string').join(' ').length
    : 0;
  if (aboutLength > ABOUT_MAX_CHARS) {
    problems.push(
      problem(
        'paragraphs',
        `the About section is ${aboutLength} characters long — trim it to ${ABOUT_MAX_CHARS} or fewer so it still fits its place on the page`,
      ),
    );
  }
```
`field: 'paragraphs'` and not an indexed field, deliberately: no single paragraph is at fault, and `StoryForm`'s existing banner already claims the bare `paragraphs` field (`StoryForm.tsx:85`), so this lands with no new plumbing.

- [ ] **Step 4: The live counter in `StoryForm.tsx`**, under the paragraph `<ul>` and above the Add button:

```tsx
      {/* Live, not only on the debounce tick: the validator's own message
          arrives 400ms after she stops typing and says she is over. This
          says how much room is left while she is still writing, which is the
          difference between a limit and a rejection. `role="status"` and not
          `role="alert"` -- an alert here would drive CollapsibleSection's
          folded marker on every keystroke of a perfectly fine paragraph. */}
      <p role="status" className="mb-2 font-['Montserrat'] text-xs text-gray-500">
        {`${value.paragraphs.join(' ').length} of ${ABOUT_MAX_CHARS} characters`}
      </p>
```

- [ ] **Step 5: Opening hours is unchanged, and that needs a pin**

In `thumbnail-rows.test.tsx`, keep the existing Opening-hours no-thumbnail case and add:

```tsx
it('Opening hours is still a form, not a list', async () => {
  markEveryAreaSeeded();
  stubFetchWithPhotos();
  renderDashboard('/edit/manage/details');
  const el = await openPanel('Opening hours', 'hours');
  expect(el.querySelectorAll('[data-item-row]')).toHaveLength(0);
  expect(within(el).queryByRole('dialog')).toBeNull();
  expect(within(el).getAllByRole('textbox').length).toBeGreaterThan(0);
});
```

- [ ] **Step 6: Validator cases**

`VALID_STORY` is declared **inside** `describe('story.json chef intro')` at `src/content/__tests__/validate.test.ts:1225`, so these cases live in that describe (or hoist the fixture). `storyJson` is not imported in that file today — add `import storyJson from '../story.json'` (`resolveJsonModule` is on).

```ts
it('accepts an About section at the limit exactly', () => {
  const paragraphs = ['x'.repeat(ABOUT_MAX_CHARS)];
  expect(validateContent('story.json', { ...VALID_STORY, paragraphs })).toEqual([]);
});
it('refuses an About section one character over', () => {
  // TWO paragraphs of half the limit each, so the joining space is the only
  // thing that crosses the line -- that is what makes the join(' ') vs
  // join('') mutation below falsifiable.
  const half = 'x'.repeat(ABOUT_MAX_CHARS / 2);
  const problems = validateContent('story.json', { ...VALID_STORY, paragraphs: [half, half] });
  expect(problems.map((p) => p.field)).toContain('paragraphs');
  expect(problems[0].message).toContain(String(ABOUT_MAX_CHARS));
});
it('the committed About section is inside the limit', () => {
  expect(storyJson.paragraphs.join(' ').length).toBeLessThanOrEqual(ABOUT_MAX_CHARS);
});
```
The third is not decoration: a limit the shipped content already breaks would refuse her next publish of a file she has not touched.

- [ ] **Step 7: The `StoryForm` counter case, against that file's real fixture**

`src/admin/__tests__/StoryForm.test.tsx:27-30` uses a synthetic `STORY` of two short paragraphs (33 + 1 + 28 characters), **not** the committed `story.json`. So:

```tsx
it('the About form says how much room is left', () => {
  renderStoryForm();
  expect(screen.getByText('62 of 2000 characters')).toBeInTheDocument();
});
```

The `role="status" → role="alert"` mutation asks about `CollapsibleSection`'s folded marker (`:191-193`), and `StoryForm.test.tsx` renders `StoryForm` bare with no `CollapsibleSection`. That case therefore goes in a **panel-level** file (`src/admin/__tests__/thumbnail-rows.test.tsx`'s `openPanel` helper, or wherever the About panel is already mounted), not here.

- [ ] **Step 8: Re-record `About (story)` with `CI=true`; `npx tsc -b --noEmit && npx eslint . && npm test -- --run && npm run test:deploy`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `aboutLength > ABOUT_MAX_CHARS` → `>=` | "accepts an About section at the limit exactly" |
| `ABOUT_MAX_CHARS = 2000` → `1000` | "the committed About section is inside the limit" |
| delete the whole length block from `validateStory` | "refuses an About section one character over" |
| `join(' ')` → `join('')` in the validator but not the counter | "refuses an About section one character over" — falsifiable *because* the fixture is two half-limit paragraphs |
| delete the counter `<p>` from `StoryForm` | "the About form says how much room is left" |
| `role="status"` → `role="alert"` on the counter | the panel-level case: fold the About panel and assert the "needs attention" marker is absent |
| turn Opening hours into a list | "Opening hours is still a form, not a list" |

**If this task is wrong:** the OWNER cannot publish an About section she is happy with, or publishes one that overruns its slab. **A VISITOR is reachable here and nowhere else in this section:** `validate.ts` is the write boundary the Worker runs too, so a bad constant makes the server reject a legitimate publish and the live site stays stale. Note the deploy split — `npm run test:deploy` runs on Cloudflare and `npm test` does not; `validate.test.ts` is in both, so run both.

---

## Task 11: `e2e/editor-surface.spec.ts` — everything jsdom cannot say

**Files:**
- Create: `e2e/drag.ts` (export `startDragging`, lifted from `e2e/block-editor.spec.ts:154-196`)
- Create: `e2e/editor-surface.spec.ts`
- Modify: `e2e/dashboard-sections.spec.ts:230-243`

**Interfaces:** consumes `mockEditBackend` and the area/panel constants the existing specs import (`e2e/dashboard-sections.spec.ts:1-6`), plus `startDragging` — **export it into `e2e/drag.ts` rather than copying it**; its instrumented event trace (`block-editor.spec.ts:86-97`) is the record of why `locator.dragTo` cannot work here. Section B deletes `block-editor.spec.ts`, so this move must happen here, not there.

- [ ] **Step 1: The spec, at the two viewports this project already uses**

Every assertion is a computed-style, geometry or real-input claim. Note the two errors this sketch does **not** make: `dialog` is resolved inside each test, and the containing-block test sets its own viewport, because Playwright resets to the config viewport per test and the sheet is centred (`y > 0`) at desktop width.

```ts
import { expect, test } from '@playwright/test';
import { startDragging } from './drag';

const DIALOG = '[data-panel="dishes"] [role="dialog"]';

test.describe('the editor surface', () => {
  test('at 1280 it is a centred dialog with the page still visible behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // open Dishes, click the first row
    const box = (await page.locator(DIALOG).boundingBox())!;
    expect(box.width).toBeLessThan(1280 * 0.7);
    expect(Math.abs((box.x + box.width / 2) - 640)).toBeLessThan(4);
    expect(box.y).toBeGreaterThan(0);
  });

  test('at 390 it is a full-screen sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const box = (await page.locator(DIALOG).boundingBox())!;
    expect(box.width).toBe(390);
    expect(box.height).toBe(844);
    expect(box.y).toBe(0);
  });

  test('the sheet is positioned against the viewport, not against the panel', async ({ page }) => {
    // The containing-block claim the no-portal decision rests on. Its own
    // viewport, because the assertion is "y does not move", and the sheet's
    // resting y differs between the two layouts.
    await page.setViewportSize({ width: 390, height: 844 });
    const before = (await page.locator(DIALOG).boundingBox())!.y;
    await page.mouse.wheel(0, 600);
    expect((await page.locator(DIALOG).boundingBox())!.y).toBe(before);
  });

  test('hovering a row highlights the whole row', async ({ page }) => {
    const row = page.locator('[data-item-row]').first().getByRole('button');
    const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    await row.hover();
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
  });

  test('keyboard focus highlights the row too', async ({ page }) => { /* .focus(), same read */ });

  test('dragging a dish three rows down slides the others', async ({ page }) => {
    // startDragging from e2e/drag.ts; assert the full name order before/after
    expect(after).toEqual(['Dish B', 'Dish C', 'Dish D', 'Dish A', 'Dish E']);
    // A swap would give ['Dish D','Dish B','Dish C','Dish A','Dish E'] --
    // this ordering is what distinguishes moveTo from swapAt, and it is why
    // there is no jsdom mutation row for that swap.
  });

  test('the row in flight is dimmed, and stops being dimmed once it lands', async ({ page }) => { /* both halves */ });

  test('the drag handle shows a move cursor, read off the handle itself', async ({ page }) => { /* cursor inherits */ });

  test('dragging the last homepage section to the top slides the others', async ({ page }) => { /* Task 8 */ });

  test('Done sits within thumb reach on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const box = (await page.getByRole('button', { name: 'Done' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    // and it is the element the centre pixel resolves to -- hitTestSelf,
    // e2e/dashboard-sections.spec.ts:45
  });
});
```

**Deliberately absent, and why:** there is no "the publish bar does not cover the sheet" test and no "the publish confirmation opens over the editor" test. `PublishBar`'s bar is in-flow, not fixed (`:925`), so there is no overlap to measure; and the confirmation is portalled to the document body while the whole editor lives inside `ManageShell`'s `relative z-10` stacking context (`:269`), so the confirmation wins by containment whatever number the sheet carries. Two mutation rows on `zIndex` were dropped for the same reason — neither could redden.

- [ ] **Step 2: Re-point `e2e/dashboard-sections.spec.ts:230-243`**

It measures the 46–50px thumbnail box "and controls to the right, inside the viewport". The controls moved into the editor. Keep the box measurement against `[data-item-row] [data-thumbnail]` and replace the controls half with "the row's own button extends to the right of the picture and stays inside the viewport". **Do not delete it** — that box size is the one geometric claim about the list that has ever caught anything.

- [ ] **Step 3: Confirm `:434-445` (five phone home rows fit 844px) and `:450-474` (no sidebar variant at 390) still pass** rather than assuming.

- [ ] **Step 4: Run it when nothing else is running; port 8080 is shared: `npm run test:e2e -- editor-surface`.** Note `e2e/block-editor.spec.ts:19-23`'s warning — the dev-server Tailwind JIT never removes rules within a session, so any assertion re-pointed at a *class* needs a cold restart before its result can be believed.

**Mutation table** — every row is browser-only by construction.

| Mutation | Test that must redden |
|---|---|
| drop `sm:m-auto sm:w-[32rem]` (sheet at every width) | "at 1280 it is a centred dialog" (`width` would be 1280) |
| `fixed inset-0 flex` → `absolute inset-0 flex` on the overlay | "the sheet is positioned against the viewport, not against the panel" |
| drop `hover:bg-brand/10` from `ROW_CLASSNAME` | "hovering a row highlights the whole row" |
| drop `focus-visible:outline` from `ROW_CLASSNAME` | "keyboard focus highlights the row too" |
| `onMove(dragging, index)` calls `swapAt` instead of `moveTo` | "dragging a dish three rows down slides the others" |
| delete `style={dragging === index ? DRAGGING_STYLE : undefined}` | "the row in flight is dimmed…" |
| `HANDLE_STYLE` → `{ cursor: 'pointer' }` | "the drag handle shows a move cursor" |

**If this task is wrong:** the OWNER on her phone gets a dialog she can only half see. A VISITOR sees nothing.

---

## Task 12: Re-measure the CSS ceiling and close Section A's bookkeeping

**Files:**
- Modify: `src/test/bundle.post-build.test.ts` (the assertion at `:719` **and** the test name at `:715` — they have drifted apart once before, `:511-514`)
- Modify: `src/test/hosting.test.ts:382` (a comment, not an assertion)
- Verify untouched: `src/admin/manage/__tests__/areas.test.tsx`, `src/admin/__tests__/owner-facing-labels.test.tsx`, `src/test/homepage-bytes.test.tsx`

- [ ] **Step 1: Build the parent commit in a worktree, never a stash** (this file's own documented method, `:319-713`):
```
git worktree add ../vb-base $(git rev-parse HEAD~1)
cd ../vb-base && npm ci && npm run build
wc -c dist/assets/index-*.css
```
The comment lineage records 38593 for Phase 5A and the ceiling is 38700; **measure, do not quote** — several commits since that entry touched scanned source.

- [ ] **Step 2: Build this branch and measure:** `npm run build && wc -c dist/assets/index-*.css`

- [ ] **Step 3: Diff at rule level, not byte level**

`postcss-cli` is not installed (the `postcss` devDependency ships no bin), so read the built CSS directly:
```
grep -o '^[^{]*{' ../vb-base/dist/assets/index-*.css | sort -u > /tmp/base-rules.txt
grep -o '^[^{]*{' dist/assets/index-*.css | sort -u > /tmp/head-rules.txt
diff /tmp/base-rules.txt /tmp/head-rules.txt
```
Expect roughly: `overflow-y-auto`, `truncate`, `min-w-0`, `sm:m-auto`, `sm:w-[32rem]`, `sm:max-h-[85vh]`, `sm:rounded`, and the new row/Add/Done bindings. Anything on that list you did not intend is a leaked class — check it against the scans-comments rule (`bundle.post-build.test.ts:340-350`, `ManageShell.tsx:59-64`) before raising the ceiling to accommodate it. Paste the resulting list into the test file's ledger with each rule's byte cost.

- [ ] **Step 4: Set the new ceiling to the measured HEAD number rounded up to the next 100, plus 100** — the same shape of headroom 38700 gives 38593. Write **both** places:
```ts
  // Measured on this branch: <N> bytes, up from <M> before the list-and-editor
  // work. The delta is <N-M> bytes across <k> new rules, listed above. The
  // ceiling exists to catch accidental bloat and has done so more than once;
  // it is raised to a measured number here, never deleted.
  it('the entry CSS file stays under <CEILING> bytes', ...)
    expect(size).toBeLessThan(<CEILING>);
```
It runs only under `VB_REQUIRE_DIST=1` (`npm run test:bundle`, reached via `npm run build`); it silently skipped for an entire phase once (`:703-713`), so prove it ran by lowering the ceiling 1 byte, watching it redden, and restoring.

- [ ] **Step 5: Confirm the untouched numbers.** `bundle.post-build.test.ts:263`'s `ADMIN_MARKERS['manage/areas.ts'] = 'Dishes, drinks and the PDF menus'` is `AREAS[0].description` and nothing here reworded an area description, so the 244-character total (`areas.test.tsx:128-131`), the 844px phone-home fold and this marker are untouched: `npm test -- --run src/admin/manage/__tests__/areas.test.tsx`.

- [ ] **Step 6: Correct the count in `src/test/hosting.test.ts:382`** ("17 components set React style props" — a comment). `EditorSheet`, `ItemList` and `SectionList` now set inline styles and `BlockList` still does:
```
grep -rl "style={{\|style={[A-Z_]*STYLE" src/ --include=*.tsx | wc -l
```
Nothing goes red if you skip this, which is exactly why it is a step rather than a hope.

- [ ] **Step 7: `src/test/homepage-bytes.test.tsx:256`'s exact `48074` is the public homepage and is not reachable from anything here.** Confirm with `npm test -- --run src/test/homepage-bytes.test.tsx`; if it moved, something in this section leaked into a public component and that is the finding, not the number.

- [ ] **Step 8: `npm run gate`. Then, alone: `npm run test:e2e`.**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| lower the new ceiling by 1 byte | the ceiling test — **run this deliberately in Step 4; it is the only proof the assertion is not skipping** |
| raise the ceiling by 5000 instead of the measured margin | nothing. **PREDICTED WEAK and unavoidable** — a ceiling that is too generous cannot fail. The mitigation is the rule-level ledger in Step 3, which is what a reviewer reads. |
| add one small unused utility class under `src/admin/` | the ceiling test only if it crosses the margin — **PREDICTED WEAK** for a single 30-byte rule; rely on the ledger diff |
| reword `AREAS[0].description` | `bundle.post-build.test.ts:301-303` marker-presence, and `areas.test.tsx:128-131`'s 244 total |

**If this task is wrong:** nobody sees anything today, and in three phases' time the admin stylesheet has quietly doubled with no commit that can be blamed.

---

# Section B — The writing surface

One continuous editable column replacing `BlockList`'s box-per-block editor, storing the existing `Block[]` unchanged. It lands **after** Section A deliberately: the riskiest thing this project has built arrives against a dashboard that already works, inside an editor that already opens and closes, with a known-good state to roll back to.

The architecture is decision **D5** above, and every task here depends on it. Its consequences, stated once:

1. Only **one** conversion is needed per direction, and both are per-slot and inline-only: `DOM inline subtree → InlineNode[]` (Task 15) and `InlineNode[] → markdown source` (Task 14). The block-boundary reader never has to exist.
2. An edit is `{ ...block, text: next }` — the shape `stable-names.ts:38` describes and `BlockList.tsx:442`'s `rename(from, to, index)` already handles, so staged photos stay attached.
3. `image`, `gallery`, `citation` and the plain-`string` `ingredients.heading` are **atoms**: React-owned, not editable, rendering the existing `BlockFields` controls. Nothing about their staged-upload keys moves.
4. A block she never focuses is never re-serialised, so its committed markdown stays byte-identical. That contains the round-trip hazard to text she has just edited.

Two places the spec and the model disagree, named here rather than discovered in Task 25:

- **Underline and strikethrough have nowhere to be stored.** `InlineNode` (`markdown.ts:29-34`) is four forms. Task 13 adds two. Verified: `src/content/posts.json` contains **zero** `~` and **zero** `_` characters, so no committed content changes meaning.
- **Tab/Shift+Tab nesting has nowhere to be stored.** `bulletList: { items: InlineText[] }` is flat. Task 26 adds an optional `levels?: number[]`. It is the **last** task in this section and is explicitly droppable: everything else ships without it, and dropping it costs only Tab.

Everything about selection, caret, paste and phone keyboards is provable only in a browser (Task 28). The pure modules in Tasks 14, 15, 19, 20 and 21 are pure precisely so the majority of this feature is provable in `npm test`.

---

## Task 13: Two new inline marks — strikethrough and underline

**Files:**
- Modify: `src/content/markdown.ts`, `src/components/blog/Inline.tsx`
- Modify: `src/content/__tests__/markdown.test.ts`, `src/components/blog/__tests__/Inline.test.tsx`

**Interfaces:** produces, for Tasks 14/15/16/20:
```ts
export type InlineNode =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] }
  | { kind: 'strike'; children: InlineNode[] }
  | { kind: 'underline'; children: InlineNode[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: InlineNode[] };
```
Delimiters: `~~strike~~`, `__underline__`. Both **doubled only** — a lone `~` or `_` stays literal, which keeps `snake_case`, `NB0_7576.JPG` and an approximate quantity in prose intact.

- [ ] **Step 1: `const ESCAPABLE = '*`[]()\\~_';`** (`markdown.ts:39`), and the two new members on the node union (`:29-34`).

- [ ] **Step 2: Make `tryDelimited`'s memo pick total**

Replace the two-way pick (`:246-248`) and widen the `kind` parameter; add the two maps to `Cursor` (`:215-217`) and to `parseInline`'s literal (`:376-386`):

```ts
type MarkKind = 'strong' | 'em' | 'strike' | 'underline';

function memoFor(cursor: Cursor, kind: MarkKind): Map<number, Attempt> {
  switch (kind) {
    case 'strong': return cursor.strongMemo;
    case 'em': return cursor.emMemo;
    case 'strike': return cursor.strikeMemo;
    case 'underline': return cursor.underlineMemo;
  }
}
```
`Cursor` gains `readonly strikeMemo: Map<number, Attempt>; readonly underlineMemo: Map<number, Attempt>;` and `parseInline` gains `strikeMemo: new Map(), underlineMemo: new Map(),`.

- [ ] **Step 3: The two doubled-delimiter branches in `parseNodes`**, immediately after the `char === '*'` branch (`:348-356`). Doubled-only is the whole safety property, so the `startsWith` guard is not optional:

```ts
    if (char === '~' && cursor.source.startsWith('~~', cursor.index)) {
      const node = tryDelimited(cursor, '~~', 'strike');
      if (node) { flush(); nodes.push(node); continue; }
    }

    if (char === '_' && cursor.source.startsWith('__', cursor.index)) {
      const node = tryDelimited(cursor, '__', 'underline');
      if (node) { flush(); nodes.push(node); continue; }
    }
```
`atStop` needs no new exception: unlike `*`/`**`, neither has a single-character form to be confused with. (Verified by running the real parser over `via_bianca`, `about ~200g`, `a ~~b`, `a __b`, `a ~~~~ b` and `about ~~~200g`.)

- [ ] **Step 4: Two cases in `Inline.tsx`'s `renderNode` (`:32-70`), before the `default` that carries the `never`:**

```tsx
    case 'strike':
      return <s key={key}>{renderNodes(node.children)}</s>;
    case 'underline':
      return <u key={key}>{renderNodes(node.children)}</u>;
```
No class on either, for the reason `Inline.tsx:15-20` gives for `<strong>`/`<em>`/`<code>`: the browser's own default gives `<s>` a line through and `<u>` a line under. Confirm rather than assume — build, `wc -c dist/assets/index-*.css`, add the cases, build again, diff rule by rule against a **worktree** checkout of the parent. Task 27 is where the ceiling moves.

- [ ] **Step 5: `markdown.test.ts` — a new sibling describe**

```ts
describe('parseInline: strikethrough and underline', () => {
  it('parses a doubled tilde run', () => {
    expect(parseInline('a ~~b~~ c')).toEqual([text('a '), { kind: 'strike', children: [text('b')] }, text(' c')]);
  });
  it('parses a doubled underscore run', () => {
    expect(parseInline('a __b__ c')).toEqual([text('a '), { kind: 'underline', children: [text('b')] }, text(' c')]);
  });
  // The reason both are doubled-only. A single underscore is a real
  // character in a file name and in a social handle, and a single tilde is a
  // real character in prose about approximate quantities.
  it.each([
    ['a lone underscore', 'via_bianca', [text('via_bianca')]],
    ['a lone tilde', 'about ~200g', [text('about ~200g')]],
    ['an unclosed strike run', 'a ~~b', [text('a ~~b')]],
    ['an unclosed underline run', 'a __b', [text('a __b')]],
    ['a closed but empty strike run', 'a ~~~~ b', [text('a ~~~~ b')]],
  ])('%s stays literal: %s', (_name, source, expected) => {
    expect(parseInline(source)).toEqual(expected);
  });
  it('escapes both new delimiters with a backslash', () => {
    expect(parseInline('a \\~\\~b\\~\\~ c')).toEqual([text('a ~~b~~ c')]);
  });
});
```

- [ ] **Step 6: `Inline.test.tsx`**

```tsx
  it('renders strikethrough and underline with no class of their own', () => {
    const { container } = render(<MemoryRouter><Inline text="a ~~b~~ and __c__" /></MemoryRouter>);
    const struck = container.querySelector('s');
    const underlined = container.querySelector('u');
    expect(struck?.textContent).toBe('b');
    expect(underlined?.textContent).toBe('c');
    expect(struck?.getAttribute('class')).toBeNull();
    expect(underlined?.getAttribute('class')).toBeNull();
  });
```

- [ ] **Step 7: `npx tsc -b --noEmit`.** The `never` at `Inline.tsx:66` and the `never` in `blocks.tsx` are what force this to be complete; if either compiles before Step 4, the union edit did not land.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `if (char === '~')` with delimiter `'~'` | "a lone tilde stays literal" — `about ~200g` would try a single-tilde run |
| `if (char === '_')` with delimiter `'_'` | "a lone underscore stays literal" — `via_bianca` becomes an underline node |
| delete `~` from `ESCAPABLE` | "escapes both new delimiters with a backslash" |
| add the two kinds to `markdown.ts` but not to `Inline.tsx` | `npx tsc -b --noEmit` fails at `Inline.tsx:66`'s `never` |
| give `<s>` a class | "renders strikethrough and underline with no class of their own" |

**Deliberately no mutation row for `memoFor`.** Measured: returning `cursor.strongMemo` for `'strike'` leaves both `parseInline('a ~~b~~ c')` and `parseInline('**~~a~~**')` correct. A memo is keyed on index, and the character at an index fixes which delimiter is attempted, so two kinds can never contend for one key. The per-kind split is structure, not behaviour, and no honest jsdom assertion covers it.

**If this task is wrong:** a **visitor** reading a post sees literal `~~` and `__` in the middle of a sentence, or — the reason for doubled-only — sees `pasta_al_forno` rendered with an underline swallowing part of the name.

**Browser-only:** none. Every claim here is a pure-function claim.

---

## Task 14: `InlineNode[]` → markdown source (the serializer that does not exist)

**Files:**
- Create: `src/content/inline-source.ts`, `src/content/__tests__/inline-source.test.ts`

**Interfaces:** consumes `InlineNode` (Task 13). Produces `export function serializeInline(nodes: InlineNode[]): string;` for Tasks 15 and 17.

- [ ] **Step 1: `src/content/inline-source.ts`**

It imports only a type, so it stays as clean as `markdown.ts` for the Worker bundle.

```ts
// The inverse direction markdown.ts never had: an AST back to the source
// string a content field stores. It exists because the writing surface
// (src/admin/writing/) reads a DOM subtree, turns it into InlineNode values,
// and has to write a string into `paragraph.text`.
//
// IT IS NOT A BYTE-LEVEL INVERSE, AND CANNOT BE. parseInline is not
// injective. What this module guarantees instead is RENDER equivalence:
// parseInline(serializeInline(parseInline(s))) is the same tree as
// parseInline(s), once adjacent text siblings are merged. That is the
// property the surface needs, and inline-source.test.ts proves it over a
// corpus rather than over examples.
import type { InlineNode } from './markdown';

const MARKER: Record<'strong' | 'em' | 'strike' | 'underline', string> = {
  strong: '**', em: '*', strike: '~~', underline: '__',
};

// The backslash goes first, so an escape added below is never re-escaped.
// `~` and `_` are escaped in two positions only: before another `~` or `_`,
// where they would form a delimiter, and at the END of a node, where the
// character that follows is emitted by the NEXT sibling and is not visible
// from here. Without that second case, serializing strike("a~") produces
// `~~a~~~`, which re-parses as strike("a") followed by a loose tilde -- the
// tilde falls out of the mark. Everywhere else a lone `~` or `_` is left
// exactly as she typed it, which is what keeps a file name or an
// approximate quantity free of backslashes she never wrote.
function escapeText(value: string): string {
  return value
    .split('\\').join('\\\\')
    .replace(/[*`[\]()]/g, (char) => `\\${char}`)
    .replace(/[~_](?=[~_])|[~_]$/g, (char) => `\\${char}`);
}

export function serializeInline(nodes: InlineNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: InlineNode): string {
  switch (node.kind) {
    case 'text':
      return escapeText(node.value);
    case 'code':
      // A backtick inside a code span has no escape in this grammar --
      // parseNodes stops a run at the next backtick -- so a value carrying
      // one cannot be written back as a code span at all. It becomes plain
      // words: lossy in appearance, never lossy in meaning. dom-inline.ts
      // makes the same call at the other end, so the two agree.
      return node.value.includes('`') ? escapeText(node.value) : `\`${node.value}\``;
    case 'strong':
    case 'em':
    case 'strike':
    case 'underline': {
      const inner = serializeInline(node.children);
      // An empty run is DROPPED rather than emitted. '****' is not an empty
      // bold run to this parser -- the empty-body guard makes it four
      // literal asterisks on the page, a visible corruption of a field she
      // thought was empty. parseInline never produces one; readInline does.
      return inner.length === 0 ? '' : `${MARKER[node.kind]}${inner}${MARKER[node.kind]}`;
    }
    case 'link':
      // A link with no label IS kept, unlike an empty mark: parseInline
      // accepts `[](/menu)` and produces a link node with no children
      // (tryLink has no empty-body guard), so dropping it here would break
      // the round trip on a real input. The surface's own link tool never
      // creates one -- marks.ts inserts a placeholder word.
      return `[${serializeInline(node.children)}](${node.href})`;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}
```

There is deliberately **no `mergeText` pass.** The end-of-node half of the escape rule subsumes it: a node ending in `~` is escaped whether or not the next sibling starts with one. A merge pass would be a branch no test could redden.

- [ ] **Step 2: The equivalence helper**

```ts
import { describe, it, expect } from 'vitest';
import { parseInline, type InlineNode } from '../markdown';
import { serializeInline } from '../inline-source';

// Two trees are RENDER-equivalent when they differ only in how their text is
// chunked. Inline.tsx renders a text node as a bare string, so ['a','b'] and
// ['ab'] produce identical DOM -- and the serializer legitimately re-chunks.
function normalise(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  nodes.forEach((node) => {
    const last = out[out.length - 1];
    if (node.kind === 'text') {
      if (node.value.length === 0) return;
      if (last !== undefined && last.kind === 'text') {
        out[out.length - 1] = { kind: 'text', value: last.value + node.value };
        return;
      }
      out.push(node);
      return;
    }
    if (node.kind === 'code') { out.push(node); return; }
    out.push({ ...node, children: normalise(node.children) });
  });
  return out;
}

function roundTrips(source: string): void {
  const once = parseInline(source);
  const twice = parseInline(serializeInline(once));
  expect(normalise(twice), `round trip changed: ${JSON.stringify(source)}`).toEqual(normalise(once));
}
```

- [ ] **Step 3: The named cases — every non-round-trippable input `markdown.test.ts` pins, plus the two the measurement found**

```ts
describe('serializeInline round-trips what parseInline produces', () => {
  it.each([
    ['plain words', 'Rest the dough for an hour.'],
    ['bold', 'Rest the **dough** for an hour.'],
    ['emphasis inside bold', '**a *b* c**'],
    ['strike and underline', 'a ~~b~~ and __c__'],
    ['inline code', 'Set `220 C` and wait'],
    ['a site link', 'See [the menu](/menu) tonight'],
    ['an off-site link', 'See [the piece](https://example.com/a_(b)/c) now.'],
    ['a link with no label', '[](/menu)'],
    ['an unclosed bold run', 'Add **salt to taste'],
    ['a closed but empty bold run', 'a **** b'],
    ['an escaped delimiter', '2 \\* 3 is six'],
    ['a refused link target', 'See [x](javascript:alert(1)) here'],
    ['a lone underscore', 'follow @via_bianca'],
    ['a run of tildes', 'about ~~~200g'],
    ['an escaped tilde before a run', 'a \\~~~b~~'],
    ['a trailing backslash', 'the path C:\\'],
  ])('%s', (_name, source) => { roundTrips(source); });
});
```

- [ ] **Step 4: The three direct assertions the round trip cannot make**

```ts
it('leaves a lone tilde exactly as she typed it', () => {
  // Over-escaping round-trips fine and would still be wrong: it puts
  // backslashes into her stored JSON that she never wrote.
  expect(serializeInline(parseInline('about ~200g'))).toBe('about ~200g');
  expect(serializeInline(parseInline('follow @via_bianca'))).toBe('follow @via_bianca');
});

it('keeps a tilde that ends a mark inside that mark', () => {
  // Hand-built, because parseInline cannot produce this and readInline can.
  const nodes: InlineNode[] = [{ kind: 'strike', children: [{ kind: 'text', value: 'a~' }] }];
  expect(normalise(parseInline(serializeInline(nodes)))).toEqual(normalise(nodes));
});

it('drops an empty mark and writes nothing for it', () => {
  // Also unreachable from parseInline -- tryDelimited refuses an empty body,
  // so 'a **** b' is one text node. readInline produces empty marks, which
  // is why this guard exists at all.
  expect(serializeInline([{ kind: 'strong', children: [] }])).toBe('');
});

it('writes a code value containing a backtick as plain words', () => {
  expect(serializeInline([{ kind: 'code', value: 'a`b' }])).toBe('a`b');
});
```

- [ ] **Step 5: The corpus. A seeded generator, over an alphabet made entirely of characters that mean something to this parser**

```ts
it('round-trips five thousand strings drawn from the delimiter alphabet', () => {
  const ALPHABET = 'ab*_~`[]()\\/: h';
  // xorshift32, so the corpus is identical on every machine and a failure is
  // reproducible from the seed alone.
  let state = 0x9e3779b9;
  const next = (): number => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  for (let i = 0; i < 5000; i += 1) {
    const length = next() % 24;
    let source = '';
    for (let c = 0; c < length; c += 1) source += ALPHABET[next() % ALPHABET.length];
    roundTrips(source);
  }
});
```

- [ ] **Step 6: `npx vitest run src/content/__tests__/inline-source.test.ts`.** If the corpus finds a counter-example, the printed source string is the whole bug report — fix `escapeText`, do not weaken `normalise`.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop the `\\` → `\\\\` step | "a trailing backslash" |
| `/[~_](?=[~_])\|[~_]$/` → `/~~/g` | "a run of tildes" |
| drop the `\|[~_]$` alternative | "keeps a tilde that ends a mark inside that mark" |
| escape every `~` and `_` unconditionally | "leaves a lone tilde exactly as she typed it" |
| emit the marker unconditionally (drop the empty-run guard) | "drops an empty mark and writes nothing for it" |
| drop the link node's own case and return `''` for an empty label | "a link with no label" |
| emit a code node with a backtick as a code span | "writes a code value containing a backtick as plain words" |

**If this task is wrong:** the **owner** edits one paragraph of a published post and the *other* paragraphs are fine, but the one she touched comes back with stray backslashes, or an asterisk she typed turns her next sentence bold. A **visitor** sees the corrupted paragraph after the next publish.

**Browser-only:** none. This is the single largest piece of this feature provable in `npm test`, which is why it is a pure module rather than buried in a component.

---

## Task 15: DOM inline subtree → `InlineNode[]` (the reader)

**Files:**
- Create: `src/admin/writing/dom-inline.ts`, `src/admin/writing/__tests__/dom-inline.test.ts`

**Interfaces:** consumes `isSafeHref`, `InlineNode`. Produces `export function readInline(host: Node): InlineNode[];` — `Node`, not `HTMLElement`, because Task 19 passes it a `DocumentFragment` from `Range.cloneContents()`.

- [ ] **Step 1: `src/admin/writing/dom-inline.ts`**

```ts
// One editable slot's DOM subtree, read back as InlineNode values.
//
// IT READS THE TREE, NEVER A MARKUP STRING. src/test/html-sinks.test.ts is a
// plain substring scan over every shipped file (readFileSync(file).includes(sink),
// html-sinks.test.ts:53), so a module that so much as NAMES the obvious
// property -- in code or in a comment -- fails the build. Structure comes
// from childNodes, nodeType, nodeName, getAttribute and textContent, all of
// which return values rather than markup. That is not a workaround for the
// test; it is the same guarantee markdown.ts's header states, held at the
// one boundary where a contenteditable could otherwise have broken it.
//
// Anything this surface did not itself create contributes its TEXT and
// nothing else. A span a browser autocorrect left behind, a font wrapper an
// extension injected, a stray attribute -- all of it flattens to words. That
// is what makes "paste strips formatting" true even for the paths paste
// handling does not intercept.
import { isSafeHref, type InlineNode } from '../../content/markdown';

// The element names inline-dom.ts creates, and the only ones that carry
// meaning here. One map so the writer and the reader cannot drift.
const MARK_OF: Record<string, 'strong' | 'em' | 'strike' | 'underline' | 'code'> = {
  STRONG: 'strong', EM: 'em', S: 'strike', U: 'underline', CODE: 'code',
};

const ZWSP = '\u200b';

export function readInline(host: Node): InlineNode[] {
  const nodes: InlineNode[] = [];
  host.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      // The zero-width placeholder marks.ts leaves inside a freshly created
      // empty mark. Never a character she typed, so it is stripped
      // everywhere -- EditableText.tsx:47-49 made the same call for the same
      // reason, and strips every occurrence rather than a whole-string match.
      const value = (child.nodeValue ?? '').split(ZWSP).join('');
      if (value.length > 0) nodes.push({ kind: 'text', value });
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;

    // A line break contributes a SPACE, not nothing. Contributing nothing is
    // EditableText.tsx's Finding C1 verbatim: the screen shows two lines
    // while the committed value runs them together with no gap, and the two
    // agree on every comparison, so nothing can detect the drift.
    if (el.nodeName === 'BR') { nodes.push({ kind: 'text', value: ' ' }); return; }

    if (el.nodeName === 'A') {
      const href = el.getAttribute('href') ?? '';
      const children = readInline(el);
      // The same judgement parseInline makes at markdown.ts:302, asked here
      // so an unusable target can never be written into a content field at
      // all. A refused link keeps its words and loses its wrapper.
      if (isSafeHref(href)) nodes.push({ kind: 'link', href: href.trim(), children });
      else nodes.push(...children);
      return;
    }

    const mark = MARK_OF[el.nodeName];
    if (mark === 'code') {
      const text = el.textContent ?? '';
      // Agrees with inline-source.ts's decision at the other end.
      nodes.push(text.includes('`') ? { kind: 'text', value: text } : { kind: 'code', value: text });
      return;
    }
    if (mark !== undefined) { nodes.push({ kind: mark, children: readInline(el) }); return; }

    // Unknown element: its words, and nothing about it.
    nodes.push(...readInline(el));
  });
  return nodes;
}
```

- [ ] **Step 2: `src/admin/writing/__tests__/dom-inline.test.ts`**

Build fixtures with `createElement`/`appendChild` — not from a markup string, which would both defeat the point and fail the sink scan if it ever moved into shipped code.

```ts
function host(build: (root: HTMLElement) => void): HTMLElement {
  const root = document.createElement('p');
  build(root);
  return root;
}
function el(name: string, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(name);
  children.forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

it('reads plain words as one text node', () => { /* 'Rest the dough' */ });

it('reads the four mark elements this surface creates', () => {
  const root = host((r) => { r.appendChild(el('strong', 'a')); r.appendChild(el('em', 'b')); r.appendChild(el('s', 'c')); r.appendChild(el('u', 'd')); });
  expect(readInline(root)).toEqual([
    { kind: 'strong', children: [{ kind: 'text', value: 'a' }] },
    { kind: 'em', children: [{ kind: 'text', value: 'b' }] },
    { kind: 'strike', children: [{ kind: 'text', value: 'c' }] },
    { kind: 'underline', children: [{ kind: 'text', value: 'd' }] },
  ]);
});

it('keeps a safe link and drops an unsafe one, keeping its words', () => {
  // href '/menu' and href 'javascript:alert(1)'
  expect(readInline(root)).toEqual([
    { kind: 'link', href: '/menu', children: [{ kind: 'text', value: 'the menu' }] },
    { kind: 'text', value: 'this' },
  ]);
});

it('flattens an element it did not create to its words', () => {
  // a <span style="font-weight:700">pasted</span>
  expect(readInline(root)).toEqual([{ kind: 'text', value: 'pasted' }]);
});

it('reads a line break as a space, never as nothing', () => {
  expect(readInline(root)).toEqual([
    { kind: 'text', value: 'one' }, { kind: 'text', value: ' ' }, { kind: 'text', value: 'two' },
  ]);
});

it('strips the zero-width placeholder wherever it sits', () => {
  expect(readInline(host((r) => r.appendChild(document.createTextNode('a\u200bb'))))).toEqual([{ kind: 'text', value: 'ab' }]);
});

it('keeps an empty mark with no children', () => {
  // Named for what it asserts. The mark is KEPT here; inline-source.ts's
  // empty-run guard is what drops it on the way to markdown.
  expect(readInline(host((r) => r.appendChild(el('strong', '\u200b'))))).toEqual([{ kind: 'strong', children: [] }]);
});
```

- [ ] **Step 3: `git add src/admin/writing/dom-inline.ts`, then `npx vitest run src/admin/writing/__tests__/dom-inline.test.ts && npx vitest run src/test/html-sinks.test.ts`.** The `git add` is not optional: `html-sinks.test.ts:38` enumerates files via `git ls-files src worker`, so an untracked new module is scanned by nothing and its green means nothing.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop the `BR` branch, or make it contribute nothing | "reads a line break as a space, never as nothing" |
| remove the `isSafeHref` guard | "keeps a safe link and drops an unsafe one" |
| unknown-element branch → `return;` | "flattens an element it did not create to its words" |
| add `'SPAN'` to `MARK_OF` | same test — the span becomes a mark node |
| drop the ZWSP strip | "strips the zero-width placeholder wherever it sits" |
| add the banned property name anywhere in this file, code or comment | `src/test/html-sinks.test.ts` (after `git add`) |

**If this task is wrong:** the **owner** applies bold, reloads, and the bold is gone — or every paragraph she edits after pasting arrives with an invisible wrapper that swallows a word. In the worst case a link she never checked is written into `posts.json` and refused at publish naming a target she did not type.

**Browser-only:** that a real Chromium contenteditable produces exactly the element names in `MARK_OF` and no others when the surface's own mark code runs. jsdom holds whatever we put there; only Task 28 can show a real browser did not substitute a styled span.

---

## Task 16: `InlineNode[]` → DOM (the writer)

**Files:**
- Create: `src/admin/writing/inline-dom.ts`, `src/admin/writing/__tests__/inline-dom.test.ts`

**Interfaces:** produces `export function writeInline(hostEl: HTMLElement, source: string): void;` for Task 17.

- [ ] **Step 1: `src/admin/writing/inline-dom.ts`**

```ts
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
```

- [ ] **Step 2: The test that makes Tasks 14, 15 and 16 one fact rather than three**

```ts
function throughTheDom(source: string): string {
  const host = document.createElement('p');
  writeInline(host, source);
  return serializeInline(readInline(host));
}

describe('source -> DOM -> source', () => {
  it.each([
    ['plain words', 'Rest the dough for an hour.'],
    ['bold', 'Rest the **dough** for an hour.'],
    ['strike and underline', 'a ~~b~~ and __c__'],
    ['nested marks', '**a *b* c**'],
    ['a site link', 'See [the menu](/menu) tonight'],
    ['an off-site link', 'See [the piece](https://example.com/a_(b)/c) now.'],
    ['inline code', 'Set `220 C` and wait'],
    ['an unclosed bold run', 'Add **salt to taste'],
    ['a refused link target', 'See [x](javascript:alert(1)) here'],
    ['a lone underscore', 'follow @via_bianca'],
  ])('%s renders the same after a full loop', (_name, source) => {
    // Parsed trees, not strings: the loop may re-chunk and re-escape, and
    // may not change what a reader sees.
    expect(parseInline(throughTheDom(source))).toEqual(parseInline(source));
  });

  it('writes a fresh slot rather than appending to it', () => {
    const host = document.createElement('p');
    writeInline(host, 'first');
    writeInline(host, 'second');
    expect(host.textContent).toBe('second');
  });
});
```

- [ ] **Step 3: `npx vitest run src/admin/writing/ && npx tsc -b --noEmit`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| delete `hostEl.textContent = '';` | "writes a fresh slot rather than appending to it" |
| map `strike` to `'del'` | every `it.each` case containing `~~` — `readInline` flattens `DEL` to words |
| map `underline` to `'ins'` | "strike and underline", same mechanism |
| skip `el.setAttribute('href', node.href)` | "a site link" and "an off-site link" |
| recurse over `code` children instead of one text node | `npx tsc -b --noEmit` — `code` carries a `value`, not `children`. That is the check, and it is a real one |

**If this task is wrong:** the **owner** opens a post that already has bold in it and sees literal asterisks in what is supposed to be a rendered writing surface — the most obvious way this feature reads as broken on first contact.

**Browser-only:** whether a real Chromium contenteditable keeps these exact elements intact across a caret move and a keystroke. Task 28.

---

## Task 17: The column — `WritingSurface`, array-authoritative, one editable slot per text-bearing field

**Files:**
- Create: `src/admin/writing/slots.ts`, `src/admin/writing/WritingSurface.tsx`
- Create: `src/admin/writing/__tests__/slots.test.ts`, `src/admin/writing/__tests__/WritingSurface.test.tsx`

**Interfaces:** consumes `writeInline` (16), `readInline` (15), `serializeInline` (14), `useStableNames` (`src/admin/blocks/stable-names.ts`), `blockProblemOf` (`src/admin/blocks/block-problems.ts`). Produces:

```ts
export interface Slot {
  // How this surface addresses one editable field inside one block. The
  // string is the same shape validate.ts emits after `[i].blocks[n].`, so a
  // problem's own field path routes to a slot with no translation table.
  readonly key: 'text' | 'attribution' | 'caption' | `items[${number}]`;
  readonly source: string;
}
export function slotsOf(block: Block): Slot[];
export function withSlot(block: Block, key: Slot['key'], source: string): Block;
export function isAtom(kind: BlockKind): boolean;

export interface WritingSurfaceProps {
  blocks: Block[];
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}
```
The props are **byte-identical to `BlockListProps`** (`BlockList.tsx:25-35`) so Task 25 is a one-element swap with no prop plumbing, and both components can coexist while this section is being built.

- [ ] **Step 1: `src/admin/writing/slots.ts`**

Every field is read through an explicit cast off one `Record` alias. Aliasing the *discriminant* through a cast (`(block as {kind?: unknown})?.kind`) and then switching would sever TypeScript's aliased-discriminant narrowing and leave `block` as the full union inside the switch — `error TS2339: Property 'text' does not exist on type 'Block'`, measured. `BlockFields.tsx:228` switches on `block.kind` directly for the same reason.

```ts
import { isBlockKind } from '../../content/guards';
import type { Block, BlockKind } from '../../content/types';

export interface Slot {
  readonly key: 'text' | 'attribution' | 'caption' | `items[${number}]`;
  readonly source: string;
}

// Blocks with no editable words at all. They render as atoms (Task 24) and
// are never handed a contenteditable.
const ATOM_KINDS: Record<BlockKind, true | undefined> = {
  paragraph: undefined, heading: undefined, quote: undefined,
  bulletList: undefined, numberList: undefined, image: undefined,
  ingredients: undefined, steps: undefined,
  gallery: true, citation: true,
};

export function isAtom(kind: BlockKind): boolean {
  return ATOM_KINDS[kind] === true;
}

function str(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

export function slotsOf(block: Block): Slot[] {
  const record = block as unknown as Record<string, unknown> | null | undefined;
  const kind = record?.kind;
  if (!isBlockKind(kind)) return [];
  const fields = record as Record<string, unknown>;
  switch (kind) {
    case 'paragraph':
    case 'heading':
      return [{ key: 'text', source: str(fields, 'text') }];
    case 'quote':
      return [
        { key: 'text', source: str(fields, 'text') },
        { key: 'attribution', source: str(fields, 'attribution') },
      ];
    case 'image':
      return [{ key: 'caption', source: str(fields, 'caption') }];
    case 'bulletList':
    case 'numberList':
    case 'ingredients':
    case 'steps': {
      // Non-array `items` is reachable: a draft restores through an
      // unchecked cast (sections/register-loaded.ts) and the nearest error
      // boundary is per-section, so a throw takes the whole Posts panel down
      // -- BlockList.tsx:162 defends the same way for the same reason.
      const items: unknown[] = Array.isArray(fields.items) ? (fields.items as unknown[]) : [];
      return items.map((item, i) => ({
        key: `items[${i}]` as const,
        source: typeof item === 'string' ? item : '',
      }));
    }
    case 'gallery':
    case 'citation':
      return [];
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

const ITEM_KEY = /^items\[(\d+)\]$/;

// Writes one slot back, producing a NEW block object. The caller must pass
// the result to `rename(from, to, index)` before onChange, exactly as
// BlockList.tsx:442 already does -- stable-names.ts's WeakMap is keyed on
// this object, and a staged photo is filed under the name it yields.
export function withSlot(block: Block, key: Slot['key'], source: string): Block {
  const match = ITEM_KEY.exec(key);
  if (match !== null) {
    const index = Number(match[1]);
    const items: unknown[] = Array.isArray((block as { items?: unknown }).items)
      ? ((block as { items: unknown[] }).items)
      : [];
    return { ...block, items: items.map((item, i) => (i === index ? source : item)) } as Block;
  }
  // `caption` and `attribution` are OMITTED when blank, never blanked --
  // types.ts:316-337 and blank-block.ts:22-25 both state the rule, and
  // assertBlock accepts an absent key while validateBlock refuses a blank
  // one, so writing '' here would fail the write boundary.
  if (key === 'caption' || key === 'attribution') {
    const next = { ...block } as Record<string, unknown>;
    if (source.trim().length === 0) delete next[key];
    else next[key] = source;
    return next as unknown as Block;
  }
  return { ...block, text: source } as Block;
}
```

- [ ] **Step 2: `WritingSurface.tsx` — the three load-bearing rules, in this order**

```tsx
// One continuous writing column over the EXISTING block array.
//
// THE ARRAY IS AUTHORITATIVE AND THE DOM IS NOT. Every editable slot below
// is its own contenteditable host; the surface never infers where one block
// ends and the next begins by reading the tree. That is what keeps
// stable-names.ts's WeakMap valid -- an edit is `{ ...block, text: next }`,
// the object-replacing shape stable-names.ts:38 describes, so `rename`
// (BlockList.tsx:442) carries the name across and a staged photo stays
// attached. A surface that rebuilt Block[] from the DOM would produce
// all-new objects on every keystroke and detach every one of them, which is
// BlockList.tsx:261-292's defect at larger scale.
//
// REACT RENDERS NO CHILDREN INTO AN EDITABLE HOST. Once a contenteditable
// holds real edits its subtree belongs to the browser; a React-managed text
// child there fights the caret and drops keystrokes. EditableText.tsx:67-75
// paid for this already. Content is written imperatively by the layout
// effect below.
//
// A FOCUSED HOST IS NEVER REWRITTEN. That single rule removes the entire
// caret-restoration problem: InlineTextField.tsx's pendingSelection /
// forValue round trip exists because a controlled textarea is rewritten on
// every commit. Nothing here is rewritten while she is in it.
```

- [ ] **Step 3: The host element per slot, keyed on `(kind, slotKey)` — not on kind alone**

A `quote` has two slots and they are not the same element. The shipped renderer is `<blockquote><p>…</p></blockquote>` plus a `<cite>` (`blocks.tsx:100-108`).

```tsx
function hostTagFor(kind: BlockKind, key: Slot['key']): string {
  if (key === 'caption') return 'figcaption';
  if (key === 'attribution') return 'cite';
  if (key.startsWith('items[')) return 'li';
  if (kind === 'heading') return 'h2';
  return 'p';               // paragraph, and the quote's own text inside a rendered blockquote
}
```
Every class string on these hosts is already in the shipped stylesheet (they are `blocks.tsx`'s own), which keeps this task's CSS cost at zero and pushes the whole cost into Task 27's measurement.

- [ ] **Step 4: The imperative write, and its two exclusions**

```tsx
  const lastWritten = useRef<Map<string, string>>(new Map());
  const focusedRef = useRef<string | null>(null);
  const hostRefs = useRef<Map<string, HTMLElement>>(new Map());

  useLayoutEffect(() => {
    hostRefs.current.forEach((el, address) => {
      const source = sourceByAddress.get(address);
      if (source === undefined) return;
      if (focusedRef.current === address) return;
      if (lastWritten.current.get(address) === source) return;
      writeInline(el, source);
      lastWritten.current.set(address, source);
    });
  });
```

`address` is `` `${name}/${slot.key}` `` — the block's **stable name**, not its index, for the reason `BlockList.tsx:304` gives about `<li key>`: a positional address hands one block's content to another the moment she moves one.

Each host also carries `data-slot={address}` and `data-slot-key={slot.key}`. Those attributes are the query surface for every jsdom test in this section; the hosts declare no ARIA role, because a `contenteditable` with a hand-written `role` is a claim about assistive behaviour this plan has no way to verify.

- [ ] **Step 5: The commit, on `input`**

```tsx
  function commitSlot(index: number, slot: Slot, el: HTMLElement): void {
    const source = serializeInline(readInline(el));
    const block = safe[index];
    const next = withSlot(block, slot.key, source);
    rename(block, next, index);
    lastWritten.current.set(addressOf(block, index, slot.key), source);
    onChange(safe.map((existing, i) => (i === index ? next : existing)));
  }
```
`lastWritten` is set **before** `onChange` so the value coming back down is recognised as already written and the layout effect leaves the host alone even in the instant between blur and re-render.

- [ ] **Step 6: Problems**

`FIRST_PROBLEM_SELECTOR = '[aria-describedby*="-error"], [role="alert"]'` (`PostList.tsx:114`) is queried with `querySelector` in document order across the whole panel (the query is at `PostList.tsx:190`), so a slot with a problem must carry `aria-describedby` pointing at a real `role="alert"` paragraph immediately after it:

```tsx
      {slotProblems.length > 0 && (
        <p id={`${idOf(index, slot.key)}-error`} role="alert" className="mt-1 text-sm text-red-600">
          {slotProblems.map((problem) => problem.message).join(' ')}
        </p>
      )}
```
Same class string as `InlineTextField.tsx:325`, character for character — a retyped Tailwind string is a brand-new class to the content scanner.

- [ ] **Step 7: Unplaced problems (a stale block index, a list-level `[i].blocks`)**

`BlockList` renders these in a plain inline banner — `<div role="alert" aria-label="Problems with this post's content">` at `BlockList.tsx:247-259`, not a shared component (`BlockProblemMessage` is a different thing, rendered per block at `:428`/`:432`). Copy that banner's markup and its `aria-label` verbatim into this file; there is nothing importable, and the two must read identically to the owner.

- [ ] **Step 8: `src/admin/writing/__tests__/slots.test.ts`**

```ts
describe('slotsOf', () => {
  it('gives every text-bearing kind the slots its own keys declare', () => {
    expect(slotsOf({ kind: 'paragraph', text: 'a' }).map((s) => s.key)).toEqual(['text']);
    expect(slotsOf({ kind: 'quote', text: 'a' }).map((s) => s.key)).toEqual(['text', 'attribution']);
    expect(slotsOf({ kind: 'bulletList', items: ['a', 'b'] }).map((s) => s.key)).toEqual(['items[0]', 'items[1]']);
    expect(slotsOf({ kind: 'image', src: '/x.webp', alt: 'x' }).map((s) => s.key)).toEqual(['caption']);
  });
  it('gives the two atom kinds no slots', () => { /* gallery, citation */ });
  it('survives a restored draft whose items are not an array', () => {
    expect(slotsOf({ kind: 'bulletList', items: null } as unknown as Block)).toEqual([]);
  });
  it('survives a restored draft whose kind is not a kind', () => {
    expect(slotsOf({ kind: 'marquee' } as unknown as Block)).toEqual([]);
  });
});

describe('withSlot', () => {
  it('omits an emptied caption rather than blanking it', () => {
    const next = withSlot({ kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' }, 'caption', '  ');
    expect(Object.prototype.hasOwnProperty.call(next, 'caption')).toBe(false);
  });
  it('returns a new object, leaving the original untouched', () => {
    const before: Block = { kind: 'paragraph', text: 'a' };
    const after = withSlot(before, 'text', 'b');
    expect(after).not.toBe(before);
    expect(before).toEqual({ kind: 'paragraph', text: 'a' });
  });
});
```

- [ ] **Step 9: `WritingSurface.test.tsx`** — what jsdom can honestly say: the right number of hosts, the right tag per `(kind, slot)` pair (including a quote's `p` and `cite`), each host carrying the parsed content of its own block, a problem reaching the right slot's `aria-describedby`, and a stale block index reaching the banner exactly once.

- [ ] **Step 10: `npx tsc -b --noEmit`, then `npx vitest run src/admin/writing/`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `withSlot` writes `next[key] = source` for a blank caption | "omits an emptied caption rather than blanking it" |
| `withSlot` mutates `block` in place | "returns a new object, leaving the original untouched" |
| `slotsOf` drops its `Array.isArray` guard | "survives a restored draft whose items are not an array" (throws) |
| `slotsOf` drops its `isBlockKind` guard | "survives a restored draft whose kind is not a kind" |
| `hostTagFor` keyed on kind alone | the `WritingSurface.test.tsx` tag case — a quote's attribution host would be a `blockquote` |
| `addressOf` composed from `index` instead of the stable name | **PREDICTED WEAK** in jsdom — a static render passes either way. Pin it directly: render two paragraphs, reorder them through `onChange`, re-render, assert each host's `textContent` moved with its block. If that still passes, the claim is genuinely browser-only and belongs in Task 28 |
| the layout effect drops its `focusedRef.current === address` guard | **PREDICTED WEAK** in jsdom — jsdom's selection model will not show the lost caret. This is the single most important behavioural rule in the surface and it is provable **only** in Task 28 |
| `commitSlot` omits `rename(block, next, index)` | no jsdom test can see it until a photo is staged. Covered by Task 23's staged-identity test — do not write an assertion here that cannot fail |

**If this task is wrong:** the **owner** types a sentence and the words appear in reverse order, or jump to the top of the paragraph after every character. If `rename` is missing she publishes a post naming a photo no file was ever sent for and the live page shows a broken image.

**Browser-only:** caret survival across a commit, the focused-host exclusion, and address stability across a reorder.

---

## Task 18: Enter and Backspace — split, create, merge, leave a list

**Files:**
- Create: `src/admin/writing/structure.ts`, `src/admin/writing/__tests__/structure.test.ts`
- Modify: `src/admin/writing/WritingSurface.tsx`

**Interfaces:** consumes `Block`, `withSlot`/`Slot` (17). It does **not** consume `blankBlock` — both functions below build `{ kind: 'paragraph', text }` literals, and an unused import is a hard `npx eslint .` failure under `npm run gate`.

```ts
export interface Caret { readonly blockIndex: number; readonly slotKey: Slot['key']; readonly offset: 'start' | 'end'; }
export interface Edit { readonly blocks: Block[]; readonly caret: Caret; }
// `before`/`after` are the slot's own source either side of the caret, which
// the caller reads off the live DOM. These functions never touch the DOM.
export function enterAt(blocks: Block[], at: Caret, before: string, after: string): Edit;
export function backspaceAtStart(blocks: Block[], at: Caret): Edit | null;
```

- [ ] **Step 1: `enterAt`**

```ts
export function enterAt(blocks: Block[], at: Caret, before: string, after: string): Edit {
  const block = blocks[at.blockIndex];
  const match = ITEM_KEY.exec(at.slotKey);

  if (match === null) {
    // A paragraph, a heading, a quote or an image caption. Enter always
    // produces a PARAGRAPH, never a second heading -- pressing Enter at the
    // end of a heading and getting another heading is the single most
    // complained-about behaviour in any editor that does it.
    const head = withSlot(block, at.slotKey, before);
    const tail: Block = { kind: 'paragraph', text: after };
    return {
      blocks: splice(blocks, at.blockIndex, 1, head, tail),
      caret: { blockIndex: at.blockIndex + 1, slotKey: 'text', offset: 'start' },
    };
  }

  const index = Number(match[1]);
  const items = itemsOf(block);

  // ENTER ON AN EMPTY ITEM LEAVES THE LIST. Only on an empty one, and only
  // on the last one -- pressing Enter on an empty item in the MIDDLE of a
  // list is her adding a gap, not her finishing.
  if (before.length === 0 && after.length === 0 && index === items.length - 1) {
    const shortened = items.slice(0, index);
    const paragraph: Block = { kind: 'paragraph', text: '' };
    const rest = shortened.length === 0
      ? splice(blocks, at.blockIndex, 1, paragraph)
      : splice(blocks, at.blockIndex, 1, { ...block, items: shortened } as Block, paragraph);
    const caretIndex = shortened.length === 0 ? at.blockIndex : at.blockIndex + 1;
    return { blocks: rest, caret: { blockIndex: caretIndex, slotKey: 'text', offset: 'start' } };
  }

  const nextItems = items.slice();
  nextItems.splice(index, 1, before, after);
  return {
    blocks: splice(blocks, at.blockIndex, 1, { ...block, items: nextItems } as Block),
    caret: { blockIndex: at.blockIndex, slotKey: `items[${index + 1}]`, offset: 'start' },
  };
}
```
with local `splice(blocks, index, remove, ...insert)` and `itemsOf(block)` helpers reading `items` through an explicit cast.

- [ ] **Step 2: `backspaceAtStart`**

```ts
export function backspaceAtStart(blocks: Block[], at: Caret): Edit | null {
  const block = blocks[at.blockIndex];
  const kind = (block as { kind?: unknown }).kind;
  const match = ITEM_KEY.exec(at.slotKey);

  // A heading or a quote demotes to a paragraph on the first press and
  // merges upward on the second. Two presses to destroy a block boundary is
  // deliberate: one press is how a heading disappears by accident.
  if (match === null && (kind === 'heading' || kind === 'quote')) {
    const text = typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '';
    return {
      blocks: splice(blocks, at.blockIndex, 1, { kind: 'paragraph', text }),
      caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
    };
  }

  // The first item of a list steps out of it, keeping its words.
  if (match !== null && Number(match[1]) === 0) {
    const items = itemsOf(block);
    const paragraph: Block = { kind: 'paragraph', text: items[0] ?? '' };
    const remainder = items.slice(1);
    const replacement = remainder.length === 0 ? [paragraph] : [paragraph, { ...block, items: remainder } as Block];
    return {
      blocks: splice(blocks, at.blockIndex, 1, ...replacement),
      caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
    };
  }
  if (match !== null) return null;

  // A paragraph merges into the paragraph above it. Anything else above --
  // an image, a gallery, a citation -- is left alone: Backspace must never
  // silently delete a photo.
  const previous = blocks[at.blockIndex - 1];
  if (previous === undefined) return null;
  if ((previous as { kind?: unknown }).kind !== 'paragraph') return null;
  const head = typeof (previous as { text?: unknown }).text === 'string' ? (previous as { text: string }).text : '';
  const tail = typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '';
  return {
    blocks: splice(blocks, at.blockIndex - 1, 2, { kind: 'paragraph', text: head + tail }),
    caret: { blockIndex: at.blockIndex - 1, slotKey: 'text', offset: 'end' },
  };
}
```

- [ ] **Step 3: Reading the caret off the DOM — the only browser-dependent part, and it is three lines**

```tsx
  function sourceAroundCaret(el: HTMLElement): { before: string; after: string } | null {
    const selection = el.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const head = range.cloneRange();
    head.selectNodeContents(el);
    head.setEnd(range.startContainer, range.startOffset);
    const tail = range.cloneRange();
    tail.selectNodeContents(el);
    tail.setStart(range.endContainer, range.endOffset);
    return {
      before: serializeInline(readInline(head.cloneContents())),
      after: serializeInline(readInline(tail.cloneContents())),
    };
  }
```
`cloneContents()` returns a `DocumentFragment`, which is why Task 15's signature is `Node` and not `HTMLElement`.

- [ ] **Step 4: `onKeyDown`, for Enter and Backspace only.** Everything else is left entirely alone — this is not a general "block special keys" rule, the same discipline `EditableText.tsx:173-179` states.

```tsx
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const around = sourceAroundCaret(el);
      if (around === null) return;
      applyEdit(enterAt(safe, { blockIndex: index, slotKey: slot.key, offset: 'start' }, around.before, around.after));
      return;
    }
    if (event.key === 'Backspace') {
      const around = sourceAroundCaret(el);
      if (around === null || around.before.length > 0) return;
      const edit = backspaceAtStart(safe, { blockIndex: index, slotKey: slot.key, offset: 'start' });
      if (edit === null) return;
      event.preventDefault();
      applyEdit(edit);
    }
```
`applyEdit` calls `onChange(edit.blocks)` and stores `edit.caret` in a ref a layout effect consumes once the new hosts exist, placing the caret with `selectNodeContents` + `collapse(edit.caret.offset === 'start')`.

- [ ] **Step 5: `structure.test.ts` — every branch, as a pure-function test**

```ts
describe('enterAt', () => {
  it('splits a paragraph in two at the caret', () => { /* ['one','two'], caret at blockIndex 1 */ });
  it('gives a heading a paragraph after it, never a second heading', () => {
    const edit = enterAt([{ kind: 'heading', text: 'Before you start' }], { blockIndex: 0, slotKey: 'text', offset: 'start' }, 'Before you start', '');
    expect(edit.blocks[1]).toEqual({ kind: 'paragraph', text: '' });
  });
  it('continues a list', () => {
    const edit = enterAt([{ kind: 'bulletList', items: ['a', 'b'] }], { blockIndex: 0, slotKey: 'items[0]', offset: 'start' }, 'a', '');
    expect(edit.blocks).toEqual([{ kind: 'bulletList', items: ['a', '', 'b'] }]);
    expect(edit.caret.slotKey).toBe('items[1]');
  });
  it('leaves a list on an empty last item, dropping that item', () => { /* [bulletList ['a'], paragraph ''] */ });
  it('removes a list that had only one, empty item', () => { /* [paragraph ''] */ });
  it('does NOT leave the list on an empty item in the middle', () => { /* ['a','','','c'] */ });
});

describe('backspaceAtStart', () => {
  it('merges a paragraph into the paragraph above it', () => { /* 'onetwo' */ });
  it('demotes a heading rather than merging it on the first press', () => { /* [paragraph 'a', paragraph 'B'] */ });
  it('refuses to merge across an image, so a photo cannot vanish', () => {
    const blocks: Block[] = [{ kind: 'image', src: '/food/x.webp', alt: 'x' }, { kind: 'paragraph', text: 'a' }];
    expect(backspaceAtStart(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' })).toBeNull();
  });
  it('steps the first list item out of its list, keeping the rest', () => { /* [paragraph 'a', bulletList ['b']] */ });
  it('does nothing at the very top of the post', () => { /* null */ });
});
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| tail is `{ ...block }` instead of a paragraph | "gives a heading a paragraph after it, never a second heading" |
| drop `&& index === items.length - 1` | "does NOT leave the list on an empty item in the middle" |
| drop `before.length === 0 && after.length === 0` | "continues a list" |
| `nextItems.splice(index, 0, after)` (insert without replace) | "continues a list" — the item's text duplicates |
| drop the `previous.kind !== 'paragraph'` guard | "refuses to merge across an image, so a photo cannot vanish" |
| merge a heading instead of demoting it | "demotes a heading rather than merging it on the first press" |
| return an `Edit` instead of `null` at index 0 | "does nothing at the very top of the post" |
| drop `event.preventDefault()` on Enter | **no jsdom test can see it** — jsdom implements no default action for Enter in a contenteditable. PREDICTED WEAK, and the reason Task 28 exists |

**If this task is wrong:** the **owner** presses Enter and gets a heading where she wanted a sentence, or presses Backspace once at the top of a paragraph and the photo above it disappears with no undo yet built. The list-exit rule failing means she can never leave a bulleted list except with the mouse.

**Browser-only:** `sourceAroundCaret` itself, Enter's suppressed default, and caret placement after an edit.

---

## Task 19: Autoformat — `1. `, `- `, `* `, `# `, `> `

**Files:**
- Create: `src/admin/writing/autoformat.ts`, `src/admin/writing/__tests__/autoformat.test.ts`
- Modify: `src/admin/writing/WritingSurface.tsx`

**Interfaces:** `export function autoformat(block: Block, slotKey: Slot['key'], before: string, after: string): Block | null;` — returns null unless `before` is exactly one of the five triggers.

- [ ] **Step 1: `src/admin/writing/autoformat.ts`**

```ts
// The five things typing produces, and nothing else. Each fires only in a
// PARAGRAPH's own `text` slot: typing "- " inside a list item is her writing
// a dash, not asking for a list inside a list, and typing "# " in an image
// caption is a hash.
//
// A numbered list always starts at 1, whatever number she typed. numberList
// carries no start index and blocks.tsx renders it with the browser's own
// numbering, so "7. " opening a list at 1 is the honest behaviour rather
// than a bug -- there is nowhere to store the 7.
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
```

- [ ] **Step 2: Wire it into `onKeyDown`, ahead of everything else, on the space key**

```tsx
    if (event.key === ' ') {
      const around = sourceAroundCaret(el);
      if (around === null) return;
      const converted = autoformat(safe[index], slot.key, around.before, around.after);
      if (converted === null) return;
      event.preventDefault();
      rename(safe[index], converted, index);
      // The host is about to be rewritten by the layout effect, so its
      // last-written record must be cleared or the effect decides the
      // content is already correct and leaves the trigger characters on
      // screen.
      lastWritten.current.delete(addressOf(safe[index], index, slot.key));
      onChange(safe.map((existing, i) => (i === index ? converted : existing)));
      setPendingCaret({
        blockIndex: index,
        slotKey: converted.kind === 'bulletList' || converted.kind === 'numberList' ? 'items[0]' : 'text',
        offset: 'start',
      });
    }
```

- [ ] **Step 3: `autoformat.test.ts`**

```ts
it.each([
  ['a numbered list', '1.', { kind: 'numberList', items: [''] }],
  ['a numbered list from any number', '7.', { kind: 'numberList', items: [''] }],
  ['a bulleted list from a hyphen', '-', { kind: 'bulletList', items: [''] }],
  ['a bulleted list from a star', '*', { kind: 'bulletList', items: [''] }],
  ['a heading', '#', { kind: 'heading', text: '' }],
  ['a quote', '>', { kind: 'quote', text: '' }],
])('%s', (_name, before, expected) => {
  expect(autoformat({ kind: 'paragraph', text: before }, 'text', before, '')).toEqual(expected);
});

it('carries the words after the caret into the new block', () => {
  expect(autoformat({ kind: 'paragraph', text: '-rest' }, 'text', '-', 'rest')).toEqual({ kind: 'bulletList', items: ['rest'] });
});

it.each([['mid-sentence', 'add 1.'], ['two hashes', '##'], ['a hash with words before it', 'a #'], ['a bare number', '1']])(
  'does not fire %s', (_name, before) => {
    expect(autoformat({ kind: 'paragraph', text: before }, 'text', before, '')).toBeNull();
  });

it('does not fire inside a list item', () => {
  expect(autoformat({ kind: 'bulletList', items: ['-'] }, 'items[0]', '-', '')).toBeNull();
});
it('does not fire in an image caption', () => {
  expect(autoformat({ kind: 'image', src: '/x.webp', alt: 'x', caption: '#' }, 'caption', '#', '')).toBeNull();
});
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `/^\d+\.$/` → `/\d+\./` | "does not fire mid-sentence" |
| `/^#$/` → `/^#+$/` | "does not fire two hashes" |
| drop the `kind !== 'paragraph'` guard | "does not fire inside a list item" |
| drop the `slotKey !== 'text'` guard | "does not fire in an image caption" |
| `make` ignores `rest` | "carries the words after the caret into the new block" |
| drop `lastWritten.current.delete(...)` in the wiring | **PREDICTED WEAK** in jsdom — the layout effect's staleness is a real-DOM timing fact. It is why Task 28 types `- ` and asserts the hyphen is **gone** from the screen |

**If this task is wrong:** the **owner** types "I paid 1. 50 for it" and the sentence turns into a numbered list, or types `- ` and gets a paragraph starting with a hyphen and a space — the version of this feature that makes her stop trusting it.

---

## Task 20: Toolbar, shortcuts, and mark toggling through Selection/Range

**Files:**
- Create: `src/admin/writing/marks.ts`, `src/admin/writing/WritingToolbar.tsx`, `src/admin/writing/__tests__/marks.test.ts`
- Modify: `src/admin/writing/WritingSurface.tsx`

**Interfaces:**
```ts
export type Mark = 'strong' | 'em' | 'strike' | 'underline';
export function toggleMark(hostEl: HTMLElement, mark: Mark): void;
export function clearMarks(hostEl: HTMLElement): void;
export function insertLink(hostEl: HTMLElement, href: string): void;
```

- [ ] **Step 1: `marks.ts`. `document.execCommand` is not used, and the reason is not deprecation**

```ts
// Marks applied by building elements, never by document.execCommand.
//
// execCommand's output is not specified: the same call produces one element
// in one browser and a styled span in another, and a styled span is exactly
// what dom-inline.ts flattens to bare words -- so her bold would silently
// disappear on some browsers and not others, the worst possible shape for a
// bug in a writing tool. Building the element ourselves means the tree only
// ever holds the five names MARK_OF knows.
const TAG_OF: Record<Mark, string> = { strong: 'STRONG', em: 'EM', strike: 'S', underline: 'U' };
const ZWSP = '​';
```
plus `ancestorMark(node, hostEl, mark)` walking up and **stopping at `hostEl`**, `unwrap(el)`, and:

```ts
export function toggleMark(hostEl: HTMLElement, mark: Mark): void {
  const doc = hostEl.ownerDocument;
  const selection = doc.getSelection();
  if (selection === null || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const existing = ancestorMark(range.commonAncestorContainer, hostEl, mark);
  if (existing !== null) { unwrap(existing); hostEl.normalize(); return; }
  const el = doc.createElement(TAG_OF[mark].toLowerCase());
  el.appendChild(range.extractContents());
  // With nothing selected this leaves an empty element with the caret in it,
  // so she can turn bold on and type -- InlineTextField.tsx:145-147 made the
  // same call for the same reason. A totally empty inline element collapses
  // to a 0x0 box in a real browser (EditableText.tsx:16-33, measured), so it
  // gets the same zero-width placeholder that file uses, which dom-inline.ts
  // strips on the way back out.
  if (el.childNodes.length === 0) el.appendChild(doc.createTextNode(ZWSP));
  range.insertNode(el);
  const next = doc.createRange();
  next.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(next);
}
```
`clearMarks` replaces the selection with a single text node of `range.toString()`; `insertLink` wraps the selection in an `<a href>` and, when the selection is empty, appends the placeholder word `this` for the reason `InlineTextField.tsx:187` uses one.

- [ ] **Step 2: `WritingToolbar.tsx` — twelve buttons and one label**

`role="group"` and **not** `role="toolbar"`, for the reason `InlineTextField.tsx:223-231` states at length: a toolbar in ARIA promises arrow-key navigation and one tab stop, and these are plain buttons. Every button reuses `MOVE_BUTTON_CLASSNAME` imported from `RecordList`, never retyped.

Twelve buttons — `Bold`, `Italic`, `Underline`, `Strikethrough`, `Link`, `Heading`, `Bulleted list`, `Numbered list`, `Quote`, `Undo`, `Redo`, `Clear formatting` — plus **one `<label htmlFor>` reading `Image`** over the hidden file input Task 23 owns. Image is not a button: a browser only opens the picker under a live user activation, and Task 23 Step 1 explains why a programmatic click cannot be relied on. The label carries the same class string as the buttons so the row reads as one control set.

**`Italic` keeps its capital I** — the lowercase spelling is a real Tailwind candidate this stylesheet does not ship, and `InlineTextField.tsx:240-248` records that a comment warning about it shipped the rule it was warning about.

- [ ] **Step 3: Link uses `window.prompt` and the exact three-gate check `InlineTextField.tsx:153-207` performs** — `isSafeHref`, then the `rawLinkTargets` read-back check, then insert. Import that file's `TARGET_SHAPES` sentence rather than retyping it; export it from `InlineTextField.tsx` if it is not already exported, so the advice and the refusal cannot drift.

- [ ] **Step 4: Shortcuts, on the surface's `onKeyDown`, before the Enter/Backspace branches**

```tsx
    const meta = event.metaKey || event.ctrlKey;
    if (meta) {
      const key = event.key.toLowerCase();
      if (key === 'b') { event.preventDefault(); toggleMark(el, 'strong'); commitSlot(index, slot, el); return; }
      if (key === 'i') { event.preventDefault(); toggleMark(el, 'em'); commitSlot(index, slot, el); return; }
      if (key === 'u') { event.preventDefault(); toggleMark(el, 'underline'); commitSlot(index, slot, el); return; }
      if (key === 'k') { event.preventDefault(); promptForLink(el, index, slot); return; }
      if (key === '\\') { event.preventDefault(); clearMarks(el); commitSlot(index, slot, el); return; }
      if (key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    }
```
`preventDefault` on `z` is **not optional**: without it the browser runs its own contenteditable undo, restoring DOM the block array knows nothing about, and the two disagree permanently. There is no strikethrough shortcut — the spec lists none, and every plausible candidate is taken.

- [ ] **Step 5: `marks.test.ts`.** jsdom implements `Selection`, `Range.extractContents` and `Range.toString` well enough for the *structural* assertions, which are the ones that matter.

```ts
it('wraps a selection in the element for that mark', () => { /* strong holds 'bc' */ });
it('unwraps when the selection is already inside that mark', () => { /* no strong, textContent 'bc' */ });
it('leaves a placeholder inside an empty mark so it can be typed into', () => { /* em textContent is the ZWSP */ });
it('uses s and u, the elements dom-inline.ts reads back', () => {
  // Pinned directly, because a mark written as an element dom-inline.ts does
  // not know flattens to bare words and her formatting vanishes on the next
  // commit with nothing on screen saying so.
  toggleMark(host, 'strike');
  expect(host.querySelector('s')).not.toBeNull();
});
it('stops at the host and never unwraps something outside it', () => {
  // Two sibling hosts, the second inside a page-level <strong>. Without the
  // `current !== hostEl` stop, toggling in the second host unwraps the
  // page's element.
});
it('clearMarks replaces the selection with its own plain words', () => { /* no strong, textContent 'bold' */ });
it('produces a tree the reader and serializer turn into markdown', () => {
  // select 'bc' in 'abcd', toggle strong
  expect(serializeInline(readInline(host))).toBe('a**bc**d');
});
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `TAG_OF.strike = 'DEL'` | "uses s and u, the elements dom-inline.ts reads back" |
| `toggleMark` always wraps, never unwraps | "unwraps when the selection is already inside that mark" |
| drop the ZWSP placeholder | "leaves a placeholder inside an empty mark so it can be typed into" |
| `clearMarks` deletes with no reinsertion | "clearMarks replaces the selection with its own plain words" |
| `ancestorMark` walks past `hostEl` | "stops at the host and never unwraps something outside it" |
| replace `toggleMark` with `document.execCommand('bold')` | **PREDICTED WEAK** — jsdom's `execCommand` is a no-op stub, so this reddens by producing *nothing*, the right colour for the wrong reason. The real claim is browser-only (Task 28) |
| drop `event.preventDefault()` from the `z` branch | no jsdom test can see it. **Browser-only**, and the highest-value assertion in Task 28 |

**If this task is wrong:** the **owner** selects a phrase, presses Bold, sees it go bold, clicks away, and it is plain again — with nothing telling her why. Or Cmd+Z undoes something the block array does not know about and the screen and the saved draft permanently disagree.

---

## Task 21: Undo and redo

**Files:**
- Create: `src/admin/writing/history.ts`, `src/admin/writing/__tests__/history.test.ts`
- Modify: `src/admin/writing/WritingSurface.tsx`

**Interfaces:**
```ts
export interface Snapshot { readonly blocks: Block[]; readonly caret: Caret | null; readonly at: number; readonly slot: string | null; }
export interface History { readonly past: readonly Snapshot[]; readonly future: readonly Snapshot[]; }
export const EMPTY_HISTORY: History;
export function record(history: History, snapshot: Snapshot, structural: boolean): History;
export function undo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null;
export function redo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null;
```

- [ ] **Step 1: `history.ts`**

```ts
// Undo over the BLOCK ARRAY, not over the DOM.
//
// That choice is what makes undo safe for staged photos. A snapshot holds
// the same block OBJECTS that were in the array when it was taken, so an
// undone block is the identical object stable-names.ts's WeakMap already
// knows -- same name, same staged-photo key, bytes still in the collector
// (staged.ts only drops an entry on a fresh pick or on clearSent at
// publish). Undoing a deleted photo restores the photo, not a reference to
// nothing.
//
// The browser's own contenteditable undo is suppressed at the key handler.
// Two undo stacks over one surface is not a smaller version of this problem;
// it is a permanent disagreement between what is on screen and what would
// publish.
const LIMIT = 100;
const COALESCE_MS = 600;

export function record(history: History, snapshot: Snapshot, structural: boolean): History {
  const top = history.past[history.past.length - 1];
  // Typing runs of ordinary characters in one slot collapse into one
  // undoable step. Anything structural -- Enter, a kind change, an image, a
  // paste, a mark -- always starts a new one, because those are the steps
  // she will actually reach for.
  const coalesces =
    !structural && top !== undefined && top.slot !== null &&
    top.slot === snapshot.slot && snapshot.at - top.at < COALESCE_MS;
  const past = coalesces ? history.past.slice(0, -1) : history.past.slice(-(LIMIT - 1));
  return { past: [...past, snapshot], future: [] };
}

export function undo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null {
  const restored = history.past[history.past.length - 1];
  if (restored === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, restored };
}

export function redo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null {
  const restored = history.future[0];
  if (restored === undefined) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, restored };
}
```

- [ ] **Step 2: In `WritingSurface.tsx`, hold `History` in a ref** (never state — it must not itself trigger a render) and call `record` on every commit path with `structural` set by the caller: `false` for `commitSlot`, `true` for `enterAt`, `backspaceAtStart`, `autoformat`, paste, image insert and every mark toggle.

- [ ] **Step 3: `history.test.ts`**

```ts
const A: Snapshot = { blocks: [{ kind: 'paragraph', text: 'a' }], caret: null, at: 0, slot: 'b1/text' };
const B: Snapshot = { blocks: [{ kind: 'paragraph', text: 'ab' }], caret: null, at: 100, slot: 'b1/text' };
const C: Snapshot = { blocks: [{ kind: 'paragraph', text: 'ab' }, { kind: 'paragraph', text: '' }], caret: null, at: 200, slot: 'b2/text' };

it('coalesces typing in one slot inside the window', () => {
  expect(record(record(EMPTY_HISTORY, A, false), B, false).past).toEqual([B]);
});
it('does not coalesce across slots', () => { /* length 2 */ });
it('does not coalesce past the window', () => { /* at: 5000, length 2 */ });
it('never coalesces a structural step', () => {
  expect(record(record(EMPTY_HISTORY, A, false), C, true).past).toEqual([A, C]);
});
it('undo hands back the MOST RECENT snapshot, not the oldest', () => {
  // Two steps, deliberately: with a one-element past, `past[0]` and
  // `past[past.length - 1]` are the same object and the mutation below
  // cannot redden.
  const h = record(record(EMPTY_HISTORY, A, true), B, true);
  expect(undo(h, C)?.restored).toBe(B);
});
it('undo can be redone', () => {
  const back = undo(record(EMPTY_HISTORY, A, true), C)!;
  expect(redo(back.history, A)?.restored).toBe(C);
});
it('a new step clears the redo branch', () => { /* future is [] */ });
it('restores the identical block objects, so a staged photo stays attached', () => {
  const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x' };
  const before: Snapshot = { blocks: [photo], caret: null, at: 0, slot: null };
  const back = undo(record(EMPTY_HISTORY, before, true), { blocks: [], caret: null, at: 1, slot: null })!;
  expect(back.restored.blocks[0]).toBe(photo);
});
it('never grows past its limit', () => { /* 300 structural records, past.length <= 100 */ });
it('undo on an empty history is null, not a throw', () => { /* both null */ });
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop `top.slot === snapshot.slot` | "does not coalesce across slots" |
| drop `snapshot.at - top.at < COALESCE_MS` | "does not coalesce past the window" |
| drop `!structural` | "never coalesces a structural step" |
| `record` returns `{ past, future: history.future }` | "a new step clears the redo branch" |
| `undo` deep-clones the restored blocks | "restores the identical block objects, so a staged photo stays attached" |
| `record` slices with no `-(LIMIT - 1)` | "never grows past its limit" |
| `undo` reads `history.past[0]` | "undo hands back the MOST RECENT snapshot, not the oldest" |

**If this task is wrong:** the **owner** presses Cmd+Z after deleting a paragraph and either nothing happens, or every character she typed in the last two minutes vanishes at once. If block identity is not preserved, undoing a deleted image restores a block naming a photo whose bytes the collector no longer holds and she publishes a broken image.

**Browser-only:** that Cmd+Z reaches this handler rather than the browser's own undo.

---

## Task 22: Paste strips incoming formatting

**Files:**
- Create: `src/admin/writing/paste.ts`, `src/admin/writing/__tests__/paste.test.ts`
- Modify: `src/admin/writing/WritingSurface.tsx`

**Interfaces:** `export function pasteChunks(text: string): string[];`

- [ ] **Step 1: `paste.ts`**

```ts
// Blank lines separate paragraphs; a single line break inside one is a soft
// wrap and becomes a space. Word and Google Docs both produce the first
// shape; a webpage copied at a narrow width produces the second, and turning
// each of its wrapped lines into its own paragraph is the failure people
// notice immediately.
export function pasteChunks(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((chunk) => chunk.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim())
    .filter((chunk) => chunk.length > 0);
}
```

- [ ] **Step 2: One `onPaste` per host. Only `text/plain` is ever read**

The rich flavour is never asked for, which makes "paste strips formatting" true by construction rather than by cleanup — exactly as `EditableText.tsx:185-208` argues.

```tsx
  function handlePaste(event: React.ClipboardEvent<HTMLElement>, index: number, slot: Slot, el: HTMLElement): void {
    event.preventDefault();
    const chunks = pasteChunks(event.clipboardData.getData('text/plain'));
    if (chunks.length === 0) return;
    const selection = el.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = el.ownerDocument.createTextNode(chunks[0]);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    commitSlot(index, slot, el, { structural: true });
    if (chunks.length > 1) {
      const extra: Block[] = chunks.slice(1).map((chunk) => ({ kind: 'paragraph', text: chunk }));
      onChange(insertAfter(latestBlocks(), index, extra));
    }
  }
```
The clipboard text goes in as a **text node**, so `**` in what she pasted stays two literal asterisks: `commitSlot` runs it through `readInline` → `serializeInline`, which escapes them. Pasting the source of a markdown document gives her the characters she can see, not accidental formatting.

- [ ] **Step 3: `paste.test.ts`**

```ts
it('splits on a blank line', () => { expect(pasteChunks('one\n\ntwo')).toEqual(['one', 'two']); });
it('joins a soft wrap into one paragraph', () => { expect(pasteChunks('one\ntwo')).toEqual(['one two']); });
it('handles the Windows line ending Word produces', () => { expect(pasteChunks('one\r\n\r\ntwo')).toEqual(['one', 'two']); });
it('drops whitespace-only chunks rather than making empty paragraphs', () => { expect(pasteChunks('one\n\n   \n\ntwo')).toEqual(['one', 'two']); });
it('returns nothing for an empty clipboard', () => { expect(pasteChunks('   ')).toEqual([]); });
```

- [ ] **Step 4: Two surface-level jsdom cases**

Query by the `data-slot` attribute Task 17 Step 4 puts on every host — the surface declares no `role="textbox"` and no per-host accessible name, so a role query would find nothing.

```tsx
it('never asks the clipboard for its rich flavour', () => {
  const getData = vi.fn().mockReturnValue('pasted');
  const host = container.querySelector('[data-slot]') as HTMLElement;
  fireEvent.paste(host, { clipboardData: { getData } });
  expect(getData).toHaveBeenCalledWith('text/plain');
  expect(getData).not.toHaveBeenCalledWith('text/html');
});

it('pasted asterisks stay characters', () => {
  // after pasting 'a **b** c' into an empty paragraph
  expect(serializeInline(readInline(host))).toBe('a \\*\\*b\\*\\* c');
});
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `getData('text/plain')` → `getData('text/html')` | "never asks the clipboard for its rich flavour" |
| drop `event.preventDefault()` | **does not redden** — jsdom has no default paste action to suppress. PREDICTED WEAK, and the single most important paste claim: Task 28 pastes real rich content and asserts the surface holds no element outside `MARK_OF` |
| split on `/\r?\n/` | "joins a soft wrap into one paragraph" |
| drop the `\r?` from both patterns | "handles the Windows line ending Word produces" |
| drop `.filter((chunk) => chunk.length > 0)` | "drops whitespace-only chunks rather than making empty paragraphs" |
| insert the pasted text as anything other than a text node | "pasted asterisks stay characters" |

**If this task is wrong:** the **owner** pastes three paragraphs out of an email and gets one run-on paragraph, or pastes from Google Docs and the post arrives on the live site in Google's font at Google's size — the outcome the spec's typography section exists to prevent, and a **visitor** sees it.

---

## Task 23: The Image control — device picker → staged upload → centred block

**Files:**
- Modify: `src/admin/writing/WritingSurface.tsx`, `src/admin/writing/WritingToolbar.tsx`
- Create: `src/admin/writing/__tests__/image-insert.test.tsx`

**Interfaces:** consumes `convertHeic`, `checkPhotoSize`, `uploadAndEncode(category, file, onProgress)` from `src/admin/upload-photo.ts`; `StagedPhoto` (re-exported from `PhotoField.tsx:34`); `nameOf` from `useStableNames`; `onStaged`/`previewKeyPrefix` from `WritingSurfaceProps`.

- [ ] **Step 1: The control is a `<label htmlFor>` over a hidden `<input type="file" accept="image/*">` owned by the surface.** It must **not** be a button that programmatically clicks a file input on a later render: a browser only opens the picker under a live user activation, and by the time a freshly inserted block renders that activation has expired. Task 20 Step 2's toolbar is twelve buttons and this one label for exactly this reason.

- [ ] **Step 2: The handler — the existing pipeline, in the order `PhotoField.tsx` already uses**

```tsx
  async function handleImagePick(file: File, index: number): Promise<void> {
    setUpload({ kind: 'converting' });
    let resolved: File;
    try { resolved = await convertHeic(file); }
    catch { setUpload({ kind: 'error', message: 'This photo could not be read. Try a JPEG or a PNG.' }); return; }

    const tooBig = checkPhotoSize(resolved);
    if (tooBig !== null) { setUpload({ kind: 'error', message: tooBig }); return; }

    let staged: StagedPhoto;
    try { staged = await uploadAndEncode('posts', resolved, (percent) => setUpload({ kind: 'uploading', percent })); }
    catch (error) { setUpload({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed.' }); return; }
    setUpload({ kind: 'idle' });
    // `posts` is a real UPLOAD_CATEGORY (src/shared/upload-categories.ts:25)
    // and assets-source/posts/ does not exist on disk yet -- deliberately,
    // per that file's own comment. worker/upload.ts creates the path on the
    // commit; scripts/images.mjs walks whatever is under assets-source/, so
    // the derivative appears on the first Pages build after the first post
    // photo is published. Nothing needs to be pre-created.

    const block: Block = { kind: 'image', src: staged.contentPath, alt: '' };
    // THE NAME IS TAKEN BEFORE THE BLOCK IS INSERTED, and it must be: the
    // staged key is composed from the block's stable name, and there is no
    // render between here and the collector write. `nameOf` memoises on
    // object identity in a ref-held WeakMap (stable-names.ts:63-72), so
    // calling it from an event handler is the same operation calling it from
    // a render is, and the name this returns is the one the row will use.
    const name = nameOf(block, index + 1);
    onStaged(`blocks[${name}].src`, staged);
    recordStructural();
    onChange(insertAfter(safe, index, [block]));
  }
```

- [ ] **Step 3: The rendered image block is centred at column width.** Every class here already ships (`blocks.tsx` and `PhotoField.tsx` between them), so it costs nothing new — verify with Task 27's rule-level diff, do not assume.

```tsx
        <figure className="mb-6">
          <img src={previewFor(name) ?? block.src} alt={block.alt} className="w-full rounded-lg" />
          {/* the caption slot, a contenteditable figcaption */}
        </figure>
```
She does not position it; the block does. There is no alignment control anywhere on this surface, deliberately.

- [ ] **Step 4: The alt field sits under the image as a plain `Field` of kind `text`**, wired to the same `problemsFor` routing. A freshly inserted image immediately shows `validateBlock`'s own sentence about needing a description, which is correct and is the existing behaviour.

- [ ] **Step 5: `image-insert.test.tsx`.** Mock `uploadAndEncode` and assert the five things that matter.

```tsx
it('stages the bytes under the same name the block will render with', async () => {
  // Insert two images, move the first below the second, then pick a photo on
  // the one now at the top. The staged key must name the block she picked
  // on, not the position she picked at -- BlockList.tsx:261-292.
});
it('inserts the image after the block the caret was in, never at the end', async () => {});
it('refuses a photo over the size cap before any network call', async () => {
  await pickFile(new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }));
  expect(vi.mocked(uploadAndEncode)).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/under 5\.00MB/);
});
it('uploads to the posts category', async () => {
  expect(vi.mocked(uploadAndEncode).mock.calls[0][0]).toBe('posts');
});
it('leaves the block array untouched when the upload fails', async () => { /* onChange never called */ });
```

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| compose the staged key from `index` instead of `name` | "stages the bytes under the same name the block will render with" |
| call `nameOf` after `onChange` | same test — the name assigned during the subsequent render differs from the one the collector was given |
| `'posts'` → `'food'` | "uploads to the posts category" |
| drop the `checkPhotoSize` call | "refuses a photo over the size cap before any network call" |
| `onChange([...safe, block])` instead of `insertAfter` | "inserts the image after the block the caret was in, never at the end" |
| call `onChange` before awaiting the upload | "leaves the block array untouched when the upload fails" |
| replace the label with a button that clicks the input | **no test can redden** — jsdom opens no picker either way. PREDICTED WEAK; this is why the shape is mandated in Step 1 rather than tested. Task 28 proves the picker opens by intercepting the file chooser event |

**If this task is wrong:** the **owner** picks a photo, sees it on screen, publishes, and the live post shows a broken image because the bytes were filed under a key nothing referenced — and a **visitor** sees the broken image on the public blog.

**Browser-only:** that the picker opens at all; that the image renders centred at column width at 390px and 1280px; that the toolbar sits above a phone keyboard.

---

## Task 24: The insert menu — gallery, ingredients, steps, citation

**Files:**
- Modify: `src/admin/blocks/BlockPicker.tsx`, `src/admin/blocks/block-meta.ts`, `src/admin/writing/WritingSurface.tsx`
- Modify: `src/admin/blocks/__tests__/BlockPicker.test.tsx`, `src/admin/blocks/__tests__/block-meta.test.ts`

**Interfaces:**
```ts
export interface BlockPickerProps {
  onPick: (kind: BlockKind) => void;
  // Which kinds to offer. Defaults to PICKER_ORDER -- every existing caller
  // is unaffected, which is what keeps BlockPicker.test.tsx's "exactly the
  // model's kinds in a deliberate order" green.
  kinds?: readonly BlockKind[];
}
// src/admin/blocks/block-meta.ts
export const INSERT_MENU_KINDS: readonly BlockKind[] = ['gallery', 'ingredients', 'steps', 'citation'];
```

- [ ] **Step 1: Add the optional `kinds` prop to `BlockPicker.tsx`, defaulting to `PICKER_ORDER`.** The runtime reconciliation at `:45` stays — it now reconciles `PICKER_ORDER` against `BLOCK_KINDS`, unchanged.

- [ ] **Step 2: Export `INSERT_MENU_KINDS` from `block-meta.ts` and pin it in `block-meta.test.ts`**

```ts
it('the insert menu holds exactly the kinds the toolbar does not', () => {
  const TOOLBAR_KINDS = ['paragraph', 'heading', 'bulletList', 'numberList', 'image', 'quote'];
  expect([...INSERT_MENU_KINDS].sort()).toEqual(BLOCK_KINDS.filter((k) => !TOOLBAR_KINDS.includes(k)).sort());
});
```
That assertion is what makes an eleventh block kind show up somewhere rather than silently nowhere.

- [ ] **Step 3: Render the four kinds as atoms in the column using the existing `BlockFields` component, unchanged**, with the existing `idPrefix`, `problemsFor`, `previews`, `onStaged` and `previewKeyPrefix` contracts (`BlockList.tsx:436-471`). Nothing about how a gallery photo stages moves.

- [ ] **Step 4: `ingredients` and `steps` keep their `InlineTextField` textareas through `BlockFields`.** That is a deliberate inconsistency inside a writing surface and it is the right one: the spec says these four stay *reachable*, not that they become prose. Their `heading` is a plain `string`, not `InlineText`, and must never be routed through the markdown pipeline — `blocks.tsx:114,124` renders it as a bare string with no `<Inline>`, so an asterisk typed there would be a visible asterisk on the live site.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop `citation` from `INSERT_MENU_KINDS` | "the insert menu holds exactly the kinds the toolbar does not" |
| add `paragraph` to `INSERT_MENU_KINDS` | same test |
| make `kinds` required on `BlockPicker` | `npx tsc -b --noEmit` at `BlockList.tsx`'s existing call |
| change `BlockPicker`'s default to `INSERT_MENU_KINDS` | `BlockPicker.test.tsx` "exactly the model's kinds in a deliberate order" |
| route `ingredients.heading` through `InlineTextField` | `BlockFields.test.tsx`'s per-kind rendering; if it does not distinguish the two controls, add `expect(screen.getByLabelText('Heading for the ingredients').tagName.toLowerCase()).toBe('input')` — **that exact label**, because `BlockFields.tsx:74-79` deliberately names it `Heading for the ${BLOCK_KIND_LABELS.ingredients.toLowerCase()}` so two controls on one screen are not both called "Heading" |

**If this task is wrong:** the **owner** writing a recipe cannot add ingredients at all, and a post that already has them opens with those blocks invisible — which, because the array is authoritative and she then edits and publishes, would delete them from the live site.

**Browser-only:** none.

---

## Task 25: Swap `PostList` from `BlockList` to `WritingSurface`

**Files:**
- Modify: `src/admin/PostList.tsx`, `src/admin/__tests__/PostList.test.tsx`
- Delete: `e2e/block-editor.spec.ts` (replaced by Task 28; `POSTS_PANEL` and `startDragging` were already lifted out in Task 11)

- [ ] **Step 1: Change the import and the element name. Nothing else on those lines moves**

The real call site is `PostList.tsx:312-320` and it does **not** pass `post.blocks`, `{ ...post, blocks: next }` or a bare `onStaged`. Copy it exactly as it stands:

```tsx
              <WritingSurface
                blocks={blocksOf(post)}
                postIndex={index}
                onChange={(nextBlocks) => onChange(index, { ...metaOf(post), blocks: nextBlocks })}
                problems={problems}
                previews={previews}
                onStaged={(key, staged) => onStaged(`${post.id}:${key}`, staged)}
                previewKeyPrefix={previewKeyPrefix}
              />
```
The `${post.id}:` prefix on `onStaged` is load-bearing: dropping it files every staged post photo under a key nothing publishes. `problems` is passed **whole** — `BlockList` filtered by `postIndex` itself (`PostList.tsx:140`, "The block half goes to BlockList, whole") and `WritingSurface` inherits that contract.

- [ ] **Step 2: `src/admin/blocks/BlockList.tsx` stays on disk, unreferenced.** `src/test/no-dead-backend.test.ts` names eight specific protected files and does not sweep for unreferenced modules, so nothing goes red — verified against that file. Leaving it is the smaller risk while the surface is new; deleting it can be revisited with a working replacement in hand.

- [ ] **Step 3: Verify the Posts panel snapshot does not move.** `panel-snapshots.test.tsx.snap` renders the Posts panel with **zero posts** at 3861+ — `<ul />` plus the Add button, both from `PostList`, not from `BlockList`. Confirm with `CI=true npx vitest run src/admin/__tests__/panel-snapshots.test.tsx`; `npm run gate` never sets `CI`, so a locally-green snapshot proves nothing (`areas.test.tsx:205-212`).

- [ ] **Step 4: Confirm `PostList`'s jump still lands.** `FIRST_PROBLEM_SELECTOR` (`:114`) is queried in document order across the whole panel (`:190`), and Task 17 Step 6 emits exactly the two shapes it looks for. Run the existing three-way partition tests and the two `InlineTextField` refusal cases unchanged; if a refusal case names `InlineTextField`, re-point it at the surface's own link refusal, keeping both halves (a live refusal can win the jump; it stops winning once she types).

- [ ] **Step 5: Delete `e2e/block-editor.spec.ts`.** Everything in it — drag handles on block rows, kind labels, the block cursor, the dimmed block — describes a component no longer mounted. Its two reusable parts already live in `e2e/drag.ts` and Task 28's scaffold.

- [ ] **Step 6: `npx tsc -b --noEmit`, `npm test -- --run`, `npm run test:deploy`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `postIndex={0}` instead of `index` | `PostList.test.tsx`'s existing "foreign post ignored" problem-routing case |
| drop `previewKeyPrefix` | `npx tsc -b --noEmit` (required on `WritingSurfaceProps`) |
| drop the `${post.id}:` prefix from `onStaged` | `PostList.test.tsx`'s staged-key case — if none exists, **write it first**: stage a photo on the second post and assert the collector key names that post's id |
| leave `BlockList` mounted alongside | `PostList.test.tsx` "no two controls on one post share a label" — every control renders twice |
| revert `PostList.tsx` to `BlockList` | `e2e/writing-surface.spec.ts` in its entirety. **This is the only check on the swap itself**, so Task 28 is not optional polish |

**Deliberately not a mutation row:** "pass `problems` instead of `blockProblems`". There is no `blockProblems` variable in `PostList.tsx`; passing `problems` whole is the current, correct code and cannot redden anything.

**If this task is wrong:** the **owner** opens the Posts panel and sees two editors, or the problem summary claims three problems while "Take me to the first one" lands on nothing.

---

## Task 26: Tab and Shift+Tab nest a list item (droppable)

**Cut this task first if the section runs long.** Everything above ships without it; only Tab is lost.

**Files:**
- Modify: `src/content/types.ts`, `src/content/guards.ts`, `src/content/validate.ts`, `src/components/blog/blocks.tsx`
- Modify: `src/admin/writing/structure.ts`, `src/admin/writing/WritingSurface.tsx`
- Modify: `src/content/__tests__/guards.test.ts`, `src/content/__tests__/validate.test.ts`, `src/components/blog/__tests__/blocks.test.tsx`, `src/admin/writing/__tests__/structure.test.ts`

**Interfaces:**
```ts
// In BlockContentMap:
  bulletList: { items: InlineText[]; levels?: number[] };
  numberList: { items: InlineText[]; levels?: number[] };

// In src/content/types.ts -- NOT in src/admin/writing/, because guards.ts
// imports it and worker/__tests__/bundle.test.ts fails the build if admin or
// React-adjacent code reaches the Worker bundle chain.
export const MAX_LIST_DEPTH = 2;

// In structure.ts:
export function indentAt(blocks: Block[], at: Caret, delta: 1 | -1): Edit | null;
```

**Why an optional parallel array rather than a nested structure:** every committed post stays valid unchanged, so the spec's "there is no migration, because the storage never moves" survives literally. The cost is that `items` and `levels` can desync, which both boundaries refuse outright.

- [ ] **Step 1: `types.ts`** — add `levels?: number[]` to both list kinds and `export const MAX_LIST_DEPTH = 2`, with the comment stating the two-regime rule already documented at `:316-337`: `levels` is optional, so **absent means every item is at depth 0** and every renderer must handle its absence.

- [ ] **Step 2: `guards.ts`** — add `levels: true` to `BLOCK_KEYS.bulletList` and `BLOCK_KEYS.numberList` (**`:177-178`**), import `MAX_LIST_DEPTH` from `types.ts`, and extend `assertBlock`'s list branch:

```ts
    case 'bulletList':
    case 'numberList':
      assertBlockTextList(record.items, 'items', context);
      if (record.levels !== undefined) {
        const levels = record.levels;
        if (!Array.isArray(levels) || levels.length !== (record.items as unknown[]).length) {
          throw new Error(`content/posts.json: block ${context} has a "levels" list that does not match its items`);
        }
        levels.forEach((level, i) => {
          if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > MAX_LIST_DEPTH) {
            throw new Error(`content/posts.json: block ${context} levels[${i}] is not a nesting depth`);
          }
        });
      }
      break;
```

- [ ] **Step 3: `validate.ts`'s `validateBlock` list branch — the owner-facing counterpart**

```ts
      if (block.levels !== undefined) {
        const levels: unknown = block.levels;
        const items: unknown[] = Array.isArray(block.items) ? block.items : [];
        if (!Array.isArray(levels) || levels.length !== items.length) {
          problems.push(problem(`${field}.levels`, `a list in ${subject} lost track of how its items are nested -- reload this page, decline any draft it offers to restore, and make the edit again`));
        }
      }
```
The two boundaries must refuse the same broken blocks — **`guards.test.ts:578`**, `'assertBlock and the write boundary refuse the same broken blocks'`, is the describe that proves it (it is in `guards.test.ts`, not `validate.test.ts`).

- [ ] **Step 4: `blocks.tsx` — build the tree.** Reuse `list-disc`/`list-decimal` and `pl-5`, which already ship as separate rules inside the `LIST` string, so a nested list adds **no new rule**.

```tsx
interface ListNode { text: string; children: ListNode[] }

function nest(items: string[], levels: number[] | undefined): ListNode[] {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  items.forEach((text, i) => {
    // Clamped to the stack, so a levels array that jumps from 0 to 2 gives
    // one level of nesting rather than an orphan. Absent levels means flat.
    const depth = Math.min(levels?.[i] ?? 0, stack.length);
    const node: ListNode = { text, children: [] };
    stack.length = depth;
    if (depth === 0) roots.push(node);
    else stack[depth - 1].children.push(node);
    stack.push(node);
  });
  return roots;
}
```

- [ ] **Step 5: `indentAt` in `structure.ts`, capped at `MAX_LIST_DEPTH`** (imported from `types.ts`). A third level is unreadable at 390px and no jsdom test can tell you so, which is why the cap is a constant rather than a judgement at each press.

```ts
export function indentAt(blocks: Block[], at: Caret, delta: 1 | -1): Edit | null {
  const match = ITEM_KEY.exec(at.slotKey);
  if (match === null) return null;
  const block = blocks[at.blockIndex];
  const items = itemsOf(block);
  const index = Number(match[1]);
  const levels = Array.isArray((block as { levels?: unknown }).levels)
    ? ((block as { levels: number[] }).levels).slice()
    : items.map(() => 0);
  // The first item of a list has nothing to nest under, so Tab does nothing
  // there rather than producing a list whose only item is indented.
  const ceiling = index === 0 ? 0 : Math.min((levels[index - 1] ?? 0) + 1, MAX_LIST_DEPTH);
  const next = Math.max(0, Math.min((levels[index] ?? 0) + delta, ceiling));
  if (next === levels[index]) return null;
  levels[index] = next;
  const flat = levels.every((level) => level === 0);
  const updated = { ...block, items, levels } as Block;
  // A `levels: undefined` would be an OWN key with an undefined value, which
  // JSON.stringify drops but `unknownKeys` (hasOwnProperty, guards.ts:216)
  // still sees. Delete it instead, the same way withSlot omits a blank
  // caption rather than blanking it.
  if (flat) delete (updated as unknown as Record<string, unknown>).levels;
  return { blocks: splice(blocks, at.blockIndex, 1, updated), caret: at };
}
```

- [ ] **Step 6: Wire Tab/Shift+Tab in `WritingSurface.tsx`, with `preventDefault` only when `indentAt` returns non-null** — otherwise Tab must keep moving focus, which is how a keyboard user leaves the surface at all.

- [ ] **Step 7: Tests**

`structure.test.ts`: nests an item under the one above it (`levels: [0, 1]`); refuses to nest the first item; refuses to nest more than one level below the item above; caps at `MAX_LIST_DEPTH`; removes the `levels` key entirely once every item is flat again.

`blocks.test.tsx`: a flat list renders unchanged when `levels` is absent; `levels: [0, 1]` produces two `<ul>` and `li > ul > li` holding the second item; `levels: [0, 2]` renders one level of nesting rather than throwing.

`guards.test.ts` and `validate.test.ts`: a mismatched-length `levels`, refused at both ends — the cross-boundary case `guards.test.ts:578` exists for.

- [ ] **Step 8: `npx tsc -b --noEmit`** — `BLOCK_KEYS` and `BlockContentMap` are both total, so a missed edit is a compile error, not a runtime surprise.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop the `index === 0` ceiling | "refuses to nest the first item" |
| `ceiling` = `MAX_LIST_DEPTH` unconditionally | "refuses to nest more than one level below the item above" |
| set `levels[index]` without the flat-check delete | "removes the levels key entirely once every item is flat again" |
| drop `levels: true` from `BLOCK_KEYS` | `validate.test.ts`'s unknown-key-per-kind table |
| drop the length check from `assertBlock` | the new `guards.test.ts` case, and `guards.test.ts:578`'s both-ends describe |
| drop the `Math.min(…, stack.length)` clamp in `nest` | the `levels: [0, 2]` case — without it `stack[1]` is undefined and the render throws |
| add `levels` to the model with no control in `BlockFields` | `BlockFields.test.tsx:77` is `labels.length >= expected.length` and the `bulletList` fixture has two items, so it stays green with one extra declared key. **PREDICTED WEAK — do not list it as a check.** The `guards.test.ts` and `blocks.test.tsx` cases above are the pins |

**If this task is wrong:** a **visitor** sees a recipe's sub-steps rendered flat, or — with the clamp removed — the whole post page throws and renders nothing. The **owner** presses Tab and focus jumps out of the writing surface entirely.

**Browser-only:** whether one level of nesting is legible at 390px. That is a measurement and it belongs in Task 28 as a bounding-box assertion, not as a judgement in a comment.

---

## Task 27: Raise the entry CSS ceiling to a measured number (second raise)

**Files:**
- Modify: `src/test/bundle.post-build.test.ts`

- [ ] **Step 1: Worktree checkout of the true parent commit — never a stash.** That is this file's mandated method (`:319-713`); a stash leaves generated files in place and the diff lies.
```
git worktree add /tmp/vb-parent <parent-sha>
```
Resolve `<parent-sha>` on the branch (`git rev-parse HEAD~1`). Do not reuse the sha in any earlier comment; HEAD has moved since the 38593 ledger entry was written.

- [ ] **Step 2: Build both and record both numbers**
```
npm run build && wc -c dist/assets/index-*.css
cd <worktree> && npm ci && npm run build && wc -c dist/assets/index-*.css
```
Task 12 already raised the ceiling once; the "before" number here is Task 12's measured number, not 38593.

- [ ] **Step 3: Diff the two stylesheets rule by rule and write the result into the file's ledger**
```
grep -o '^[^{]*{' <worktree>/dist/assets/index-*.css | sort -u > /tmp/base-rules.txt
grep -o '^[^{]*{' dist/assets/index-*.css | sort -u > /tmp/head-rules.txt
diff /tmp/base-rules.txt /tmp/head-rules.txt
```
(`postcss-cli` is not installed — `postcss` is a devDependency but ships no bin.) A rule that appears and cannot be traced to a class you deliberately added is the signal this method exists to catch: `.lowercase`, `.collapse`, `.invisible`, a slant utility and a grid-columns utility have each leaked real rules out of **comments** in this repo (`bundle.post-build.test.ts:340-350`, `:404-420`, `:626-639`; `ManageShell.tsx:59-64`; `EditableImage.tsx:150-159`). Re-read every comment written in Tasks 13–26 against that list before choosing a number.

- [ ] **Step 4: Set the new ceiling to the measured size rounded up to the next 100, plus 100. Change both the assertion and the test-name string** — they have drifted apart once before (`:511-514`):
```ts
  // Measured at <NEW> bytes on <sha> after the writing surface landed, up
  // from <TASK 12's NUMBER>. The delta is accounted for rule by rule in the
  // ledger above. The check is not deleted and never should be: it has
  // caught accidental bloat more than once, including rules that leaked out
  // of prose comments rather than out of class attributes.
  it('the entry CSS file stays under <CEILING> bytes', () => {
    expect(size).toBeLessThan(<CEILING>);
  });
```

- [ ] **Step 5: Prove the assertion actually runs.** It is `it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))` and needs `VB_REQUIRE_DIST=1`, reached only through `npm run test:bundle` / `npm run build`; the file records that it silently skipped for an entire phase (`:703-713`). Run `VB_REQUIRE_DIST=1 npx vitest run src/test/bundle.post-build.test.ts` and read the output for the word `skipped` before believing the green.

- [ ] **Step 6: Check the other pinned numbers this work could have moved.** `homepage-bytes.test.tsx:249-257` asserts an exact `48074` on the **homepage**; nothing in this section renders on `/`, so it must be unchanged — if it moved, something leaked into a shared component and that is the finding. The Posts panel snapshot must be unchanged for the reason Task 25 Step 3 gives; run it with `CI=true`.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| set the ceiling below the measured size | the ceiling test, immediately |
| change the assertion but not the test name string | nothing — **PREDICTED WEAK, and the documented historical failure.** The counter-measure is not a test: Step 4 changes both in one edit, and the reviewer greps the file for the old number before merging |
| add a bare utility-looking token to any comment written in Tasks 13–26 | the ceiling test, but only if the leaked rule pushes past the new bound. With 100 bytes of headroom a 26-byte leak passes silently; the rule-level diff in Step 3 is the real check |
| delete the assertion | forbidden outright by the project rule |

---

## Task 28: `e2e/writing-surface.spec.ts` — everything jsdom cannot honestly assert

**Files:**
- Create: `e2e/writing-surface.spec.ts`

**Interfaces:** reuses `POSTS_PANEL = '[data-area="story"]:not([hidden]) [data-panel="posts"]'` and the `openPostsPanel`/`addPost` shapes lifted from the deleted `e2e/block-editor.spec.ts` (as re-pointed in Task 7 Step 5), plus `e2e/drag.ts`.

**Playwright runs only when nothing else runs; port 8080 is shared.** Run this on its own.

- [ ] **Step 1: Scaffold** — `openPostsPanel(page)`, `addPost(page)`, and `slots(page)` returning the text of every `[data-slot]` host in order.

- [ ] **Step 2: The assertions that can exist nowhere else. Each names the jsdom mutation it stands in for**

```ts
test('Enter splits a paragraph and leaves no line break behind', async ({ page }) => {
  // Task 18's preventDefault mutation: jsdom implements no default action
  // for Enter in a contenteditable, so only a real browser can show the
  // break element EditableText.tsx:77-91 documents.
});
test('the caret stays where she is typing across a commit', async ({ page }) => {
  // Task 17's focused-host exclusion. Type 'ac', move left one, type 'b',
  // expect 'abc'. Without the guard this reads 'acb'.
});
test('typing "1." and a space starts a numbered list and the characters are gone', async ({ page }) => {
  // Task 19. Both halves: a numberList exists, AND no "1." is on screen.
});
test('Enter on an empty list item leaves the list', async ({ page }) => {});
test('Tab nests a list item and Shift+Tab un-nests it', async ({ page }) => {}); // skip if Task 26 was cut
test('one level of nesting is legible at 390px', async ({ page }) => {});        // Task 26's bounding-box claim
test('pasting rich content leaves no foreign element in the surface', async ({ page }) => {
  // Task 22's preventDefault mutation. Write real rich content to the
  // clipboard, paste, then evaluate over the surface's descendants and
  // assert every element name is one of P, H2, BLOCKQUOTE, CITE, LI, UL, OL,
  // FIGURE, FIGCAPTION, IMG, STRONG, EM, S, U, CODE, A, BR.
});
test('Cmd+Z undoes the last step and the screen matches the draft', async ({ page }) => {
  // Tasks 20/21. The browser's own undo being suppressed is the claim; if it
  // is not, the DOM and the block array disagree and this catches it.
});
test('bold survives a click away and back', async ({ page }) => {
  // Tasks 15/16/20 end to end, in a real selection model.
});
test('the image picker opens from the toolbar control', async ({ page }) => {
  // Task 23's label-over-input shape, via page.waitForEvent('filechooser').
});
test('an inserted image sits centred at column width', async ({ page }) => {});
test('the toolbar is reachable above the keyboard at 390px', async ({ page }) => {
  // Same fold budget e2e/dashboard-sections.spec.ts:434-445 enforces for the
  // phone home rows.
});
test('the surface renders as a column at 1280px and at 390px', async ({ page }) => {});
```

- [ ] **Step 3: `npx playwright test e2e/writing-surface.spec.ts` with nothing else running.** `e2e/block-editor.spec.ts:19-23`'s warning applied here unchanged before that file was deleted, and still applies: the dev-server Tailwind JIT never removes rules within a session, so any assertion pointed at a *class* needs a cold restart before it can be believed.

- [ ] **Step 4: For each test, prove it can fail.** Revert the corresponding production line, watch it go red, restore. An e2e spec written against a working feature is the easiest place in the codebase to write a fifth unfalsifiable assertion.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| remove `event.preventDefault()` from the Enter branch (18) | "Enter splits a paragraph and leaves no line break behind" |
| remove the `focusedRef` guard from Task 17's layout effect | "the caret stays where she is typing across a commit" |
| remove `lastWritten.current.delete(...)` from Task 19's wiring | "typing 1. and a space starts a numbered list and the characters are gone" |
| remove `event.preventDefault()` from Task 22's paste handler | "pasting rich content leaves no foreign element in the surface" |
| remove `event.preventDefault()` from Task 20's `z` branch | "Cmd+Z undoes the last step and the screen matches the draft" |
| replace `toggleMark` with `document.execCommand('bold')` | "bold survives a click away and back" — a styled span is flattened to bare words by `readInline` |
| make the Image control a button that clicks the input | "the image picker opens from the toolbar control" |
| revert `PostList.tsx` to `BlockList` (25) | every test in this file |
| give the image figure a fixed pixel width | "an inserted image sits centred at column width" |

**If this task is wrong:** nothing is caught. Every genuinely dangerous property of this feature — caret, selection, paste, undo, and the fact that the swap happened at all — is provable only here.

---

# Section C — The public blog index, and the washes on a phone

Eight tasks. Tasks 29–32 add filter, sort and search to `/blog`; Tasks 33–36 make the section washes visible on a phone. The two halves touch disjoint files except `src/test/bundle.post-build.test.ts`, which Task 36 owns and which must run last of the eight.

**Facts this section is written against, which contradict the spec's own numbers — do not carry the spec's table forward unchecked.**

- The spec's wash table says the brand washes are `bg-brand/8` through `bg-brand/30`. **No section background in this repo uses a brand-with-opacity utility.** Every occurrence is a decorative ping dot (`Drinks.tsx:16-19`, `SignatureMocktails.tsx:42-45`), a hover wash (`NavBar.tsx:285,335,353`, `AreaNav.tsx:53`, `RecordList.tsx:116`, `BlockPicker.tsx:56`, `ChefGallery.tsx:40`), or inline code (`Inline.tsx:26`). The real section washes are `bg-white`, `bg-cream`, `bg-cream-alt`, `bg-slate-50` and a hard-coded near-white hex. "Raise the opacity scale" cannot be executed literally; Task 34 executes the *intent* against the classes that exist.
- The spec's "Footer band `(237,237,237)`, 18 points" has no counterpart in source: `Footer.tsx:10` is `bg-ink text-white py-16`, `#222222`. Treat 18 points as the **target**, not as an observation to reproduce.
- The brick overlay is real and it composites over every non-positioned section background — see **D7**. Task 33 measures it before Task 34 picks a hex.

---

## Task 29: The list operations, as pure functions

**Files:**
- Modify: `src/components/blog/posts.ts`, `src/components/blog/__tests__/posts.test.ts`

**Interfaces:** consumes `Post`, `PostType` (`src/content/types.ts:287`; `posts.ts` already imports both — confirm, do not change) and the existing `POSTS_PER_PAGE`, `POST_TYPE_LABELS`, `sortedPosts`, `pageCount`. Produces:

```ts
export type PostFilter = PostType | 'all';
export type PostOrder = 'newest' | 'oldest';
export const POST_FILTERS: readonly PostFilter[];
export const ALL_FILTER_LABEL: string;
export const NO_MATCHING_POSTS_MESSAGE: string;
export function filterLabel(filter: PostFilter): string;
export function filterByType(posts: Post[], filter: PostFilter): Post[];
export function searchPosts(posts: Post[], query: string): Post[];
export function orderedPosts(posts: Post[], order: PostOrder): Post[];
export function visiblePosts(posts: Post[], filter: PostFilter, query: string, order: PostOrder): Post[];
export function pageSlice(posts: Post[], page: number): Post[];
```
Removes `pageOf(posts, page)`. Its only production caller is `BlogIndex.tsx:39`, which Task 30 rewrites; leaving it exported-and-uncalled would be dead code with live tests. `pageSlice` inherits its clamp and its clamp tests.

- [ ] **Step 1: The control vocabulary, directly under `POST_TYPE_LABELS`**

```ts
// The controls above the list on /blog. `all` is NOT a PostType and must
// never become one: it is the absence of a filter, and POST_TYPE_LABELS
// stays total over the three real kinds so a fourth kind is still a
// `tsc -b` failure at the card badge rather than a blank pill.
export type PostFilter = PostType | 'all';
export type PostOrder = 'newest' | 'oldest';

export const POST_FILTERS: readonly PostFilter[] = ['all', 'recipe', 'story', 'mention'];
export const ALL_FILTER_LABEL = 'All';

// The filter row and the card badge read ONE table for the three real
// kinds. A control reading "Press mentions" beside a card badged "In the
// press" is two vocabularies for one idea; deriving the label rather than
// retyping it makes that impossible instead of merely currently-true.
export function filterLabel(filter: PostFilter): string {
  return filter === 'all' ? ALL_FILTER_LABEL : POST_TYPE_LABELS[filter];
}

// Deliberately NOT EMPTY_POSTS_MESSAGE. "the first post is on its way" is
// true of a blog with no posts and false of a blog with three posts and a
// filter that matches none of them -- and with today's committed content
// (three Mentions, pinned by src/content/__tests__/shape.test.ts:367-379)
// the Recipe and Story filters land here on the very first click.
export const NO_MATCHING_POSTS_MESSAGE = 'No stories match that — try another kind, or a different word.';
```

- [ ] **Step 2: The four list operations, under `sortedPosts`**

```ts
export function filterByType(posts: Post[], filter: PostFilter): Post[] {
  return filter === 'all' ? posts : posts.filter((post) => post.type === filter);
}

// Titles and excerpts, case-insensitive, over what is already in memory.
// No endpoint: use-posts.ts keeps the compiled-in list on `error`, so this
// keeps working with the database down. The empty-query early return is not
// an optimisation -- `''.includes('')` is true for every post, so the
// filtered branch would return the same CONTENTS -- it returns the same
// ARRAY, which is the only observable difference and is what posts.test.ts
// asserts.
export function searchPosts(posts: Post[], query: string): Post[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return posts;
  return posts.filter(
    (post) => post.title.toLowerCase().includes(needle) || post.excerpt.toLowerCase().includes(needle),
  );
}

// Oldest-first is its own ascending sort, NOT sortedPosts().reverse():
// reversing a stable descending sort also reverses the file order of two
// posts sharing a date, so one pair would read one way newest-first and the
// other way oldest-first for no reason a reader could name.
export function orderedPosts(posts: Post[], order: PostOrder): Post[] {
  if (order === 'newest') return sortedPosts(posts);
  return [...posts].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
}

export function visiblePosts(posts: Post[], filter: PostFilter, query: string, order: PostOrder): Post[] {
  return orderedPosts(searchPosts(filterByType(posts, filter), query), order);
}
```

- [ ] **Step 3: Replace `pageOf` with `pageSlice`**, keeping the existing comment block and amending its first sentence:

```ts
// Clamped rather than trusted. The page number reaches this from component
// state today and from a URL segment the moment anyone adds one, and an
// out-of-range slice returning [] renders as "no posts" -- which reads as a
// broken blog rather than as a bad page number.
//
// Takes an ALREADY-ordered list: /blog composes filter, search and sort
// before paging, and a function that re-sorted internally would silently
// throw the chosen order away on every page.
export function pageSlice(posts: Post[], page: number): Post[] {
  const clamped = Math.min(Math.max(1, Math.trunc(page)), pageCount(posts));
  const start = (clamped - 1) * POSTS_PER_PAGE;
  return posts.slice(start, start + POSTS_PER_PAGE);
}
```

- [ ] **Step 4: Rewrite the three `pageOf` cases in `describe('pagination')` against `pageSlice`**, keeping the negative-index reasoning comment verbatim:
```ts
  it('slices the requested page out of the list it was handed', () => { /* p19 first, page 3 has 2 */ });
  it.each([[0], [-1]])('clamps a too-low page number (%i) to page 1', (page) => { /* equals page 1 */ });
  it.each([[4], [99]])('clamps a too-high page number (%i) to the last real page', (page) => { /* equals pageCount */ });
```

- [ ] **Step 5: A new describe at the end of `posts.test.ts`**

```ts
describe('the /blog controls', () => {
  const mixed: Post[] = [
    { ...post('r-new', '2026-03-01'), type: 'recipe', title: 'Lemon and caper spaghetti', excerpt: 'A weeknight plate.' },
    { ...post('s-mid', '2026-02-01'), type: 'story', title: 'The oven arrives', excerpt: 'Six men and a lemon tree.' },
    { ...post('m-old', '2026-01-01'), type: 'mention', title: 'A review', excerpt: 'Nothing citrus here.' },
  ];

  it('offers All plus every kind the model carries, once each', () => {
    expect([...POST_FILTERS]).toEqual(['all', 'recipe', 'story', 'mention']);
    expect(new Set(POST_FILTERS).size).toBe(POST_FILTERS.length);
  });
  it("labels every filter that names a kind with that kind's own card badge", () => {
    for (const kind of ['recipe', 'story', 'mention'] as const) expect(filterLabel(kind)).toBe(POST_TYPE_LABELS[kind]);
    expect(filterLabel('all')).toBe(ALL_FILTER_LABEL);
  });
  it('keeps only the chosen kind, and everything under All', () => { /* r-new / s-mid / mixed */ });
  it('searches titles', () => { /* 'spaghetti' -> r-new */ });
  it('searches excerpts too, on a word no title contains', () => { /* 'six men' -> s-mid */ });
  it('ignores case and surrounding space', () => { /* '  LEMON  ' -> r-new, s-mid */ });
  it('hands back the very same array for an empty query, not a copy of it', () => {
    // Referential, deliberately: `''.includes('')` is true for every post, so
    // a filtered branch would return the same CONTENTS and this is the only
    // assertion the early return can fail.
    expect(searchPosts(mixed, '')).toBe(mixed);
    expect(searchPosts(mixed, '   ')).toBe(mixed);
  });
  it('orders newest first and oldest first', () => { /* both directions */ });
  it('keeps file order between two posts sharing a date in BOTH directions', () => {
    // This is what a reverse() implementation of oldest-first cannot do.
    const same = [post('a', '2026-01-01'), post('b', '2026-01-01')];
    expect(orderedPosts(same, 'newest').map((p) => p.slug)).toEqual(['a', 'b']);
    expect(orderedPosts(same, 'oldest').map((p) => p.slug)).toEqual(['a', 'b']);
  });
  it('composes: a kind and a word together', () => { /* recipe+lemon, story+lemon, mention+lemon */ });
  it('applies the order AFTER the filter and the search', () => { /* ['s-mid','r-new'] */ });
  it('says something different about an empty result than about an empty blog', () => {
    expect(NO_MATCHING_POSTS_MESSAGE).not.toBe(EMPTY_POSTS_MESSAGE);
  });
});
```

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/components/blog/__tests__/posts.test.ts`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `filterByType` returns `posts` unconditionally | "keeps only the chosen kind, and everything under All" |
| delete the excerpt clause from `searchPosts` | "searches excerpts too, on a word no title contains" |
| `query.trim().toLowerCase()` → `query.trim()` | "ignores case and surrounding space" |
| delete the empty-query early return | "hands back the very same array for an empty query, not a copy of it" |
| oldest branch → `sortedPosts(posts).reverse()` | "keeps file order between two posts sharing a date in BOTH directions" |
| `visiblePosts` drops the filter | "composes: a kind and a word together" |
| delete `pageSlice`'s clamp | both clamp cases |
| hardcode `filterLabel` **and** change `POST_TYPE_LABELS.mention` | "labels every filter that names a kind with that kind's own card badge". The two halves are needed together: changing the table alone reddens only the existing literal pin at `posts.test.ts:89-95`, and hardcoding alone leaves both green. That two-part shape is what proves the derivation rather than the current agreement |

**If this is wrong:** nothing is visible yet — no component calls any of it. It surfaces in Task 30 as a filter that shows the wrong posts or a sort that silently ignores the chosen direction.

**Browser-only claims:** none.

---

## Task 30: The controls on `/blog`

**Files:**
- Modify: `src/components/blog/BlogIndex.tsx`, `src/components/blog/__tests__/BlogIndex.test.tsx`

**Interfaces:** consumes Task 29's exports. Produces, for Task 32 — the DOM contract, and nothing else may be relied on:
- kind filters: `<button aria-pressed>` inside `<div role="group" aria-label="Filter stories by kind">`, names `All`, `Recipe`, `Story`, `In the press`
- order: `<button aria-pressed>` inside `<div role="group" aria-label="Sort stories">`, names `Newest first`, `Oldest first`
- search: `<input type="search" id="blog-search" aria-label="Search stories">` → role `searchbox`
- the no-match sentence: a `<p>` carrying `NO_MATCHING_POSTS_MESSAGE`

- [ ] **Step 1: The import at `BlogIndex.tsx:15`** becomes the seven names plus `import type { PostFilter, PostOrder } from './posts';`.

- [ ] **Step 2: The shared control chrome, above `export default function BlogIndex()`**

These are the *exact* strings today's pagination buttons build inline, split so the filter row, the sort row and the pagination row cannot drift into three chromes for one idea — and so the pagination row's rendered class attribute does not move.

```tsx
// The one control chrome, shared by the three rows. Byte-identical to the
// string the numbered page buttons already built inline, so this split costs
// zero new rules. The pressed state paints ink on the brand surface, never
// white: the brand blue is 1.45:1 against white and the palette sweep exists
// because this project once shipped exactly that button.
const CONTROL_CLASSNAME = `px-4 py-2 rounded-lg font-['Montserrat'] text-sm transition-colors duration-300`;
const CONTROL_ON = 'bg-brand text-ink';
const CONTROL_OFF = 'bg-white border border-gray-300 hover:bg-gray-50';
const ORDERS: readonly PostOrder[] = ['newest', 'oldest'];
const ORDER_LABELS: Record<PostOrder, string> = { newest: 'Newest first', oldest: 'Oldest first' };
```
(The comment names no bare utility token. `BlogIndex.tsx` is inside Tailwind's content glob, and the project rule holds even where the token happens to be used as a real class two lines below.)

- [ ] **Step 3: State and derivation, replacing `:35` and `:38-39`**

```tsx
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<PostFilter>('all');
  const [order, setOrder] = useState<PostOrder>('newest');
  const [query, setQuery] = useState('');
  useCanonical(`${site.seo.url}/blog`);

  // Every count on this page is a count of the VISIBLE list, not of the
  // whole one. Reading pageCount(posts) here while slicing the filtered list
  // is the exact bug shape a filter introduces: three numbered buttons above
  // a single-page result, two of which show nothing.
  const visible = visiblePosts(posts, filter, query, order);
  const total = pageCount(visible);
  const shown = pageSlice(visible, page);
```

- [ ] **Step 4: The page-reset helpers, below `goTo`**

```tsx
  // Every control resets to page 1. Choosing Recipes while standing on page 2
  // of All otherwise lands on page 2 of a one-page result, which pageSlice
  // clamps back to page 1 -- so the cards would be right and the highlighted
  // page number wrong, which is worse than either.
  function chooseFilter(next: PostFilter): void { setFilter(next); setPage(1); }
  function chooseOrder(next: PostOrder): void { setOrder(next); setPage(1); }
  function changeQuery(next: string): void { setQuery(next); setPage(1); }
```

- [ ] **Step 5: The three control rows**, immediately after the heading block's closing `</div>` and before the `posts.length === 0` ternary. `flex flex-wrap justify-center gap-4` is reused verbatim from `Drinks.tsx:67` and `mb-8` from `Hero.tsx:145` — no new layout rules.

```tsx
          <div className="flex flex-wrap justify-center gap-4 mb-8" role="group" aria-label="Filter stories by kind">
            {POST_FILTERS.map((value) => (
              <button key={value} type="button" aria-pressed={filter === value}
                onClick={() => chooseFilter(value)}
                className={`${CONTROL_CLASSNAME} ${filter === value ? CONTROL_ON : CONTROL_OFF}`}>
                {filterLabel(value)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-8" role="group" aria-label="Sort stories">
            {ORDERS.map((value) => (
              <button key={value} type="button" aria-pressed={order === value}
                onClick={() => chooseOrder(value)}
                className={`${CONTROL_CLASSNAME} ${order === value ? CONTROL_ON : CONTROL_OFF}`}>
                {ORDER_LABELS[value]}
              </button>
            ))}
          </div>

          {/* aria-label rather than a visually-hidden <label>: the
              hidden-label utility has no rule in the shipped stylesheet today
              and would be a new one for no reader-visible gain, and a heading
              over these rows would make e2e/blog.spec.ts:52-53's own "no h2
              anywhere on the page" comment stale. */}
          <div className="flex justify-center mb-12">
            <input id="blog-search" type="search" value={query}
              onChange={(event) => changeQuery(event.target.value)}
              aria-label="Search stories" placeholder="Search stories"
              className={`w-full max-w-2xl px-4 py-2 rounded-lg border border-gray-300 bg-white font-['Open_Sans'] text-sm text-ink`} />
          </div>
```

- [ ] **Step 6: The empty ternary becomes three-way**, keeping the existing comment above the first branch verbatim and adding the second branch's reason (a blog with three posts and a filter matching none of them is not an empty blog).

- [ ] **Step 7: Point the numbered page button at the shared bindings**: `` className={`${CONTROL_CLASSNAME} ${page === n ? CONTROL_ON : CONTROL_OFF}`} ``

- [ ] **Step 8: Fix the test this breaks**

`BlogIndex.test.tsx`'s "shows each post's type as a readable badge" does `screen.getByText('In the press')` and `screen.getByText('Recipe')`. Both strings now appear twice — once as a filter control, once as a card badge — and `getByText` throws on multiple matches. Replace with the claim it was always making, scoped to the cards (`PostCard.tsx:32` renders exactly one `<span>` per `<article>`):

```tsx
  it("shows each post's type as a readable badge on the card, in the same words as the filter", () => {
    const { container } = renderIndex([post(1), post(2)]);
    const badges = [...container.querySelectorAll('article span')].map((s) => s.textContent);
    expect(badges).toEqual(['Recipe', 'In the press']);
  });
```

- [ ] **Step 9: The component-level cases**, added inside the existing `describe('BlogIndex')` (add `NO_MATCHING_POSTS_MESSAGE` to the import at `:12`):

starts on All / newest / empty box · narrows to one kind · turns the order round without changing which posts are shown · filters as she types over titles and excerpts · composes a kind and a word · says so in words when nothing matches and does not claim the blog is empty · goes back to page one when a control changes · counts pages over the filtered list, not the whole one.

- [ ] **Step 10: `npx tsc -b --noEmit`, then `npm test -- --run src/components/blog`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `pageCount(visible)` → `pageCount(posts)` | "counts pages over the filtered list, not the whole one" |
| `pageSlice(visible, page)` → slice of the unfiltered list | "narrows to one kind when that kind is chosen" |
| delete `setPage(1)` from `chooseOrder` | "goes back to page one when a control changes" |
| `aria-pressed={filter === value}` → `false` | "starts on All, newest first, with an empty search box" |
| second branch renders `EMPTY_POSTS_MESSAGE` | "says so in words when nothing matches…" |
| `filterLabel(value)` → `value` in the button body | "narrows to one kind when that kind is chosen" — its `getByRole('button', { name: 'Recipe' })` finds nothing. **The badge case cannot see the filter row**; if that is not enough, add an explicit assertion that the filter row's accessible names equal `['All', ...Object.values(POST_TYPE_LABELS)]` |
| `onChange` drops `setQuery` | "filters as she types, over titles and excerpts" |
| `CONTROL_ON` → white text on the brand surface | **Nothing in vitest.** jsdom has no computed style and this is a class string. Task 32 only. Listed so nobody reads the vitest green as covering it |

**If this is wrong:** a VISITOR on `/blog` sees the wrong cards for a control they just pressed, or three page numbers above a one-page result, or "the first post is on its way" on a blog that plainly has three posts. The OWNER sees nothing.

---

## Task 31: The controls survive a D1 outage

**Files:**
- Modify: `src/components/blog/__tests__/BlogIndex.test.tsx`

**Interfaces:** consumes the `stubFetch` helper at `BlogIndex.test.tsx:54-56` and `usePosts`'s documented `error` behaviour (`use-posts.ts:56-82` — on a failed fetch the state becomes `{status:'error', posts: committed}`).

This task exists on its own because it is the one claim in the spec no other test makes: *"it searches what is already loaded in the browser — no new endpoint, no server round trip, and it keeps working from the compiled-in fallback when D1 is unreachable."* Every other case in the file runs against a fetch that never settles, which is the *loading* state, not the *error* state.

- [ ] **Step 1: Drive the error state explicitly, and do not pretend a first-paint assertion proves it**

`findByRole('button', { name: 'All', pressed: true })` resolves synchronously on the first check — the All pill is pressed before any fetch settles — so it proves nothing about `status`. Flush the rejection instead:

```tsx
  it('still filters, sorts and searches with the database unreachable', async () => {
    // Not a pending fetch -- a REJECTED one. usePosts settles to
    // `status: 'error'` and keeps the compiled-in list, and the controls have
    // to work over that list, because that is the whole reason search is
    // client-side and has no endpoint of its own.
    const fetchMock = vi.fn(() => Promise.reject(new Error('D1 is down')));
    stubFetch(fetchMock);
    const { container } = renderIndex([post(1), post(2), post(3), post(4)]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });   // let the rejection settle

    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 4', 'Fixture post 2']);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stories' }), 'Excerpt 2');
    expect(cardHeadings(container)).toEqual(['Fixture post 2']);

    await userEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 2']);
  });

  it('sends no request of its own when a control is used', async () => {
    const calls = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', calls);
    renderIndex([post(1), post(2)]);
    const before = calls.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stories' }), 'lemon');
    await userEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    // The one call usePosts makes on mount, and not one more. A control that
    // quietly grew an endpoint is the thing this refuses.
    expect(calls.mock.calls.length).toBe(before);
    expect(before).toBe(1);
  });
```

- [ ] **Step 2: `npm test -- --run src/components/blog/__tests__/BlogIndex.test.tsx`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| in `BlogIndex.tsx`, render the three control rows only when `status === 'loaded'` | "still filters, sorts and searches with the database unreachable" — the Recipe button is not found. **This is what makes the case falsifiable independent of the flush timing** |
| in `BlogIndex.tsx`, make `changeQuery` also call `fetch('/api/published?path=posts.json')` | "sends no request of its own when a control is used" |
| in `use-posts.ts:56-82`, change the `error` branch to `posts: []` | "still filters…" (no cards at all). Also reddens `use-posts`' own suite — expected, and the row is here to show this test is not blind to its own fixture |

**If this is wrong:** a VISITOR reaching `/blog` while `/api/published` is failing gets a filter row that does nothing, or an empty page, instead of the three committed cards filtering normally. This is the state the site is in during a Worker outage, so it is not hypothetical.

---

## Task 32: The controls in a real browser at 390px and 1280px

**Files:**
- Create: `e2e/blog-controls.spec.ts`

**Interfaces:** consumes Task 30's DOM contract and the committed `src/content/posts.json`, whose three posts are all `type: 'mention'` and are pinned by `src/content/__tests__/shape.test.ts:367-379`:

| slug | date | title contains | excerpt contains |
|---|---|---|---|
| `bw-hotelier-regional-flair` | 2024-12-15 | "Regional Italian Flair" | "Puglian" |
| `delhi-royale-pastificio-ristorante` | 2024-12-10 | "Pastificio" | — |
| `restaurant-india-cordon-bleu-debut` | 2024-12-05 | "Cordon Bleu" | — |

- [ ] **Step 1: Read `e2e/block-editor.spec.ts:19-23` before writing a line** (or, if Task 25 has already deleted it, the same warning as restated in Task 28 Step 3): the dev-server Tailwind JIT never removes a rule within a session, so any assertion pointed at a *class* needs a cold restart before its green can be believed. This spec asserts computed style and geometry, not class names, for that reason.

- [ ] **Step 2: The spec, at both widths**

```ts
import { expect, test } from '@playwright/test';

// Runs against the committed posts.json -- three Mention posts. That is why
// "Recipe" here is the empty-result case and "In the press" is the
// everything case, and it is deliberate: a fourth post of a different kind
// changes what this spec sees, which is the signal we want.
const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// The ink and brand pair e2e/blog.spec.ts already pins on the card badge.
const INK = 'rgb(34, 34, 34)';
const BRAND = 'rgb(200, 216, 232)';

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the kind filters narrow the list, and All brings it back', async ({ page }) => {
      await page.goto('/blog');
      await expect(page.locator('article')).toHaveCount(3);
      await page.getByRole('button', { name: 'Recipe' }).click();
      await expect(page.locator('article')).toHaveCount(0);
      await expect(page.getByText(/No stories match that/)).toBeVisible();
      await page.getByRole('button', { name: 'In the press' }).click();
      await expect(page.locator('article')).toHaveCount(3);
      await page.getByRole('button', { name: 'All' }).click();
      await expect(page.locator('article')).toHaveCount(3);
    });

    test('search reaches a word that is only in an excerpt', async ({ page }) => {
      await page.goto('/blog');
      await page.getByRole('searchbox', { name: 'Search stories' }).fill('puglian');
      await expect(page.locator('article')).toHaveCount(1);
    });

    test('oldest first turns the real list round', async ({ page }) => { /* first h3 flips */ });

    test('a kind and a word compose', async ({ page }) => { /* In the press + 'cordon' -> 1; Story -> 0 */ });

    test('the pressed pill is ink on brand, never white on brand', async ({ page }) => {
      await page.goto('/blog');
      const colours = await page.getByRole('button', { name: 'All' }).evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, background: style.backgroundColor };
      });
      // Both assertions on the foreground, deliberately: the equality holds
      // the colour, the inequality names the hazard for whoever reads this
      // after breaking it.
      expect(colours.color).not.toBe('rgb(255, 255, 255)');
      expect(colours.color).toBe(INK);
      expect(colours.background).toBe(BRAND);
    });

    test('nothing the controls add pushes the page sideways', async ({ page }) => {
      await page.goto('/blog');
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test('the four kind pills sit on one row at 1280 and wrap at 390', async ({ page }) => {
      // What "wraps" actually means, measured. Dropping flex-wrap does NOT
      // overflow the page: flex items have an automatic min-content minimum,
      // so the four pills shrink and their labels wrap inside the buttons
      // instead -- roughly 330px of min-content against the 358px available
      // at 390px, so the overflow test above stays green. This is the
      // assertion that catches it.
      await page.goto('/blog');
      const first = (await page.getByRole('button', { name: 'All' }).boundingBox())!;
      const last = (await page.getByRole('button', { name: 'In the press' }).boundingBox())!;
      if (size.width === 390) expect(last.y).toBeGreaterThan(first.y);
      else expect(last.y).toBe(first.y);
    });

    test('every control is inside the viewport, and none overlaps another', async ({ page }) => {
      // boxes for All, Recipe, Story, In the press, Newest first, Oldest
      // first: each x >= 0, x + width <= viewport width, and no pair
      // intersects.
    });
  });
}
```

- [ ] **Step 3: Run it alone, with nothing else on port 8080:** `npx playwright test e2e/blog-controls.spec.ts`

- [ ] **Step 4: Re-run `npx playwright test e2e/blog.spec.ts` unchanged.** Its `toHaveCount(3)` at both widths still passes because the default filter is `all`, and its `/blogs` case still finds exactly one `h1` named "All Stories" because these controls add no heading. If either fails, the controls changed the default state and Task 30 is wrong, not this spec.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| drop `flex-wrap` from the kind-filter row | mobile only, "the four kind pills sit on one row at 1280 and wrap at 390" |
| `CONTROL_ON` → white text on brand | both widths, "the pressed pill is ink on brand, never white on brand" |
| `CONTROL_ON` → `'bg-white border border-gray-300'` | both widths, same test (background assertion) |
| `filterByType` returns `posts` unconditionally | "the kind filters narrow the list, and All brings it back" |
| `searchPosts` drops the excerpt clause | "search reaches a word that is only in an excerpt" |
| `orderedPosts` oldest branch returns `sortedPosts` | "oldest first turns the real list round" |
| remove `mb-8` from the sort row | **Nothing.** Adjacent rows with zero margin still do not overlap. PREDICTED WEAK — do not add a margin assertion to chase it. Spacing that reads well is a screenshot judgement, and `e2e/about-byline.spec.ts:104-120` records why pixel sampling near glyphs is the wrong tool for it |

**If this is wrong:** a VISITOR on a phone gets a `/blog` page that scrolls sideways, or a control row running off the right edge with "In the press" unreachable, or a highlighted pill at 1.45:1 that nobody can read outdoors.

**Browser-only claims — all of them.**

---

## Task 33: Measure the washes at 390px, before changing anything

**Files:**
- Create: `e2e/section-washes.spec.ts`

**Interfaces:** consumes `sharp`, already a devDependency (`package.json:47`) and already used by `scripts/images.mjs`; Playwright specs run in Node, so importing it is legitimate. `e2e/` is in no tsconfig project, so `npx tsc -b --noEmit` will not check this file.

It produces nothing for other tasks. `BANDS` and the metric live in this file and are **not exported**: Task 34 writes its hexes by hand and Task 35 deliberately re-implements the arithmetic in `src/test/`, because a shared import between `src/test/` and `e2e/` would let one silently define the other away.

- [ ] **Step 1: Fix the metric in words, before any code**

**Points below white = `255 − (r + g + b) / 3`**, the mean channel drop. The spec's table quotes per-channel ranges, which cannot express a single target; the footer's "18 points" is a single number, so the target has to be one too. A second, independent floor guards the degenerate case a mean cannot see: **every channel must be at least 8 below white**, so a band cannot average 18 while one channel sits at white.

- [ ] **Step 2: Verify the two coordinate spaces agree before trusting any number**

`boundingBox()` is documented as viewport-relative; `page.screenshot({ clip })` is passed through to CDP, which uses page coordinates. Before pasting a BEFORE table, sample one band of a known colour (scroll to top, clip at `x: 4, y: 4`, and confirm the pixel is the colour the top section actually paints). If they disagree, add the scroll offset explicitly and record that you had to.

- [ ] **Step 3: `e2e/section-washes.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

// The section washes, measured as pixels on a 390px phone -- the only honest
// way to measure them, because src/index.css paints a fixed, full-viewport
// pseudo-element of a brick photograph at 10% opacity over the whole page,
// and getComputedStyle cannot see a pseudo-element's background image at
// all. e2e/brand-contrast.spec.ts's effectiveBg walks straight past it.
// Whatever that overlay contributes, a screenshot has it and a computed
// style does not.
//
// This is NOT a contrast measurement and must never become one. This project
// has one earlier contrast finding that was an artefact of pixel sampling a
// region with glyphs still painted in it (e2e/about-byline.spec.ts:104-120
// records it). Every sample below is taken in a section's left gutter, 4px
// in, where no text, card or decorative dot is painted. Contrast stays where
// it belongs, in e2e/brand-contrast.spec.ts, off computed style.

type Band = { id: string; label: string; kind: 'wash' | 'white' };

// The eight homepage sections below the hero, in sections.json order. The
// hero is excluded: it is a photograph collage over white and has no flat
// band to sample.
const BANDS: readonly Band[] = [
  { id: 'gallery', label: 'atmosphere', kind: 'wash' },
  { id: 'menu', label: 'food', kind: 'white' },
  { id: 'drinks', label: 'drinks', kind: 'wash' },
  { id: 'experiences', label: 'experiences', kind: 'wash' },
  { id: 'blogs', label: 'press', kind: 'wash' },
  { id: 'awards', label: 'awards', kind: 'white' },
  { id: 'our-story', label: 'our story', kind: 'wash' },
  { id: 'visit', label: 'visit', kind: 'wash' },
];

function pointsBelowWhite(r: number, g: number, b: number): number {
  return 255 - (r + g + b) / 3;
}

test.use({ viewport: { width: 390, height: 844 } });

test('every wash band lands 15 to 20 points below white on a phone', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const rows: { label: string; kind: string; rgb: string; points: number }[] = [];

  for (const band of BANDS) {
    const section = page.locator(`#${band.id}`);
    await expect(section, `#${band.id} is not on the homepage`).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    // The vertical middle of whatever part of the section is on screen,
    // clamped into the viewport; x = 4 is inside the section and outside its
    // own centred content column at every width.
    const y = Math.max(0, Math.min(box.y + box.height / 2, 843));
    const shot = await page.screenshot({ clip: { x: 4, y, width: 1, height: 1 } });
    const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0], data[1], data[2]];
    const points = pointsBelowWhite(r, g, b);
    rows.push({ label: band.label, kind: band.kind, rgb: `(${r},${g},${b})`, points: Number(points.toFixed(1)) });

    if (band.kind === 'wash') {
      expect(points, `${band.label} mean drop`).toBeGreaterThanOrEqual(15);
      expect(points, `${band.label} mean drop`).toBeLessThanOrEqual(20);
      // A band cannot average 18 while one channel sits at white.
      expect(255 - Math.max(r, g, b), `${band.label} shallowest channel`).toBeGreaterThanOrEqual(8);
    } else {
      // The white bands stay white, because a wash only reads as a boundary
      // if the thing on the other side of it is not also a wash. This is
      // unreachable until Task 34 positions the sections above the brick
      // overlay -- see the BEFORE table below, where both white bands
      // measure roughly 14.5 points down purely from that overlay.
      expect(points, `${band.label} mean drop`).toBeLessThanOrEqual(3);
    }
  }

  await testInfo.attach('section-washes-390.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  // eslint-disable-next-line no-console
  console.table(rows);
});
```

- [ ] **Step 4: Run it: `npx playwright test e2e/section-washes.spec.ts`. It must fail**, and its failure is the "before" measurement. Copy the printed table into a comment block at the top of the file under `// BEFORE (measured <date>, 390x844, chromium):`, one row per band, with the exact rgb triple and mean drop. Do not paraphrase; paste the numbers.

- [ ] **Step 5: Read the BEFORE table for the two facts Task 34 depends on**

- **What does the brick overlay contribute?** Predicted ~14.5 points on every non-positioned band: the brick image's channel means are `(132.3, 110.0, 88.8)` (measured with sharp `.stats()`), composited at 0.1 over white gives `(242.7, 240.5, 238.4)`. Confirm against the two `white`-kind rows, which have no wash of their own — whatever they read *is* the overlay.
- **Does `#drinks` differ from `#experiences`?** Both are the same token today, but `Drinks.tsx:13` carries `relative` and `Experiences.tsx:32` does not, and a positioned element paints above the fixed pseudo-element while a non-positioned one paints below it. If those two rows differ, decision **D7** is confirmed live and Task 34's `relative` additions are what makes every band comparable.

- [ ] **Step 6: Touch no component in this task.** It ends red on purpose.

**If this is wrong:** nothing ships — this task changes no rendered byte. The risk is a *wrong measurement* leading Task 34 to a wrong hex, which a VISITOR then sees as bands that are either still invisible or noticeably blue.

**Browser-only claims — all of them, by construction.** A rendered pixel under a fixed pseudo-element overlay is not observable from jsdom, from `getComputedStyle`, or from the token values in `tailwind.config.js`.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| (after Task 34, once green) revert `OurStory.tsx:63` to its old token | the `our story` row |
| (after Task 34) point `Awards.tsx:44` at the new wash token | the `awards` row (`points > 3`) |
| (after Task 34) remove `relative` from `Experiences.tsx` | the `experiences` row — the overlay comes back on top and the drop overshoots 20 |
| change the sample x from `4` to `195` (centre of the viewport) | `atmosphere` and `food` — those sections paint photo grids across the centre column. This is the row that proves the gutter choice is load-bearing rather than arbitrary |
| `pointsBelowWhite` → `255 - Math.min(r, g, b)` | after Task 34, every `wash` row (the cool token gives 25, outside 15–20). Proves the metric is the one the assertion uses |
| delete the shallowest-channel floor | the floor cannot redden without a deliberately degenerate token. **PREDICTED WEAK as written** — prove it once by hand with a token whose mean drop is ~15 but whose red channel is at white, watch the floor go red, revert, and record in the file that you did it |

---

## Task 34: The wash tokens, and the eight bands

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/components/PlaceGallery.tsx`, `Drinks.tsx`, `Experiences.tsx`, `blog/BlogSection.tsx`, `OurStory.tsx`, `VisitUs.tsx`, `FoodGallery.tsx`, `Awards.tsx`, `templates/ItemListSection.tsx`
- Modify: `src/test/homepage-bytes.test.tsx`

**Interfaces:** produces, for Tasks 35 and 36:
```js
// tailwind.config.js -> theme.extend.colors
wash: '#E6EDF5',        // brand blue #C8D8E8 at 45% over white; mean 17.7 points below white
'wash-warm': '#F5EEE4', // the warm partner; mean 18.0 points below white
```
giving the utilities that paint the two washes.

- [ ] **Step 1: Derive the cool token from the target, not from the spec's phantom scale**

Brand `#C8D8E8` at opacity *a* over white composites to `(255−55a, 255−39a, 255−23a)`; the mean drop is `(55+39+23)a/3 = 39a`. Solving `39a ∈ [15, 20]` gives `a ∈ [0.385, 0.513]`. At `a = 0.45`: `(230.25, 237.45, 244.65)` → **`#E6EDF5`**, mean drop **17.7**, shallowest channel 10 below white. That matches the footer's 18-point target, the only band the spec says currently reads. (The spec's "roughly a 15-point bump on an 8%–30% scale" is not used to pick this number: that scale is the phantom this section's preamble refutes.)

- [ ] **Step 2: Derive the warm token to the same mean** so the two bands read as one system: **`#F5EEE4`** = `(245, 238, 228)`, mean drop **18.0**, shallowest channel 10. It is the mirror of the cool token about the neutral axis. It is *not* the existing cream deepened along its own hue — holding cream's `(0, 2, 7)` deviation ratio to an 18-point mean gives `(255, 243, 213)`, a saturated yellow that is a colour, not a wash.

- [ ] **Step 3: Put the sections above the brick overlay, which is what makes the arithmetic and the pixel agree (D7)**

Add `relative` to the section wrapper of `PlaceGallery`, `Experiences`, `BlogSection`, `OurStory`, `VisitUs`, `FoodGallery` and `Awards`. `Drinks.tsx:13` already has it. Without this, the composite is `measured = 0.9 × token + 0.1 × brick`, the rendered drop of an 17.7-point token is ~30, Task 33's window and Task 35's window cannot both be satisfied, and `#drinks` and `#experiences` measure differently while carrying the same class.

**Check before doing it:** `grep -n "absolute" src/components/{PlaceGallery,Experiences,OurStory,VisitUs,FoodGallery,Awards}.tsx src/components/blog/BlogSection.tsx`. A `relative` wrapper becomes the containing block for any absolutely-positioned descendant that currently resolves against something further up. If any of those files positions a child absolutely, measure that child's box at 390px and 1280px before and after in `e2e/section-washes.spec.ts`, or leave that one section unpositioned and give its band its own expected value in Task 33.

*Cost, stated:* the brick texture no longer shows through these eight sections. It remains behind the hero, in the page margins, and on every other page. `Drinks` already looks this way today.

- [ ] **Step 4: `tailwind.config.js`, after `'cream-alt'`**

```js
        // The section washes. A band on a phone in daylight has to be visibly
        // a band: measured at 390px, every wash on this site sat 2 to 8 points
        // below white and only the footer read as a boundary at all. These
        // land 18 points below white -- the brand surface colour at 45% over
        // white for the cool one, its mirror about the neutral axis for the
        // warm one -- which is the footer's own distance and is where
        // e2e/section-washes.spec.ts holds them.
        //
        // Still a wash, not a colour. The brand blue stays a SURFACE colour
        // (1.45:1 on white); text on these keeps using ink or the accent, and
        // e2e/brand-contrast.spec.ts's sweep over every text node still
        // governs. src/test/palette.test.ts holds the floors these clear.
        //
        // ONE CONSTRAINT THIS CREATES: the palest of Tailwind's mid greys
        // measures 4.10:1 on the cool wash and 4.20:1 on the warm one, both
        // under AA. That grey and these two washes are mutually exclusive
        // from here on. Nothing on the homepage pairs them today; the sweep
        // will say "unreadable" without saying why, so it is said here.
        wash: '#E6EDF5',
        'wash-warm': '#F5EEE4',
```

Leave `cream` and `cream-alt` defined: `cream` still paints the ingredients and steps blocks (`blocks.tsx:113,123`) and the nav dropdown (`NavBar.tsx:268`); `cream-alt` still paints `NotFound.tsx:8` and `ErrorBoundary.tsx:26`. Removing either would break those and `palette.test.ts`'s "keeps ink readable on both creams".

- [ ] **Step 5: The class changes, exactly**

| File:line | from | to |
|---|---|---|
| `PlaceGallery.tsx:8` | `"py-20 bg-[#F9F9F9]"` | `"py-20 relative bg-wash"` |
| `Drinks.tsx:13` | `"py-20 bg-cream relative overflow-hidden"` | `"py-20 bg-wash-warm relative overflow-hidden"` |
| `Experiences.tsx:32` | `"py-20 bg-cream"` | `"py-20 relative bg-wash-warm"` |
| `blog/BlogSection.tsx:39` | `"py-20 bg-slate-50"` | `"py-20 relative bg-wash"` |
| `OurStory.tsx:63` | `"py-20 bg-cream-alt"` | `"py-20 relative bg-wash-warm"` |
| `VisitUs.tsx:9` | `"py-20 bg-cream-alt"` | `"py-20 relative bg-wash"` |
| `FoodGallery.tsx:8` | `"py-20 bg-white"` | `"py-20 relative bg-white"` |
| `Awards.tsx:44` | `"py-20 bg-white"` | `"py-20 relative bg-white"` |
| `templates/ItemListSection.tsx:18` | `"py-20 bg-[#F9F9F9]"` | `"py-20 relative bg-wash"` |

`VisitUs` moves to the cool token deliberately: it and `OurStory` are both the same token today, so the boundary between the last two bands on the homepage does not exist at any opacity. `Drinks` and `Experiences` stay the same token as each other, which is also true today — that pair has no boundary now and does not gain one here; say so rather than pretending otherwise. `FoodGallery`, `Awards` and `Hero.tsx:86` keep white: alternation is the entire mechanism, and if every band is a wash there are no bands.

- [ ] **Step 6: Re-measure `homepage-bytes` and write its ledger entry**

`npm test -- --run src/test/homepage-bytes.test.tsx` fails with an exact actual number. The predicted arithmetic, for checking the ledger rather than for trusting: class-string deltas are PlaceGallery −5, Drinks +4, Experiences +4, BlogSection −4, OurStory 0, VisitUs −5 (sum **−6**), plus ` relative` at 9 characters on each of the seven sections that gain it and render at `/` (**+63**), predicting **48131** against today's 48074. `ItemListSection` is a template-page component and does not render at `/`. **Use the number the test prints.** Append a dated paragraph to that file's running delta ledger in the house style — every per-file delta with its from/to string, and their sum matching the whole-page delta exactly. If the sum does not match, stop: something else moved and you have not found it yet.

- [ ] **Step 7: `npx playwright test e2e/section-washes.spec.ts`.** All eight rows must now pass. Paste the printed table into the spec under `// AFTER (measured <date>, 390x844, chromium):`, beneath the BEFORE block. Both blocks stay in the file permanently — that is the record the spec asks for.

- [ ] **Step 8: `npx tsc -b --noEmit` and the full `npm test -- --run`**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| revert `VisitUs.tsx:9` | `homepage-bytes` **and** `section-washes` on the `visit` row |
| revert `OurStory.tsx:63`'s token but keep its `relative` | `section-washes` on the `our story` row **only** — that token swap is byte-neutral, so `homepage-bytes` stays green. That asymmetry is exactly why both checks exist; neither covers the other |
| remove `relative` from `Experiences.tsx` | `section-washes` on the `experiences` row (drop overshoots 20) **and** `homepage-bytes` (−9) |
| `wash` → a 20%-strength value (roughly today's depth) | `section-washes` on every cool-token band (mean drop 7.9) |
| `wash` → the brand colour at full strength | `section-washes` (mean drop 39) **and** Task 35's palette assertions |
| point `Awards.tsx:44` at the wash token | `section-washes` on the `awards` row **and** `homepage-bytes` |
| delete `wash` from `tailwind.config.js` while leaving the class in the components | `section-washes` — the utility has no rule, the sections render white, every wash row fails the floor. `homepage-bytes` stays green (the class string is still in the HTML), which is the point of having the browser check at all |

**If this is wrong:** a VISITOR sees a homepage that is either unchanged (bands still invisible — the whole point missed), or noticeably blue and beige rather than washed, or one where two adjacent bands are the same shade so a boundary that should exist does not.

---

## Task 35: Hold the new tokens to the palette's own floors

**Files:**
- Modify: `src/test/palette.test.ts`

**Interfaces:** consumes `wash` and `wash-warm` read through this file's existing pattern of importing the real config rather than re-typing hexes (`palette.test.ts:15`).

- [ ] **Step 1: Read `palette.test.ts:1-40` and pull the two tokens out of the imported config in whatever destructuring style the file already uses.** Do not introduce a second style.

- [ ] **Step 2: The helper, beside the existing ones**

```ts
// The token's own distance from white, in the same units
// e2e/section-washes.spec.ts measures the rendered band in. This is the
// arithmetic claim; the pixel claim lives in e2e/ and neither substitutes
// for the other -- src/index.css paints a fixed overlay this function cannot
// see, and only the browser knows whether the section paints above it.
function meanPointsBelowWhite(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 255 - (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
}
```

- [ ] **Step 3: The describe**

```ts
describe('the section washes are washes, and readable', () => {
  it.each([['wash', WASH], ['wash-warm', WASH_WARM]])(
    '%s sits 15 to 20 points below white, which is where a band reads as a band', (_n, hex) => {
      expect(meanPointsBelowWhite(hex)).toBeGreaterThanOrEqual(15);
      expect(meanPointsBelowWhite(hex)).toBeLessThanOrEqual(20);
    });
  it.each([['wash', WASH], ['wash-warm', WASH_WARM]])('%s carries ink at AA', (_n, hex) => {
    expect(contrastRatio(hex, INK)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([['wash', WASH], ['wash-warm', WASH_WARM]])(
    '%s carries the accent at AA, because that is the only foreground colour this palette allows on a light surface',
    (_n, hex) => { expect(contrastRatio(hex, ACCENT)).toBeGreaterThanOrEqual(4.5); });
  it.each([['wash', WASH], ['wash-warm', WASH_WARM]])(
    '%s is a surface, not a colour: white text on it is still unreadable and always will be',
    (_n, hex) => { expect(contrastRatio(hex, WHITE)).toBeLessThan(1.5); });
  it('the two washes are distinguishable from white and from each other', () => {
    // Equal-to-white would pass the AA assertions above and defeat the whole
    // task; equal-to-each-other would pass them too and remove the boundary
    // between the last two bands on the homepage.
    expect(contrastRatio(WASH, WHITE)).toBeGreaterThan(1.1);
    expect(contrastRatio(WASH_WARM, WHITE)).toBeGreaterThan(1.1);
    expect(WASH).not.toBe(WASH_WARM);
  });
});
```
Computed with this repo's own `src/test/contrast.ts`: `#E6EDF5` — ink 13.48, accent 5.11, white 1.180, mean drop 17.67, shallowest channel 10. `#F5EEE4` — ink 13.81, accent 5.23, white 1.152, mean drop 18.00, shallowest 10.

- [ ] **Step 4: `npm test -- --run src/test/palette.test.ts`**

- [ ] **Step 5: `npx playwright test e2e/brand-contrast.spec.ts` with nothing else on port 8080.** Every homepage text node now sitting on a wash is measured live at 4.5:1. The section-level foregrounds on the changed bands measure, on the cool wash: `Drinks.tsx:27`, `Experiences.tsx:38`, `BlogSection.tsx:45`, `OurStory.tsx:71` at **8.74:1**, and `BlogSection.tsx:54` at **6.40:1**. The palest mid grey measures **4.10:1** on the cool wash and **4.20:1** on the warm one — under the floor — and nothing on the homepage pairs them today (`Awards.tsx:73` and `PostCard.tsx:38` are both inside white cards). That constraint is written into `tailwind.config.js` beside the tokens by Task 34 Step 4.

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| `wash: '#FFFFFF'` | "sits 15 to 20 points below white…" and "distinguishable from white and from each other" |
| `wash: '#334455'` | "carries ink at AA" and the 15–20 case |
| `'wash-warm'` identical to `wash` | "distinguishable from white and from each other" |
| change `BlogSection.tsx:45` to the palest mid grey | `e2e/brand-contrast.spec.ts` — 4.10:1 on the cool wash, under the fixed 4.5 threshold, lands in `unreadable`. **Prove this one by running it**: if it does not redden, the element is being excluded by `sitsOverImageLayer` or a visibility gate and the sweep is not covering what you think it covers |
| delete the white-text case | nothing — that is a deletion, not a mutation. To prove the case can fail, set `wash` to a mid slate and watch it redden alongside the ink case. Record that you did |

**If this is wrong:** a VISITOR reads grey body text on a wash at under 4.5:1 — legible on a laptop indoors, not on a phone outdoors, which is the exact population this whole change is for.

---

## Task 36: Re-measure the entry CSS ceiling and raise it (third raise)

**Files:**
- Modify: `src/test/bundle.post-build.test.ts`

**Interfaces:** consumes every CSS-affecting change from Task 30 (`flex-wrap`, `gap-4`, `mb-8`, `max-w-2xl`, `w-full`, the search input's chrome — all reused from existing sites, expected net near zero) and Task 34 (two new background utilities added; the hard-coded near-white utility removed if `ItemListSection` was its last user; the slate and cream-alt utilities **not** removed, because `NewsPress.tsx:15`, `BlogTeaser.tsx:15`, `NotFound.tsx:8` and `ErrorBoundary.tsx:26` still use them and Tailwind scans dead components the same as live ones).

- [ ] **Step 1: Read `bundle.post-build.test.ts:319-720` in full before touching anything.** Two facts from its own lineage govern this task: the assertion **skipped silently for an entire phase** because no gate ran the production build (`:702-713`), and the test **name string has drifted from the assertion once before** (`:511-514`). Both change together.

- [ ] **Step 2: Establish the parent baseline — a worktree checkout of the true parent commit, never a stash**
```
git worktree add /tmp/vb-parent $(git rev-parse HEAD~1)
cd /tmp/vb-parent && npm ci && npm run build
```
The "before" number is whatever Task 27 measured, not 38593 — that figure is a Phase 5A ledger entry, and Tasks 12 and 27 have both raised the ceiling since.

- [ ] **Step 3: Build the branch: `npm run build`.** That runs `npm run images && tsc -b && vite build && npm run test:bundle`, and `test:bundle` sets `VB_REQUIRE_DIST=1`, the only way the ceiling assertion runs at all.

- [ ] **Step 4: Take the two byte counts:** `stat -f%z /tmp/vb-parent/dist/assets/index-*.css` and `stat -f%z dist/assets/index-*.css`.

- [ ] **Step 5: Take the rule-level diff** — the byte delta alone cannot tell an intended new utility from a comment that leaked one:
```
grep -o '^[^{]*{' /tmp/vb-parent/dist/assets/index-*.css | sort -u > /tmp/parent-rules.txt
grep -o '^[^{]*{' dist/assets/index-*.css | sort -u > /tmp/branch-rules.txt
diff /tmp/parent-rules.txt /tmp/branch-rules.txt
```
(`postcss-cli` is not installed; do not reach for `npx postcss`.) Every added selector must be one you meant to add. If a selector appears that no `className` in the diff contains, a comment leaked it — this repo has shipped rules out of comments at least three times (`:340-350`, `:404-420`, `:626-639`). Find the comment and reword it; do not raise the ceiling to accommodate it.

- [ ] **Step 6: Set the new ceiling to `measured + 150`, rounded up to the next 50.** 150 bytes is roughly two Tailwind utility rules — enough that the next unrelated task does not have to re-measure, small enough that a real regression still trips it. Write the measured number, the parent number, the delta and the rule-level diff into the file's comment lineage, dated.

- [ ] **Step 7: Edit both the assertion and the test name at `:715-720`.** Never delete the check. Never widen it to a range. Never remove the `skipIf` — it is what lets `npm test` pass without a dist directory, and the fix for its historical silence was `npm run gate` gaining `npm run build`, not removing the guard.

- [ ] **Step 8: Confirm `:263`'s `ADMIN_MARKERS['manage/areas.ts']` is untouched** — nothing in this section rewords an area description: `grep -n "Dishes, drinks and the PDF menus" src/admin/manage/areas.ts`.

- [ ] **Step 9: `git worktree remove /tmp/vb-parent`, then the whole gate: `npm run gate`.**

**Mutation table**

| Mutation | Test that must redden |
|---|---|
| set the new ceiling to the pre-change measured size | the ceiling test, under `npm run test:bundle` |
| add an unused utility class in `BlogIndex.tsx` and set the ceiling to `measured + 1` | same test |
| run `npm test -- --run src/test/bundle.post-build.test.ts` with no `dist/` present | the test **skips**, and does not fail. That is correct, and this row documents it: a skip and a pass print differently and mean different things, and this project already lost a whole phase to reading one as the other |
| change the assertion number without changing the test name string | **Nothing.** PREDICTED WEAK and known (`:511-514` records it happening). There is no honest assertion to add without a self-referential source scan; the mitigation is Step 7 and the reviewer grepping for the old number |

**If this is wrong:** a ceiling below the measured size fails every future build for a reason unrelated to the change being made; a ceiling far above it stops catching the leaked-rule bug that has bitten this repo three times. The OWNER's `/edit` surface pays: it is the largest CSS consumer and the ceiling is the only thing bounding it.

---

# Section D — Phase 6: the Drive photographs, end to end

The terminal section. It ends with photographs from the Drive shoot rendering on the live site at `https://viabiancarestaurant.com`, not with an import that "works locally". It lands last deliberately: the photographs go onto a dashboard that can already display them as rows with thumbnails, and onto a writing surface that can already place them.

**Phase 6's relationship to the CSS ceiling:** this section changes *data*, not markup, and introduces **zero new Tailwind classes**. The entry CSS must come back byte-identical to the number Task 36 left. If it moves by a single byte, that is a defect here — a prose comment leaking a utility token, most likely — and it is fixed, not accommodated. Task 46 asserts it.

**The storage decision is D9.** One clarification of the argument, because two consequences that have been claimed for it are not real: committing a derivative into `public/` would be erased by `prune()` on the next `npm run images`, and that is the whole argument. It would **not** break `src/test/gitignore.test.ts` (which only asserts `git check-ignore` results on synthetic probe paths) and it would **not** break `src/shared/__tests__/derivative-path.test.ts` (whose `realSources()` walks `assets-source` only).

**The enumeration facts, verified while writing this plan** (ran against the live Drive on 2026-08-18):

- `owner = 'arpit@socialtab.in' and mimeType contains 'image/'` returns **47 files** in one page with no continuation token: **24** `NB0_75xx–77xx.JPG` (2025-06-09 shoot, 0.9–11.1MB each), **12** `A74018xx/A74019xx.JPG` (2025-05-14, 6.4–7.2MB each), and **11** `.ARW` Sony raws (30–68MB each).
- Nine ARW frames — `A7401792, 1825, 1835, 1840, 1842, 1846, 1849, 1855, 1927` — have **no JPEG sibling**. `.arw` is not in `IMAGE_EXT` (`scripts/paths.mjs:47`) and sharp cannot decode Sony raw, so they can never be committed as sources.
- `owner = 'cykhdesigns@gmail.com'` **paginates** (5 rows plus a continuation token on the first call even with `pageSize: 100` — page size is not reliably honoured; always loop until the token is absent). It owns folders, fonts, `.ai` files, a brand deck PDF, and two raster images: `Logo-01.jpg` (1.2MB) and `Logo-02.jpg` (1.7MB).
- **The download mechanism:** `https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w2000` returns an unauthenticated, full-frame, correctly-oriented JPEG. Measured: `NB0_7719` (10.4MB original) → 200, 343,597 bytes, 2000×3006. `A7401927.ARW` (30.4MB raw) → 200, 227,806 bytes, 2000×2996 — **Drive renders raw previews, so all 47 frames are reachable, including the nine raw-only ones.** The MCP `download_file_content` tool returns base64 into the conversation (one 10MB frame is roughly 3.3M tokens) and is forbidden below except as a last-resort fallback for a file under 2MB.

**The two hard boundaries, as mechanical checks:**

1. **The hero collage is never touched.** `heroCollage`, `assets-source/hero/`, `public/hero/` and the brick image are out of scope. Task 43 asserts the `heroCollage` subtree is unchanged; Task 47 re-checks the committed photo count of 11 that `no-missing-react-keys.test.tsx:115` pins.
2. **Only sections that carry images are in scope:** `dishes.json`, `drinks.json`, `galleries.json`'s `atmosphere` and `ourStory` lists, `experiences.json`, `press.json` — plus any new dish or drink the photographs reveal. Explicitly out: `story.json`'s chef portrait, awards, `menus.json`, `pages.json`, `sections.json`, `copy.json`, hours, `posts.json`.

---

## Task 37: Enumerate every Drive image by owner, into a manifest

**Files:**
- Create: `/Users/taran/Desktop/vb-phase6/drive-manifest.json` (staging root, deliberately **outside** the repo)

**Interfaces:** produces
```ts
type DriveManifest = {
  sweptAt: string;                    // ISO date the sweep ran
  queries: string[];                  // the exact query strings used, so a reviewer can re-run them
  files: Array<{
    id: string;
    title: string;
    mimeType: string;
    fileSize: number | null;          // as reported by Drive, null if the tool does not return it
    owner: 'arpit@socialtab.in' | 'cykhdesigns@gmail.com';
    modifiedTime: string | null;
  }>;
};
```

- [ ] **Step 1: `mkdir -p /Users/taran/Desktop/vb-phase6/frames /Users/taran/Desktop/vb-phase6/small`**

- [ ] **Step 2: Sweep `arpit@socialtab.in`'s images, paginating properly**

Call `mcp__claude_ai_Google_Drive__search_files` with `query: "owner = 'arpit@socialtab.in' and mimeType contains 'image/'"`, `pageSize: 100`, `excludeContentSnippets: true`. **The response cursor is `next_page_token`** — that is the field the tool documents; do not loop on a camel-cased guess. Repeat, passing it as `pageToken`, until a response carries no token. Do not stop after one call because the first sweep happened to return everything: that is exactly the mistake ("listing by folder returns nothing") this phase exists to correct.

On the first response, **confirm which fields actually come back**. `owner`, `fileSize` and `modifiedTime` are used by every task below but are not documented response fields on this tool; if any is absent, record it as `null` and note in the manifest which of the four query strings produced the row.

- [ ] **Step 3: Repeat for `owner = 'cykhdesigns@gmail.com' and mimeType contains 'image/'`.**

- [ ] **Step 4: Repeat twice more with the `mimeType` clause removed**, paginating the same way. Any row whose `title` ends in a raster extension (`.jpg .jpeg .png .heic .tif .tiff .webp .arw .dng .cr2 .nef`) but which did not appear in Steps 2–3 is a file Drive typed as something other than an image; add it. This is the second half of the "the blocker was the query" lesson — a mimeType filter is a query too.

- [ ] **Step 5: Write the merged, de-duplicated-by-`id` result, sorted by `title`, with all four query strings in `queries`.**

- [ ] **Step 6: The non-vacuity and shape check**
```bash
node -e '
const m = require("/Users/taran/Desktop/vb-phase6/drive-manifest.json");
const ids = new Set(m.files.map((f) => f.id));
if (m.files.length < 40) throw new Error(`manifest has only ${m.files.length} files -- the sweep did not paginate`);
if (ids.size !== m.files.length) throw new Error("duplicate ids in manifest");
if (!Array.isArray(m.queries) || m.queries.length !== 4) throw new Error("the four sweep queries are not recorded");
for (const o of ["arpit@socialtab.in", "cykhdesigns@gmail.com"]) {
  if (!m.files.some((f) => f.owner === o)) throw new Error(`no files found for ${o}`);
}
// The arpit image sweep returns all 47 rows in one page, so a
// pagination bug does not shorten it. The cykhdesigns sweep DOES paginate
// (5 rows plus a token, verified), and its two raster images are on a later
// page -- this is the assertion that catches a dropped loop.
const logos = m.files.filter((f) => f.owner === "cykhdesigns@gmail.com" && /\.(jpe?g|png)$/i.test(f.title));
if (logos.length < 2) throw new Error("the second sweep was truncated to folders");
const raw = m.files.filter((f) => /\.(arw|dng|cr2|nef)$/i.test(f.title));
console.log(`${m.files.length} files, ${raw.length} camera raw, ${m.files.length - raw.length} rasterised`);
'
```

**If this task is wrong:** nobody sees anything — no visitor-facing or owner-facing symptom. The damage is silent and downstream: a short manifest means photographs that exist are never looked at, and the phase ends declaring itself complete having imported a subset.

**Browser-only claims:** none.

| Mutation | Test that must redden |
|---|---|
| stop the pagination loop after the first call | Step 6's `logos.length < 2` check. (The `files.length < 40` check alone would **not** catch it: the arpit image sweep returns everything in one page.) |
| drop Step 4's unfiltered sweeps | Nothing reddens — this is a coverage widening, not an invariant. **PREDICTED WEAK, and stated as such**: there is no way to prove a file you never asked for is missing. The compensation is the `queries` field, so a reviewer can re-run the exact four queries |
| point one query at a third, nonexistent owner | the `owners` check throws |

---

## Task 38: Fetch a full-frame preview of every enumerated image

**Files:**
- Create: `/Users/taran/Desktop/vb-phase6/fetch-frames.mjs` (staging only, **not committed** — it depends on a Drive URL shape that is not this project's contract and has no lasting review value; the encode recipe, which does, is committed in Task 41)
- Create: `/Users/taran/Desktop/vb-phase6/frames/<driveId>.jpg`, `/Users/taran/Desktop/vb-phase6/fetch-report.json`

**Interfaces:** consumes `drive-manifest.json`. Produces `{ ok: [{ id, title, bytes, width, height }], failed: [{ id, title, status, contentType }] }` plus one JPEG per `ok` row.

- [ ] **Step 1: `fetch-frames.mjs`**

Note the sharp import: Node resolves a bare ESM specifier by walking up from the **importing module's URL**, not from cwd, and `/Users/taran/Desktop/vb` is not an ancestor of the staging directory. An absolute specifier is the fix; changing cwd is not. (`.mjs` is already a module, so no `--experimental-default-type` flag either.)

```js
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from '/Users/taran/Desktop/vb/node_modules/sharp/lib/index.js';

const STAGING = '/Users/taran/Desktop/vb-phase6';
const manifest = JSON.parse(readFileSync(join(STAGING, 'drive-manifest.json'), 'utf8'));

// Drive's own renderer. Chosen over the MCP download tool because that tool
// returns base64 into the conversation: one 10MB frame is roughly 3.3M
// tokens, and there are 36 rasterised frames. This endpoint also renders the
// nine Sony raw frames that have no JPEG sibling in Drive at all. w2000 is
// twice DEFAULT_MAX_WIDTH (scripts/paths.mjs), so the committed source is
// never upscaled and the final 1000px encode never starves.
const url = (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;

await mkdir(join(STAGING, 'frames'), { recursive: true });
const ok = [];
const failed = [];

for (const file of manifest.files) {
  const res = await fetch(url(file.id), { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) {
    failed.push({ id: file.id, title: file.title, status: res.status, contentType: type });
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const out = join(STAGING, 'frames', `${file.id}.jpg`);
  await writeFile(out, bytes);
  const { width, height } = await sharp(out).metadata();
  ok.push({ id: file.id, title: file.title, bytes: bytes.length, width, height });
  console.log(`${file.title} -> ${width}x${height}, ${(bytes.length / 1024).toFixed(0)}KB`);
}

await writeFile(join(STAGING, 'fetch-report.json'), JSON.stringify({ ok, failed }, null, 2));
console.log(`\n${ok.length} fetched, ${failed.length} failed`);
```

- [ ] **Step 2: `node /Users/taran/Desktop/vb-phase6/fetch-frames.mjs`**

- [ ] **Step 3: Assert the fetch is complete, every frame is big enough to identify a dish from, and every file the report claims is actually on disk**
```bash
node -e '
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const S = "/Users/taran/Desktop/vb-phase6";
const r = require(join(S, "fetch-report.json"));
const m = require(join(S, "drive-manifest.json"));
if (r.ok.length + r.failed.length !== m.files.length) throw new Error("report does not cover the manifest");
for (const f of r.ok) if (!existsSync(join(S, "frames", f.id + ".jpg"))) throw new Error("missing frame " + f.title);
const small = r.ok.filter((f) => f.width < 1200);
if (small.length) throw new Error(`too small to identify: ${small.map((f) => `${f.title}@${f.width}px`).join(", ")}`);
if (r.failed.length) console.error("FAILED:", r.failed);
console.log(`${r.ok.length} frames fetched, min width ${Math.min(...r.ok.map((f) => f.width))}px`);
'
```

- [ ] **Step 4: Handle `failed` rows.** Expected: zero, but the endpoint depends on the file being link-shared. If `fileSize < 2_000_000`, fall back to `mcp__claude_ai_Google_Drive__download_file_content` for that one file. If `fileSize >= 2_000_000` (or is unknown), **do not** call that tool — stop and ask the owner to set link-sharing, naming the file by title. Record the decision in `fetch-report.json`.

- [ ] **Step 5: Confirm nothing was written into the repository:** `git status --porcelain` prints nothing.

**If this task is wrong:** still no visitor or owner symptom. A silently-failed fetch means a frame is never judged, which surfaces as a photograph the owner remembers taking that never appears on the site — and she cannot tell whether it was judged and rejected or never downloaded. `fetch-report.json` is what makes those two distinguishable.

| Mutation | Test that must redden |
|---|---|
| `sz=w2000` → `sz=w200` | Step 3 throws `too small to identify: …@200px` |
| delete a file from `frames/` after the run | Step 3's `existsSync` loop |
| drop the `type.startsWith('image/')` guard | a file that is not link-shared returns an HTML sign-in page as a 200 and `sharp().metadata()` throws. **PREDICTED WEAK against today's Drive** — every file tested was shared. To make it falsifiable, add a deliberately corrupt id to the manifest once and confirm it lands in `failed` rather than `ok` |

---

## Task 39: Look at every frame and record what it depicts

This is the substance of the phase, not a preliminary to it. `NB0_7576.JPG` says nothing.

**Files:**
- Create: `/Users/taran/Desktop/vb-phase6/small/<driveId>.jpg` (900px reading copies), `/Users/taran/Desktop/vb-phase6/judgements.json`

**Interfaces:** produces
```ts
type Judgement = {
  driveId: string;
  title: string;
  subject: string;                     // what is actually in the frame, in plain words
  kind: 'dish' | 'drink' | 'room' | 'process' | 'people' | 'logo' | 'other';
  confidence: 'certain' | 'likely' | 'unsure';
  matchesContentId: string | null;     // only ever set when confidence === 'certain'
  notes: string;                       // the visual detail that settled it, or what makes it ambiguous
};
```

- [ ] **Step 1: 900px reading copies, so the vision pass costs a predictable amount of context**
```bash
cd /Users/taran/Desktop/vb-phase6 && node -e '
const sharp = require("/Users/taran/Desktop/vb/node_modules/sharp");
const { readdirSync } = require("node:fs");
(async () => {
  for (const f of readdirSync("frames")) {
    await sharp(`frames/${f}`).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(`small/${f}`);
  }
  console.log(`${readdirSync("small").length} reading copies`);
})();
'
```

- [ ] **Step 2: Print the vocabulary being matched against**, so judgement happens against the real content and not from memory:
```bash
cd /Users/taran/Desktop/vb && node -e '
const d = require("./src/content/dishes.json"), k = require("./src/content/drinks.json");
console.log("DISHES:"); for (const x of d) console.log(` ${x.id} | ${x.name} | ${x.description}`);
console.log("DRINKS (no photo):"); for (const x of k) if (x.image === null) console.log(` ${x.id} | ${x.category} | ${x.name} | ${x.description}`);
'
```

- [ ] **Step 3: Read every file in `small/` with the `Read` tool, in batches of six**, writing one judgement each. The rules, applied without exception:
   - `subject` describes the frame, not the guess: "a long pasta in a red sauce with chilli flakes, shot from above on a dark plate", not the dish's name.
   - `matchesContentId` is set **only** when the frame's subject and a content record's `name` + `description` agree on the identifying detail — the pasta shape, the garnish, the glassware. "Italian food on a plate" is never a match.
   - `confidence: 'unsure'` is the correct and expected answer for a large share of the shoot. There is no cost to `unsure` and no reward for reducing the count.
   - Wine bottles: `kind: 'drink'`, and a match requires the **label to be readable**, because `drinks.json` carries 20 wines that differ only by label.
   - `Logo-01.jpg` / `Logo-02.jpg`: `kind: 'logo'`, `matchesContentId: null`. No section of this site carries a logo image; they are enumerated and recorded, and not imported.

- [ ] **Step 4: Check the discipline held**
```bash
node -e '
const j = require("/Users/taran/Desktop/vb-phase6/judgements.json").judgements;
const r = require("/Users/taran/Desktop/vb-phase6/fetch-report.json");
if (j.length !== r.ok.length) throw new Error(`judged ${j.length} of ${r.ok.length} frames`);
const bad = j.filter((x) => x.matchesContentId !== null && x.confidence !== "certain");
if (bad.length) throw new Error(`guessed: ${bad.map((x) => x.title).join(", ")}`);
const blank = j.filter((x) => !x.subject || x.subject.trim().length < 15);
if (blank.length) throw new Error(`no real description for ${blank.map((x) => x.title).join(", ")}`);
const noNotes = j.filter((x) => x.confidence === "certain" && (!x.notes || x.notes.trim().length < 10));
if (noNotes.length) throw new Error(`certain with nothing that settled it: ${noNotes.map((x) => x.title).join(", ")}`);
console.log(j.reduce((a, x) => ({ ...a, [x.confidence]: (a[x.confidence] ?? 0) + 1 }), {}));
'
```

**If this task is wrong:** this is the one task whose failure the **visitor** sees directly and the **owner** sees as a betrayal of her menu. A frame judged `certain` that is a different dish puts somebody else's pasta above the name of hers, permanently, for every diner. Nothing downstream can catch it — every guard below checks that a path resolves, not that the food is the right food.

| Mutation | Test that must redden |
|---|---|
| set `matchesContentId` on a `likely` row | Step 4 throws `guessed: …` |
| omit one frame from `judgements.json` | Step 4 throws `judged N-1 of N frames` |
| replace one `subject` with `"food"` | Step 4's 15-character floor |
| mark a row `certain` with an empty `notes` | Step 4's `certain with nothing that settled it` |
| judge from filenames without reading the images | **Nothing reddens.** Stated plainly: no automated check can distinguish a judgement made by looking from one made by guessing. This is the phase's irreducible manual step and its irreducible risk. The mitigation is procedural: every `certain` row's `notes` names the visual detail that settled it, and a reviewer can re-open `small/<id>.jpg` and check the detail is there |

---

## Task 40: Reconcile the judgements and produce the attachment plan

**Files:**
- Create: `/Users/taran/Desktop/vb-phase6/attachments.json`

**Interfaces:** produces the single input to every task that writes to the repo.
```ts
type Attachment = {
  driveId: string;
  category: 'food' | 'mocktails' | 'atmosphere' | 'our_story' | 'experiences' | 'press';
  slug: string;                        // /^[a-z0-9-]+$/ -- becomes assets-source/<category>/<slug>.webp
  target:
    | { file: 'dishes.json'; id: string }
    | { file: 'drinks.json'; id: string }
    | { file: 'galleries.json'; list: 'atmosphere' | 'ourStory'; alt: string }
    | { file: 'experiences.json'; id: string }
    | { file: 'press.json'; id: string };
  supersedes: string | null;           // the assets-source/ path this replaces, or null
};
// A new record carries the SAME three encoding fields an Attachment does.
// Without them its photograph is never encoded, its image path resolves to
// nothing, and assets.test.ts fails on a record this plan itself wrote.
type NewRecord = {
  driveId: string;
  category: 'food' | 'mocktails';
  slug: string;
  record:
    | { file: 'dishes.json'; id: string; name: string; description: string; image: string; tags: string[] }
    | { file: 'drinks.json'; id: string; name: string; description: string; category: 'mocktail' | 'cocktail' | 'wine'; image: string };
};
type AttachmentPlan = {
  attach: Attachment[];
  newRecords: NewRecord[];
  unattached: Array<{ driveId: string; title: string; why: string }>;
};
```

- [ ] **Step 1: One `Attachment` per judgement with `confidence === 'certain'` and `matchesContentId !== null`.** Category is fixed by the record type and matches `src/admin/fields.ts`: dish → `food`, drink → `mocktails`, experience → `experiences`, press article → `press`, atmosphere gallery → `atmosphere`, ourStory gallery → `our_story`.

- [ ] **Step 2: Slugs are `<content-item-id>-<drive-stem-lowercased-and-kebabed>`**, e.g. `tiramisu-nb0-7576`. Two load-bearing reasons: it can never collide with an existing source (a collision makes `findCollisions`, `scripts/paths.mjs:120-131`, abort `npm run images` entirely, writing **nothing** and exiting 1), and it traces every committed byte back to a Drive file id. Enforce `/^[a-z0-9-]+$/` — no spaces, no apostrophes, no capitals; a path with an apostrophe could never have been committed through the Worker's own `ASSET_PATH` allowlist (`worker/github.ts:85`).

- [ ] **Step 3: `supersedes`, and the check that stops it deleting a source three other records still use**

Set `supersedes` to the existing `assets-source/` path the record currently resolves to, where one exists. The current mismatches are the obvious candidates and are exactly what this phase is for: `suppli` → `/food/arrosticini.webp`, `risotto-ai-gamberi` → `/food/tielle.webp`, `cappelletti-pollo-tartufo-pecorino` → `/food/pollo alla cacciatora.webp`, `gamberi-pistacchio` → `/food/idk1.webp`, `bruschetta-ricotta-miele-piccante` → `/food/idk2.webp`.

**Image paths are shared across content files, and deleting a source deletes its derivative for every record that names it.** `/food/tielle.webp` is also `press.json`'s `travel-leisure-india-puglia-to-delhi.image`; `/food/tiramisu.webp` is a dish, an experience and a press row; `/food/margarita.webp` is a dish and two press rows; `/atmosphere/dining.webp`, `/atmosphere/ambience.webp` and `/atmosphere/table.webp` are gallery entries, heroCollage photos and experiences. So, for every candidate:

```bash
cd /Users/taran/Desktop/vb && grep -rn "<the derivative path this source maps to>" src/content/*.json
```
If any record other than the one being repointed still names it, **`supersedes` must be `null`** — the new photograph is added alongside and the old source stays. Two extra sources are a bytes problem; a deleted source under a live reference is a broken image on the public site.

**`assets-source/atmosphere/dining.jpg` is out of scope for `supersedes` entirely.** It is `OG_SOURCE` (`scripts/paths.mjs:87`), and an OG failure lands in `failures` rather than `skipped` (`images.mjs:149-158`) and sets `process.exitCode = 1` (`:212-216`) — `npm run images` fails, and it is the first command in the Cloudflare build.

- [ ] **Step 4: One `NewRecord` per judgement with `confidence === 'certain'`, `matchesContentId === null`, and `kind` of `dish` or `drink`** — a photograph of something real the content does not yet name. Give it its `driveId`, `category` and `slug` as well as the record, so Task 41 encodes it. The name must survive `validate.ts:207-208`'s placeholder-name pattern and its filename pattern, and the description must survive `dishes.test.ts:9`'s meta-language pattern. Those rules interlock with the confidence gate on purpose: if the only honest description is "probably a seafood pasta", the record cannot be written, which is the correct outcome.

- [ ] **Step 5: Everything else goes in `unattached` with a `why`.** Unattached frames are **not** imported — the repository is the storage, so a photograph nobody can name earns no bytes.

- [ ] **Step 6: Press articles default to untouched.** An attachment there is legitimate only when the frame depicts the article's stated subject; "an Italian dish" does not match an article about regional Italian cuisine in India.

- [ ] **Step 7: Check the plan for the four ways it can be internally wrong**
```bash
node -e '
const p = require("/Users/taran/Desktop/vb-phase6/attachments.json");
const seenDrive = new Set(), seenSlug = new Set(), seenTarget = new Set();
for (const a of [...p.attach, ...p.newRecords]) {
  if (!/^[a-z0-9-]+$/.test(a.slug)) throw new Error(`bad slug: ${a.slug}`);
  if (seenDrive.has(a.driveId)) throw new Error(`one frame used twice: ${a.driveId}`);
  if (seenSlug.has(`${a.category}/${a.slug}`)) throw new Error(`slug collision: ${a.slug}`);
  seenDrive.add(a.driveId); seenSlug.add(`${a.category}/${a.slug}`);
}
for (const a of p.attach) {
  const key = JSON.stringify(a.target);
  if (seenTarget.has(key)) throw new Error(`two photos on one item: ${key}`);
  seenTarget.add(key);
}
const j = require("/Users/taran/Desktop/vb-phase6/judgements.json").judgements;
const total = p.attach.length + p.newRecords.length + p.unattached.length;
if (total !== j.length) throw new Error(`plan covers ${total} of ${j.length} judged frames`);
console.log(`${p.attach.length} attach, ${p.newRecords.length} new records, ${p.unattached.length} unattached`);
'
```

- [ ] **Step 8: Read the plan against `drinks.json` once more.** `src/components/__tests__/Drinks.test.tsx:45` asserts `expect(unphotographed.length).toBeGreaterThan(0)` as a deliberate non-vacuity guard. Confirm at least one drink still has `image: null`. With 20 wines in the list this cannot realistically fail, but the plan must not assume it.

**If this task is wrong:** the **owner** opens `/edit`, sees the Dishes list, and finds two rows carrying the same thumbnail, or a dish she never put on the menu. The **visitor** sees a duplicate photograph in the food carousel.

| Mutation | Test that must redden |
|---|---|
| point two attachments at the same dish id | Step 7 `two photos on one item` |
| give a slug a space or an apostrophe | Step 7 `bad slug` |
| drop one judged frame from all three lists | Step 7 `plan covers N-1 of N` |
| give a `newRecords` row no slug/category | Step 7's slug regex throws on `undefined` — and it is why those fields are on the type |
| set `supersedes` on a source another record still references | the grep in Step 3; if skipped, `assets.test.ts` after Task 42 |
| set a new dish's description to "probably a seafood pasta" | `npx vitest run src/content/__tests__/dishes.test.ts` — **after Task 43 writes it**, not here. Stated so nobody waits for a red that arrives one task later |

---

## Task 41: Encode accepted frames into repo-sized WebP sources

**Files:**
- Create: `scripts/drive-import.mjs`

**Interfaces:** consumes `attachments.json` and `frames/<driveId>.jpg`. Produces `assets-source/<category>/<slug>.webp` for every `attach` **and every `newRecords`** row, plus the exported recipe `SOURCE_MAX_WIDTH: 1600`, `SOURCE_QUALITY: 90`, `encodeSource`, `sourcePathFor`.

- [ ] **Step 1: `scripts/drive-import.mjs`**

```js
// The one-off importer for the 2025 photo shoot. Committed rather than run
// out of a shell history, for the same reason scripts/strip-farfalle.mjs
// was: the recipe that produced every byte under assets-source/ from this
// import has to be reviewable, and a corrected judgement has to be able to
// re-run it and get identical output.
//
// It never writes into public/. scripts/images.mjs owns that directory and
// prunes anything there without a source; this script only writes the
// repo-sized SOURCE that images.mjs then encodes down to 1000px.
//
// 1600 / quality 90 was measured against a real frame from this shoot:
// 168KB in, 47KB out of the 1000px q78 pass. The originals are 6-70MB and
// stay in Drive; R2 is billing-gated, so the repository is the storage and
// the size of what lands here is the whole point.
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const STAGING = '/Users/taran/Desktop/vb-phase6';
export const SOURCE_MAX_WIDTH = 1600;
export const SOURCE_QUALITY = 90;

export function encodeSource(fetchedPath) {
  return sharp(fetchedPath)
    .rotate()
    .resize({ width: SOURCE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: SOURCE_QUALITY });
}

export function sourcePathFor({ category, slug }) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`slug must be lowercase kebab: ${slug}`);
  return join('assets-source', category, `${slug}.webp`);
}

if (import.meta.filename === process.argv[1]) {
  const plan = JSON.parse(await readFile(join(STAGING, 'attachments.json'), 'utf8'));
  // BOTH lists. A newRecords row names an image path in a content file the
  // same way an attachment does, and a path with no source is a broken
  // image the moment images.mjs prunes.
  const entries = [...plan.attach, ...plan.newRecords];
  let total = 0;
  for (const entry of entries) {
    const out = sourcePathFor(entry);
    await mkdir(dirname(out), { recursive: true });
    await encodeSource(join(STAGING, 'frames', `${entry.driveId}.jpg`)).toFile(out);
    const { size } = await stat(out);
    total += size;
    console.log(`${entry.driveId} -> ${out} (${(size / 1024).toFixed(0)}KB)`);
  }
  console.log(`\n${entries.length} sources, ${(total / 1024 / 1024).toFixed(2)}MB added to the repository`);
}
```

- [ ] **Step 2: `cd /Users/taran/Desktop/vb && node scripts/drive-import.mjs`**

- [ ] **Step 3: Record the largest source it wrote — Task 44 needs this exact number:**
```
find assets-source -name '*.webp' -exec ls -l {} \; | awk '{print $5}' | sort -rn | head -1
```

- [ ] **Step 4: `npx eslint scripts/drive-import.mjs`** — it must lint clean, because `npm run gate` runs `npx eslint .`.

- [ ] **Step 5: Confirm the script wrote nothing tracked outside `assets-source/`:** `git status --porcelain | grep -v '^?? assets-source/\|^A  assets-source/'`. (Checking `public/` alone would be vacuous — `/public/*/` is gitignored, so `git status --porcelain public/` prints nothing whatever the script did.)

**If this task is wrong:** the **owner** sees nothing yet — no content file points at these paths until Task 43. A wrong encode surfaces later as a visibly soft photograph on the food carousel. The 1600/q90 intermediate is what keeps that from happening; dropping to q60 here would be invisible to every test in the repository and visible to every diner.

| Mutation | Test that must redden |
|---|---|
| `SOURCE_MAX_WIDTH` → 400 | the width floor added to **`scripts/__tests__/images.derivatives.test.mjs`** in Task 44 (not `photo-sources.test.ts` — Task 44 keeps sharp out of the deploy path deliberately). Order matters: Task 44 must land before this can be claimed as guarded |
| `SOURCE_QUALITY` → 40 | Nothing reddens. **PREDICTED WEAK, and honest about it**: no test here can assert perceptual quality, and a byte-floor test would fail for the wrong reason on a genuinely simple photograph. The defence is that the constant is committed, named, and commented with the measurement that chose it |
| remove the slug regex guard and pass a slug with a space and a capital | `sourcePathFor` no longer throws, and `worker/github.ts:85`'s `ASSET_PATH` would refuse that path on a future owner-side publish. Restore the guard and confirm it throws |
| `.jpeg({quality:90})` instead of `.webp(...)` | Task 44's magic-byte assertion: `expected 'ÿØÿà' to be 'RIFF'` |
| iterate `plan.attach` only | `src/content/__tests__/assets.test.ts` after Task 43 — a new record's image path resolves to nothing |

---

## Task 42: Retire superseded sources and run the derivative pipeline

**Files:**
- Delete: `assets-source/<category>/<old>` for every non-null `supersedes` value
- Regenerate: `public/<category>/*.webp` (gitignored — regenerated, never committed)

- [ ] **Step 1: Delete only what the plan says is superseded, one `git rm` per path, so the diff is reviewable**
```bash
node -e '
const p = require("/Users/taran/Desktop/vb-phase6/attachments.json");
for (const a of p.attach) if (a.supersedes) console.log(a.supersedes);
' | while read -r f; do git rm --quiet "$f"; done
```
Task 40 Step 3 has already refused a `supersedes` whose derivative another record still names, and has already put the OG source out of scope. If either check was skipped, do it now, before the `git rm`.

- [ ] **Step 2: `npm run images`**

- [ ] **Step 3: Read the output for the four things that can go wrong, in the order `scripts/images.mjs` reports them**
   - **`COLLISION:`** — two sources map to one output. `build()` returns having written **nothing at all** and the CLI exits 1 (`:97-103`, `:179-188`). This is why slugs carry the drive stem; if it happens anyway, fix the slug, do not delete the other source blindly.
   - **`FAILED …`** — a source sharp could not process that is also the OG source. Fatal: `:149-158` puts it in `failures` and `:212-216` sets a non-zero exit code. Deleting `assets-source/atmosphere/dining.jpg` produces exactly this, which is why Task 40 Step 3 puts it out of scope.
   - **`WARNING: skipped`** — sharp could not decode a non-OG source. Not fatal, correctly, but a skipped source a content file then references fails `assets.test.ts` in Task 45. Every new source must be absent from this block.
   - **`pruned stale derivative:`** — expected, once per deleted source.

- [ ] **Step 4: Confirm each new derivative exists at the right width and format**
```bash
cd /Users/taran/Desktop/vb && node -e '
const sharp = require("sharp");
const p = require("/Users/taran/Desktop/vb-phase6/attachments.json");
(async () => {
  for (const a of [...p.attach, ...p.newRecords]) {
    const out = `public/${a.category}/${a.slug}.webp`;
    const m = await sharp(out).metadata();
    if (m.format !== "webp") throw new Error(`${out} is ${m.format}`);
    if (m.width > 1000) throw new Error(`${out} is ${m.width}px, over DEFAULT_MAX_WIDTH`);
    console.log(`${out} ${m.width}x${m.height}`);
  }
})();
'
```

- [ ] **Step 5: Confirm the hero boundary held**
```bash
cd /Users/taran/Desktop/vb && git status --porcelain assets-source/hero && ls public/hero
```
`git status` prints nothing; `ls` still shows the same ten files it shows today.

**If this task is wrong:** a collision makes `npm run images` write **nothing**, which on Cloudflare means the entire `public/` image tree is absent and **every photograph on the site 404s** — not just the new ones. That is the most destructive failure mode in this section, and it is why Step 3 reads the output rather than trusting exit codes.

| Mutation | Test that must redden |
|---|---|
| give two entries the same slug in the same category | `npm run images` prints `COLLISION:`, writes nothing, exits 1 |
| delete `assets-source/atmosphere/dining.jpg` | `npm run images` reports it in `failures` and exits non-zero — the OG source |
| delete a superseded source but leave a content file pointing at its derivative | `npx vitest run src/content/__tests__/assets.test.ts` on that `it.each` case |
| skip Step 1 entirely (leave a superseded source in place) | Nothing reddens — an unreferenced source is legal by design (`images.mjs:106-120`). A bytes problem, not a correctness problem, caught by the reviewer reading the diff. Stated so nobody expects a red |
| give a new source a `.arw` extension | `listSources()` skips it (not in `IMAGE_EXT`), no derivative is written, and Step 4 throws `Input file is missing` |

---

## Task 43: Rewrite the five in-scope content files

**Files:**
- Modify: `src/content/dishes.json`, `drinks.json`, `galleries.json` (the `atmosphere` and `ourStory` lists **only**), `experiences.json`, `press.json` (only where a `certain` judgement matched the article's subject)

- [ ] **Step 1: For every `attach` and `newRecords` row, the target field is `` `/${category}/${slug}.webp` ``** — the output path with the leading `public` segment dropped, the rule `src/shared/derivative-path.ts:37-62` re-implements for the browser and `derivative-path.test.ts` proves agrees with `outputPathFor` over every real source.

- [ ] **Step 2: A `galleries.json` attachment writes both `src` and `alt`.** `alt` must be real and descriptive and must not match the placeholder patterns `validate.ts:491-492` enforces per list. Match the voice already in the file: "Warm evening light across the restaurant", "Shaping pasta in the pastificio".

- [ ] **Step 3: Append every `newRecords` record.** The dish key set is closed (`DISH_KEYS`, `src/content/guards.ts:69-76`): exactly `id, name, description, image, tags` and nothing else. `tags` is authored but deliberately rendered by nothing (`types.ts:48-54`) — populate it, do not start rendering it. The drink key set is `id, name, description, category, image` with `category ∈ {mocktail, cocktail, wine}` (`guards.ts:77-83`).

- [ ] **Step 4: Confirm the hero collage did not move**
```bash
cd /Users/taran/Desktop/vb && node -e '
const { execFileSync } = require("node:child_process");
const before = JSON.parse(execFileSync("git", ["show", "HEAD:src/content/galleries.json"], { encoding: "utf8" }));
const after = require("./src/content/galleries.json");
if (JSON.stringify(before.heroCollage) !== JSON.stringify(after.heroCollage)) {
  throw new Error("heroCollage changed -- Phase 6 does not touch the collage");
}
console.log("heroCollage unchanged (structural equality, not byte equality -- this is blind to formatting)");
'
```

- [ ] **Step 5: Confirm at least one drink still has no photograph**, so `Drinks.test.tsx:45`'s non-vacuity guard keeps meaning something:
```bash
cd /Users/taran/Desktop/vb && node -e '
const d = require("./src/content/drinks.json");
const n = d.filter((x) => x.image === null).length;
if (n === 0) throw new Error("every drink now has a photo -- Drinks.test.tsx:45 loses its guard");
console.log(`${d.length - n} photographed, ${n} not`);
'
```

- [ ] **Step 6: `npx tsc -b --noEmit`**

- [ ] **Step 7: `npx vitest run src/content/__tests__/ src/components/__tests__/`** — expect `assets.test.ts`, `shape.test.ts`, `dishes.test.ts`, `FoodGallery.test.tsx`, `Drinks.test.tsx`, `PlaceGallery.test.tsx`, `Experiences.test.tsx`, `OurStory.test.tsx` all green. These are data-derived, not count-pinned: `FoodGallery.test.tsx:9` asserts `toHaveLength(dishes.length)` and `Drinks.test.tsx:21` asserts `toHaveLength(photographed.length)`, so adding records moves them together.

**If this task is wrong:** the **visitor** gets a broken-image box in the food or drinks carousel, or a photograph under the wrong name. The **owner** opens `/edit` → Dishes and sees a row with an empty thumbnail box (`manage/Thumbnail.tsx:66-68` renders a placeholder when neither a staged preview nor a resolvable path exists), with no explanation of why.

| Mutation | Test that must redden |
|---|---|
| point one new image path at a file that does not exist | `assets.test.ts` on that `it.each` case |
| change one path's case | same test — `src/test/publicFiles.ts` builds its set from `readdirSync`, precisely so macOS's case-insensitive filesystem does not hide it |
| add a sixth key to a new dish record | `shape.test.ts`'s `unknownKeys(...)` sweep (`:217-219`) |
| reorder one entry inside `galleries.heroCollage` | Step 4 throws |
| give an atmosphere entry a placeholder alt | `src/components/__tests__/PlaceGallery.test.tsx:15` — **not `validate.test.ts`**, which builds its own fixtures (`:771`) and never reads the committed content |
| give a new dish a placeholder name | `src/components/__tests__/FoodGallery.test.tsx:15`, same reason (`validate.test.ts:786` also builds its own) |

---

## Task 44: Pin what Phase 6 guarantees, in tests that can fail

**Files:**
- Create: `src/content/__tests__/photo-sources.test.ts`
- Modify: `scripts/__tests__/images.derivatives.test.mjs`

- [ ] **Step 1: Re-measure the largest committed WebP source** (Task 41 Step 3 printed it; re-run so the number in the file is measured, not remembered), round **up to the next whole 50KB**, and write both numbers into the file's comment in the style `bundle.post-build.test.ts` uses for the entry CSS.

- [ ] **Step 2: `src/content/__tests__/photo-sources.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dishes, drinks } from '../index';

// The Drive import committed repo-sized WebP intermediates, not camera
// originals: R2 is billing-gated, so this repository IS the image storage,
// and one 10MB frame per dish would have been 320MB of history for a site
// that serves 47KB derivatives. Every pre-existing source is a camera file
// (.jpg/.JPG/.png/.jpeg); every source this import added is .webp. That split
// is what lets this ceiling apply only forward, without a hand-kept list of
// filenames that would drift.
//
// Measured after the import: largest committed WebP source is <MEASURED>
// bytes. The ceiling below is that, rounded up to the next 50KB. REPLACE THE
// ZERO before running -- the file as printed here fails its own suite, which
// is deliberate: a placeholder that passes is a placeholder that ships.
const MAX_IMPORTED_SOURCE_BYTES = 0;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const sources = walk('assets-source');
const imported = sources.filter((f) => extname(f).toLowerCase() === '.webp');

describe('imported photo sources', () => {
  it('found imported WebP sources to check against', () => {
    // Without this, every it.each below runs zero cases and reports green for
    // having checked nothing.
    expect(imported.length).toBeGreaterThan(0);
  });

  it.each(imported)('%s stays under the repository ceiling', (file) => {
    expect(statSync(file).size).toBeLessThanOrEqual(MAX_IMPORTED_SOURCE_BYTES);
  });

  it.each(imported)('%s really is WebP, not another format under a .webp name', (file) => {
    // RIFF....WEBP -- bytes 0-3 and 8-11 of every WebP file.
    const head = readFileSync(file).subarray(0, 12);
    expect(head.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(head.subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  it('commits no camera raw file', () => {
    expect(sources.filter((f) => /\.(arw|dng|cr2|nef)$/i.test(f))).toEqual([]);
  });

  it('gives every dish its own photograph', () => {
    const images = dishes.map((d) => d.image);
    expect(new Set(images).size).toBe(images.length);
  });

  it('gives every photographed drink its own photograph', () => {
    const images = drinks.map((d) => d.image).filter((i): i is string => i !== null);
    expect(images.length).toBeGreaterThan(0);
    expect(new Set(images).size).toBe(images.length);
  });
});
```

- [ ] **Step 3: The width assertion goes in `scripts/__tests__/`, not here.** `src/content/__tests__/` runs inside `npm run test:deploy`, and `scripts/paths.mjs`'s own header forbids pulling sharp's native binding into the deploy path. Append to `scripts/__tests__/images.derivatives.test.mjs`, **adding the imports that file does not have today** (it imports only `mkdtemp, rm, writeFile`, `existsSync`, `tmpdir`, `join`, `sharp`, `build`/`encodeDerivative`, `IMAGE_EXT`/`outputPathFor`):

```js
import { readdirSync } from 'node:fs';
import { extname } from 'node:path';

function walk(dir) { /* same shape as above */ }
const imported = walk('assets-source').filter((f) => extname(f).toLowerCase() === '.webp');

it.each(imported)('%s was encoded wide enough for the 1000px pass', async (file) => {
  const { width } = await sharp(file).metadata();
  expect(width).toBeGreaterThanOrEqual(1200);
});
```

- [ ] **Step 4: `npx vitest run src/content/__tests__/photo-sources.test.ts scripts/__tests__/images.derivatives.test.mjs`**

- [ ] **Step 5: Prove each assertion can fail, one at a time, reverting between**
```bash
cd /Users/taran/Desktop/vb
cp /Users/taran/Desktop/vb-phase6/frames/<any-id>.jpg assets-source/food/__probe__.webp   # a JPEG named .webp
npx vitest run src/content/__tests__/photo-sources.test.ts   # the RIFF/WEBP case must redden
rm assets-source/food/__probe__.webp
```
The `__…__.` naming matters: `src/shared/__tests__/derivative-path.test.ts:39`'s `TEMP_FIXTURE = /^__.*__\./` exists because a probe file left in `assets-source/` mid-run once made the suite's test count non-deterministic. Use that convention and delete the probe.

**If this task is wrong:** no immediate symptom. The failure is a year out: somebody drags a 12MB original into `assets-source/food/` and the repository doubles in size with nothing going red, which is precisely how the existing 201MB accumulated.

| Mutation | Test that must redden |
|---|---|
| copy a JPEG to `assets-source/food/__probe__.webp` | "really is WebP, not another format under a .webp name" |
| copy a 10MB frame re-encoded as real WebP at full size | "stays under the repository ceiling" |
| `touch assets-source/food/__probe__.arw` | "commits no camera raw file" |
| point two dishes at one image path | "gives every dish its own photograph" |
| delete every `.webp` source | "found imported WebP sources to check against" — the guard against the whole file passing vacuously |
| `SOURCE_MAX_WIDTH` → 400 and re-import | "was encoded wide enough for the 1000px pass", in `images.derivatives.test.mjs` |

---

## Task 45: Re-measure the homepage byte count and write its ledger entry

**Files:**
- Modify: `src/test/homepage-bytes.test.tsx`

- [ ] **Step 1: Measure.** `npx vitest run src/test/homepage-bytes.test.tsx` and read the new number out of `expected N to be <the number Task 34 left>`.

- [ ] **Step 2: Get the per-cause arithmetic by measurement, not estimate.** The file's own history records a delta credited to one cause that had two. Create a worktree at the parent commit and toggle **five** content files one at a time — `dishes.json`, `drinks.json`, `galleries.json`, `experiences.json` **and `press.json`**, which renders on the homepage as `<section id="press">` (`NewsPress.tsx:15`):
```bash
git worktree add /Users/taran/Desktop/vb-parent HEAD
# for each of the five:
cp /Users/taran/Desktop/vb-parent/src/content/<file> src/content/<file>
npx vitest run src/test/homepage-bytes.test.tsx   # record the number
git checkout src/content/<file>
```
The five deltas must sum exactly to the whole-page delta. If they do not, something outside the five moved and must be found before the number is written.

- [ ] **Step 3: Update the assertion to the measured number.**

- [ ] **Step 4: Append a ledger paragraph in the file's existing voice** — old → new, the sign, and the measured attribution. **Five causes are possible here and each is named separately:** image path strings changing length in `dishes.json`; the same in `experiences.json`/`press.json`/`galleries.json`; new dish cards arriving in `FoodGallery`; new drink cards arriving in `Drinks` (each drink that gains a photo adds a whole card — `Drinks.tsx:41` renders one card per drink that `hasImage`, so a single `null → path` edit adds roughly 700 bytes of card markup, not 30 bytes of path); and changed `alt` text on gallery entries, which lands in `container.innerHTML` through `PlaceGallery` and `OurStory`.

- [ ] **Step 5: Re-read `homepage-bytes.test.tsx:18-52` before committing.** This file is **excluded from `test:deploy` and must stay excluded**; `src/test/hosting.test.ts:449-450` and `:460` assert that exclusion in both directions. Do not "fix" it.

- [ ] **Step 6: `git worktree remove /Users/taran/Desktop/vb-parent`**

**If this task is wrong:** the **owner** is the victim, and this is documented history, not theory. If the number is left stale, `npm run test:deploy` fails on Cloudflare, the deploy is refused, and — because `worker/github.ts`'s `isContentPath` restricts publishing to `src/content/*.json` — **every subsequent publish she makes fails on the same assertion with no control she can reach to fix it.** A fifteen-character dish-description edit did exactly this once.

| Mutation | Test that must redden |
|---|---|
| revert one dish's `image` to its pre-Phase-6 path and leave the number alone | `homepage-bytes.test.tsx` "the public homepage is unchanged" |
| update the number but skip the ledger paragraph | Nothing reddens. **PREDICTED WEAK and unfixable by a test** — the file's whole design is that a human states the accounting. A bare number change with no paragraph is a rejected diff |
| remove the `homepage-bytes` exclusion from `test:deploy` | `hosting.test.ts:449-450` |

---

## Task 46: Run the full gate and confirm Phase 6 moved no CSS

**Files:** none modified; this task is verification.

- [ ] **Step 1: `npm run gate`.** In order: `npm run images`, `npx tsc -b --noEmit`, `npx eslint .`, `npm test -- --run`, `npm run test:deploy`, `npm run build`.

- [ ] **Step 2: Read the built stylesheet's size off disk.** The ceiling assertion prints nothing on success (it is `expect(size).toBeLessThan(...)`), so there is no number to read out of a passing run: `stat -f%z dist/assets/index-*.css`.

- [ ] **Step 3: Confirm it is byte-identical to what Task 36 left.** Phase 6 adds no markup and no class, so any movement means a comment written during this section leaked a rule — the scanner is a plain text extractor with no JS parser, and this repository has shipped that bug from comments more than once. If it moved, diff the stylesheet at rule level against a **worktree** checkout of the parent (never a stash — the file's method note at `:319-713` is emphatic), find the leaked token, and rewrite the comment. Do not raise the ceiling to accommodate it, and never delete the check.

- [ ] **Step 4: Note which files the gate's two vitest runs differ on.** `test:deploy` excludes `scripts/__tests__/images.derivatives.test.mjs` and `src/test/homepage-bytes.test.tsx`. Task 44's width assertion lives in the first of those, so it runs under `npm test` and not on Cloudflare — correct and deliberate, for the sharp-avoidance reason `scripts/paths.mjs:1-25` documents.

- [ ] **Step 5: `git status --porcelain`.** The only modified/added paths should be `assets-source/**`, `src/content/*.json`, `src/content/__tests__/photo-sources.test.ts`, `scripts/__tests__/images.derivatives.test.mjs`, `scripts/drive-import.mjs`, `src/test/homepage-bytes.test.tsx`. Nothing under `public/`, nothing under `src/admin/`, nothing under `worker/`.

**If this task is wrong:** the **owner** loses the ability to publish anything at all — a red `test:deploy` on `main` blocks every future Pages build, not just this one.

| Mutation | Test that must redden |
|---|---|
| write a bare utility-looking token into a comment in `scripts/drive-import.mjs` | Nothing — `tailwind.config.js:31`'s content glob is `['./index.html', './src/**/*.{js,ts,jsx,tsx}', …]` and does **not** include `scripts/`. Verified. Stated so nobody assumes protection that is not there; the rule still applies by discipline |
| write the same token into a comment in `src/content/__tests__/photo-sources.test.ts` | Also nothing — the glob excludes `'!./src/**/__tests__/**'`. Both exclusions are real; the ceiling only guards non-test `src/` files |
| add a class string to `src/components/FoodGallery.tsx` | `npm run build` → `test:bundle`, but **only if it exceeds the remaining margin**, which is 150 bytes after Task 36 — one utility rule is typically 30–50 bytes, so this row is not reliably falsifiable on its own. Step 3's byte-identical check is the real guard |
| leave a superseded source deleted but its derivative still referenced | `npm test` on `src/content/__tests__/assets.test.ts` |

---

## Task 47: Prove in a real browser that the photographs paint

jsdom has no layout engine and no image loader: an `<img>` whose `src` points at a corrupt file renders identically to one pointing at a good file, and `naturalWidth` is always 0. Everything here belongs in `e2e/` and nowhere else.

**Files:**
- Create: `e2e/phase6-photos.spec.ts`

- [ ] **Step 1: Confirm nothing else is running** — Playwright runs only when nothing else runs, port 8080 is shared.

- [ ] **Step 2: `e2e/phase6-photos.spec.ts`**

The load discipline is the whole trick. Every carousel image on this homepage is `loading="lazy"` (`FoodGallery.tsx:28`, `Drinks.tsx:51`, and the others), inside a horizontal scroller, below the fold — so `goto` plus `networkidle` leaves most of them undecoded and `naturalWidth === 0` for images that are perfectly fine. `e2e/blog.spec.ts:68` calls `scrollIntoViewIfNeeded()` before reading `naturalWidth` at `:86` for exactly this reason, and `e2e/collage-hit-test.spec.ts:88` comments on the same hazard.

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SECTIONS = ['#menu', '#drinks', '#gallery', '#experiences'] as const;
const drinks = JSON.parse(readFileSync('src/content/drinks.json', 'utf8')) as Array<{ image: string | null }>;
const PHOTOGRAPHED_DRINKS = drinks.filter((d) => d.image !== null).length;

for (const width of [390, 1280]) {
  test(`every in-scope photograph decodes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    for (const selector of SECTIONS) {
      const imgs = page.locator(`${selector} img`);
      const count = await imgs.count();
      // Non-vacuous: a selector matching nothing would pass the loop below by
      // checking zero images.
      expect(count, `${selector} rendered no images`).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const img = imgs.nth(i);
        // Vertical scroll AND horizontal scroll inside the carousel track:
        // every one of these is loading="lazy", and a queued image is
        // indistinguishable from a broken one on naturalWidth alone.
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(async () => img.evaluate((el) => (el as HTMLImageElement).complete))
          .toBe(true);
        const natural = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        const src = await img.evaluate((el) => (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
        expect(natural, `did not decode: ${src}`).toBeGreaterThan(0);
      }
    }

    // Structural, not falsifiable by editing drinks.json: this constant is
    // derived from the same file the page renders from, so both sides move
    // together. It is here to catch a RENDERING change (a card dropped, a
    // card duplicated), not a data change.
    await expect(page.locator('#drinks img')).toHaveCount(PHOTOGRAPHED_DRINKS);
  });
}
```

- [ ] **Step 3: `npx playwright test e2e/phase6-photos.spec.ts`**

- [ ] **Step 4: Re-run the collage guards untouched**, to show the boundary held in a browser and not only in a diff: `npx playwright test e2e/hero-collage.spec.ts e2e/collage-divider.spec.ts e2e/collage-reachable.spec.ts`. `e2e/collage-page.ts:39-54`'s `heroCollagePhotoCount()` reads `galleries.json` fresh and asserts `> 1`, so these cannot pass vacuously.

- [ ] **Step 5: Run the contrast sweep**, because new photographs change what text sits over what: `npx playwright test e2e/brand-contrast.spec.ts`. Its `sitsOverImageLayer` exclusion (`:127-144`) decides which nodes are measurable by walking for a positioned ancestor carrying both an image element and a background-image child; a new photograph inside an existing card cannot change that shape, but the sweep's `expect(measured.length).toBeGreaterThan(50)` non-vacuity floor is worth seeing pass with the new content in place. **Note the interaction with Task 34:** those section wrappers are now positioned, so re-read this spec's exclusion logic against them and record whether the measured count moved.

**If this task is wrong:** the **visitor** sees a broken-image icon, or an empty hole in the food carousel, on the live site — the failure every preceding disk-level check is blind to. The **owner** sees the photograph fine in `/edit` (which renders a local blob preview) and cannot reproduce what the visitor is describing.

| Mutation | Test that must redden |
|---|---|
| truncate one derivative (`head -c 200 public/food/<slug>.webp`) | "every in-scope photograph decodes at 390px", with the failing URL named. **This is the mutation that proves the e2e earns its place**: `assets.test.ts` stays green because the file still exists, and no jsdom test can see it |
| drop the `scrollIntoViewIfNeeded` / `complete` poll | the same test, on perfectly good images — which is why the loop is written this way rather than as one `evaluateAll` |
| change `SECTIONS` to a selector that matches nothing | `#nothing rendered no images` |
| remove one photo from `galleries.heroCollage` | `e2e/hero-collage.spec.ts`, and `no-missing-react-keys.test.tsx:115`'s `toBe(11)` under `npm test` |

---

## Task 48: Commit, push, and confirm the photographs are live

**Files:** none modified; this task ships.

- [ ] **Step 1: Stage exactly the expected paths and review the diff once more**
```bash
cd /Users/taran/Desktop/vb && git add assets-source src/content scripts/drive-import.mjs scripts/__tests__/images.derivatives.test.mjs src/content/__tests__/photo-sources.test.ts src/test/homepage-bytes.test.tsx && git status
```

- [ ] **Step 2: Confirm the added bytes are what the phase promised, and put the number in the commit message**
```bash
git diff --cached --stat | tail -1
du -ch $(git diff --cached --name-only --diff-filter=A -- assets-source) | tail -1
```

- [ ] **Step 3: Commit on a branch** (the repo is on `main`; branch first). The message states: how many frames were enumerated, how many judged `certain`, how many attached, how many left unattached and why that is the correct outcome, the megabytes added, and the homepage-bytes old → new with its attribution. Never mention AI or list any AI as co-author.

- [ ] **Step 4: Push, and let `.githooks/pre-push` run** — it runs `npm run images` first, unconditionally, then the fast checks.

- [ ] **Step 5: Open a PR to `main` and merge.** A push to main deploys Pages only; nothing in this section touches the Worker, so **do not** run `npx wrangler deploy` — that command replaces the Worker's route list with exactly what `wrangler.toml` declares and has no business running here.

- [ ] **Step 6: Watch the Cloudflare Pages build.** Its command is `npm run images && npm run test:deploy && npm run build` (`docs/cloudflare-cutover.md:29`); `npm run images` must precede `test:deploy` because the asset guardrail reads the filesystem, and it is the step that turns the committed 1600px sources into the served 1000px derivatives.

- [ ] **Step 7: `npm run verify:deploy`** (defaults to `https://viabiancarestaurant.com`, matching `site.json`'s `seo.url`).

- [ ] **Step 8: Confirm the new derivatives are served, with the right content type and cache header**

`public/_headers` sets `/*.webp` to `public, max-age=604800, must-revalidate` — deliberately not immutable, because derivative URLs are stable across builds.
```bash
node -e '
const p = require("/Users/taran/Desktop/vb-phase6/attachments.json");
for (const a of [...p.attach, ...p.newRecords]) console.log(`https://viabiancarestaurant.com/${a.category}/${a.slug}.webp`);
' | while read -r u; do
  curl -sI -H 'Origin: https://viabiancarestaurant.com' "$u" | awk -v u="$u" '/^HTTP|content-type|cache-control/ {print u": "$0}'
done
```
Every line must show `200`, `content-type: image/webp`, and the seven-day cache header. A `text/html` content type on a `.webp` URL is the SPA catch-all manufacturing a poisoned cache entry — the failure `scripts/verify-deploy.mjs`'s header comment was written for, and the reason status is never checked in isolation there.

- [ ] **Step 9: Load `https://viabiancarestaurant.com/` at phone width and look at the food and drinks carousels.** This is the end of the phase: photographs, live, on the site.

**If this task is wrong:** the **visitor** gets either the old site (build failed, nothing deployed) or, in the poisoned-cache case, a completely blank page — which has happened here before, returned HTTP 200, and was invisible to `curl -I` without the Origin header.

| Mutation | Test that must redden |
|---|---|
| push with a content file pointing at a path whose source was never committed | the Pages build's `npm run test:deploy` fails on `assets.test.ts`, the deploy is refused, and the site keeps serving the previous build |
| push without re-measuring `homepage-bytes` | `npm test` inside `.githooks/pre-push` reddens before the push completes (`test:deploy` excludes that file; plain `npm test` does not) |
| skip Step 8 and trust a 200 from Step 7 | Nothing reddens automatically. **PREDICTED WEAK by construction**: `verify:deploy` checks the entry bundle's content type, not every image URL. Step 8 is a command, not a test. If it should become permanent it belongs in `scripts/verify-deploy.mjs`'s asset list — call that out in the PR rather than leaving it as a one-time command |
| run `npx wrangler deploy` "to be safe" | No test catches it, and it replaces the Worker's live route list with whatever `wrangler.toml` currently declares. Do not run it |

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Where |
|---|---|
| Every content section becomes a compact list; clicking a row opens an editor | Tasks 1–9. All thirteen panels accounted for: Dishes/Drinks/Press/Awards/Experiences (3), Menu PDFs (4), Galleries (5), Pages (6), Posts (7), Homepage order (8, list only, per the spec's own table), Words on the site (9), About (10, the writing surface with a limit — not a list, per the table), Opening hours (10 Step 5, unchanged and pinned) |
| Add at the top, one surface, no separate new-item form | Task 2 Step 3 (position), Task 3 Step 1 (`onAdd: () => string`, the mechanism that makes Add and Edit one code path) |
| Delete inside the editor, not on the row | D8, Task 1 Steps 2–3, Task 3's "there is no Remove on any row" |
| Drag to reorder, keyboard fallback kept | Task 2 (shared handle + Up/Down), Task 8 Step 3 (explicitly keeps both) |
| Centred dialog at 1280, full-screen sheet at 390, both tested at those widths | Task 1, Task 11 |
| Saving does not change | D3, restated in Task 1 and Task 3 |
| One continuous writing surface with a toolbar | Tasks 13–25 |
| Every toolbar item, every shortcut, every typing trigger | Task 20 (twelve buttons + Image label; B/I/U/K/Z/backslash), Task 19 (`1.`, `-`, `*`, `#`, `>`), Task 18 (Enter continues and leaves a list), Task 26 (Tab/Shift+Tab), Task 22 (paste strips formatting) |
| Images: device picker, existing staged path, centred at column width | Task 23 |
| Stores the existing block model; three published posts open unchanged | D5, Task 17, Task 25 |
| No font, size, colour, highlight, alignment or spacing controls | Task 20 Step 2 lists the whole toolbar; Task 23 Step 3 states there is no alignment control |
| The four off-toolbar kinds stay reachable | Task 24 |
| Blog index: filter by kind, sort, search, composing, empty result in words | Tasks 29–32 |
| Washes land 15–20 points below white, measured at 390 before and after | Tasks 33–35 |
| Phase 6: enumerate by owner, download, look at each, attach only what is certain, run the pipeline, publish | Tasks 37–48 |
| The CSS ceiling rises to a measured number and is never deleted | Tasks 12, 27, 36; Task 46 asserts Phase 6 moves it by zero |

Nothing in the plan implements a requirement the spec does not state. Two spec numbers are deliberately **not** carried forward, with the contradiction stated in Section C's preamble rather than silently: the brand-opacity wash scale (no section background in this repo uses one) and the footer's own `(237,237,237)` reading (the footer is `#222222`; 18 points is the target, not an observation).

**2. Placeholders resolved.** No "TBD", no "similar to Task N", no "write tests for the above". Four places name a value the implementer must read rather than invent, and each says what to read and what to do with each outcome: the three CSS ceilings (Tasks 12, 27, 36 — measured, never quoted), the homepage byte counts (Tasks 34 and 45 — measured, with the predicted arithmetic given only so the ledger can be checked), `MAX_IMPORTED_SOURCE_BYTES` (Task 44 Step 1, printed as `0` with an explicit instruction to replace it, because a placeholder that passes is a placeholder that ships), and Task 6-era Drive field names (Task 37 Step 2 — confirm `owner`/`fileSize`/`modifiedTime` come back before typing them as required). Two decisions the drafts left open are resolved here rather than at implementation time: **Pages' checkbox moves into the editor** (Task 6 Step 3, with the rejected alternative named), and **Pages gets no drag** unless its staged key turns out to be slug-derived (Task 6 Step 5, with both branches written).

**3. Type and name consistency across sections.** `ItemRow`/`ItemListProps` are declared in `ItemList.tsx` (Task 2) and consumed by Tasks 3–7 and 9 with those exact field names; `EditorSheetProps` likewise. `onAdd: () => string` is changed in Task 3 and every caller — `ArraySection`, `AwardsArea`, `ExperiencesArea` (Task 3), `PostsArea` (Task 7) — returns the id. `InlineNode` gains its two members once (Task 13) and every later signature uses the seven-member union. `Slot`/`Caret`/`Edit` are defined in Tasks 17 and 18 and used unchanged in 19, 21 and 26. `WritingSurfaceProps` is asserted byte-identical to `BlockListProps`, and Task 25's swap passes exactly the seven props `PostList.tsx:312-320` passes today — including the `${post.id}:` staged-key prefix, which the draft had silently dropped. `MAX_LIST_DEPTH` is declared in `src/content/types.ts`, not in `src/admin/writing/`, so `guards.ts` can import it without dragging admin code into the Worker bundle chain. `PostFilter`/`PostOrder`/`pageSlice` are produced in Task 29 and consumed in 30–32 under those names. The two wash tokens are named once in Task 34 and read from the real config in Task 35. `Attachment` and `NewRecord` both carry `driveId`/`category`/`slug`, which is what lets Task 41 encode `[...attach, ...newRecords]` — the single largest correctness fix applied to Section D.

**4. Known weak spots, all labelled in place rather than hidden.** Every `PREDICTED WEAK` row in this plan is one of five shapes: a ceiling set too generously (Tasks 12, 27, 36), a claim only a real browser can make (drag, caret, paste default, undo suppression, picker activation), a judgement no test can audit (Task 39's looking), a procedural guard with no automated counterpart (test-name drift, ledger paragraphs, Step 8's per-URL header sweep), and one row that reddens for the right reason by accident (`execCommand` in jsdom). Rows the verifiers proved could never redden — the two z-index rows, the `memoFor` memo row, `mergeText`, `blockProblems`, the empty-bold-run round trip, the backtick-in-code round trip, the duplicate-key render row — have been deleted or replaced with a falsifiable form rather than left in as decoration.
