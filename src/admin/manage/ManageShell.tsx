// The shell every /edit/manage screen sits inside: the lockup, the
// cross-surface draft notice, the nav, the one PublishBar, and the five
// areas.
//
// ---------------------------------------------------------------------------
// THE ONE THING THIS FILE MUST NOT GET WRONG: AREAS MOUNT ONCE AND STAY
// MOUNTED.
// ---------------------------------------------------------------------------
// Every panel holds its own fetched data in local React state, and its load
// effect calls `registerLoaded`, which calls `registry.register(...)`.
// `register` overwrites the entry's `data` unconditionally -- that is its
// documented contract, and it is correct for the load path it was written
// for.
//
// So if navigating from Menu to Pages UNMOUNTED the Menu panels, navigating
// back would remount them, re-fetch, and register the SERVER value on top of
// an unpublished edit she made two minutes ago. That is the exact
// vanishing-edit failure CollapsibleSection's own decision #1 was written to
// prevent for folding, one level up.
//
// Hence: all five areas render from the first render, and the route selects
// which one is VISIBLE using the `hidden` attribute -- the same mechanism,
// and the same reasoning, that folding already uses. A route change is a
// visibility toggle. Nothing re-fetches, nothing re-registers, nothing is
// lost.
//
// Concretely, and this is the part an ordinary React instinct gets wrong:
//
//   * There is NO nested <Routes>, no <Outlet/>, and no area is ever the
//     child of a <Route element> of its own. Both of those render only the
//     matched child and unmount every sibling on navigation, which is
//     precisely the failure above.
//   * The active slug is derived from useLocation().pathname.
//   * The bare-URL redirect at the large breakpoint is a conditionally
//     rendered <Navigate replace/> ALONGSIDE the mounted areas, never
//     instead of them -- returning it on its own would unmount all five for
//     the length of the redirect.
//
// And `hidden` means the HTML ATTRIBUTE, with no display-setting utility
// class on the element carrying it. jsdom loads no CSS, so getByRole's
// refusal to match inside a hidden subtree -- the mechanism every visibility
// assertion in the tests rides on -- only holds for the attribute; and in a
// real browser any display utility on the same element silently defeats the
// user-agent rule for it. Both halves are pinned, in jsdom and in real
// Chromium.
//
// ---------------------------------------------------------------------------
// THE WIDTH IS READ ONCE, AND ONLY THE BARE URL DEPENDS ON IT.
// ---------------------------------------------------------------------------
// `window.matchMedia('(min-width: 1024px)').matches`, in a lazy useState
// initializer -- synchronously on the first render, so there is no flash of
// the wrong layout. The accepted consequence, stated so it is not later
// discovered as a bug: a window narrowed past the breakpoint, or a tablet
// rotated, keeps whichever branch it started in until the page is reloaded.
// Re-reading it whenever the window changes size would mean a dragged
// window edge could yank her from an area screen back to a home list
// mid-edit, which is worse.
//
// (The word for "changing a window's size" is deliberately not written as a
// bare token anywhere in this file. Tailwind's scanner is a plain text
// extractor with no JS parser behind it, and it reads words straight out of
// comments -- that exact word IS a utility class, and writing it here once
// added a real rule to the shipped stylesheet, caught by the rule-level diff
// this commit ran. This repo has shipped bogus comment-derived CSS twice.)
//
// The breakpoint is 1024, not 768. The content column is 768px wide and the
// forms inside it are already tight at that width on the panels that show
// two fields per row; a 224px sidebar plus that column plus gutters needs
// roughly 1000px before either has to give.
//
// The sidebar is gated on that flag rather than on a CSS breakpoint, and
// that is deliberate: a CSS-hidden sidebar is still in the DOM, so under
// vitest (no CSS, no media queries) every one of its links would be
// queryable alongside the phone list's, which is exactly the duplicated-nav
// bug AreaNav's own header rules out -- and the real-browser assertion that
// the sidebar element NEVER EXISTS at 390px could not hold either.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import PublishBar, { DraftBanner } from '../PublishBar';
import type { PublishPhase } from '../PublishBar';
import StatusStrip from './StatusStrip';
import { dirtyContentFiles } from '../publish';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { markAreaSeeded, hasSeededArea, saveSectionOpen } from '../open-sections';
import { AREAS, MANAGE_BASE, areaForFile, areaPath, findArea, slugFromPathname } from './areas';
import type { AreaSlug } from './areas';
import AreaNav from './AreaNav';
import { BRAND_NAME, BRAND_TAGLINE } from './brand';
import AreaHome from './AreaHome';
import AreaNotFound from './AreaNotFound';
import MenuArea from '../areas/MenuArea';
import PagesArea from '../areas/PagesArea';
import AwardsArea from '../areas/AwardsArea';
import ExperiencesArea from '../areas/ExperiencesArea';
import StoryPhotosArea from '../areas/StoryPhotosArea';
import DetailsArea from '../areas/DetailsArea';
import NumbersArea from '../areas/NumbersArea';
import type { AreaProps } from '../areas/area-props';
import type { ContentRegistry } from '../publish';
import type { StagedFiles } from '../staged';
import type { DraftMap } from '../drafts';

// One area's container, with a MutationObserver on it.
//
// Mirrors CollapsibleSection's own implementation rather than inventing new
// plumbing, and for the same reason: `role="alert"` is what every section in
// this dashboard ALREADY uses for a failed load and for a validation
// banner, so this needs nothing threaded through nine components and cannot
// drift out of sync with them.
//
// An observer rather than a re-read on render, also for CollapsibleSection's
// reason: an alert appears when a PANEL's own state changes -- its fetch
// rejects, its debounced validation pass finishes -- and that re-renders the
// panel alone. The shell is never told. Watching the subtree is what makes
// the nav marker arrive at the same moment the message it stands in for
// does.
//
// `subtree: true`, not direct children: a validation problem is raised deep
// inside a RecordForm, several levels below this element.
const AreaContainer: React.FC<{
  slug: AreaSlug;
  hidden: boolean;
  onProblemChange: (slug: AreaSlug, hasProblem: boolean) => void;
  children: React.ReactNode;
}> = ({ slug, hidden, onProblemChange, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => onProblemChange(slug, el.querySelector('[role="alert"]') !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
    return () => observer.disconnect();
  }, [slug, onProblemChange]);

  // The `hidden` ATTRIBUTE, and no display utility on this element. See this
  // file's header.
  return (
    <div ref={ref} data-area={slug} hidden={hidden}>
      {children}
    </div>
  );
};

export interface ManageShellProps {
  registry: ContentRegistry;
  stagedFiles: StagedFiles;
  // Everything the five areas share, drilled through here as props rather
  // than reaching them through a context -- see area-props.ts for why.
  areaProps: AreaProps;
  // The one thing that tells her an /edit draft exists at all. It is not
  // restorable here, deliberately (they are different sessions), but it must
  // be SAID, on every area and at both widths.
  otherSurfaceDraftExists: boolean;
  // The decision she has not made yet. While this is non-null, NOTHING below
  // it renders -- see the gate below, which is structural rather than
  // cosmetic.
  pendingDraft: DraftMap | null;
  staleStagedCount: number;
  onRestore: () => void;
  onDiscard: () => void;
  onPublishLockChange: (locked: boolean) => void;
  onUnauthenticated: (notice: string) => void;
}

const WIDE_QUERY = '(min-width: 1024px)';

function readWideViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(WIDE_QUERY).matches;
}

const ManageShell: React.FC<ManageShellProps> = ({
  registry,
  stagedFiles,
  areaProps,
  otherSurfaceDraftExists,
  pendingDraft,
  staleStagedCount,
  onRestore,
  onDiscard,
  onPublishLockChange,
  onUnauthenticated,
}) => {
  const { pathname } = useLocation();
  const slug = slugFromPathname(pathname);
  const area = findArea(slug);
  const [wide] = useState(readWideViewport);
  // What PublishBar is currently reporting, so the strip and the bar make
  // ONE statement about a publish rather than two that contradict each
  // other. See PublishBar's `onPhaseChange`.
  const [publishPhase, setPublishPhase] = useState<PublishPhase>('idle');
  // Which areas are currently reporting a problem somewhere inside them.
  // A Set held in state, updated only when an area's answer actually
  // changes, so an observer firing on every keystroke does not re-render the
  // nav on every keystroke.
  const [problemSlugs, setProblemSlugs] = useState<AreaSlug[]>([]);
  const onProblemChange = useCallback((slug: AreaSlug, hasProblem: boolean) => {
    setProblemSlugs((previous) => {
      const had = previous.includes(slug);
      if (had === hasProblem) return previous;
      return hasProblem ? [...previous, slug] : previous.filter((s) => s !== slug);
    });
  }, []);
  const seededRef = useRef(false);

  // The same dirty-file set the status strip's sentence is built from,
  // mapped to areas -- so the strip says WHAT is unsaved and the nav says
  // WHERE, from one source.
  const dirtyFiles = dirtyContentFiles(registry.getEntries());
  const unsavedSlugs = Array.from(
    new Set(dirtyFiles.map((file) => areaForFile(file)?.slug).filter((s): s is AreaSlug => s !== undefined)),
  );

  const isBareUrl = slug === '';
  const isNotFound = !isBareUrl && area === undefined;
  // On a laptop there is no home screen to show: the sidebar is the home,
  // permanently. `replace`, so pressing Back from /edit/manage/menu returns
  // to wherever she came from rather than bouncing through the redirect
  // again.
  const redirectingHome = isBareUrl && wide;
  const showSidebar = wide;
  const showHomeList = !wide && isBareUrl;
  // A real <Link>, never history.back(): "back" does the wrong thing when
  // she arrived at an area from a bookmark, from /edit, or after a reload.
  const showBackControl = !wide && !isBareUrl;

  // The one-time "open this area's first panel" seed, run DURING render
  // rather than in an effect -- and it has to be, because
  // CollapsibleSection reads its own open state in a lazy useState
  // initializer at mount, so a write that happens after the children have
  // mounted arrives too late to open anything.
  //
  // All five areas are seeded together, on her first ever load, because all
  // five mount together. That is not a compromise: opening the first panel
  // of an area she has not visited yet costs nothing, since that panel is
  // inside a hidden container until she does visit it, and the alternative
  // (seeding when an area becomes visible) cannot work at all under
  // mount-and-hide.
  if (!seededRef.current && pendingDraft === null) {
    seededRef.current = true;
    AREAS.forEach((definition) => {
      const first = definition.panelIds[0];
      if (first === undefined || hasSeededArea(definition.slug)) return;
      saveSectionOpen(first, true);
      markAreaSeeded(definition.slug);
    });
  }

  return (
    // Positioned, and stacked above the brick texture `body::before` paints
    // over the whole app (src/index.css). That texture is a PUBLIC-SITE
    // element: it sits behind photography and large display type, where a
    // faint wall reads as warmth. Behind a dense editing form it reads as
    // dirt -- white panels on a grey-brown wash, every border and every field
    // label losing contrast, which is most of why this screen still looked
    // sad after it had been reorganised.
    //
    // Suppressed by stacking rather than by editing that rule, because the
    // rule is correct for the site it was written for. `body::before` is
    // fixed with a zero stack level, so it paints ABOVE the background of any
    // ordinary unpositioned block -- which is exactly why the cream below was
    // being washed out rather than covering it. A positioned wrapper on a
    // higher level puts the whole dashboard in front of it instead, and the
    // public site is untouched.
    <div className="relative z-10 min-h-screen bg-[#f7f5f0] px-4 py-10">
      <div className="mx-auto max-w-5xl">
        {/* The real lockup, not a heading that says "Dashboard". Two lines,
            capped at two by design: the 390px header budget is what makes
            "all five home rows fit one screen without scrolling" achievable
            by design rather than by luck.

            A single <h1> whose accessible name is the whole lockup, rather
            than the wordmark as an image -- an image with an empty alt would
            leave this page with no h1 at all, which is the specific way this
            change fails silently. The e2e spec pins exactly one h1 with a
            non-empty name at both widths. */}
        <h1 className="mb-4 leading-tight">
          <span className="block font-['Parisienne'] text-4xl text-accent">{BRAND_NAME}</span>
          <span className="block font-['Montserrat'] text-xs uppercase tracking-[0.2em] text-gray-500">
            {BRAND_TAGLINE}
          </span>
        </h1>
        {/* On EVERY area, on the phone home and on the not-found screen,
            at both widths -- outside the draft ternary below, because the
            one screen she can be looking at while a draft is pending is
            still a screen that should say what is going on. */}
        <StatusStrip
          dirtyFiles={dirtyFiles}
          stagedCount={Object.keys(stagedFiles.files).length}
          publishPhase={publishPhase}
        />
        {otherSurfaceDraftExists && (
          <p className="mb-4 font-['Montserrat'] text-sm text-gray-500">
            You also have unpublished changes saved on the live-page editor (/edit) — untouched by anything you do
            here.
          </p>
        )}
        {/* THE DRAFT GATE, unchanged from what it was before the shell
            existed, and it is structural rather than layout. If the areas
            mounted before she answered Restore or Discard, each would fetch,
            registerLoaded would register the clean server value, the
            dirty-draft map would come back empty, and PublishBar's own
            persistence effect would reach `clearDraft(...)` -- permanently
            deleting the draft she was about to be offered. AdminApp does not
            pass `holdDraftClear` (only EditMode does); this ternary is the
            protection. If it is ever relaxed, `holdDraftClear` must be
            passed in the same change. */}
        {pendingDraft ? (
          <DraftBanner
            draft={pendingDraft}
            staleStagedCount={staleStagedCount}
            onRestore={onRestore}
            onDiscard={onDiscard}
          />
        ) : (
          <>
            {/* Rendered ALONGSIDE the areas below, never instead of them:
                returning this on its own would unmount all five for the
                length of the redirect, which is the one thing this shell
                exists to prevent. */}
            {redirectingHome && <Navigate replace to={areaPath(AREAS[0].slug)} />}
            <div className="lg:flex lg:items-start lg:gap-8">
              {showSidebar && (
                <AreaNav
                  variant="sidebar"
                  activeSlug={slug}
                  problemSlugs={problemSlugs}
                  unsavedSlugs={unsavedSlugs}
                />
              )}
              <div className="min-w-0 flex-1">
                {showBackControl && (
                  <Link
                    to={MANAGE_BASE}
                    className="mb-4 inline-block font-['Montserrat'] text-sm text-accent underline"
                  >
                    ← All areas
                  </Link>
                )}
                {/* ONE PublishBar, wrapping all five areas and the phone
                    home. Not one per area: it is the single <form> every
                    panel's fields submit into, it owns the one shared
                    registry and the one draft, and five of them would be
                    five publish buttons and five drafts. Being in the shell
                    also means a publish keeps running, and keeps reporting,
                    while she moves between areas. */}
                <PublishBar
                  registry={registry}
                  stagedFiles={stagedFiles}
                  draftSurface="dashboard"
                  onPublishLockChange={onPublishLockChange}
                  onPhaseChange={setPublishPhase}
                  onUnauthenticated={onUnauthenticated}
                >
                  {showHomeList && <AreaHome problemSlugs={problemSlugs} unsavedSlugs={unsavedSlugs} />}
                  {isNotFound && (
                    <AreaNotFound
                      showAreaList={!showSidebar}
                      problemSlugs={problemSlugs}
                      unsavedSlugs={unsavedSlugs}
                    />
                  )}
                  {AREAS.map((definition) => (
                    <AreaContainer
                      key={definition.slug}
                      slug={definition.slug}
                      hidden={definition.slug !== slug}
                      onProblemChange={onProblemChange}
                    >
                      {/* One boundary per AREA, inside the shell, on top of
                          the per-panel boundaries each area already carries.
                          An area whose own module throws leaves the lockup
                          and the nav standing, so she can navigate out of
                          it; an area that took the shell down with it would
                          be unrecoverable without typing a URL. */}
                      <SectionErrorBoundary name={definition.label}>
                        {renderArea(definition.slug, definition.slug === slug, areaProps)}
                      </SectionErrorBoundary>
                    </AreaContainer>
                  ))}
                </PublishBar>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// A switch rather than a lookup table keyed by slug, so adding a sixth area
// to AREAS without giving it a component fails `tsc -b` here on the `never`
// case, instead of rendering an empty container nothing explains. The same
// exhaustiveness shape src/App.tsx already uses for section templates.
function renderArea(slug: AreaSlug, active: boolean, areaProps: AreaProps): React.ReactNode {
  switch (slug) {
    case 'menu':
      return <MenuArea {...areaProps} />;
    case 'pages':
      return (
        <>
          <PagesArea {...areaProps} />
          {/* Phase 2, Task 11 / Phase 3, Task 8: Awards and Experiences
              render here, not as a sixth AreaSlug -- manage/areas.ts's own
              `panelIds` already places the 'awards' and 'experiences'
              PanelIds inside the 'pages' area, and this switch dispatches by
              AreaSlug, one level up. No new case, so the `never`
              exhaustiveness check below is untouched. */}
          <ExperiencesArea {...areaProps} />
          <AwardsArea {...areaProps} />
        </>
      );
    case 'story':
      return <StoryPhotosArea {...areaProps} />;
    case 'details':
      return <DetailsArea {...areaProps} />;
    case 'numbers':
      return <NumbersArea active={active} registry={areaProps.registry} />;
    default: {
      const _exhaustive: never = slug;
      return _exhaustive;
    }
  }
}

export default ManageShell;
