// Plan 5 Task 2: `/edit` renders the REAL homepage -- the same public
// components HomePage (src/App.tsx) mounts at `/` -- wrapped in a provider
// holding live content fetched from the Worker, not the build-time
// snapshot. No editing affordances yet (Tasks 3/4); what this file adds is:
// live content, a login overlay that survives a mid-session 401 without
// unmounting anything, and a capture-phase click guard so the page's own
// links (WhatsApp, a PDF download, Google Maps, the in-app "View all"
// navigate) cannot fire while she is just trying to read the page.
//
// Deliberately does NOT import src/App.tsx for HomePage/SECTION_COMPONENTS:
// App.tsx only ever references admin code through React.lazy (a hard
// invariant src/test/bundle.test.ts enforces), and while a *dynamic* import
// back out of a *lazily loaded* module is runtime-safe (App.tsx has finished
// evaluating by the time this chunk loads), duplicating the small
// SectionId -> component map here keeps this file's dependency graph
// independent of App.tsx entirely, which is simpler to reason about than
// relying on that ordering. The seven components are the same ones
// SECTION_COMPONENTS (App.tsx) uses, imported the same way.
import React, { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import Hero from '../components/Hero';
import OurStory from '../components/OurStory';
import PlaceGallery from '../components/PlaceGallery';
import FoodGallery from '../components/FoodGallery';
import Drinks from '../components/Drinks';
import BlogTeaser from '../components/BlogTeaser';
import VisitUs from '../components/VisitUs';
import Footer from '../components/Footer';
import SeoHead from '../components/SeoHead';
import { useSession } from './session';
import Login from './Login';
import { CONTENT_FILES, fetchContent } from './content';
import type { ContentFileName, ContentTypeMap } from './content';
import { useContentRegistry } from './publish';
import type { ContentEntries, ContentRegistry } from './publish';
import SectionErrorBoundary from './SectionErrorBoundary';
import EditableText from './EditableText';
import EditableImage from './EditableImage';
import { setCopyText } from './editable-paths';
import { useStagedFiles, fromStagedPhoto } from './staged';
import type { StagedFile } from './staged';
import type { UploadCategory } from '../shared/upload-categories';
// '../content/context', never '../content/ContentContext' or '../content' --
// src/admin/__tests__/content.test.ts only whitelists types/validate/guards/
// publish/context as safe src/content/ imports for src/admin/ (none of the
// five import any JSON, and none has a transitive path to
// src/content/index.ts, the build-time snapshot); ContentContext.ts imports
// that snapshot to build its defaultBundle, so it is NOT on that list.
// ContentProvider lives in ./context, not ./types (post-review Fix 5 -- see
// that module's own comment): ./types is type-only and erases entirely at
// compile time, which is no longer true of anything holding a real
// `createContext` call.
import { ContentProvider } from '../content/context';
import type {
  ContentBundle,
  SectionId,
  Section,
  SiteContent,
  Galleries,
  StoryContent,
  Copy,
} from '../content/types';

const SECTION_COMPONENTS: Record<SectionId, () => React.ReactNode> = {
  hero: () => <Hero />,
  ourStory: () => <OurStory />,
  atmosphere: () => <PlaceGallery />,
  food: () => <FoodGallery />,
  drinks: () => <Drinks />,
  press: () => <BlogTeaser />,
  visit: () => <VisitUs />,
};

const SECTION_LABELS: Record<SectionId, string> = {
  hero: 'Hero',
  ourStory: 'Our Story',
  atmosphere: 'Atmosphere gallery',
  food: 'Menu',
  drinks: 'Drinks',
  press: 'Press',
  visit: 'Visit',
};

// Post-review Fix 2 (Important): a real, separate component, not an inline
// `.filter().map()` sitting directly in EditMode's own JSX. `bundle.sections`
// is `fetchContent`'s unchecked `JSON.parse(...) as` cast (content.ts's own
// header comment names this exact risk) with no runtime shape check --
// `sections.json` parsing to `{}` instead of an array makes `.filter` throw
// "bundle.sections.filter is not a function". Where that throw happens is
// what determines whether it costs one section or the whole page: a plain
// expression written inline inside EditMode's `return` still evaluates as
// part of EditMode's OWN render function body (JSX children are built
// before React ever sees the element tree, regardless of how they're
// visually nested in the wrapping `<SectionErrorBoundary>` below), so it
// throws OUTSIDE every boundary and would unmount the whole page -- the
// exact defect this fix closes. A genuinely separate component's OWN
// function body is what React calls while rendering a CHILD of whatever
// boundary wraps it, which is what actually makes the boundary able to
// catch it. Confirmed directly: reverting this to an inline expression
// reproduces `document.body.textContent === ''` against a real malformed
// sections.json (src/admin/__tests__/EditMode.test.tsx's own test for it).
const DynamicSections: React.FC<{ sections: Section[] }> = ({ sections }) => (
  <>
    {sections
      .filter((section) => section.enabled)
      .map((section) => (
        <SectionErrorBoundary key={section.id} name={SECTION_LABELS[section.id]}>
          {SECTION_COMPONENTS[section.id]()}
        </SectionErrorBoundary>
      ))}
  </>
);

// Neutral, empty starting values -- NOT the real build-time snapshot (this
// file may not import that, see above), just structurally-valid content so
// every public component can render safely (no `undefined` reads) for
// whichever of the nine files hasn't finished loading yet. Confirmed against
// every RENDERED_FILES component: an empty array/string never crashes any of
// them (Footer.tsx's `site.hours.map(...)` and SeoHead's
// `site.hours.map(toSchemaOpeningHours)` render nothing for `hours: []`;
// `galleries.*` and `dishes`/`drinks`/`press`/`menus` empty arrays render
// nothing; `copy.*` empty strings render as empty text, never as a crash).
const EMPTY_SITE: SiteContent = {
  name: '',
  tagline: '',
  strapline: '',
  address: { street: '', locality: '', postalCode: '', country: '' },
  phones: [],
  whatsapp: { number: '', prefilledMessage: '' },
  socials: { instagram: '', linkedin: null },
  hours: [],
  seo: { title: '', description: '', keywords: '', ogImage: '', url: '', locale: '' },
  copyrightYear: 0,
};

const EMPTY_GALLERIES: Galleries = { atmosphere: [], ourStory: [], heroCollage: [] };

const EMPTY_STORY: StoryContent = { heading: '', paragraphs: [] };

const EMPTY_COPY: Copy = {
  nav: { wordmark: '', links: [], instagramLabel: '', menuLabel: '' },
  hero: { logoName: '', logoTagline: '', reservationsLabel: '', reserveButton: '' },
  atmosphere: { heading: '' },
  food: { heading: '' },
  drinks: { heading: '', intro: '', mocktails: '', cocktails: '', wine: '' },
  press: { heading: '', intro: '', readArticle: '', viewAll: '' },
  visit: { heading: '', navigateButton: '', mapTitle: '' },
  footer: {
    hoursHeading: '',
    followLabel: '',
    reservationsLabel: '',
    rightsSuffix: '',
    instagramLabel: '',
    linkedinLabel: '',
  },
  blogsPage: { title: '', subtitle: '', heading: '', intro: '', back: '', previous: '', next: '' },
  notFound: { heading: '', back: '' },
};

// Reads one file's fetched data back out of the registry, typed, falling
// back to its own empty default when that file hasn't loaded (or failed to
// load) yet. `entry.data` is `unknown` (ContentEntry's own contract,
// publish.ts) -- a single assertion out of `unknown`, not the `as unknown as`
// double-hop the plan's own definition of done rules out; that phrase refers
// to the rejected value-substitution design (Copy's leaves cast to
// ReactNode), a different thing entirely from parsing dynamic content at a
// boundary, which src/admin/content.ts's own `JSON.parse(...) as` already
// does the same way.
function pick<K extends ContentFileName>(
  entries: ContentEntries,
  file: K,
  fallback: ContentTypeMap[K],
): ContentTypeMap[K] {
  const entry = entries[file];
  return entry ? (entry.data as ContentTypeMap[K]) : fallback;
}

// Task 4: images become editable in place. Every one of the seven real
// `content.renderImage` call sites Task 1 wired (Hero.tsx's heroCollage,
// OurStory.tsx, PlaceGallery.tsx, FoodGallery.tsx, Drinks.tsx,
// BlogTeaser.tsx and BlogsPage.tsx -- the last two sharing one path shape)
// resolves to exactly one of these two regexes. A path matching neither is
// not an image edit mode knows how to commit -- renderImage below falls
// back to the identity default for it, the same posture EditableText takes
// toward a path with no COPY_FIELDS entry.
//
// Deliberately keyed on the renderImage PATH, not on `useRowIds`'s
// object-identity WeakMap the way GalleryList.tsx (the DASHBOARD's own
// gallery editor) keys its staged uploads. That reuse was the plan's own
// suggestion, and it solves a real bug -- but a DIFFERENT one than exists
// here. GalleryList.tsx needs object identity because ITS screen supports
// add/remove/reorder: an array INDEX can name a different row after she
// moves one, and `item.src` (the obvious alternative) is rewritten by
// PhotoField's own onChange the instant a stage succeeds, orphaning a
// second pick on the SAME row (that component's own comment documents
// both failures in detail). Edit mode offers neither add/remove/reorder
// for a gallery -- EditableImage only ever replaces a photo IN PLACE, so
// the array never changes length or order during a session, and this
// path string (e.g. 'galleries.heroCollage.7') stays a stable name for the
// same slot for as long as the page is open. And the SPECIFIC collision
// the plan's own brief names -- eight real photos shared between two
// lists at once, verified directly against the committed galleries.json:
// five between atmosphere and heroCollage (/atmosphere/dining.webp,
// ambience.webp, "ceiling decor.webp", "front mirror.webp", room.webp) and
// three between ourStory and heroCollage (/our_story/cut.webp, oven.webp,
// stuff.webp; atmosphere and ourStory share nothing) -- is exactly what a
// PATH key already can't collide on: 'galleries.atmosphere.3' and
// 'galleries.heroCollage.7' are different strings even on the render where
// both resolve to the identical `src`, so staging one can never evict the
// other's own entry in `staged.files` below. Proven directly, not just
// reasoned about -- see this file's own tests for both halves (restaging
// one row leaves one staged file; the two paths sharing dining.webp leave
// two).
const GALLERY_LIST_CATEGORY: Record<'atmosphere' | 'ourStory' | 'heroCollage', UploadCategory> = {
  atmosphere: 'atmosphere',
  ourStory: 'our_story',
  heroCollage: 'hero',
};

const ITEM_CATEGORY: Record<'dishes' | 'drinks' | 'press', UploadCategory> = {
  dishes: 'food',
  drinks: 'mocktails',
  press: 'press',
};

type ImageTarget =
  | { kind: 'gallery'; list: 'atmosphere' | 'ourStory' | 'heroCollage'; index: number; category: UploadCategory }
  | { kind: 'item'; collection: 'dishes' | 'drinks' | 'press'; id: string; category: UploadCategory };

function resolveImageTarget(path: string): ImageTarget | null {
  const gallery = path.match(/^galleries\.(atmosphere|ourStory|heroCollage)\.(\d+)$/);
  if (gallery) {
    const list = gallery[1] as 'atmosphere' | 'ourStory' | 'heroCollage';
    return { kind: 'gallery', list, index: Number(gallery[2]), category: GALLERY_LIST_CATEGORY[list] };
  }
  const item = path.match(/^(dishes|drinks|press)\.([^.]+)\.image$/);
  if (item) {
    const collection = item[1] as 'dishes' | 'drinks' | 'press';
    return { kind: 'item', collection, id: item[2], category: ITEM_CATEGORY[collection] };
  }
  return null;
}

// Rewrites exactly the one array entry `target` names, leaving every
// sibling entry -- and the other two galleries.json lists -- at its prior
// object identity. Mirrors setCopyText's own "spread the touched level
// only" contract (editable-paths.ts).
function setGallerySrc(galleries: Galleries, list: 'atmosphere' | 'ourStory' | 'heroCollage', index: number, src: string): Galleries {
  return {
    ...galleries,
    [list]: galleries[list].map((entry, i) => (i === index ? { ...entry, src } : entry)),
  };
}

// dishes/drinks/press key on `.id`, never on array position -- Task 1's own
// note that these three are UNAFFECTED by the positional-path caveat
// gallery entries carry. A `find`-by-id that matches nothing (the record
// was removed in a different tab, say) is a safe no-op, the same
// "unreachable state, not a reason to invent one" posture ContentRegistry's
// own `updateData` already takes.
function setItemImage<T extends { id: string; image: string | null }>(items: T[], id: string, contentPath: string): T[] {
  return items.map((entry) => (entry.id === id ? { ...entry, image: contentPath } : entry));
}

// Task 3: text becomes editable in place. `registry` is passed in (not
// closed over at module scope) because `commitText` below needs the exact
// `copy` this render is showing -- every one of the 31 EditableText
// instances on the page shares this one closure, and each must write its
// own leaf back against the SAME snapshot of `copy` every sibling saw,
// never a stale one captured on an earlier render.
//
// Exported (not module-private) purely so
// src/admin/__tests__/EditMode.test.tsx can pin Task 3 review Finding C4
// directly: `commitText` below must call `registry.updateData`, never
// `registry.register` (see ContentRegistry's own comment on why the second
// overwrites a sha `markPublished` already refreshed and produces a false
// conflict on the file's SECOND publish in a session). Every OTHER
// EditMode.tsx behaviour stays proven black-box, through the rendered page,
// the same way this file's other tests already do -- this is the one seam
// that needs a real ContentRegistry double to observe, because Task 3 alone
// has no way to make `register` and `updateData` produce a different
// on-screen result to assert against (that only starts being true once
// Task 5 wires up `markPublished`, i.e. exactly when nothing would be
// watching if this weren't pinned first).
//
// This is the one export from this file that isn't the default component,
// which is exactly what `react-refresh/only-export-components` warns about
// (ContentContext.ts's own header comment hits the identical rule, for the
// identical reason, and works around it by being a plain .ts module with no
// component of its own at all -- not an option here, since this file's
// default export genuinely is a component). Disabled deliberately, not
// silenced blind: `buildBundle` is a pure function with no React state or
// hooks of its own, so it has nothing for Fast Refresh to lose track of.
// eslint-disable-next-line react-refresh/only-export-components
export function buildBundle(
  entries: ContentEntries,
  registry: ContentRegistry,
  stage: (key: string, file: StagedFile | null) => void,
): ContentBundle {
  const copy = pick(entries, 'copy.json', EMPTY_COPY);
  const galleries = pick(entries, 'galleries.json', EMPTY_GALLERIES);
  const dishes = pick(entries, 'dishes.json', []);
  const drinks = pick(entries, 'drinks.json', []);
  const press = pick(entries, 'press.json', []);

  // Undefined until copy.json has actually loaded (registered at least
  // once) -- committing an edit before then would call registry.updateData
  // against a file with no entry yet, which is a documented no-op (see that
  // function's own comment), silently discarding whatever she just typed
  // into a still-blank heading. Rather than risk that narrow, real window
  // (the "Loading live content…" banner is up for exactly this long), a
  // leaf only becomes contentEditable once its own file has a registry
  // entry to write back into; until then it renders as plain, un-editable
  // text -- identical to what she would see if no provider were mounted at
  // all.
  const copyLoaded = entries['copy.json'] !== undefined;
  // Same reasoning as `copyLoaded`, one per file an image edit can land
  // in -- committing a replacement before ITS OWN file has a registry
  // entry would call registry.updateData against nothing, a documented
  // no-op that would silently discard the upload she just made.
  const galleriesLoaded = entries['galleries.json'] !== undefined;
  const dishesLoaded = entries['dishes.json'] !== undefined;
  const drinksLoaded = entries['drinks.json'] !== undefined;
  const pressLoaded = entries['press.json'] !== undefined;

  function commitText(path: string, next: string) {
    registry.updateData('copy.json', setCopyText(copy, path, next));
  }

  // Task 4, Step 4: the upload path is unchanged (POST /api/upload?stage=1
  // returns `{path, contentPath}` without committing; the bytes travel with
  // the eventual publish, same as PhotoField's own dashboard fields) -- this
  // is only ever called with a `contentPath` `stagePhoto` has already
  // returned, so no target here ever needs to invent or validate one.
  function commitImage(path: string, contentPath: string) {
    const target = resolveImageTarget(path);
    if (!target) return;
    if (target.kind === 'gallery') {
      registry.updateData('galleries.json', setGallerySrc(galleries, target.list, target.index, contentPath));
      return;
    }
    if (target.collection === 'dishes') registry.updateData('dishes.json', setItemImage(dishes, target.id, contentPath));
    else if (target.collection === 'drinks') registry.updateData('drinks.json', setItemImage(drinks, target.id, contentPath));
    else registry.updateData('press.json', setItemImage(press, target.id, contentPath));
  }

  // Which registry file `target` names, and whether that file has loaded
  // yet -- the same "no affordance before there's somewhere real to write
  // it" gate `copyLoaded` applies to text.
  function targetLoaded(target: ImageTarget): boolean {
    if (target.kind === 'gallery') return galleriesLoaded;
    if (target.collection === 'dishes') return dishesLoaded;
    if (target.collection === 'drinks') return drinksLoaded;
    return pressLoaded;
  }

  return {
    site: pick(entries, 'site.json', EMPTY_SITE),
    galleries,
    dishes,
    drinks,
    press,
    story: pick(entries, 'story.json', EMPTY_STORY),
    menus: pick(entries, 'menus.json', []),
    copy,
    sections: pick(entries, 'sections.json', []),
    renderText: (path, value) =>
      copyLoaded ? <EditableText path={path} value={value} onCommit={commitText} /> : value,
    // Task 4: images become editable in place, exactly like renderText
    // above -- a path this file knows how to resolve, whose own content
    // file has already loaded, gets the real editing affordance; anything
    // else (a path with no real target, or one whose file hasn't loaded
    // yet) falls back to the identity default, matching what she would see
    // with no provider mounted at all.
    renderImage: (path, props) => {
      const target = resolveImageTarget(path);
      if (!target || !targetLoaded(target)) return <img {...props} />;
      // The stage key's own file prefix names WHICH content file this
      // upload's `contentPath` will be written into (galleries.json for a
      // gallery target, dishes/drinks/press.json for an item one) -- purely
      // documentary (the PATH suffix alone is already globally unique
      // across all seven renderImage call sites), matching the shape
      // GalleryList.tsx's own stage keys already use
      // (`${file}:${listName}:${index}:src`).
      const stageFile = target.kind === 'gallery' ? 'galleries.json' : `${target.collection}.json`;
      return (
        <EditableImage
          path={path}
          category={target.category}
          onStaged={(staged) => stage(`${stageFile}:${path}`, fromStagedPhoto(staged))}
          onReplace={(contentPath) => commitImage(path, contentPath)}
          {...props}
        />
      );
    },
  };
}

// content.ts's fetchContent throws a plain Error, not a status-carrying
// type (see that module's own header comment on why every error it raises
// is already a plain sentence, not a structured one) -- `(status 401)` is
// the literal, tested substring its message ends with on any non-OK
// response (src/admin/__tests__/content.test.ts pins this exact wording via
// `.rejects.toThrow(/401/)`), so matching it here is the only way to tell
// "the session just expired" apart from "this file is genuinely malformed"
// without changing that module's return type for every other caller.
function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && /\(status 401\)/.test(error.message);
}

// Post-review Fix 1: the old wording ("the live page will still be showing
// exactly what it was") is a promise this component cannot always keep -- a
// file that hadn't loaded yet when the 401 hit (or every file, if the
// session was already dead before the first fetch ever went out) is NOT
// showing what it was; it is still blank, and logging back in is what makes
// it start loading for the first time. What IS always true, and is the
// actual guarantee the per-file registry guard below provides: nothing that
// had already loaded is ever re-fetched or overwritten, and nothing that
// hadn't gets left blank forever.
const SIGN_OUT_NOTICE =
  "You've been signed out. Log in and whatever has already loaded will stay exactly as it was — whatever hasn't will load now.";

// Default export, deliberately: React.lazy (src/App.tsx) requires one.
const EditMode: React.FC = () => {
  const { status, logIn, logOut } = useSession();
  const registry = useContentRegistry();
  // Task 4: the same shared collector staged.ts's own header comment
  // describes for the dashboard (AdminApp's one `useStagedFiles()` call) --
  // one instance for the whole page, so a photo staged on a gallery tile
  // and a different one staged on a dish reach the same eventual publish.
  const staged = useStagedFiles();
  const [fileErrors, setFileErrors] = useState<Partial<Record<ContentFileName, string>>>({});
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  // Post-review Fix 1 (Critical): on every transition into 'in' -- the
  // first load AND any later out->in cycle caused by a 401 below -- refetch
  // only the files that have NO registry entry yet. "Never clobber, but do
  // fill what is empty": a file that already loaded (and, from Task 3
  // onward, may hold her edits) has a registry entry the instant `.then`
  // below calls `registry.register` for it, so it is never touched again by
  // a later run of this same effect -- Plan 4's clobber does not return. A
  // file that never loaded -- because the session was already dead before
  // its own fetch ever went out, or because IT was the one that 401'd --
  // has no entry, so the next 'in' transition retries exactly that file,
  // instead of leaving it blank forever (the bug this fix replaces: a
  // boolean `startedRef` that fired the whole batch once and never again,
  // so a 401 on any of the nine permanently stranded every file that had
  // not yet resolved).
  //
  // No `previousStatusRef`/`wasIn` guard is needed here (Fix 7): with
  // `[status]` as the only dependency, this effect already only re-runs
  // when `status` actually changes, so `status === 'in'` inside the effect
  // body already implies the previous render's status was something else --
  // there is no way to reach this point on a render where 'in' merely
  // continued.
  useEffect(() => {
    if (status !== 'in') return;
    setSignOutNotice(null);
    const entries = registry.getEntries();
    CONTENT_FILES.forEach((file) => {
      // Already loaded (or holds her edits, once Task 3 adds editing) --
      // never re-fetched, never overwritten.
      if (entries[file] !== undefined) return;
      fetchContent(file)
        .then((loaded) => {
          // registry.register, not updateData: this is the load path (see
          // ContentRegistry's own comment on the two), and the only one this
          // task ever calls -- there is no edit yet to write back.
          registry.register(file, loaded.data, loaded.sha);
          // A file that errored on an EARLIER attempt (its own message is
          // still sitting in fileErrors) but has now loaded successfully on
          // this retry must not keep showing that stale error banner over
          // content that is, right now, actually on screen.
          setFileErrors((prev) => {
            if (!(file in prev)) return prev;
            const next = { ...prev };
            delete next[file];
            return next;
          });
        })
        .catch((error: unknown) => {
          if (isUnauthorized(error)) {
            setSignOutNotice(SIGN_OUT_NOTICE);
            logOut();
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setFileErrors((prev) => ({ ...prev, [file]: message }));
        });
    });
    // registry and logOut are stable for this component's whole lifetime
    // (useContentRegistry's own useRef/useCallback, useSession's own
    // useCallback) -- `status` is the only dependency that can actually
    // change what this effect does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status === 'checking') {
    // Same reasoning as AdminApp.tsx's own 'checking' branch: the lazy
    // chunk itself is already covered by src/App.tsx's <Suspense
    // fallback={null}>; this covers the moment between the chunk loading
    // and the session probe answering.
    return null;
  }

  const entries = registry.getEntries();
  const bundle = buildBundle(entries, registry, staged.stage);
  const erroredFiles = Object.keys(fileErrors) as ContentFileName[];
  const loadedOrErroredCount = CONTENT_FILES.filter(
    (file) => entries[file] !== undefined || fileErrors[file] !== undefined,
  ).length;
  const stillLoading = loadedOrErroredCount < CONTENT_FILES.length;

  // Capture phase, on the root that wraps the real page and nothing else
  // (never the login overlay below, which must stay clickable). React
  // dispatches every onClickCapture handler, root to target, before any
  // onClick handler anywhere in the subtree -- so this always runs before
  // Hero's reserve button, BlogTeaser's "View all", Drinks' download link or
  // VisitUs' Maps link. preventDefault stops an anchor's own default
  // navigation/download; stopPropagation is what stops a *button*'s onClick
  // (openReservationWhatsApp, navigate('/blogs')) from ever being invoked at
  // all, since React only dispatches those once the (now-halted) event would
  // otherwise bubble back up. A handler on the BUBBLE phase (onClick instead
  // of onClickCapture here) would run after the target's own onClick has
  // already fired -- too late; see this file's own test for the mutation
  // that proves it.
  //
  // Post-review (Task 2 Step 4 finding): the first version of this handler
  // cancelled EVERY click in the subtree, unconditionally -- which also
  // killed the in-page "#" nav links and the hamburger, the only way to
  // move around a full restaurant homepage on a phone, and Tasks 3/4 only
  // make that navigation more necessary. The two checks below carve out
  // exactly the clicks that stay on this page and touch nothing external,
  // decided by what the click DOES, not by tag name alone:
  //
  //   1. An anchor that stays on THIS document -- same origin, same path,
  //      same query string, no `download`, no `target="_blank"` -- is a
  //      plain same-page "#" jump (NavBar's desktop links and its mobile
  //      panel, both literal `<a href="#...">`, never a router `Link`).
  //      `anchor.origin`/`.pathname`/`.search` are read off the RESOLVED
  //      URL (`HTMLAnchorElement`'s own parsing), not the raw `href`
  //      string, so a relative path that merely *looks* like a fragment
  //      can't slip through. Every other anchor on this page fails this on
  //      a different clause -- Drinks' PDF (`download`), VisitUs' Maps link
  //      and the Instagram/LinkedIn links (`target="_blank"`, another
  //      origin) -- and stays blocked.
  //   2. A <button> carrying `aria-expanded` is a disclosure control by
  //      ARIA's own definition of that attribute -- it toggles this page's
  //      own UI state and nothing else. It is used nowhere in this tree but
  //      the hamburger (NavBar.tsx), so this carve-out is exactly that one
  //      button, not a general "buttons are fine" rule.
  //
  // Everything else stays blocked, including Hero's reserve button
  // (fires the WhatsApp beacon) and BlogTeaser's "View all"
  // (`navigate('/blogs')`) -- neither is an anchor and neither carries
  // `aria-expanded`, so both fall straight through to the same
  // preventDefault/stopPropagation as before. Fails closed: a future
  // button added anywhere in this tree is blocked by default unless it
  // explicitly earns one of the two carve-outs above.
  function handleCaptureClick(event: React.MouseEvent) {
    const target = event.target;
    if (target instanceof Element) {
      const anchor = target.closest('a');
      if (anchor) {
        const staysOnThisPage =
          anchor.target !== '_blank' &&
          !anchor.hasAttribute('download') &&
          anchor.origin === window.location.origin &&
          anchor.pathname === window.location.pathname &&
          anchor.search === window.location.search;
        if (staysOnThisPage) return;
      } else if (target.closest('button')?.hasAttribute('aria-expanded')) {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <ContentProvider value={bundle}>
      <div onClickCapture={handleCaptureClick}>
        {stillLoading && (
          <p
            role="status"
            className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 font-['Montserrat'] text-sm text-[#222]"
          >
            Loading live content…
          </p>
        )}
        {erroredFiles.length > 0 && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-300 bg-red-50 p-3 font-['Montserrat'] text-sm text-red-700"
          >
            {`Could not load ${erroredFiles.join(', ')} — ask your developer to check ${
              erroredFiles.length === 1 ? 'this file' : 'these files'
            }.`}
          </p>
        )}
        <div className="min-h-screen">
          <SectionErrorBoundary name="SEO">
            {/* Post-review Fix 6: /edit never emits structured data or a
                canonical link, logged in or out -- see SeoHead.tsx's own
                comment on why. The boundary stays: `site.seo.url` is still
                read unconditionally before that decision, so a malformed
                site.json still throws here exactly as before. */}
            <SeoHead emitMetadata={false} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="Navigation">
            <Navbar />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="Sections">
            <DynamicSections sections={bundle.sections} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="Footer">
            <Footer />
          </SectionErrorBoundary>
        </div>
      </div>
      {/* Overlay, not a replacement: EditMode must never unmount the page
          above on status === 'out' (Step 3's whole point). A 401 mid-load
          (or mid-edit, once Task 3 adds editing) shows this on top of a
          page that keeps showing exactly what it already had. */}
      {status === 'out' && (
        <div className="fixed inset-0 z-50">
          <Login onLogin={logIn} notice={signOutNotice ?? undefined} />
        </div>
      )}
    </ContentProvider>
  );
};

export default EditMode;
