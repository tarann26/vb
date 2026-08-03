// Task 10: the one button everything built over nine tasks has been
// waiting for, and the machinery that tells her whether it worked. The
// spec's own reason this exists: "Step 5 exists because of step 4. Once a
// bad edit cannot break the site, the new failure mode is that her work
// silently evaporates. She must be told."
import React, { useEffect, useRef, useState } from 'react';
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
import { clearDraft, formatRelativeTime, mostRecentSavedAt, saveDraft, type DraftMap } from './drafts';
import type { StagedFiles } from './staged';
import type { ContentFileName } from './content';
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
  | { phase: 'unauthenticated' };

const BUSY_PHASES = new Set<BarState['phase']>(['publishing', 'polling', 'confirming']);

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
      return { phase: 'unauthenticated' };
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
  // Called the moment either the publish request itself, or a build-status
  // poll made after it succeeded, comes back 401 -- the session's own 7-day
  // token can expire mid-edit. AdminApp wires this to useSession's logOut,
  // which re-shows the login form; nothing here assumes what happens next,
  // since her still-unsaved edits are already safe in both the in-memory
  // registry (until AdminApp itself unmounts on the status flip) and, more
  // durably, in the localStorage draft this component keeps current on
  // every change.
  onUnauthenticated: () => void;
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
}

const REAL_CLOCK = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

const PublishBar: React.FC<PublishBarProps> = ({ registry, stagedFiles, onUnauthenticated, children, pollClock = REAL_CLOCK }) => {
  const [state, setState] = useState<BarState>({ phase: 'idle' });
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

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
    const map = dirtyDraftMap(entries);
    if (Object.keys(map).length > 0) saveDraft(map, stagedCount);
    else clearDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry.version, stagedCount]);

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

  async function handlePublish() {
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
    const plan = buildPublishRequest(entries, stagedFiles.files);
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
      setState({ phase: 'unauthenticated' });
      onUnauthenticated();
      return;
    }
    if (result.status !== 'success') {
      setState(resultToBarState(result));
      return;
    }

    // Success: the commit landed. Clear exactly the staged keys THIS
    // request included (never the whole live map -- a photo staged after
    // this request was built must survive), clear the draft (Step 4: "clear
    // on a 200"), and refresh baseSha for every content file just published
    // so a second publish later in this session isn't refused with a false
    // conflict against her own prior write (see publish.ts's
    // refreshBaseShas comment).
    plan.stagedKeys.forEach((key) => stagedFiles.stage(key, null));
    clearDraft();

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
    setState(progressToBarState(outcome, result.sha));
    if (outcome.phase === 'unauthenticated') onUnauthenticated();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handlePublish();
      }}
    >
      <div className="mx-auto mb-8 max-w-3xl rounded border border-gray-200 bg-white p-4">
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
          <button type="submit" disabled={!isDirty || busy || tooManyStaged} className={PUBLISH_BUTTON_CLASSNAME}>
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
        {tooManyStaged ? (
          <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
            {`You have ${stagedCount} photos or PDFs staged; only ${MAX_STAGED_PHOTOS_PER_PUBLISH} can publish at once. Remove some before publishing.`}
          </p>
        ) : (
          <PublishStatus state={state} />
        )}
      </div>
      {children}
    </form>
  );
};

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

function PublishStatus({ state }: { state: BarState }) {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'publishing':
      return (
        <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
          Publishing…
        </p>
      );
    case 'polling':
      return (
        <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
          {`Publishing… ${describeBuildState(state.buildState)}.`}
        </p>
      );
    case 'confirming':
      return (
        <p role="status" className="mt-3 font-['Montserrat'] text-sm text-gray-600">
          Almost there — confirming the site picked it up.
        </p>
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
      return (
        <p role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          Someone else published while you were editing. Reload to get their changes, then try again.
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
          You&apos;ve been signed out. Log in and your changes will still be here.
        </p>
      );
    case 'validation':
      return (
        <div role="alert" className="mt-3 font-['Montserrat'] text-sm text-red-600">
          <p>There&apos;s a problem with what you tried to publish:</p>
          <ul className="list-disc pl-5">
            {state.problems.map((problem, index) => (
              <li key={index}>
                {problem.field ? <strong>{problem.field}: </strong> : null}
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export default PublishBar;
