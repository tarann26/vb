// A sibling declaration for tailwind.config.js, not a switch to allowJs:
// this project's tsconfig.app.json is strict and scoped to `src`, and
// widening it to typecheck arbitrary JS across the whole repo is a much
// bigger change than one file needs. A `.d.ts` beside the `.js` it
// describes is TypeScript's own mechanism for typing a single untyped
// module without either rewriting it or loosening the project.
//
// Only the shape src/test/palette.test.ts actually reads (fix round 1,
// Important 1: importing the config directly so the guard's contrast
// assertions run against the values Tailwind itself will use, not a copy
// re-typed into the test file). Loose on purpose -- a plain
// `Record<string, string>` rather than a literal type per token -- so this
// declaration never needs editing when a new token is added to
// `theme.extend.colors`.
declare const tailwindConfig: {
  theme: {
    extend: {
      colors: Record<string, string>;
    };
  };
};

export default tailwindConfig;
