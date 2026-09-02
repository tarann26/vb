// Type declarations for verify-image-urls.mjs, the plain-ESM module that owns
// the live image sweep. Same arrangement, and the same reasons, as
// scripts/paths.d.mts: the script is outside every tsconfig project's
// `include`, and turning on `allowJs` project-wide so one file's exports
// resolve would quietly enrol every other .js/.mjs file in `tsc -b` too. A
// `.d.mts` sibling types this one module for the one .ts file that imports it
// (src/test/__tests__/verify-image-urls.test.ts) and changes nothing else.
//
// Kept in sync by hand -- there is no compiler link back to the real exports,
// so an export removed there without an edit here fails to compile and one
// added there is simply invisible to a .ts caller.
export declare const ISLAND_ID: string;

export declare function referencesIn(value: unknown, found?: string[]): string[];
export declare function islandFrom(html: string): unknown;
export declare function committedReferences(dir?: string): string[];
export declare function sweep(
  references: readonly string[],
  origin: string,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ url: string; why: string }[]>;
