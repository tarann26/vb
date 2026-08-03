// Plan 5 Task 2 correction (post-review Fix 5): the raw React Context object
// and ContentProvider live HERE, not in ./types -- Task 2 originally put
// them in types.ts specifically so src/admin/ (whose own
// src/admin/__tests__/content.test.ts only whitelists types/validate/guards/
// publish as safe src/content/ imports -- see that file's own
// SAFE_CONTENT_SUBMODULES) could reach ContentProvider without a transitive
// path to src/content/index.ts, the build-time snapshot. That reasoning was
// right; the destination was wrong. types.ts's OTHER exports (ContentBundle,
// SectionId, ...) are pure TypeScript types -- `import type` erases them
// completely, and the whitelist's own review comment leaned on that ("types
// erases entirely at compile time"). `createContext` is not a type, though:
// it is a real `react` runtime call, so the moment types.ts held it, the
// whitelist's name-based check ("types" is safe) could no longer tell a type
// import from a value import at that path apart -- src/content/index.ts:73's
// `export * from './types'` silently became a path by which the Worker
// bundle (worker/index.ts -> ../src/content/validate -> ./guards -> ./types)
// COULD have pulled in react, resting entirely on nobody ever importing a
// value across that path. Nothing did (confirmed: bundling worker/index.ts
// with esbuild, see worker/__tests__/bundle.test.ts), but the invariant was
// no longer something the whitelist itself enforced -- it was an accident of
// nobody having done it yet.
//
// This module is the one place that actually needs the runtime `react`
// import. Safe for src/admin/ to reach via SAFE_CONTENT_SUBMODULES
// (content.test.ts) for the same reason `validate`/`guards`/`publish` are:
// it imports no JSON and has no path to src/content/index.ts -- unlike
// those three, it is not type-erasing (it holds a real `createContext`
// call), which is exactly why it must never be allowed to import JSON
// itself, or gain one indirectly. `types.ts` is the only other module it
// touches, and only for `ContentBundle`'s type.
import { createContext } from 'react';
import type { ContentBundle } from './types';

// null when no provider is mounted -- useContent() (ContentContext.ts) is
// what turns that into defaultBundle; this module has no static import into
// src/content/index.ts to build a default from, deliberately (see above).
export const ContentReactContext = createContext<ContentBundle | null>(null);
export const ContentProvider = ContentReactContext.Provider;
