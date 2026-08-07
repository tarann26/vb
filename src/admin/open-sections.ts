// Which dashboard sections she left open, remembered across a reload.
//
// localStorage, and no new dependency for it -- the same store, and the same
// never-throw posture, drafts.ts already uses for something far more
// valuable (see that module's own header comment on why a helper that can
// crash the screen it exists to improve is worse than no helper at all).
// This one holds nothing but a boolean per section: losing it costs her one
// click, which is why every function below degrades to the default rather
// than surfacing anything.
//
// One key PER SECTION, not one key holding a map of all ten. Ten independent
// components each write their own on toggle, and a single shared key would
// make every one of those writes a read-modify-write against a value the
// other nine also own -- a race with no upside, for a feature whose entire
// job is to remember one bit. Per-key writes cannot interleave wrongly
// because they never touch each other's data.
export const SECTION_OPEN_KEY_PREFIX = 'vb:section-open:v1:';

function keyFor(id: string): string {
  return `${SECTION_OPEN_KEY_PREFIX}${id}`;
}

// Collapsed is the default, and the default is what an unreadable,
// unwritten, or malformed value reads as. That direction matters: the
// dashboard's own problem was that everything was open at once, so falling
// back to "open" on a storage failure would quietly restore exactly the
// state this feature exists to fix.
//
// `storage` is a parameter rather than a bare `window.localStorage` in the
// body, the same as drafts.ts, so a test can inject a Storage that throws --
// a real, reachable state (Safari private browsing rejects every write)
// rather than a hypothetical one.
export function loadSectionOpen(id: string, storage: Storage = window.localStorage): boolean {
  try {
    return storage.getItem(keyFor(id)) === '1';
  } catch {
    return false;
  }
}

// Never throws -- see loadSectionOpen above. A failed write means the next
// reload starts her at the default again, which is the same place she would
// have been without this module at all.
export function saveSectionOpen(id: string, open: boolean, storage: Storage = window.localStorage): void {
  try {
    if (open) storage.setItem(keyFor(id), '1');
    else storage.removeItem(keyFor(id));
  } catch {
    // Best effort, the same posture saveDraft takes for a quota failure.
  }
}

// ---------------------------------------------------------------------------
// "This area has been visited before", one key per area.
//
// The problem it solves: once the ten panels are grouped into five areas,
// the flow on a phone she has never used is home (five rows) -> area (three
// folded headings) -> content. Five decisions replaced by five, then three.
// Opening the first panel of an area by itself, ONCE, is what makes the
// second step land on something rather than on another list.
//
// Why this cannot be a `defaultOpen` prop on CollapsibleSection.
// `saveSectionOpen` REMOVES the key when a section is closed, so "never
// opened" and "deliberately closed" are the same stored state -- and a naive
// default would therefore re-open, on every single reload, the one panel she
// keeps closing. A separate per-area key is the only thing that can tell
// those two apart.
//
// The two functions below are purely additive. `loadSectionOpen` and
// `saveSectionOpen` above are not modified, the fold contract is unchanged,
// and NO key migration is needed: the prefix here shares no prefix with
// SECTION_OPEN_KEY_PREFIX, so nothing already in her browser is read or
// written differently than it was yesterday.
export const AREA_SEEDED_KEY_PREFIX = 'vb:area-seeded:v1:';

function seedKeyFor(slug: string): string {
  return `${AREA_SEEDED_KEY_PREFIX}${slug}`;
}

// False for an unreadable, unwritten or malformed value, exactly as
// `loadSectionOpen` is -- and the direction matters here too: falling back to
// "already seeded" would silently withdraw the one-time open on precisely
// the device that could not store the flag, which is the device where she is
// most likely seeing this screen for the first time.
export function hasSeededArea(slug: string, storage: Storage = window.localStorage): boolean {
  try {
    return storage.getItem(seedKeyFor(slug)) === '1';
  } catch {
    return false;
  }
}

// Never throws -- the same reasoning as `saveSectionOpen`. A failed write
// costs her one extra tap the next time she opens that area.
export function markAreaSeeded(slug: string, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(seedKeyFor(slug), '1');
  } catch {
    // Best effort, same posture as above.
  }
}
