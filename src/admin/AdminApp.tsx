import React, { useRef, useState } from 'react';
import { useSession } from './session';
import Login from './Login';
import { useStagedFiles } from './staged';
import { useContentRegistry } from './publish';
import { loadDraft, loadDraftStagedCount, clearDraft } from './drafts';
import type { DraftMap } from './drafts';
// The shell: the lockup, the nav, the one PublishBar, and the five areas
// with the route deciding which one is visible. Every panel implementation
// lives in the area module that renders it; this file keeps only the session
// gate, the shared plumbing (registry, staged files, draft state, publish
// lock) and the mount.
import ManageShell from './manage/ManageShell';

// Default export, deliberately: React.lazy (src/App.tsx) requires one --
// there is no lazy() form that takes a named export.
//
// The route, the bundle guard that keeps everything under src/admin/ out of
// the main chunk (see src/test/bundle.test.ts and
// src/test/bundle.post-build.test.ts), and the login gate in front of it are
// Task 1's. Task 6 is what turns the logged-in placeholder into a working
// screen for the three content files whose forms Tasks 4/5 already built in
// full (dishes.json, drinks.json, press.json -- each a flat array of
// records with an `id`, so RecordList's own machinery already covers them
// with no new component). Task 7 adds sections.json's reorder/toggle screen
// and site.json's opening-hours screen. Site.json's remaining leaf fields,
// the menu PDFs, and story/galleries/copy.json are later tasks' screens, not
// this one's.
const AdminApp: React.FC = () => {
  const { status, logIn, logOut } = useSession();
  // The one collector every screen below that renders a PhotoField or a
  // PdfField shares -- see src/admin/staged.ts's own header comment for why
  // ONE shared instance, not one per section, is what makes "she stages
  // photos on three different dishes and a drink, then swaps a menu PDF,
  // and all of it reaches the same eventual publish" true. Called
  // unconditionally, before either early return below, the same as
  // `useSession()` already is -- React's own rule that hooks can't run
  // conditionally, not a new constraint this task introduces.
  const { files: stagedFiles, stage, clearSent } = useStagedFiles();
  // publish.ts's own registry: the one place every section's current
  // data/sha is visible at once, which is what makes a single POST
  // /api/publish across all nine content files possible at all -- see that
  // module's own header comment.
  const registry = useContentRegistry();
  const stagedFilesApi = { files: stagedFiles, stage, clearSent };
  // True only while the publish REQUEST itself is in flight -- seconds, not
  // the whole build. PublishBar owns the decision and reports it here; see
  // its `onPublishLockChange` prop for why the poll window deliberately
  // does not lock anything.
  const [publishLocked, setPublishLocked] = useState(false);

  // Task 10 Step 4: `pendingDraft` is the decision she hasn't made yet;
  // `restoreDraft` is populated ONLY once she clicks Restore, and is what
  // registerLoaded above actually seeds each section's data with. "Never
  // auto-apply" (the brief's own words) is enforced structurally below, not
  // just by convention: no section, and no PublishBar, is rendered at all
  // while `pendingDraft` is non-null.
  const [pendingDraft, setPendingDraft] = useState<DraftMap | null>(null);
  // How many staged (uploaded, not yet published) photos/PDFs existed the
  // last time this draft was saved -- read alongside `pendingDraft`, from
  // its own sibling localStorage key (drafts.ts's own comment on why it's
  // separate), purely to tell her honestly that they were lost, not to
  // attempt restoring them (their bytes only ever lived in memory).
  const [pendingStagedCount, setPendingStagedCount] = useState(0);
  const [restoreDraft, setRestoreDraft] = useState<DraftMap | null>(null);
  // Minor review finding (Plan 5 repair): purely informational, the
  // reciprocal of EditMode.tsx's own identical note -- the dashboard
  // correctly never offers an /edit draft for restore here (drafts.ts's
  // own per-surface separation: they are different sessions, and this
  // screen must never apply the OTHER one's draft), but until now nothing
  // told her one exists at all. Read alongside `pendingDraft` below, on the
  // same 'in' transition.
  const [otherSurfaceDraftExists, setOtherSurfaceDraftExists] = useState(false);
  // Review finding: PublishBar's own "You've been signed out..." sentence
  // lives inside PublishBar, which unmounts the INSTANT `logOut` flips
  // `status` to 'out' -- in the same render, before a single paint could
  // ever show it. Held here instead, one level up, where it survives that
  // unmount, and handed to <Login> below. Cleared the moment she's back
  // 'in' (the same render-time transition check already re-arms
  // `pendingDraft`), so it never lingers into a later, unrelated logout.
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  // Review finding (post-Task-10, Critical): re-checks localStorage on
  // EVERY fresh transition into 'in' -- not just the page's first mount --
  // by comparing this render's `status` against the value the PREVIOUS
  // render saw. `logOut` (called by PublishBar's own `onUnauthenticated`, a
  // 401 on the publish itself or mid-poll) never unmounts AdminApp; it only
  // swaps the returned JSX from the dashboard to <Login>, so a lazy
  // `useState` initializer -- which runs exactly once, on this component's
  // very first mount -- never re-fires on a SECOND login within the same
  // page load. Without this, a 401 mid-edit is fatal: her edit sits
  // correctly un-cleared in the registry (survives the logout, since
  // `registry` itself is never destroyed) and in localStorage (PublishBar's
  // own persistence effect never ran a clearing pass for it) right up until
  // she logs back in -- at which point every section remounts, re-fetches,
  // and `registerLoaded` overwrites the registry with the clean SERVER
  // value (there is no `restoreDraft` override, because the banner was
  // never shown), which makes the file read clean, which is what PublishBar's
  // own persistence effect sees on the NEXT registry change and answers
  // with `clearDraft()` -- silently deleting the very thing "your changes
  // will still be here" just promised was safe.
  //
  // Written as a conditional `setState` call DURING RENDER (comparing
  // against a ref of the last-seen status), not inside a `useEffect` --
  // deliberately. An effect-based version (`useEffect(() => { if (status
  // === 'in') setPendingDraft(loadDraft('dashboard')); }, [status])`) loses a real
  // race: on the render where `status` flips to 'in', React commits the
  // FULL dashboard first (pendingDraft is still stale-null at render time),
  // and only after that commit does it run effects -- by which point every
  // section's own fetch-effect has ALREADY started, and child effects run
  // before a parent's, so nothing guarantees the corrective re-render (and
  // the unmount it causes) beats an already-resolving fetch's `.then()`
  // back into the registry. Adjusting state DURING render is React's own
  // documented escape from exactly this: seeing `setPendingDraft` called
  // mid-render, React discards this render immediately and re-renders
  // synchronously with the new state BEFORE committing anything to the DOM
  // or starting a single effect -- so the sections' fetch-effects never
  // start at all when a draft needs offering again.
  const previousStatusRef = useRef(status);
  if (previousStatusRef.current !== 'in' && status === 'in') {
    setPendingDraft(loadDraft('dashboard'));
    setPendingStagedCount(loadDraftStagedCount('dashboard'));
    setOtherSurfaceDraftExists(loadDraft('edit') !== null);
    setSignOutNotice(null);
  }
  previousStatusRef.current = status;

  if (status === 'checking') {
    // src/App.tsx's <Suspense fallback={null}> already covers the moment
    // this chunk itself is still downloading; this covers the moment right
    // after it has loaded but before GET /api/wa (the session probe) has
    // answered. Rendering nothing here too avoids a login-form flash for
    // someone who is, in fact, already logged in.
    return null;
  }

  if (status === 'out') {
    return <Login onLogin={logIn} notice={signOutNotice ?? undefined} />;
  }

  // status === 'in'.
  //
  // One object, spread into all four areas, so the shared plumbing they
  // depend on is declared once and a fifth area cannot quietly be given a
  // different set.
  const areaProps = { registry, restoreDraft, stage, publishLocked };

  return (
    <ManageShell
      registry={registry}
      stagedFiles={stagedFilesApi}
      areaProps={areaProps}
      otherSurfaceDraftExists={otherSurfaceDraftExists}
      pendingDraft={pendingDraft}
      // Minor review finding: `pendingStagedCount` alone is honest about a
      // genuine RELOAD (staged.ts's own in-memory collector, `stagedFiles`
      // here, really is empty then) but wrong for an in-page 401 re-login --
      // AdminApp never unmounts on that path (this component's own comment
      // above on why the banner is re-offered anyway), so `stagedFiles` is
      // the SAME collector instance she staged into before the 401, still
      // holding every byte. Telling her those photos "will need to be picked
      // again" when they are, right now, still in memory and will publish
      // correctly is the opposite of what's true. Subtracting what is STILL
      // staged from what the draft recorded as staged leaves only what a
      // real reload would have actually lost.
      staleStagedCount={Math.max(0, pendingStagedCount - Object.keys(stagedFiles).length)}
      onRestore={() => {
        setRestoreDraft(pendingDraft);
        setPendingDraft(null);
      }}
      onDiscard={() => {
        clearDraft('dashboard');
        setPendingDraft(null);
      }}
      onPublishLockChange={setPublishLocked}
      onUnauthenticated={(notice) => {
        // Set BEFORE logOut -- both are plain setState calls in the same
        // synchronous handler, batched into the one re-render that flips
        // `status`, so <Login>'s very first paint already has the notice;
        // there is no intermediate frame where the dashboard is gone and the
        // notice isn't there yet. `notice` itself comes from PublishBar (its
        // own prop comment) -- it already knows whether this 401 landed
        // BEFORE or AFTER the commit succeeded, which is not something this
        // callback can tell on its own.
        setSignOutNotice(notice);
        logOut();
      }}
    />
  );
};

export default AdminApp;
