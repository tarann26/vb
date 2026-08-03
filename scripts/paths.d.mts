// Type declarations for paths.mjs, the plain-ESM module that owns the
// source-to-derivative naming rule. paths.mjs is intentionally outside every
// tsconfig project's `include` (it isn't Worker code, app code, or Node
// tooling code, and enabling `allowJs` project-wide just so one file's
// exports resolve would let every OTHER .js/.mjs file in the repo start
// silently participating in `tsc -b` too). A `.d.mts` sibling is
// TypeScript's own supported way to type a plain `.mjs` module without
// either of those costs: it types this one file for whichever `.ts` module
// imports it (today, only src/shared/__tests__/derivative-path.test.ts),
// and nothing else changes.
//
// Kept in sync by hand -- there is no compiler link from this file back to
// paths.mjs's real exports, so an export added or removed there without a
// matching edit here either fails to compile (removed) or is silently
// invisible to any future .ts importer (added). Only the members an actual
// .ts caller needs are declared.
export declare const SOURCE: string;
export declare const OUT: string;
export declare const IMAGE_EXT: Set<string>;
export declare const DEFAULT_MAX_WIDTH: number;
export declare const DIR_MAX_WIDTH: Record<string, number>;
export declare const FILE_MAX_WIDTH: Record<string, number>;
export declare const QUALITY: number;
export declare const OG_SOURCE: string;
export declare const OG_OUTPUT: string;
export declare const OG_WIDTH: number;
export declare const OG_HEIGHT: number;
export declare const OG_QUALITY: number;
export declare const OG_MAX_BYTES: number;

export declare function outputPathFor(sourcePath: string): string;
export declare function maxWidthFor(sourcePath: string): number;
export declare function findCollisions(sources: string[]): { output: string; sources: string[] }[];
