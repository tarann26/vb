import React, { useEffect, useRef, useState } from 'react';
import { useSession } from './session';
import Login from './Login';
import { fetchContent } from './content';
import type { ContentFileName, ContentTypeMap, LoadedContent } from './content';
import RecordList from './RecordList';
import SectionList from './SectionList';
import HoursField from './HoursField';
import GalleryList from './GalleryList';
import StoryForm from './StoryForm';
import SectionErrorBoundary from './SectionErrorBoundary';
import Field from './Field';
import PdfField from './PdfField';
import { ARTICLE_FIELDS, DISH_FIELDS, DRINK_FIELDS, MENU_FIELDS, COPY_FIELDS } from './fields';
import type { FieldsOf } from './fields';
import { replaceAt, useValidation } from './useValidation';
import { problemsFor, arrayIndexOf } from './problems';
import { useStagedFiles, fromStagedPhoto, fromStagedMenuPdf } from './staged';
import type { StagedFile } from './staged';
import { useContentRegistry } from './publish';
import type { ContentRegistry } from './publish';
import PublishBar, { DraftBanner } from './PublishBar';
import { loadDraft, loadDraftStagedCount, clearDraft } from './drafts';
import type { DraftMap } from './drafts';
import type { Article, BespokeSection, Copy, Dish, Drink, Galleries, MenuFile, Section, SiteContent, StoryContent } from '../content/types';
import type { ValidationProblem } from '../content/validate';

// The registry's own `initial` must always be the value GET /api/content
// most recently returned -- never the restored draft -- so a restored file
// correctly reads as dirty (it genuinely IS unpublished) rather than being
// mistaken for the committed baseline itself. Registers the server value
// FIRST (pinning `initial`), then, only if a draft exists for this file,
// re-registers with the draft's own `data` on top of it -- `register`'s own
// contract (publish.ts) is that `initial` is set once, on the first call,
// and never moves after -- so two calls in this exact order is what makes
// both true at once. Returns whichever value the caller's own local state
// should actually hold.
function registerLoaded<K extends ContentFileName>(
  registry: ContentRegistry,
  file: K,
  loaded: LoadedContent<ContentTypeMap[K]>,
  restoreDraft: DraftMap | null,
): ContentTypeMap[K] {
  registry.register(file, loaded.data, loaded.sha);
  const draftEntry = restoreDraft?.[file];
  if (draftEntry === undefined) return loaded.data;
  registry.register(file, draftEntry.data, loaded.sha);
  return draftEntry.data as ContentTypeMap[K];
}

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
  const { files: stagedFiles, stage } = useStagedFiles();
  // publish.ts's own registry: the one place every section's current
  // data/sha is visible at once, which is what makes a single POST
  // /api/publish across all nine content files possible at all -- see that
  // module's own header comment.
  const registry = useContentRegistry();
  const stagedFilesApi = { files: stagedFiles, stage };

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
  return (
    <div className="min-h-screen bg-[#f7f5f0] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 font-['Parisienne'] text-3xl text-[#222]">Via Bianca Dashboard</h1>
        {otherSurfaceDraftExists && (
          <p className="mb-4 font-['Montserrat'] text-sm text-gray-500">
            You also have unpublished changes saved on the live-page editor (/edit) — untouched by anything you do
            here.
          </p>
        )}
        {pendingDraft ? (
          <DraftBanner
            draft={pendingDraft}
            // Minor review finding: `pendingStagedCount` alone is honest
            // about a genuine RELOAD (staged.ts's own in-memory collector,
            // `stagedFiles` here, really is empty then) but wrong for an
            // in-page 401 re-login -- AdminApp never unmounts on that path
            // (this component's own comment above on why the banner is
            // re-offered anyway), so `stagedFiles` is the SAME collector
            // instance she staged into before the 401, still holding every
            // byte. Telling her those photos "will need to be picked
            // again" when they are, right now, still in memory and will
            // publish correctly is the opposite of what's true. Subtracting
            // what is STILL staged from what the draft recorded as staged
            // leaves only what a real reload would have actually lost.
            staleStagedCount={Math.max(0, pendingStagedCount - Object.keys(stagedFiles).length)}
            onRestore={() => {
              setRestoreDraft(pendingDraft);
              setPendingDraft(null);
            }}
            onDiscard={() => {
              clearDraft('dashboard');
              setPendingDraft(null);
            }}
          />
        ) : (
          <PublishBar
            registry={registry}
            stagedFiles={stagedFilesApi}
            draftSurface="dashboard"
            onUnauthenticated={(notice) => {
              // Set BEFORE logOut -- both are plain setState calls in the
              // same synchronous handler, batched into the one re-render
              // that flips `status`, so <Login>'s very first paint already
              // has the notice; there is no intermediate frame where the
              // dashboard is gone and the notice isn't there yet. `notice`
              // itself comes from PublishBar (its own prop comment) -- it
              // already knows whether this 401 landed BEFORE or AFTER the
              // commit succeeded, which is not something this callback can
              // tell on its own.
              setSignOutNotice(notice);
              logOut();
            }}
          >
            {/* Review finding (Task 9): every section below reads a whole
                content file through fetchContent's own unchecked cast
                (src/admin/content.ts's own header comment) with no runtime
                guard -- a malformed galleries.json/story.json/menus.json
                throws mid-render, and main.tsx's ErrorBoundary is the ONLY
                one in this app, wrapping the whole SPA, not just AdminApp.
                Without a boundary HERE, per section, that throw would
                unmount every OTHER section too (Dishes, Drinks, Press,
                Sections, Hours included), and reloading would fail
                identically against the same bad file. One boundary per
                section is what limits one bad file to costing one
                section. */}
            <SectionErrorBoundary name="Dishes">
              <ArraySection<Dish>
                file="dishes.json"
                load={() => fetchContent('dishes.json')}
                heading="Dishes"
                noun="dish"
                fields={DISH_FIELDS}
                itemLabel={(dish) => dish.name || 'Untitled dish'}
                makeBlank={blankDish}
                stage={stage}
                registry={registry}
                restoreDraft={restoreDraft}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Drinks">
              <ArraySection<Drink>
                file="drinks.json"
                load={() => fetchContent('drinks.json')}
                heading="Drinks"
                noun="drink"
                fields={DRINK_FIELDS}
                itemLabel={(drink) => drink.name || 'Untitled drink'}
                makeBlank={blankDrink}
                stage={stage}
                registry={registry}
                restoreDraft={restoreDraft}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Press">
              <ArraySection<Article>
                file="press.json"
                load={() => fetchContent('press.json')}
                heading="Press"
                noun="article"
                fields={ARTICLE_FIELDS}
                itemLabel={(article) => article.title || 'Untitled article'}
                makeBlank={blankArticle}
                stage={stage}
                registry={registry}
                restoreDraft={restoreDraft}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Homepage sections">
              <SectionsSection registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Opening hours">
              <HoursSection registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Menus">
              <MenusSection stage={stage} registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Galleries">
              <GallerySection stage={stage} registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Our Story">
              <StorySection registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Page copy">
              <CopySection registry={registry} restoreDraft={restoreDraft} />
            </SectionErrorBoundary>
          </PublishBar>
        )}
      </div>
    </div>
  );
};

type LoadState<Item> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Item[]; sha: string };

interface ArraySectionProps<Item extends { id: string }> {
  // Which real content file this section edits -- passed to useValidation
  // (so the debounced pass runs validateContent's rules for THIS file, not
  // a generic one) and shown in error text. Typed as the whole
  // ContentFileName union rather than a literal `K` tied to `Item`: doing
  // that properly needs `Item` derived from `ContentTypeMap[K]` through a
  // conditional type, which the compiler cannot carry through a component
  // generic over `Item` alone (confirmed while writing this). Every actual
  // call site below supplies `file` and `load` TOGETHER as a matched pair
  // (e.g. `file="dishes.json"` with `load={() => fetchContent('dishes.json')}`),
  // which is what keeps this honest in practice -- `load`'s own return type
  // is checked against `Item[]` fully, with no cast, at each call site.
  file: ContentFileName;
  load: () => Promise<LoadedContent<Item[]>>;
  heading: string;
  noun: string;
  fields: FieldsOf<Item>;
  itemLabel: (item: Item) => string;
  makeBlank: () => Item;
  // src/admin/staged.ts's shared collector, threaded down to RecordList so a
  // photo staged on any Dish/Drink/Article reaches it -- see that file's own
  // header comment. Every call site above binds this to the SAME instance
  // AdminApp created once; ArraySection's own job is only to add the `file`
  // name to the key RecordList reports (`${file}:${itemId}:${fieldKey}`),
  // finishing the key RecordForm/RecordList's own comments describe as
  // building "up".
  stage: (key: string, file: StagedFile | null) => void;
  // publish.ts's shared content registry (Task 10) -- registered on load and
  // on every commit, so a Publish click sees this file's current data/sha
  // regardless of which OTHER section she edited most recently.
  registry: ContentRegistry;
  // Non-null only in the one render where she just clicked Restore on the
  // unsaved-changes banner (AdminApp's own `restoreDraft` state) -- see
  // registerLoaded's own comment above for exactly how this overrides the
  // freshly-fetched server value without corrupting the registry's own
  // `initial`.
  restoreDraft: DraftMap | null;
}

// The one generic screen every array-shaped, id-keyed content file needs:
// fetch it from GET /api/content (never src/content/index.ts -- see
// src/admin/content.ts's own header comment for why a build-time snapshot
// would silently reintroduce the vanishing-edit bug Task 3 exists to
// close), hold the whole file in memory, validate the whole file on a
// debounce tick (useValidation), and hand RecordList the full, unfiltered
// problem list -- exactly the contract Task 4/5 already built RecordForm
// and RecordList's own banners against.
function ArraySection<Item extends { id: string }>({
  file,
  load,
  heading,
  noun,
  fields,
  itemLabel,
  makeBlank,
  stage,
  registry,
  restoreDraft,
}: ArraySectionProps<Item>) {
  const [state, setState] = useState<LoadState<Item>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(
            registry,
            file,
            loaded as unknown as LoadedContent<ContentTypeMap[ContentFileName]>,
            restoreDraft,
          );
          setState({ status: 'loaded', data: data as unknown as Item[], sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render (each call site passes an
    // inline arrow) -- keying on `file` instead, which is stable for the
    // lifetime of one section, is what keeps this effect from re-fetching
    // on every unrelated re-render. `registry`/`restoreDraft` deliberately
    // excluded too: `registry` is a stable object for the page's whole
    // lifetime (useContentRegistry's own useCallback/useRef), and
    // `restoreDraft` must only ever be consulted at the MOMENT this fetch
    // resolves -- re-running this effect if she clicks Restore AFTER this
    // section has already loaded would re-fetch and re-apply the draft a
    // second time, not simply update in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const data = state.status === 'loaded' ? state.data : undefined;
  // `Item[]` and `ContentTypeMap[file]` are the same real array type for
  // every call site below (see ArraySectionProps.file's own comment) --
  // this cast documents that equality where the compiler cannot verify it
  // through Item, an unrelated type parameter from useValidation's own `K`.
  // Nothing downstream of `useValidation` reads `data` as anything other
  // than what it already is; the cast changes no runtime behaviour.
  const problems = useValidation(file, data as ContentTypeMap[ContentFileName] | undefined);

  if (state.status === 'loading') {
    return (
      <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">
        Loading {heading.toLowerCase()}…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load ${heading.toLowerCase()}: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;

  function commit(next: Item[]) {
    registry.updateData(file, next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">{heading}</h2>
      <RecordList<Item>
        fields={fields}
        items={items}
        // replaceAt, not a hand-rolled reconstruction: `next` already
        // carries everything RecordForm's own onChange preserved (unknown
        // keys included), and replaceAt's whole job is to not undo that.
        // See src/admin/useValidation.ts's own comment and
        // useValidation.test.tsx's round-trip tests for exactly the failure
        // this guards against.
        onChange={(index, next) => commit(replaceAt(items, index, next))}
        onReorder={(ids) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          commit(ids.map((id) => byId.get(id) as Item));
        }}
        onAdd={() => commit([...items, makeBlank()])}
        onRemove={(index) => commit(items.filter((_, i) => i !== index))}
        noun={noun}
        itemLabel={itemLabel}
        problems={problems}
        onStaged={(key, staged) => stage(`${file}:${key}`, fromStagedPhoto(staged))}
        // Review finding (Task 9): without this, Dishes' and Drinks' own
        // first record both render `id="field-image-0"` (RecordForm.tsx's
        // `idFor` had no per-file namespace) -- confirmed to actually
        // misdirect a real click (a `<label for>` in one section focusing
        // the WRONG section's input, since id resolution isn't scoped by
        // container). `file` minus its ".json" is already unique per
        // ArraySection on this page.
        scope={file.replace('.json', '')}
      />
    </section>
  );
}

type SectionsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Section[]; sha: string };

// sections.json's own screen: reorder and toggle only, matching
// SectionList's own D6-driven contract (no Add, no Remove -- see
// SectionList.tsx's own header comment). Deliberately NOT built on the
// generic ArraySection above: that component always renders RecordList's
// Add/Remove buttons unconditionally (RecordList itself has no prop to hide
// either one), which would let this screen build a state assertSections
// refuses -- see SectionList.tsx's own header for why reorder/toggle alone
// cannot.
function SectionsSection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<SectionsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('sections.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'sections.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('sections.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading sections…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load sections: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: Section[]) {
    registry.updateData('sections.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // Plan 7, Task 1: SectionList.tsx only ever shows/permutes the seven
  // bespoke entries (see its own comment) -- `bespokeItems` is that
  // narrowed view, and `templateItems` is everything else in the real
  // sections.json array, carried through UNCHANGED on every write below so
  // this screen can never silently drop a template section it doesn't yet
  // have a UI for. Order between the two groups is not preserved across a
  // write (every bespoke entry is written back before every template one) --
  // harmless today (sections.json has no template entries yet) and a known
  // limitation Task 4 ("the dashboard grows Add") resolves when this screen
  // actually needs to interleave and reorder both kinds together.
  const bespokeItems = items.filter((item): item is BespokeSection => item.kind === 'bespoke');
  const templateItems = items.filter((item) => item.kind === 'template');

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Homepage sections</h2>
      <SectionList
        items={bespokeItems}
        onChange={(index, next) => commit([...replaceAt(bespokeItems, index, next), ...templateItems])}
        onReorder={(ids) => {
          const byId = new Map(bespokeItems.map((item) => [item.id, item]));
          commit([...ids.map((id) => byId.get(id) as BespokeSection), ...templateItems]);
        }}
        problems={problems}
      />
    </section>
  );
}

type HoursLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  // `initial` is the committed snapshot exactly as GET /api/content
  // returned it -- captured once, when the fetch resolves, and never
  // written to again. `data` is the live, editable copy `onChange` updates.
  // Kept as two separate fields (not one, re-derived) so `initial` cannot
  // possibly drift just because `data` does.
  | { status: 'loaded'; data: SiteContent; initial: SiteContent; sha: string };

// The one part of site.json this task's own scope covers. No task in this
// plan builds a full SiteForm for site.json's remaining leaf fields
// (strapline, address, phones, ...) -- see task-6-report.md's own note
// attributing HoursField specifically, not a whole site.json screen, to
// Task 7. Fetches the WHOLE site.json (there is no narrower read) and holds
// it all in memory, but only ever changes the `hours` key on write: `{
// ...data, hours: next }` preserves every other field exactly, the same
// spread-not-reconstruct guarantee `replaceAt`'s own header comment
// describes for a whole-array update.
function HoursSection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<HoursLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('site.json')
      .then((loaded) => {
        if (!cancelled) {
          // registerLoaded's own `data` return is what the REGISTRY (and
          // therefore a publish) sees; `initial` here is a SEPARATE, local
          // concept -- the developer-owned-fields comparison base just
          // below -- which must stay the server's own value regardless of a
          // restored draft (see this section's own comment on `initial`).
          const data = registerLoaded(registry, 'site.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, initial: loaded.data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const initial = state.status === 'loaded' ? state.initial : undefined;
  // `initial`, the untouched committed snapshot (see HoursLoadState's own
  // comment) -- not `data` -- so useValidation's site.json rule can tell a
  // developer-owned field (name, tagline, seo.*) apart from one this screen
  // actually changed (validateSiteDeveloperOwnedFields,
  // src/content/validate.ts). This screen structurally never touches any of
  // those fields (its only write is `{ ...data, hours: next }`), so this is
  // a defensive no-op today, not a fix for anything reachable here -- kept
  // anyway so this screen matches the same `current` contract a future full
  // SiteForm would need, rather than quietly omitting it.
  const problems = useValidation('site.json', data, initial);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading opening hours…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load opening hours: ${state.message}`}
      </p>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Opening hours</h2>
      <HoursField
        value={state.data.hours}
        onChange={(next) => {
          const nextData = { ...state.data, hours: next };
          registry.updateData('site.json', nextData);
          setState({ status: 'loaded', data: nextData, initial: state.initial, sha: state.sha });
        }}
        problems={problems}
      />
    </section>
  );
}

// menus.json's own screen: a plain text label plus PdfField for the file
// itself. MENU_FIELDS.file's own comment (fields.ts) explains why that field
// is never rendered as `kind: 'text'` here -- PdfField needs a `name`
// derived from the CURRENT `file` value, and only this screen (which holds
// the whole record) has that.
//
// Deliberately no Add/Remove/Reorder here, unlike every ArraySection above:
// this task's brief only asks that she be able to REPLACE an existing
// menu's printed PDF, and confirmed directly, nothing on the public site
// reads `menus.json` at all today -- src/components/SignatureMocktails.tsx's
// own menu link is hand-written directly to the food menu PDF's public path,
// not driven by this file -- so there is no live consumer a THIRD or missing
// entry here would need to stay in sync with. A future task that wires the
// public site to this file for real should revisit whether add/remove
// belongs here too.
type MenusLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: MenuFile[]; sha: string };

// worker/upload.ts's `menuAssetPath` commits to `public/menus/<name>.pdf` --
// name-based, not content-addressed, so a REPLACEMENT under the same name
// must derive the exact same name every time, or it lands at a brand new
// path instead of overwriting the one menus.json already points at. The
// real, committed menus.json stores a `file` value rooted at "/menus/" with
// a stem like "food-menu.pdf" -- note the stem ("food-menu") is NOT simply
// the record's own `id` ("food") -- so the name has to come from the CURRENT
// `file` value, not
// `id`. Falls back to `id` only for a menu with no file yet (nothing to
// derive a stem from), matching worker/upload.ts's own MENU_NAME_PATTERN
// shape closely enough that a sane `id` reaches the Worker as a valid name;
// an `id` that doesn't match is refused there, the same "not re-validated
// client-side" precedent PdfField.tsx's own comment already documents for
// `name`.
const MENU_FILE_NAME = /\/([a-z0-9-]{1,64})\.pdf$/;
function menuNameFor(menu: MenuFile): string {
  const match = menu.file.match(MENU_FILE_NAME);
  return match ? match[1] : menu.id;
}

function MenusSection({
  stage,
  registry,
  restoreDraft,
}: {
  stage: (key: string, file: StagedFile | null) => void;
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
}) {
  const [state, setState] = useState<MenusLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('menus.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'menus.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('menus.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading menus…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load menus: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: MenuFile[]) {
    registry.updateData('menus.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // The bare, whole-file message (validateMenus' "the site needs at least
  // one downloadable menu", only reachable if menus.json were hand-edited
  // down to an empty array -- this screen has no Remove button that could
  // produce it itself) plus any `[i].key` naming an index this screen isn't
  // currently rendering -- the identical "nowhere else for this to go"
  // reasoning RecordList's own unclaimedProblems documents.
  const banner = problems.filter((p) => {
    if (items.length === 0) return true;
    const index = arrayIndexOf(p.field);
    return index !== undefined && (index < 0 || index >= items.length);
  });

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Menus</h2>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with menus no longer shown"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      <ul>
        {items.map((menu, index) => (
          <li key={menu.id} className="mb-6 rounded border border-gray-200 p-4">
            <Field
              id={`menu-${index}-id`}
              spec={MENU_FIELDS.id}
              value={menu.id}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, id: next }))}
              problems={problemsFor(problems, index, 'id')}
            />
            <Field
              id={`menu-${index}-label`}
              spec={MENU_FIELDS.label}
              value={menu.label}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, label: next }))}
              problems={problemsFor(problems, index, 'label')}
            />
            <PdfField
              id={`menu-${index}-file`}
              label="PDF file"
              name={menuNameFor(menu)}
              value={menu.file}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, file: next ?? '' }))}
              onStaged={(staged) => stage(`menus.json:${menu.id}:file`, fromStagedMenuPdf(staged))}
              problems={problemsFor(problems, index, 'file')}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// galleries.json's own screen -- fetches the whole file (atmosphere,
// ourStory, heroCollage all live in the one file) and hands it whole to
// GalleryList.tsx, the same fetch-whole-hold-whole shape ArraySection/
// HoursSection above already use.
type GalleriesLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Galleries; sha: string };

function GallerySection({
  stage,
  registry,
  restoreDraft,
}: {
  stage: (key: string, file: StagedFile | null) => void;
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
}) {
  const [state, setState] = useState<GalleriesLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('galleries.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'galleries.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('galleries.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading galleries…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load galleries: ${state.message}`}
      </p>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Galleries</h2>
      <GalleryList
        value={state.data}
        onChange={(next) => {
          registry.updateData('galleries.json', next);
          setState({ status: 'loaded', data: next, sha: state.sha });
        }}
        problems={problems}
        stage={stage}
      />
    </section>
  );
}

// story.json's own screen -- see StoryForm.tsx's own header comment for why
// the paragraph list is a bespoke component rather than routed through
// FieldsOf/RecordForm.
type StoryLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: StoryContent; sha: string };

function StorySection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<StoryLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('story.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'story.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('story.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading the story…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load the story: ${state.message}`}
      </p>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Our Story</h2>
      <StoryForm
        value={state.data}
        onChange={(next) => {
          registry.updateData('story.json', next);
          setState({ status: 'loaded', data: next, sha: state.sha });
        }}
        problems={problems}
      />
    </section>
  );
}

// copy.json's own screen -- every leaf COPY_FIELDS (fields.ts) describes,
// grouped by the section of the site each one belongs to. Human names, not
// the raw top-level Copy key -- the same "her vocabulary, not the type's own
// property names" reasoning SectionList.tsx's own SECTION_NAMES documents.
// Deliberately none of these collides with another `role="heading"` element
// already on the page -- confirmed directly (an earlier version used the
// plain "Drinks"/"Press", which collided with the Drinks/Press ArraySection
// headings above and made `getByRole('heading', { name: 'Drinks' })`
// ambiguous). "Atmosphere gallery heading" and "Menu heading" avoid the
// identical collision with GalleryList.tsx's own "Atmosphere" <h3> and any
// future "Menu" heading.
const COPY_SECTION_HEADINGS: Record<string, string> = {
  nav: 'Navigation',
  hero: 'Hero',
  atmosphere: 'Atmosphere gallery heading',
  food: 'Menu heading',
  drinks: 'Drinks copy',
  press: 'Press copy',
  visit: 'Visit',
  footer: 'Footer',
  blogsPage: 'Stories page',
  notFound: 'Not-found page',
};

// Grouped once, at module load, not on every render -- COPY_FIELDS is an
// unchanging, hand-written literal (fields.ts), so the grouping can never change
// between renders either. `Object.keys` preserves the insertion order
// COPY_FIELDS was written in, which is already grouped by section there --
// this just reads that order back out rather than re-deriving or
// alphabetizing it.
const COPY_GROUPS: { section: string; heading: string; keys: (keyof typeof COPY_FIELDS)[] }[] = (() => {
  const order: string[] = [];
  const groups: Record<string, (keyof typeof COPY_FIELDS)[]> = {};
  (Object.keys(COPY_FIELDS) as (keyof typeof COPY_FIELDS)[]).forEach((key) => {
    const section = key.split('.')[0];
    if (!groups[section]) {
      groups[section] = [];
      order.push(section);
    }
    groups[section].push(key);
  });
  return order.map((section) => ({ section, heading: COPY_SECTION_HEADINGS[section] ?? section, keys: groups[section] }));
})();

// Reads one dotted leaf back out of a fetched Copy object WITHOUT assuming
// its shape -- src/admin/content.ts's own header comment warns that
// `fetchContent`'s `JSON.parse(...) as ContentTypeMap[K]` is an unchecked
// cast, and Task 7's own review found the first crash that unchecked cast
// caused (an unrecognised section id took down the entire admin page, not
// just its own section -- see SectionList.tsx's own comment on the fix).
// copy.json reaching this screen with a section genuinely missing (a
// hand-edited file, a future Copy shape this build predates) must show an
// empty field and let the debounced validator explain what's wrong, not
// throw reading a property off `undefined` and take the whole page down
// with it.
function leafValue(data: Copy, path: string): string {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : '';
}

// The write side of `leafValue` above -- every COPY_FIELDS key is exactly
// two segments (`section.key`; confirmed directly, none of the 34 keys in
// fields.ts's own COPY_FIELDS has a third dot), so this only ever has to
// rebuild one level of nesting. `{ ...sectionValue, [key]: value }`, never a
// reconstruction from a named list of known keys, is what preserves every
// OTHER key on both the top-level object and the target section -- the same
// "never reconstruct from known fields" guarantee useValidation.ts's own
// `replaceAt` documents for a whole-array update. Refuses to guess at a
// shape for a section that arrived malformed (returns `data` unchanged)
// rather than overwriting whatever WAS there with a brand new, mostly-empty
// object -- the write-side twin of `leafValue`'s own defensive fallback.
function withLeaf(data: Copy, path: string, value: string): Copy {
  const [section, key] = path.split('.');
  const sectionValue = (data as unknown as Record<string, unknown>)[section];
  if (sectionValue === null || typeof sectionValue !== 'object') return data;
  return {
    ...data,
    [section]: { ...(sectionValue as Record<string, unknown>), [key]: value },
  } as Copy;
}

// U+00A0 (a non-breaking space) renders IDENTICALLY to an ordinary space in
// a browser -- that is the entire reason validateFollowLabelSpacing
// (src/content/validate.ts) exists as a rule at all, and exactly why an
// owner editing this one field by eye or by copy-paste can silently replace
// it with a regular space with nothing on screen looking any different.
// This preview line is the fix: NBSP_MARKER is a visible stand-in character,
// shown only in this read-only preview underneath the real, editable field
// -- the actual input keeps the real character, untouched, so typing in it
// still saves whatever she actually typed.
// Written as the explicit \u00a0 escape, not a literal non-breaking-space
// character sitting invisibly in this source file -- the identical reasoning
// validateFollowLabelSpacing's own comment (src/content/validate.ts) gives
// for the same choice, so the character this preview depends on stays
// legible in a diff instead of looking like an ordinary space.
const NBSP = '\u00a0';
const NBSP_MARKER = '\u2423'; // OPEN BOX -- a common convention for "a space is here"
function withVisibleNbsp(text: string): string {
  return text.split(NBSP).join(NBSP_MARKER);
}

type CopyLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Copy; sha: string };

function CopySection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<CopyLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('copy.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'copy.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('copy.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading page copy…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load page copy: ${state.message}`}
      </p>
    );
  }

  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: Copy) {
    registry.updateData('copy.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // Every leaf problem actually rendered below, tracked by reference so the
  // banner is simply "whatever's left over" -- the identical guarantee
  // RecordForm.tsx's own `matched` Set documents (a problem must never be
  // counted in both places, or in neither). Catches assertCopy's own
  // whole-file `''` failures and drinks.intro's retired-phrase check, which
  // COPY_FIELDS has no per-leaf entry for `''` to ever match.
  const matched = new Set<ValidationProblem>();
  function leafProblems(key: string): ValidationProblem[] {
    const found = problemsFor(problems, undefined, key);
    found.forEach((p) => matched.add(p));
    return found;
  }
  const rows = COPY_GROUPS.map((group) => ({
    ...group,
    fields: group.keys.map((key) => ({ key, problems: leafProblems(key) })),
  }));
  const banner = problems.filter((p) => !matched.has(p));

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Page copy</h2>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with page copy"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.map(({ section, heading, fields }) => (
        <div key={section} className="mb-6">
          <h3 className="mb-3 font-['Montserrat'] text-base text-[#222]">{heading}</h3>
          {fields.map(({ key, problems: fieldProblems }) => (
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
        </div>
      ))}
    </section>
  );
}

// Blank starting points for "Add a dish/drink/article" -- every required
// field present and empty/neutral, so the freshly-added record renders
// (RecordForm has no notion of a field that doesn't exist yet) and
// immediately shows her, via the same debounced validation as everything
// else, exactly what it still needs.
function blankDish(): Dish {
  return { id: crypto.randomUUID(), name: '', description: '', image: '', tags: [] };
}

function blankDrink(): Drink {
  return { id: crypto.randomUUID(), name: '', description: '', category: 'mocktail', image: null };
}

function blankArticle(): Article {
  return { id: crypto.randomUUID(), title: '', publication: '', date: '', excerpt: '', url: null, image: '' };
}

export default AdminApp;
