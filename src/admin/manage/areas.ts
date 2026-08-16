// The five areas of /edit/manage, and the ten existing panels that live in
// them. THE single source of truth: the sidebar, the phone home list, the
// route matching, the status strip's per-area unsaved dot and every test
// read the constant below rather than enumerating five of anything a second
// time.
//
// Why five areas rather than ten panels or a ranked "most used" home: the
// owner's own decision, recorded in the design document (section 1). She has
// no dominant task -- menus change seasonally, hours change for a holiday,
// press arrives when it arrives -- so nothing is promoted and nothing is
// buried. Five equal doors, grouped by the restaurant's own categories
// rather than by the file system's: "Menu" is one thing to her even though
// it is three files and one of them is PDFs.
//
// THE PANEL IDS BELOW ARE FROZEN. `open-sections.ts` builds its localStorage
// key as `vb:section-open:v1:<id>` from `CollapsibleSectionProps.id`, never
// from the heading -- so renaming a HEADING costs nothing in stored state,
// and changing an ID silently forgets every fold she has ever left open.
// `__tests__/areas.test.tsx` pins the ten ids against what the dashboard
// actually renders, precisely so that a rename in one place and not the
// other cannot land quietly.
import type { ContentFileName } from '../content';

// The ten `CollapsibleSection` ids, exactly as AdminApp has rendered them
// since the fold behaviour landed. A union rather than `string` so a typo in
// an area's `panelIds` below is a compile error, not a panel that silently
// belongs to nobody.
export type PanelId =
  | 'dishes'
  | 'drinks'
  | 'menus'
  | 'pages'
  | 'sections'
  | 'galleries'
  | 'story'
  | 'press'
  | 'hours'
  | 'copy'
  // Phase 2, Task 11: the eleventh panel, and the first one whose file is
  // D1-backed rather than a file in this repository (content.ts's own
  // CONTENT_FILES comment on `awards.json`).
  | 'awards'
  // Phase 3, Task 8: the twelfth panel, and back to a real committed file
  // (content.ts's own CONTENT_FILES comment on `experiences.json`).
  | 'experiences';

export type AreaSlug = 'menu' | 'pages' | 'story' | 'details' | 'numbers';

export interface PanelDefinition {
  id: PanelId;
  // The `<h2>` string CollapsibleSection renders. Kept here so the e2e spec
  // and the area modules quote one list rather than two.
  heading: string;
  // Which content file this panel edits. This is what turns "site.json is
  // dirty" into "the Hours & Wording area has unsaved work", which is the
  // whole of the status strip's per-area dot.
  file: ContentFileName;
}

// Typed as a TOTAL record over PanelId, the same posture
// CONTENT_FILE_LABELS takes over ContentFileName: an eleventh panel added to
// the union without an entry here fails `tsc -b`, rather than reaching her
// screen with no file behind it.
export const PANELS: Record<PanelId, PanelDefinition> = {
  dishes: { id: 'dishes', heading: 'Dishes', file: 'dishes.json' },
  drinks: { id: 'drinks', heading: 'Drinks', file: 'drinks.json' },
  menus: { id: 'menus', heading: 'Menu PDFs', file: 'menus.json' },
  pages: { id: 'pages', heading: 'Pages', file: 'pages.json' },
  sections: { id: 'sections', heading: 'What shows on the homepage', file: 'sections.json' },
  galleries: { id: 'galleries', heading: 'Galleries', file: 'galleries.json' },
  story: { id: 'story', heading: 'About', file: 'story.json' },
  press: { id: 'press', heading: 'Press', file: 'press.json' },
  hours: { id: 'hours', heading: 'Opening hours', file: 'site.json' },
  copy: { id: 'copy', heading: 'Words on the site', file: 'copy.json' },
  awards: { id: 'awards', heading: 'Awards', file: 'awards.json' },
  experiences: { id: 'experiences', heading: 'Experiences', file: 'experiences.json' },
};

export interface AreaDefinition {
  slug: AreaSlug;
  label: string;
  // One line, in her words, under the label -- on the phone home AND in the
  // sidebar, from this same string. The grouping is new to her and an area
  // name does not describe itself; the device with the most room for that
  // sentence is the last place to drop it.
  description: string;
  // In the order they are rendered. `panelIds[0]` is the panel an area
  // opens by itself the first time she ever visits it (see
  // `hasSeededArea`/`markAreaSeeded` in open-sections.ts).
  panelIds: PanelId[];
}

// The slug for "Hours & Wording" stays `details` even though the label does
// not: it is a URL she may bookmark, and there is no reason to make it
// prettier at the cost of a redirect. If the owner prefers the old word
// after seeing this, the label below is the only line that changes.
export const AREAS: AreaDefinition[] = [
  {
    slug: 'menu',
    label: 'Menu',
    // Also the marker src/test/bundle.post-build.test.ts uses to prove
    // AdminApp's own chunk never leaks into the entry bundle. It is a full
    // sentence rather than a label, which is what makes it unlikely to be
    // retouched by a routine wording pass; if it IS reworded, re-point that
    // marker in the same commit.
    description: 'Dishes, drinks and the PDF menus',
    panelIds: ['dishes', 'drinks', 'menus'],
  },
  {
    slug: 'pages',
    label: 'Pages',
    description: 'Your six business pages, and what shows on the homepage',
    // 'experiences' and 'awards' after 'sections': both are homepage
    // sections (SectionId 'experiences'/'awards', src/content/types.ts) the
    // same way the bespoke and template ones 'sections' already covers are
    // -- this area is already "what shows on the homepage" to her, so a new
    // sixth area for either panel would split one idea into two doors.
    // 'experiences' before 'awards', mirroring the homepage's own section
    // order (Copy's own experiences-then-awards chrome, and the carousel
    // sitting above Awards on the page itself).
    panelIds: ['pages', 'sections', 'experiences', 'awards'],
  },
  {
    slug: 'story',
    label: 'Story & Photos',
    description: 'Photo galleries, your story, and press coverage',
    panelIds: ['galleries', 'story', 'press'],
  },
  {
    slug: 'details',
    label: 'Hours & Wording',
    description: 'Opening hours, and the words on the homepage, menu and footer',
    panelIds: ['hours', 'copy'],
  },
  {
    slug: 'numbers',
    label: 'Numbers',
    // "Numbers" rather than "Analytics", deliberately: analytics is a word
    // that makes a non-technical person expect to be confused.
    description: 'How many people visited, and what they looked at',
    panelIds: [],
  },
];

// `/edit/manage` itself, with no trailing slash. Every link in the shell is
// built from this plus a slug, so the prefix exists once.
export const MANAGE_BASE = '/edit/manage';

export function areaPath(slug: AreaSlug): string {
  return `${MANAGE_BASE}/${slug}`;
}

// The slug the current pathname is asking for. `''` means the bare URL
// (`/edit/manage` or `/edit/manage/`), which resolves to the phone home list
// at narrow widths and redirects to the first area at wide ones. Anything
// else -- including a slug that matches no area -- is returned as-is, so the
// caller can tell "she is on the home screen" apart from "she typed
// something wrong", which are two different screens.
export function slugFromPathname(pathname: string): string {
  const withoutBase = pathname.startsWith(MANAGE_BASE) ? pathname.slice(MANAGE_BASE.length) : pathname;
  return withoutBase.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function findArea(slug: string): AreaDefinition | undefined {
  return AREAS.find((area) => area.slug === slug);
}

// Which area owns a given content file -- the map behind the status strip's
// per-area unsaved dot and behind the "Fix this in Menu -> Dishes" link a
// refused publish renders. Returns `undefined` for a file no panel edits,
// which cannot happen today and is not worth throwing over.
export function areaForFile(file: ContentFileName): AreaDefinition | undefined {
  return AREAS.find((area) => area.panelIds.some((id) => PANELS[id].file === file));
}

export function panelForFile(file: ContentFileName): PanelDefinition | undefined {
  const id = (Object.keys(PANELS) as PanelId[]).find((key) => PANELS[key].file === file);
  return id === undefined ? undefined : PANELS[id];
}
