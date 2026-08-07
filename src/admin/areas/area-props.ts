// What every area module is handed. One shape, so a new area cannot quietly
// grow a dependency the others do not have, and so a completeness check can
// see the whole surface in the type system.
//
// PROPS, not a context, and that is a decision rather than an oversight:
// `useContentRegistry` bumps its own `version` on every `updateData`, so the
// whole tree re-renders on every keystroke either way. A context would buy
// nothing at runtime and would hide the dependency from the compiler.
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { StagedFile } from '../staged';

export interface AreaProps {
  // publish.ts's shared registry: the one place every panel's current
  // data/sha is visible at once, which is what makes a single POST
  // /api/publish across all ten content files possible at all.
  registry: ContentRegistry;
  // Non-null only in the one render where she has just clicked Restore on
  // the unsaved-changes banner -- see registerLoaded's own comment for how
  // that overrides the freshly-fetched server value without corrupting the
  // registry's `initial`.
  restoreDraft: DraftMap | null;
  // staged.ts's one shared collector, so a photo staged on any dish, drink,
  // article, gallery row or menu PDF reaches the same eventual publish.
  stage: (key: string, file: StagedFile | null) => void;
  // True only while the publish REQUEST itself is open. Applied as one
  // `disabled` fieldset per panel, inside CollapsibleSection -- never as one
  // wrapper around a whole area, which would swallow the fold toggles too.
  publishLocked: boolean;
}
