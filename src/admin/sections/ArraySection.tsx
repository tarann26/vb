// The one generic screen every array-shaped, id-keyed content file needs --
// Dishes, Drinks and Press all mount it. Moved out of AdminApp.tsx
// unchanged when the panels were carried into their area modules; it sits
// in sections/ rather than in any one area because two areas share it.
import { useEffect, useState } from 'react';
import RecordList from '../RecordList';
import type { ContentFileName, ContentTypeMap, LoadedContent } from '../content';
import type { FieldsOf } from '../fields';
import { replaceAt, useValidation } from '../useValidation';
import { fromStagedPhoto } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import { registerLoaded } from './register-loaded';

type LoadState<Item> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Item[]; sha: string };

export interface ArraySectionProps<Item extends { id: string }> {
  // Which real content file this section edits -- passed to useValidation
  // (so the debounced pass runs validateContent's rules for THIS file, not
  // a generic one) and shown in error text. Typed as the whole
  // ContentFileName union rather than a literal `K` tied to `Item`: doing
  // that properly needs `Item` derived from `ContentTypeMap[K]` through a
  // conditional type, which the compiler cannot carry through a component
  // generic over `Item` alone (confirmed while writing this). Every actual
  // call site below supplies `file` and `load` TOGETHER as a matched pair
  // (e.g. `file="dishes.json"` with `load={() => fetchContent('dishes.json')}`),
  // which is what keeps this honest in practice -- `load`'s own return type
  // is checked against `Item[]` fully, with no cast, at each call site.
  file: ContentFileName;
  load: () => Promise<LoadedContent<Item[]>>;
  heading: string;
  noun: string;
  fields: FieldsOf<Item>;
  itemLabel: (item: Item) => string;
  makeBlank: () => Item;
  // src/admin/staged.ts's shared collector, threaded down to RecordList so a
  // photo staged on any Dish/Drink/Article reaches it -- see that file's own
  // header comment. Every call site above binds this to the SAME instance
  // AdminApp created once; ArraySection's own job is only to add the `file`
  // name to the key RecordList reports (`${file}:${itemId}:${fieldKey}`),
  // finishing the key RecordForm/RecordList's own comments describe as
  // building "up".
  stage: (key: string, file: StagedFile | null) => void;
  // publish.ts's shared content registry (Task 10) -- registered on load and
  // on every commit, so a Publish click sees this file's current data/sha
  // regardless of which OTHER section she edited most recently.
  registry: ContentRegistry;
  // Non-null only in the one render where she just clicked Restore on the
  // unsaved-changes banner (AdminApp's own `restoreDraft` state) -- see
  // registerLoaded's own comment above for exactly how this overrides the
  // freshly-fetched server value without corrupting the registry's own
  // `initial`.
  restoreDraft: DraftMap | null;
}

// The one generic screen every array-shaped, id-keyed content file needs:
// fetch it from GET /api/content (never src/content/index.ts -- see
// src/admin/content.ts's own header comment for why a build-time snapshot
// would silently reintroduce the vanishing-edit bug Task 3 exists to
// close), hold the whole file in memory, validate the whole file on a
// debounce tick (useValidation), and hand RecordList the full, unfiltered
// problem list -- exactly the contract Task 4/5 already built RecordForm
// and RecordList's own banners against.
export function ArraySection<Item extends { id: string }>({
  file,
  load,
  heading,
  noun,
  fields,
  itemLabel,
  makeBlank,
  stage,
  registry,
  restoreDraft,
}: ArraySectionProps<Item>) {
  const [state, setState] = useState<LoadState<Item>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(
            registry,
            file,
            loaded as unknown as LoadedContent<ContentTypeMap[ContentFileName]>,
            restoreDraft,
          );
          setState({ status: 'loaded', data: data as unknown as Item[], sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render (each call site passes an
    // inline arrow) -- keying on `file` instead, which is stable for the
    // lifetime of one section, is what keeps this effect from re-fetching
    // on every unrelated re-render. `registry`/`restoreDraft` deliberately
    // excluded too: `registry` is a stable object for the page's whole
    // lifetime (useContentRegistry's own useCallback/useRef), and
    // `restoreDraft` must only ever be consulted at the MOMENT this fetch
    // resolves -- re-running this effect if she clicks Restore AFTER this
    // section has already loaded would re-fetch and re-apply the draft a
    // second time, not simply update in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const data = state.status === 'loaded' ? state.data : undefined;
  // `Item[]` and `ContentTypeMap[file]` are the same real array type for
  // every call site below (see ArraySectionProps.file's own comment) --
  // this cast documents that equality where the compiler cannot verify it
  // through Item, an unrelated type parameter from useValidation's own `K`.
  // Nothing downstream of `useValidation` reads `data` as anything other
  // than what it already is; the cast changes no runtime behaviour.
  const problems = useValidation(file, data as ContentTypeMap[ContentFileName] | undefined);

  if (state.status === 'loading') {
    return (
      <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">
        Loading {heading.toLowerCase()}…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load ${heading.toLowerCase()}: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;

  function commit(next: Item[]) {
    registry.updateData(file, next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <>
      <RecordList<Item>
        fields={fields}
        items={items}
        // replaceAt, not a hand-rolled reconstruction: `next` already
        // carries everything RecordForm's own onChange preserved (unknown
        // keys included), and replaceAt's whole job is to not undo that.
        // See src/admin/useValidation.ts's own comment and
        // useValidation.test.tsx's round-trip tests for exactly the failure
        // this guards against.
        onChange={(index, next) => commit(replaceAt(items, index, next))}
        onReorder={(ids) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          commit(ids.map((id) => byId.get(id) as Item));
        }}
        onAdd={() => commit([...items, makeBlank()])}
        onRemove={(index) => commit(items.filter((_, i) => i !== index))}
        noun={noun}
        itemLabel={itemLabel}
        problems={problems}
        onStaged={(key, staged) => stage(`${file}:${key}`, fromStagedPhoto(staged))}
        // Review finding (Task 9): without this, Dishes' and Drinks' own
        // first record both render `id="field-image-0"` (RecordForm.tsx's
        // `idFor` had no per-file namespace) -- confirmed to actually
        // misdirect a real click (a `<label for>` in one section focusing
        // the WRONG section's input, since id resolution isn't scoped by
        // container). `file` minus its ".json" is already unique per
        // ArraySection on this page.
        scope={file.replace('.json', '')}
      />
    </>
  );
}

export default ArraySection;
