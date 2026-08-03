import React, { useEffect, useState } from 'react';
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
import type { Article, Copy, Dish, Drink, Galleries, MenuFile, Section, SiteContent, StoryContent } from '../content/types';
import type { ValidationProblem } from '../content/validate';

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
  const { status, logIn } = useSession();
  // The one collector every screen below that renders a PhotoField or a
  // PdfField shares -- see src/admin/staged.ts's own header comment for why
  // ONE shared instance, not one per section, is what makes "she stages
  // photos on three different dishes and a drink, then swaps a menu PDF,
  // and all of it reaches the same eventual publish" true. Called
  // unconditionally, before either early return below, the same as
  // `useSession()` already is -- React's own rule that hooks can't run
  // conditionally, not a new constraint this task introduces.
  const { files: stagedFiles, stage } = useStagedFiles();

  if (status === 'checking') {
    // src/App.tsx's <Suspense fallback={null}> already covers the moment
    // this chunk itself is still downloading; this covers the moment right
    // after it has loaded but before GET /api/wa (the session probe) has
    // answered. Rendering nothing here too avoids a login-form flash for
    // someone who is, in fact, already logged in.
    return null;
  }

  if (status === 'out') {
    return <Login onLogin={logIn} />;
  }

  // status === 'in'.
  return (
    <div className="min-h-screen bg-[#f7f5f0] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 font-['Parisienne'] text-3xl text-[#222]">Via Bianca</h1>
        {/* Publish (Task 10) doesn't exist yet -- nothing typed below this
            line leaves the browser. Said plainly, not left to be discovered
            the hard way by an owner who assumes a form that validates as
            she types must also be one that saves. The staged-file count
            keeps that honest in the other direction too: a photo she picks
            genuinely uploads (PhotoField's own "Uploaded" status already
            says so) and genuinely sits in this collector, waiting -- this
            is what tells her that much is real, without overclaiming that
            publishing itself works yet. */}
        <p className="mb-8 font-['Montserrat'] text-sm text-gray-500">
          {stagedFileCountMessage(Object.keys(stagedFiles).length)}
        </p>
        {/* Review finding (Task 9): every section below reads a whole
            content file through fetchContent's own unchecked cast
            (src/admin/content.ts's own header comment) with no runtime
            guard -- a malformed galleries.json/story.json/menus.json throws
            mid-render, and main.tsx's ErrorBoundary is the ONLY one in this
            app, wrapping the whole SPA, not just AdminApp. Without a
            boundary HERE, per section, that throw would unmount every
            OTHER section too (Dishes, Drinks, Press, Sections, Hours
            included), and reloading would fail identically against the
            same bad file. One boundary per section is what limits one bad
            file to costing one section. */}
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
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Homepage sections">
          <SectionsSection />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Opening hours">
          <HoursSection />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Menus">
          <MenusSection stage={stage} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Galleries">
          <GallerySection stage={stage} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Our Story">
          <StorySection />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="Page copy">
          <CopySection />
        </SectionErrorBoundary>
      </div>
    </div>
  );
};

// Zero staged files is the common case (nothing picked yet, or a session
// that never touches a photo/PDF at all) and reads better as the plain,
// unconditional first sentence than as "0 files staged."
function stagedFileCountMessage(count: number): string {
  const base = "Publishing isn't built yet — nothing you change below is saved anywhere.";
  if (count === 0) return base;
  const noun = count === 1 ? 'file is' : 'files are';
  return `${base} ${count} ${noun} staged and waiting for it.`;
}

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
}: ArraySectionProps<Item>) {
  const [state, setState] = useState<LoadState<Item>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
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
    // on every unrelated re-render.
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

  function commit(next: Item[]) {
    setState({ status: 'loaded', data: next, sha: (state as { status: 'loaded'; sha: string }).sha });
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
function SectionsSection() {
  const [state, setState] = useState<SectionsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('sections.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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
  function commit(next: Section[]) {
    setState({ status: 'loaded', data: next, sha: (state as { status: 'loaded'; sha: string }).sha });
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Homepage sections</h2>
      <SectionList
        items={items}
        onChange={(index, next) => commit(replaceAt(items, index, next))}
        onReorder={(ids) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          commit(ids.map((id) => byId.get(id) as Section));
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
function HoursSection() {
  const [state, setState] = useState<HoursLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('site.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, initial: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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
        onChange={(next) =>
          setState({ status: 'loaded', data: { ...state.data, hours: next }, initial: state.initial, sha: state.sha })
        }
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

function MenusSection({ stage }: { stage: (key: string, file: StagedFile | null) => void }) {
  const [state, setState] = useState<MenusLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('menus.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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
  function commit(next: MenuFile[]) {
    setState({ status: 'loaded', data: next, sha: (state as { status: 'loaded'; sha: string }).sha });
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

function GallerySection({ stage }: { stage: (key: string, file: StagedFile | null) => void }) {
  const [state, setState] = useState<GalleriesLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('galleries.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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
        onChange={(next) => setState({ status: 'loaded', data: next, sha: state.sha })}
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

function StorySection() {
  const [state, setState] = useState<StoryLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('story.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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
        onChange={(next) => setState({ status: 'loaded', data: next, sha: state.sha })}
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

function CopySection() {
  const [state, setState] = useState<CopyLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('copy.json')
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
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

  function commit(next: Copy) {
    setState({ status: 'loaded', data: next, sha: (state as { status: 'loaded'; sha: string }).sha });
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
