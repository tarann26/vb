// Type declarations for migrate-images.mjs, for the same reason and on the
// same terms as scripts/paths.d.mts: that script is plain ESM run by `node`,
// it is deliberately outside every tsconfig project's `include`, and a
// `.d.mts` sibling is TypeScript's supported way to let one `.ts` module
// import from it without turning `allowJs` on repo-wide.
//
// Kept in sync by hand -- there is no compiler link from this file back to
// migrate-images.mjs's real exports. Only the members an actual .ts caller
// needs are declared, which today is one: src/shared/__tests__/image-host.test.ts
// runs `cacheControlFor` against src/shared/image-host.ts's own copy of the
// same rule, because the Worker cannot import a .mjs and the two would
// otherwise be free to drift.
export declare function cacheControlFor(key: string): string;
