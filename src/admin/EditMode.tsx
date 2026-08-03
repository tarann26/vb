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
import type { ContentEntries } from './publish';
import SectionErrorBoundary from './SectionErrorBoundary';
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

function buildBundle(entries: ContentEntries): ContentBundle {
  return {
    site: pick(entries, 'site.json', EMPTY_SITE),
    galleries: pick(entries, 'galleries.json', EMPTY_GALLERIES),
    dishes: pick(entries, 'dishes.json', []),
    drinks: pick(entries, 'drinks.json', []),
    press: pick(entries, 'press.json', []),
    story: pick(entries, 'story.json', EMPTY_STORY),
    menus: pick(entries, 'menus.json', []),
    copy: pick(entries, 'copy.json', EMPTY_COPY),
    sections: pick(entries, 'sections.json', []),
    // No editing affordance yet (Tasks 3/4) -- identity, matching
    // ContentContext.ts's own defaultBundle, so /edit renders exactly what
    // the live content says with nothing yet clickable-to-edit.
    renderText: (_path, value) => value,
    renderImage: (_path, props) => <img {...props} />,
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
  const bundle = buildBundle(entries);
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
  function handleCaptureClick(event: React.MouseEvent) {
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
