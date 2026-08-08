// The restaurant's own lockup, for the tool she runs it from.
//
// The complaint this answers, in the owner's words: the Manage screen
// "carries none of the brand -- it could be any admin panel for any
// business". A dashboard that looks like nothing in particular is a
// dashboard she has to be told is hers.
//
// The two strings are written here rather than read from site.json, and that
// is a constraint rather than a shortcut: src/admin/ is forbidden from
// importing the build-time content snapshot (see
// src/admin/__tests__/content.test.ts, which fails the build on it), because
// a stale snapshot reaching an editing surface is the vanishing-edit bug
// this codebase has already fixed twice. Reading them from the registry
// instead would make the header wait on whichever panel happens to own
// site.json, so the lockup would arrive a beat after the page.
//
// No new fonts. Parisienne and Montserrat are already loaded and are the
// brand -- the same pairing NavBar and Footer use on the public site.
export const BRAND_NAME = 'Via Bianca';
export const BRAND_TAGLINE = 'Pastificio & Ristorante';

// What a screen reader, `getByRole('heading', { name })` and Playwright all
// see for the lockup. Exported so the tests and the e2e spec quote one
// string rather than three, since the old `Via Bianca Dashboard` heading
// they used to wait on no longer exists.
export const LOCKUP_ACCESSIBLE_NAME = `${BRAND_NAME} ${BRAND_TAGLINE}`;
