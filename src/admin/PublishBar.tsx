// Task 10: the one button everything built over nine tasks has been
// waiting for, and the machinery that tells her whether it worked. The
// spec's own reason this exists: "Step 5 exists because of step 4. Once a
// bad edit cannot break the site, the new failure mode is that her work
// silently evaporates. She must be told."
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildPublishRequest,
  dirtyContentFiles,
  dirtyDraftMap,
  fetchBuildInfo,
  fetchBuildStatus,
  refreshBaseShas,
  requestPublish,
  trackPublish,
  MAX_STAGED_PHOTOS_PER_PUBLISH,
  type BuildState,
  type ContentRegistry,
  type PublishProgress,
  type PublishRequestResult,
} from './publish';
import { clearDraft, formatRelativeTime, mostRecentSavedAt, saveDraft, type DraftMap, type DraftSurface } from './drafts';
import type { StagedFiles } from './staged';
import { CONTENT_FILE_LABELS, type ContentFileName } from './content';
import type { ValidationProblem } from '../content/validate';

// ---------------------------------------------------------------------------
// The restore-or-discard banner. Rendered by AdminApp BEFORE any content
// section mounts (see AdminApp.tsx's own gating) -- "never auto-apply" means
// nothing below this component may seed a section's data with the draft
// until she has actually clicked Restore.
export interface DraftBannerProps {
  draft: DraftMap;
  // Review finding: a restored draft can reference a photo/PDF `contentPath`
  // that was staged (uploaded, validated, given a real path) but never
  // actually published, because the tab was lost first -- the bytes for
  // that upload only ever lived in memory (staged.ts), never in
  // localStorage (drafts.ts's own comment on why). Publishing that restored
  // reference would commit JSON pointing at a blob that was never written,
  // reported as a success -- carried requirement 3's failure mode, reached
  // through the draft door. This can't be resolved automatically (a
  // restored path is indistinguishable from one that published
  // successfully in an earlier session), so this is a plain count, shown as
  // its own warning line, telling her honestly that some picked files need
  // re-picking rather than staying silent about it.
  staleStagedCount: number;
  onRestore: () => void;
  onDiscard: () => void;
}

const BANNER_BUTTON_CLASSNAME =
  "rounded px-4 py-2 font-['Montserrat'] text-sm uppercase tracking-wide transition";

export function DraftBanner({ draft, staleStagedCount, onRestore, onDiscard }: DraftBannerProps) {
  const savedAt = mostRecentSavedAt(draft);
  const relative = savedAt === null ? 'a little while ago' : formatRelativeTime(savedAt);
  return (
    <div role="alert" className="mx-auto mb-8 max-w-3xl rounded border border-amber-300 bg-amber-50 p-4">
      <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">{`You have unsaved changes from ${relative}.`}</p>
      {staleStagedCount > 0 && (
        <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">
          {staleStagedCount === 1
            ? "A photo or PDF you picked in that session wasn't saved and will need to be picked again."
            : `${staleStagedCount} photos or PDFs you picked in that session weren't saved and will need to be picked again.`}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRestore}
          className={`${BANNER_BUTTON_CLASSNAME} bg-[#6B8B59] text-white hover:bg-[#5a7349]`}
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={`${BANNER_BUTTON_CLASSNAME} border border-gray-300 text-[#222] hover:bg-gray-100`}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PublishBar itself.

type BarState =
  | { phase: 'idle' }
  // She has asked to publish and is being told what that means before
  // anything leaves the browser. NOT a busy phase (see BUSY_PHASES below):
  // nothing is in flight yet, and the trigger button behind the panel is
  // not "working", it is simply behind a dialog.
  | { phase: 'confirm' }
  | { phase: 'publishing' }
  | { phase: 'polling'; buildState: BuildState }
  | { phase: 'confirming' }
  | { phase: 'success' }
  | { phase: 'build-failed'; commitUrl: string | null; sha: string }
  | { phase: 'stalled'; commitUrl: string | null; sha: string }
  | { phase: 'mismatch' }
  | { phase: 'conflict' }
  | { phase: 'validation'; problems: ValidationProblem[] }
  | { phase: 'server-error'; message: string }
  | { phase: 'network-error' }
  // `notice` carries the EXACT sentence also handed to `onUnauthenticated`
  // (see that prop's own comment, and PRE_PUBLISH/POST_PUBLISH_
  // UNAUTHENTICATED_NOTICE below) -- one computed string, not two that have
  // to be kept in sync by hand, for what she reads here (in the unlikely
  // event this phase ever paints before AdminApp's own logOut unmounts this
  // component) and what Login shows after the unmount that normally beats
  // it there.
  | { phase: 'unauthenticated'; notice: string };

const BUSY_PHASES = new Set<BarState['phase']>(['publishing', 'polling', 'confirming']);

// Review finding (Important): a 401 mid-POLL is not the same event as a 401
// on the publish REQUEST itself, and reusing one sentence for both told her
// the opposite of what happened. By the time trackPublish can ever report
// `unauthenticated`, requestPublish has already returned success -- the
// commit landed, clearDraft() already ran -- so "your changes will still be
// here" is false for this case: there is nothing left to protect, and after
// logging back in she read "No changes to publish yet" with no way to learn
// whether the build actually finished. `result.sha` is the one thing this
// state has to offer instead: a commit reference she can hand a developer,
// the same fallback build-failed/stalled already give when there's no
// commitUrl to link.
const PRE_PUBLISH_UNAUTHENTICATED_NOTICE = "You've been signed out. Log in and your changes will still be here.";
function postPublishUnauthenticatedNotice(sha: string): string {
  return `Your changes were already published (commit ${sha}). We couldn't confirm the build finished before you were signed out — log in and check back in a minute.`;
}

function describeBuildState(state: BuildState): string {
  switch (state) {
    case 'queued':
      return 'waiting for the build to start';
    case 'building':
      return 'building';
    case 'live':
      return 'live';
    case 'failed':
      return 'failed';
  }
}

// Step 5's own translation table, plus the two rows it leaves implicit
// (success, and a request that never reached the Worker at all). Every
// sentence below is exactly what she reads -- never a raw status code,
// never GitHub's or Cloudflare's own wording.
function progressToBarState(progress: PublishProgress, sha: string): BarState {
  switch (progress.phase) {
    case 'polling':
      return { phase: 'polling', buildState: progress.state };
    case 'confirming':
      return { phase: 'confirming' };
    case 'live':
      return { phase: 'success' };
    case 'build-failed':
      return { phase: 'build-failed', commitUrl: progress.commitUrl, sha };
    case 'stalled':
      return { phase: 'stalled', commitUrl: progress.commitUrl, sha };
    case 'mismatch':
      return { phase: 'mismatch' };
    case 'unauthenticated':
      // Only ever reached from trackPublish, which only ever runs AFTER
      // requestPublish has already returned success -- see this file's own
      // POST_PUBLISH_UNAUTHENTICATED_NOTICE comment for why that makes this
      // a different sentence than the one on the publish REQUEST's own 401.
      return { phase: 'unauthenticated', notice: postPublishUnauthenticatedNotice(sha) };
  }
}

function resultToBarState(result: Exclude<PublishRequestResult, { status: 'success' } | { status: 'unauthenticated' }>): BarState {
  switch (result.status) {
    case 'conflict':
      return { phase: 'conflict' };
    case 'validation':
      return { phase: 'validation', problems: result.problems };
    case 'server-error':
      return { phase: 'server-error', message: result.message };
    case 'network-error':
      return { phase: 'network-error' };
  }
}

function summaryMessage(dirtyCount: number, stagedCount: number): string {
  const total = dirtyCount + stagedCount;
  if (total === 0) return 'No changes to publish yet.';
  const parts: string[] = [];
  if (dirtyCount > 0) parts.push(`${dirtyCount} ${dirtyCount === 1 ? 'section' : 'sections'} edited`);
  if (stagedCount > 0) parts.push(`${stagedCount} ${stagedCount === 1 ? 'file' : 'files'} staged`);
  return `${parts.join(', ')} — ready to publish.`;
}

const PUBLISH_BUTTON_CLASSNAME =
  "rounded bg-[#6B8B59] px-6 py-2 font-['Montserrat'] uppercase tracking-wide text-white transition hover:bg-[#5a7349] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500";

export interface PublishBarProps {
  registry: ContentRegistry;
  stagedFiles: StagedFiles;
  // Plan 5 Task 5, Step 2: which surface's OWN draft key (drafts.ts's own
  // DraftSurface) this bar's persistence effect and success-path clearDraft
  // call should read and write. AdminApp passes 'dashboard'; EditMode
  // passes 'edit' -- REQUIRED, not defaulted, so this component can never
  // be wired up without someone deciding which draft it means (see
  // drafts.ts's own header comment on why that decision has to be
  // explicit).
  draftSurface: DraftSurface;
  // Called the moment either the publish request itself, or a build-status
  // poll made after it succeeded, comes back 401 -- the session's own 7-day
  // token can expire mid-edit. Handed the exact sentence she should read for
  // WHICHEVER of those two cases just happened (PRE_PUBLISH/POST_PUBLISH_
  // UNAUTHENTICATED_NOTICE above) -- review finding (Important): the two are
  // not interchangeable. A mid-poll 401 fires only after the commit already
  // landed and clearDraft() already ran, so "your changes will still be
  // here" is actively false for that case, not merely imprecise; a caller
  // that hardcoded one sentence for both (AdminApp used to) told her the
  // opposite of what happened, and left her with no way to learn whether
  // the build finished after logging back in. AdminApp wires this to
  // useSession's logOut, which re-shows the login form; nothing here
  // assumes what happens next, since her still-unsaved edits (the
  // pre-publish case only) are already safe in both the in-memory registry
  // (until AdminApp itself unmounts on the status flip) and, more durably,
  // in the localStorage draft this component keeps current on every change.
  onUnauthenticated: (notice: string) => void;
  // Every content section AdminApp renders -- Dishes, Drinks, Press,
  // Sections, Hours, Menus, Galleries, Story, Copy -- rendered INSIDE the
  // <form> below, not as a sibling next to it. That is what makes Step 1's
  // carried requirement 2 a real, reachable risk rather than dead defensive
  // code: a keyboard submit (Enter, inside any plain text input anywhere on
  // this page -- TagsInput included) only submits THIS form, and therefore
  // only reaches handlePublish's own flush-the-focused-field line, if the
  // field she was typing in is actually a DESCENDANT of the same <form> the
  // Publish button submits. Every button already rendered by every section
  // below (RecordList's Add/Remove/Move, GalleryList's, SectionList's,
  // StoryForm's, PhotoField/PdfField's Retry) is confirmed to already carry
  // an explicit `type="button"` -- the one thing that keeps THIS <form>
  // wrapping them from turning any of those into a second, accidental
  // submit trigger (an unlabelled `<button>` inside a `<form>` defaults to
  // `type="submit"` in plain HTML).
  children: React.ReactNode;
  // Overrides trackPublish's `now`/`sleep` only -- everything else about a
  // real publish (the fetch calls themselves) stays real in every test that
  // uses this. Defaults to the genuine wall clock; exists ONLY so
  // PublishBar.test.tsx can reach the 10-minute-stall and 60-second-mismatch
  // terminal states without a real (or fake-timer-advanced) wait -- the
  // backoff/timeout MATH itself is already exhaustively covered against an
  // entirely fake clock in publish.test.ts's own trackPublish suite; this
  // prop exists so a COMPONENT test can reach those same terminal states
  // without re-proving that math a second, slower way.
  pollClock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  // C2 fix: while a caller is holding an unresolved restore-or-discard
  // decision in front of her (EditMode's own `pendingDraft`, offered via a
  // DraftBanner rendered ALONGSIDE this bar rather than instead of it --
  // see EditMode.tsx's own comment on why /edit can't use AdminApp's
  // either/or ternary), the persistence effect below must not run its
  // `clearDraft` branch. Without this, the effect's very first tick after
  // this bar mounts sees a freshly-loaded, entirely CLEAN registry (nothing
  // has been restored into it yet -- "never auto-apply" is the whole point
  // of asking first) and reads that the same way an ordinary "nothing
  // dirty" tick would: `dirtyDraftMap` comes back `{}`, and the old,
  // unconditional `else clearDraft(draftSurface)` deleted the very draft
  // the banner is, at that exact moment, still asking her about -- gone
  // from localStorage before she could answer, even though the banner
  // itself (plain React state) kept showing it. AdminApp never reaches
  // this at all, structurally: it renders DraftBanner INSTEAD of this bar
  // while a decision is pending (its own ternary), so this component's own
  // effect never even exists yet to run. EditMode has no such swap -- Task
  // 2's invariant is that the real page (and therefore this bar, which
  // wraps it) never unmounts -- so it needs an explicit hold instead.
  // Defaulted to `false`: AdminApp never passes this, and its own
  // structural gating already makes it correct without it.
  holdDraftClear?: boolean;
  // I8: whole-file client-side validation problems (useValidation, the
  // exact hook AdminApp's own sections already use per file) for whichever
  // content files a caller lets her edit. /edit makes emptying a field a
  // first-class action with no per-field highlighting anywhere on the real
  // page (EditableText/EditableImage have no RecordForm-style problem
  // slot) -- this is the minimum honest fix: tell her what a publish would
  // already refuse, in the same place she is about to click Publish,
  // before she clicks it. Never gates the button itself (`disabled` stays
  // driven by `isDirty`/`busy`/`tooManyStaged` alone) -- useValidation's
  // own header comment is explicit that its result must never decide what
  // a publish is ALLOWED to send, only tell her sooner what the server
  // would already say. Defaulted to `[]`: AdminApp's own sections already
  // show every one of these inline, next to the field, so it never passes
  // this prop.
  problems?: ValidationProblem[];
  // How far down this bar's own wrapper starts, in pixels. Exists for one
  // measured defect: on /edit this bar renders at the very top of the real
  // homepage, and NavBar.tsx's own `<nav>` is `fixed top-0 left-0 right-0
  // z-50` with an opaque background and a 61px height -- so the bar's whole
  // top row, summary line and Publish button included, sat underneath it.
  // Measured in a real Chromium at both 390x844 and 1440x900 before this
  // prop existed: `document.elementFromPoint` at the Publish button's own
  // centre returned the nav's "Menu" link at 1440px and the hamburger
  // toggle's glyph at 390px -- the button could not be clicked at all.
  // e2e/publish-confirm.spec.ts is what pins this now; jsdom has no layout
  // engine and cannot hit-test, so no vitest test in this repo can.
  //
  // Applied as an inline style rather than a utility class, following
  // CollageTile.tsx's own precedent for the reason it gives: the shared
  // stylesheet carries a byte ceiling every admin-only class counts
  // against, and no existing utility fits anyway -- the largest top margin
  // with a rule in the shipped stylesheet today is 48px, which would leave
  // 3px of clearance under a 61px nav. Defaulted to 0: /edit/manage has no
  // fixed header of its own and must not move.
  offsetTop?: number;
  // Fired whenever the "editing is paused" window opens or closes, so a
  // caller can stop its own editors from being touched while a publish
  // request is actually in flight. A callback OUT of this component rather
  // than a prop drilled IN, because `children` here is an opaque ReactNode
  // -- this bar cannot reach into what it renders -- and because EditMode
  // builds its whole affordance surface ABOVE this component in the tree,
  // where a context provider placed inside this bar could never reach it.
  // Each surface applies the boolean the way its own DOM allows.
  //
  // Deliberately NOT driven by BUSY_PHASES. The lock covers 'publishing'
  // alone -- the seconds while the POST is in flight, which is the one
  // window where the payload has been read and she has no way to know it.
  // Once the request returns, the commit is immutable and nothing she types
  // can corrupt it; markPublished already keeps a mid-flight edit dirty so
  // it goes in the next publish. Extending the lock into 'polling' would
  // hand a ten-minute timeout the power to freeze her page over a flaky
  // connection, for a commit that has probably already gone live.
  onPublishLockChange?: (locked: boolean) => void;
}

const REAL_CLOCK = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

// How long the editing pause is allowed to last before it lifts itself,
// whatever the request is doing. This is not a nicety -- it is what makes
// the lock safe to ship at all. `requestPublish` has no timeout and is not
// abortable: `abortRef`'s controller is created AFTER the POST resolves, so
// it only ever covers the build poll. A phone that loses signal partway
// through a payload that can reach tens of megabytes leaves the phase at
// 'publishing' indefinitely. Today that costs one disabled button; with a
// lock it would freeze the whole editing surface with no way out.
//
// Deliberately paired with releasing the UI rather than aborting the
// request: cancelling a POST the Worker may already have turned into a
// commit would report failure for a publish that actually succeeded, and
// the retry would then 409 into a message about another tab or device that
// misdescribes what happened. 60 seconds matches CONFIRM_TIMEOUT_MS, a
// number this codebase already treats as "a normal window, not evidence of
// a problem".
export const LOCK_TIMEOUT_MS = 60_000;

const PublishBar: React.FC<PublishBarProps> = ({
  registry,
  stagedFiles,
  draftSurface,
  onUnauthenticated,
  children,
  pollClock = REAL_CLOCK,
  holdDraftClear = false,
  problems = [],
  offsetTop = 0,
  onPublishLockChange,
}) => {
  const [state, setState] = useState<BarState>({ phase: 'idle' });
  // Her own way out of the pause, and the 60-second cap's way out too. Reset
  // at the top of every publish attempt so releasing one attempt never
  // silently disarms the next one.
  const [lockReleased, setLockReleased] = useState(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // Where focus goes back to when she cancels the confirmation -- the exact
  // control she opened it from, never "somewhere near it". A dialog that
  // dumps focus back at the top of the document on Escape is worse than no
  // dialog for anyone driving this from a keyboard.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    },
    [],
  );

  const dirtyFiles = dirtyContentFiles(registry.getEntries());
  const stagedCount = Object.keys(stagedFiles.files).length;
  const isDirty = dirtyFiles.length > 0 || stagedCount > 0;
  const busy = BUSY_PHASES.has(state.phase);
  // Same ceiling buildPublishRequest itself refuses at -- checked here too
  // so the button is disabled (with an explanatory line, PublishStatus's
  // own 'too-many-staged-files' case) BEFORE she ever clicks Publish, not
  // only after a refused attempt.
  const tooManyStaged = stagedCount > MAX_STAGED_PHOTOS_PER_PUBLISH;
  // 'publishing' alone, never BUSY_PHASES -- see `onPublishLockChange`'s own
  // comment for why the poll window must not freeze anything. Every terminal
  // state (conflict, validation, server-error, network-error, build-failed,
  // stalled, mismatch, unauthenticated, success) therefore releases this on
  // its own, with no extra bookkeeping to get wrong.
  const locked = state.phase === 'publishing' && !lockReleased;

  // The cap. Releases the editors WITHOUT touching the request or the
  // Publish button's own disabled state, so a hung POST can never strand
  // her -- see LOCK_TIMEOUT_MS.
  useEffect(() => {
    if (!locked) return;
    const timer = setTimeout(() => setLockReleased(true), LOCK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [locked]);

  // useLayoutEffect, not useEffect, so the pause lands in the same paint as
  // the "Publishing…" line rather than one frame later -- the same reasoning
  // EditableText gives for its own resync. The cleanup fires `false` on
  // unmount as well as on release, so a bar torn down mid-publish (the
  // dashboard's own 401 -> Login path does exactly that) can never leave a
  // parent stuck holding `true` with no component left to clear it.
  useLayoutEffect(() => {
    onPublishLockChange?.(locked);
    return () => onPublishLockChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  // Step 4: every dirty content file, written to localStorage with a
  // timestamp, on every change -- `registry.version` is the one plain
  // number that actually changes when a register() call lands (see
  // publish.ts's own comment on why `getEntries()` itself can't be a
  // dependency). The content itself is still keyed on the registry alone
  // (the draft store is scoped to content JSON -- drafts.ts's own comment
  // on why staged photo/PDF bytes are left out) -- `stagedCount` is passed
  // through only so a LATER reload's restore banner can warn her that many
  // staged files existed and were lost (see DraftBanner's own comment), not
  // because the staged files themselves are persisted here.
  //
  // Review finding: an empty registry must NEVER reach the `clearDraft()`
  // branch -- an empty registry means "nothing has loaded yet", not "she
  // has nothing unpublished". Reachable directly off the Restore path: she
  // clicks Restore, PublishBar mounts (registry still empty -- no section
  // has resolved its GET /api/content yet), and if this effect's first run
  // landed before any section's fetch settled, `dirtyDraftMap({})` is `{}`
  // and the old branch deleted the very draft she just asked to restore,
  // permanently, before a single field re-rendered with it. A content-load
  // failure right after (a flaky network, a stray 401 on the read route)
  // then leaves nothing to recover from -- no banner, no draft, no edit.
  useEffect(() => {
    const entries = registry.getEntries();
    if (Object.keys(entries).length === 0) return; // nothing has loaded yet -- never clear on this alone
    // `stagedFiles.files` -- so a leaf naming a file THIS session has
    // staged (but not yet published) is scrubbed out of what gets written
    // below; see dirtyDraftMap's own comment for the Critical this closes.
    const map = dirtyDraftMap(entries, stagedFiles.files);
    if (Object.keys(map).length > 0) saveDraft(draftSurface, map, stagedCount);
    // C2 fix: a LOADED-but-CLEAN registry is not the same fact as "nothing
    // unpublished exists" -- it is also exactly what a fresh mount looks
    // like in the instant before an unresolved restore-or-discard decision
    // has been answered (see `holdDraftClear`'s own prop comment). Holding
    // here leaves the map's absence unwritten rather than actively erasing
    // whatever is already on disk, so the worst case of holding too long
    // (she never answers, ever) is a draft that keeps existing -- never
    // the reverse.
    else if (!holdDraftClear) clearDraft(draftSurface);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry.version, stagedCount, holdDraftClear]);

  // Step 4's beforeunload handler, active only while something would
  // actually be lost.
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Chrome ignores the message text and shows its own wording, but
      // `returnValue` must still be set (a legacy requirement some browsers
      // still check) for the prompt to appear at all.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // What the form's own submit reaches now. The POST used to happen from
  // here directly, which meant Enter in ANY text input anywhere on the
  // dashboard published straight to the live site: every content section
  // renders inside this one <form> (see PublishBarProps' `children`
  // comment), and the button that submits it is `type="submit"`. That one
  // keystroke is the whole reason this step exists, and the reason there is
  // no "don't ask again" escape from it -- a checkbox is the single most
  // likely thing to be clicked by someone making a dialog go away, and
  // clicking it would permanently re-open that path with nothing to
  // discover the way back.
  //
  // The blur flush runs HERE as well as in handlePublish. TagsInput
  // (Field.tsx) and EditableText both commit a typed buffer only on blur,
  // so a still-focused field's edit is otherwise missing from the very list
  // she is being asked to approve.
  //
  // Recorded honestly, because a test was written for this line and had to
  // be withdrawn: this flush is NOT independently observable from jsdom.
  // Moving focus into the panel -- the focus trap's own opening act --
  // blurs whatever field was focused and commits its buffer regardless, and
  // under jsdom that whole sequence collapses into the same `act` as the
  // open itself, so the settled DOM is identical with and without this
  // line. What it still buys, in a real browser, is one frame: passive
  // effects run AFTER paint, so without this the panel paints once with a
  // stale summary ("1 section edited", naming the wrong sections) before
  // the focus effect corrects it. Kept for that, and because it stops the
  // panel's truthfulness from resting on an implementation detail of the
  // focus trap -- not because a vitest test fails without it.
  //
  // The flush in handlePublish is a different matter and is genuinely
  // load-bearing on its own: focus can move again while the panel is open,
  // and a clicked <button> does not take focus in every browser (see that
  // function's own comment).
  function openConfirm() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setState({ phase: 'confirm' });
  }

  function cancelConfirm() {
    setState({ phase: 'idle' });
    triggerRef.current?.focus();
  }

  async function handlePublish() {
    // A fresh attempt re-arms the pause: releasing it once (the 60s cap, or
    // her own "Keep editing") must not leave every later publish in this
    // session unprotected.
    setLockReleased(false);
    // Step 1's carried requirement 2: TagsInput commits its typed buffer
    // only when it loses focus. Unconditional, not skipped for the mouse
    // path on the assumption a click already moved focus away -- a review
    // finding corrected an earlier version of this comment that claimed
    // exactly that as "the browser's own default": true in Chromium and
    // Firefox, but Safari has never focused a plain `<button>` on click by
    // default, so a click there leaves the previously focused field's
    // buffer just as un-flushed as a keyboard submit would. This line is
    // what makes BOTH paths safe, not a backstop for only the keyboard one.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const entries = registry.getEntries();
    // The staged map exactly as this request is about to be built from --
    // captured so the success path below can clear what it actually SENT
    // rather than whatever happens to sit under those keys by then. See
    // staged.ts's `clearSent` for the data loss the by-key version caused.
    const sentStaged = stagedFiles.files;
    const plan = buildPublishRequest(entries, sentStaged);
    // Refused before a single byte left the browser -- MAX_STAGED_PHOTOS_
    // PER_PUBLISH (PhotoField.tsx), enforced here per the review finding
    // that nothing previously imported it. Unreachable through the ordinary
    // UI (the button is already disabled by `tooManyStaged` below, and the
    // same reactive check renders the plain-language explanation live,
    // updating the instant she removes enough staged files to clear it
    // again) -- this is only the defensive backstop, the same posture the
    // `plan.files.length === 0` check just below already takes.
    if (!plan.ok) return;
    if (plan.files.length === 0) return; // nothing to send -- the button is disabled for this case; defensive only.

    setState({ phase: 'publishing' });
    const result = await requestPublish(plan.files);
    if (!mountedRef.current) return;

    if (result.status === 'unauthenticated') {
      setState({ phase: 'unauthenticated', notice: PRE_PUBLISH_UNAUTHENTICATED_NOTICE });
      onUnauthenticated(PRE_PUBLISH_UNAUTHENTICATED_NOTICE);
      return;
    }
    if (result.status !== 'success') {
      setState(resultToBarState(result));
      return;
    }

    // Success: the commit landed. Clear exactly the staged files THIS
    // request included -- by identity, not by key. `plan.stagedKeys` is
    // `Object.keys` of this same map (publish.ts), so this covers the
    // identical set, filtered down to entries that are still the very
    // objects that were sent. A photo staged after this request was built
    // survives whether it landed on a new key or replaced one of these.
    // Then clear the draft (Step 4: "clear on a 200") and refresh baseSha
    // for every content file just published, so a second publish later in
    // this session isn't refused with a false conflict against her own
    // prior write (see publish.ts's refreshBaseShas comment).
    stagedFiles.clearSent(sentStaged);
    clearDraft(draftSurface);

    const publishedFiles = Object.keys(plan.contentSnapshots) as ContentFileName[];
    const freshShas = await refreshBaseShas(publishedFiles);
    if (!mountedRef.current) return;
    const updates: Partial<Record<ContentFileName, { data: unknown; sha: string }>> = {};
    publishedFiles.forEach((file) => {
      // Falls back to the sha the request was BUILT with when the refresh
      // itself failed -- never worse than before this publish, and a
      // best-effort refresh failing must not block reporting the publish's
      // own, already-successful outcome.
      const sha = freshShas[file] ?? entries[file]?.sha;
      if (sha) updates[file] = { data: plan.contentSnapshots[file], sha };
    });
    registry.markPublished(updates);

    setState({ phase: 'polling', buildState: 'queued' });
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await trackPublish(
      result.sha,
      {
        fetchBuildStatus: (sha) => fetchBuildStatus(sha),
        fetchBuildInfo: () => fetchBuildInfo(),
        now: pollClock.now,
        sleep: pollClock.sleep,
        signal: controller.signal,
      },
      (progress) => {
        if (mountedRef.current) setState(progressToBarState(progress, result.sha));
      },
    );
    if (!mountedRef.current) return;
    const nextState = progressToBarState(outcome, result.sha);
    setState(nextState);
    if (nextState.phase === 'unauthenticated') onUnauthenticated(nextState.notice);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // Opens the confirmation; never publishes. handlePublish is reached
        // from exactly one place now -- the panel's own accept button, which
        // is `type="button"` precisely so it cannot re-enter this handler.
        openConfirm();
      }}
    >
      <div className="mx-auto mb-8 max-w-3xl rounded border border-gray-200 bg-white p-4" style={{ marginTop: offsetTop }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-['Montserrat'] text-sm text-gray-600">{summaryMessage(dirtyFiles.length, stagedCount)}</p>
          {/* type="submit", not a plain onClick handler -- see PublishBarProps'
              own `children` comment for why the form this button submits
              needs to be the one wrapping every content section, not just
              this bar's own markup. Not ONLY for a click: it's the KEYBOARD
              path (Enter, from a text field elsewhere on this page) this
              wiring exists for -- handlePublish's own un-focus line is what
              makes a plain click safe too, since not every browser moves
              focus to a clicked button by default (Safari doesn't). */}
          <button
            ref={triggerRef}
            type="submit"
            disabled={!isDirty || busy || tooManyStaged}
            aria-haspopup="dialog"
            aria-expanded={state.phase === 'confirm'}
            className={PUBLISH_BUTTON_CLASSNAME}
          >
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
        {tooManyStaged ? (
          <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
            {`You have ${stagedCount} photos or PDFs staged; only ${MAX_STAGED_PHOTOS_PER_PUBLISH} can publish at once. Remove some before publishing.`}
          </p>
        ) : (
          <PublishStatus state={state} locked={locked} onKeepEditing={() => setLockReleased(true)} />
        )}
        {/* I8: client-side validation, informational only -- never disables
            the button above (see `problems` prop's own comment). Shown only
            at `idle`: once she has actually clicked Publish, the real
            outcome (a 422's own `validation` phase, or success) is the more
            current and more authoritative thing to show in this same slot,
            and this would otherwise sit stale underneath it. Reuses the
            exact amber sentence className the 'mismatch'/'stalled' cases
            below already use, and the exact list className the 'validation'
            case does -- no new Tailwind utility, so this costs nothing
            against this project's own CSS byte ceiling. */}
        {!tooManyStaged && state.phase === 'idle' && problems.length > 0 && (
          <div role="status" className="mt-3 font-['Montserrat'] text-sm text-amber-700">
            <p>{`${problems.length} ${problems.length === 1 ? 'problem needs' : 'problems need'} fixing before this can publish:`}</p>
            <ul className="list-disc pl-5">
              {problems.map((problem, index) => (
                <li key={index}>{problem.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {state.phase === 'confirm' && (
        <ConfirmPanel
          dirtyFiles={dirtyFiles}
          stagedCount={stagedCount}
          problems={problems}
          acceptDisabled={!isDirty || tooManyStaged}
          // handlePublish sets 'publishing' itself, synchronously, before
          // its first await -- so this panel unmounts in the same render
          // the request goes out in. Deliberately NOT setting that phase
          // here as well: handlePublish's two defensive early returns
          // (a refused plan, an empty one) would then strand the bar at
          // "Publishing…" with nothing in flight.
          onAccept={() => void handlePublish()}
          onCancel={cancelConfirm}
        />
      )}
      {children}
    </form>
  );
};

// ---------------------------------------------------------------------------
// The confirmation itself. A bottom-docked panel, portaled to document.body,
// used on BOTH surfaces -- not an expansion inside the bar and not a centred
// modal.
//
// Not an inline expansion, because on /edit it would be unusable rather than
// merely worse: the bar's own top row starts under a `fixed top-0 z-50` nav
// (see `offsetTop`'s comment), so a panel anchored to it renders its top
// half behind the nav. Not a centred modal, because /edit renders the real
// homepage underneath and covering it is exactly what makes /edit worth
// having; a centred layout also wants sizing and overflow utilities that
// have no rule in the shipped stylesheet today, against a byte ceiling with
// roughly two hundred bytes of headroom.
//
// The className below is CollageTile.tsx's own move/resize panel string,
// character for character, so this whole feature adds no CSS rule at all.
// `zIndex: 70` as an inline style, above that panel's own 50 and above
// CollageTile's refusal toast at 60, so which of the three paints on top is
// never decided by portal insertion order -- the same reasoning CollageTile
// itself records for choosing 60 over 50.
//
// `aria-modal="true"` plus a real focus trap, not a non-modal dialog: a
// dialog you can Tab straight past is not a stop. Known and deliberate
// limitation -- the page behind is not marked `inert`, so a screen reader's
// virtual cursor can still browse it. Doing that needs a ref to the page
// root, which this component does not own on /edit (it receives the whole
// homepage as opaque `children`). The keyboard path is trapped, and the
// keyboard path is the one the accidental-Enter hazard runs through.
const SECONDARY_BUTTON_CLASSNAME = 'border border-gray-300 text-[#222] hover:bg-gray-100';
const PRIMARY_BUTTON_CLASSNAME = 'bg-[#6B8B59] text-white hover:bg-[#5a7349] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500';

function ConfirmPanel({
  dirtyFiles,
  stagedCount,
  problems,
  acceptDisabled,
  onAccept,
  onCancel,
}: {
  dirtyFiles: ContentFileName[];
  stagedCount: number;
  problems: ValidationProblem[];
  acceptDisabled: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus moves INTO the panel on open, once. useEffect, not
  // useLayoutEffect: this runs after the portal's own nodes are in the
  // document, and there is nothing to measure first.
  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    (first ?? panelRef.current)?.focus();
  }, []);

  // Escape cancels; Tab cycles within the panel. The trap is written
  // against the panel's own focusable children rather than a general
  // document walk because the panel contains exactly two buttons and
  // nothing else focusable -- there is no case here where a wider notion of
  // "focusable" would find something this misses.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
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

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vb-publish-confirm-heading"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{ zIndex: 70 }}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)]"
    >
      <div className="mx-auto max-w-3xl">
        <p id="vb-publish-confirm-heading" className="mb-3 font-['Montserrat'] text-sm font-semibold text-[#222]">
          Publish these changes to the live site?
        </p>
        {/* WHAT. Derived live from the same `dirtyFiles`/`stagedCount` the
            summary line above the button already uses -- never a snapshot
            taken when this opened, which would go stale the moment a photo
            upload that was in flight when she clicked Publish finishes and
            stages itself. */}
        <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">{summaryMessage(dirtyFiles.length, stagedCount)}</p>
        {dirtyFiles.length > 0 && (
          <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">
            {`Changing: ${dirtyFiles.map((file) => CONTENT_FILE_LABELS[file]).join(', ')}.`}
          </p>
        )}
        {/* WHO SEES IT, then how permanent it is. "No undo button" rather
            than "cannot be undone", because the latter is not true: the
            Worker writes an ordinary single-parent commit, so a developer
            can revert it. Overstating danger in the other direction is a
            real failure mode for this bar -- it already carried a review
            finding where one sentence promised "your changes will still be
            here" in a case where that was actively false. */}
        <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">
          This puts your changes on the public website, where anyone visiting can see them.
        </p>
        <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">
          There is no undo button. To change something back, edit it again and publish again.
        </p>
        {/* TIMING. "usually takes about", never a hard promise: the poll
            this kicks off has a ten-minute ceiling and its own terminal
            copy says "This is taking longer than it should" -- a firm
            number here followed by that sentence is a contradiction she
            would read. */}
        <p className="mb-3 font-['Montserrat'] text-sm text-[#222]">
          It usually takes about 2-3 minutes for the site to show the change.
        </p>
        {problems.length > 0 && (
          <div className="mt-3 mb-3 font-['Montserrat'] text-sm text-amber-700">
            <p>{`${problems.length} ${problems.length === 1 ? 'problem needs' : 'problems need'} fixing before this can publish:`}</p>
            <ul className="list-disc pl-5">
              {problems.map((problem, index) => (
                <li key={index}>{problem.message}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Both `type="button"`, and that is not cosmetic. This panel is
            rendered inside the same <form> the Publish button submits, so a
            `type="submit"` here would re-fire that form's onSubmit -- which
            now opens this very panel -- and never reach handlePublish at
            all. The same invariant PublishBarProps' `children` comment
            already documents for every section button.

            The accept button carries the SAME `!isDirty` gate the trigger
            does. handlePublish's own `plan.files.length === 0` early return
            is commented as defensive-only "because the button is disabled
            for this case", and that stops being true the moment a panel can
            stay open across a registry change. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={acceptDisabled}
            onClick={onAccept}
            className={`${BANNER_BUTTON_CLASSNAME} ${PRIMARY_BUTTON_CLASSNAME}`}
          >
            Yes, publish to the live site
          </button>
          <button type="button" onClick={onCancel} className={`${BANNER_BUTTON_CLASSNAME} ${SECONDARY_BUTTON_CLASSNAME}`}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CommitLink({ commitUrl, sha }: { commitUrl: string | null; sha: string }) {
  if (commitUrl) {
    return (
      <a href={commitUrl} target="_blank" rel="noreferrer" className="underline">
        {commitUrl}
      </a>
    );
  }
  return <span>{sha || 'the commit that was just published'}</span>;
}

// The second line under the in-flight status, carrying the one number she
// actually wants and permission to walk away. Rendered ONLY for 'polling'
// and 'confirming', never for 'publishing' and never for 'success', because
// the "already saved" half is only TRUE once the commit has landed: by
// construction trackPublish runs only after requestPublish returned
// success, whereas during 'publishing' the POST is still in flight and
// nothing is saved anywhere yet.
//
// Hedged ("usually about"), for the same reason the confirmation panel's
// own sentence is: the poll behind this has a ten-minute ceiling and its
// terminal copy says "This is taking longer than it should".
//
// This line is also the ONLY thing telling her the tab is safe to close.
// The beforeunload guard above is keyed on `isDirty`, which goes false at
// markPublished -- so during exactly these two phases there is no
// close-the-tab warning at all. That is correct (the commit already
// landed), and it is why dropping this line would make the wait silent
// again rather than merely quieter.
function TimeExpectation() {
  return (
    <p className="mt-3 font-['Montserrat'] text-sm text-gray-600">
      This usually takes about 2-3 minutes. Your changes are already saved — you can close this tab and they will
      still go live.
    </p>
  );
}

function PublishStatus({
  state,
  locked,
  onKeepEditing,
}: {
  state: BarState;
  locked: boolean;
  onKeepEditing: () => void;
}) {
  switch (state.phase) {
    // Nothing in this slot while the confirmation is open -- the panel
    // itself is what she is reading, and it repeats the summary.
    case 'idle':
    case 'confirm':
      return null;
    case 'publishing':
      // The pause is named in the sentence she is already looking at, not
      // signalled only by controls going grey. On /edit that matters more
      // than anywhere else: the affordances there (dashed text boxes,
      // camera badges, move handles) disappear entirely for this window, so
      // without a sentence the page reads as broken rather than as busy.
      // "on this page" deliberately, never "nobody can edit" -- two
      // surfaces can be open at once with independent registries, and this
      // bar knows nothing about the other one.
      return (
        <>
          <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
            {locked ? 'Publishing… editing on this page is paused for a moment.' : 'Publishing…'}
          </p>
          {/* The escape hatch, always offered while the pause is on.
              `requestPublish` has no timeout and cannot be aborted, so a
              request that never comes back must never be able to trap her
              -- see LOCK_TIMEOUT_MS. Releases the editors only: the Publish
              button stays disabled by `busy`, so this can never let a
              second publish race the first. */}
          {locked && (
            <p className="mt-3">
              <button
                type="button"
                onClick={onKeepEditing}
                className={`${BANNER_BUTTON_CLASSNAME} border border-gray-300 text-[#222] hover:bg-gray-100`}
              >
                Keep editing
              </button>
            </p>
          )}
        </>
      );
    case 'polling':
      return (
        <>
          <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
            {`Publishing… ${describeBuildState(state.buildState)}.`}
          </p>
          <TimeExpectation />
        </>
      );
    case 'confirming':
      return (
        <>
          <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
            Almost there — confirming the site picked it up.
          </p>
          <TimeExpectation />
        </>
      );
    case 'success':
      return (
        <p role="status" className="mt-3 font-['Montserrat'] text-sm text-green-700">
          Your changes are live.
        </p>
      );
    case 'mismatch':
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-amber-700">
          Published, but the site hasn&apos;t picked it up yet.
        </p>
      );
    case 'build-failed':
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          {'Something went wrong publishing. Here’s the commit — send this link to your developer: '}
          <CommitLink commitUrl={state.commitUrl} sha={state.sha} />
        </p>
      );
    case 'stalled':
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-amber-700">
          {'This is taking longer than it should. Here’s the commit — send this link to your developer: '}
          <CommitLink commitUrl={state.commitUrl} sha={state.sha} />
        </p>
      );
    case 'conflict':
      // Plan 5 Task 5, Step 3 review finding: the 409 this maps to fires
      // whenever the file's baseSha no longer matches what's committed --
      // and now that /edit and /edit/manage can both be open at once, each
      // holding its OWN baseSha (never shared between them), publishing
      // from one makes the OTHER stale. The old wording ("someone else
      // published") told her to reload and discard work that might be, and
      // very often IS, her own -- her own second tab, her own phone open to
      // the same page. This can't tell "a genuinely different person" apart
      // from "you, elsewhere" (the server has no notion of "session" beyond
      // the request that just landed), so the fix is not asserting either:
      // naming the real possibility without accusing her of losing her own
      // work to a stranger.
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          This may already be published — from another tab or device, including one of your own. Reload to see the
          latest, then make your change again.
        </p>
      );
    case 'server-error':
    case 'network-error':
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          Couldn&apos;t reach the server that stores your changes. Nothing was lost — try again in a minute.
        </p>
      );
    case 'unauthenticated':
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          {state.notice}
        </p>
      );
    case 'validation':
      return (
        <div role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          {/* Review finding (Important): rendering `problem.field` raw put
              internal validator paths like "[0].name" in front of her --
              reachable in one click. Dropped: every message already names
              the dish or article it belongs to (validate.ts's own
              messages), and Task 6 already routes every one of these
              problems inline, next to the field it describes, in red. */}
          <p>Fix the fields marked in red below.</p>
          <ul className="list-disc pl-5">
            {state.problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        </div>
      );
  }
}

export default PublishBar;
