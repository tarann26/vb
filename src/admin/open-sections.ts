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
