// The Menu area: Dishes, Drinks and the PDF menus.
//
// Three panels that are three files -- dishes.json, drinks.json,
// menus.json, one of them PDFs -- and one thing to her. That is the whole
// argument for the regrouping: the previous screen exposed the file
// boundaries, which is exactly why it read as a developer's tool.
//
// Every panel body below was MOVED here from AdminApp.tsx, byte-identical
// apart from imports. src/admin/__tests__/panel-snapshots.test.tsx is what
// makes that claim checkable.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import ArraySection from '../sections/ArraySection';
import { registerLoaded } from '../sections/register-loaded';
import Field from '../Field';
import PdfField from '../PdfField';
import { fetchContent } from '../content';
import { DISH_FIELDS, DRINK_FIELDS, MENU_FIELDS } from '../fields';
import { replaceAt, useValidation } from '../useValidation';
import { problemsFor, arrayIndexOf } from '../problems';
import { fromStagedMenuPdf } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { Dish, Drink, MenuFile } from '../../content/types';
import type { AreaProps } from './area-props';

const MenuArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked }) => (
  <>
    <SectionErrorBoundary name="Dishes">
      <CollapsibleSection id="dishes" heading="Dishes" locked={publishLocked}>
        <ArraySection<Dish>
          file="dishes.json"
          load={() => fetchContent('dishes.json')}
          heading="Dishes"
          noun="dish"
          fields={DISH_FIELDS}
          itemLabel={(dish) => dish.name || 'Untitled dish'}
          makeBlank={blankDish}
          stage={stage}
          registry={registry}
          restoreDraft={restoreDraft}
        />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="Drinks">
      <CollapsibleSection id="drinks" heading="Drinks" locked={publishLocked}>
        <ArraySection<Drink>
          file="drinks.json"
          load={() => fetchContent('drinks.json')}
          heading="Drinks"
          noun="drink"
          fields={DRINK_FIELDS}
          itemLabel={(drink) => drink.name || 'Untitled drink'}
          makeBlank={blankDrink}
          stage={stage}
          registry={registry}
          restoreDraft={restoreDraft}
        />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="Menus">
      <CollapsibleSection id="menus" heading="Menus" locked={publishLocked}>
        <MenusSection stage={stage} registry={registry} restoreDraft={restoreDraft} />
      </CollapsibleSection>
    </SectionErrorBoundary>
  </>
);

// menus.json's own screen: a plain text label plus PdfField for the file
// itself. MENU_FIELDS.file's own comment (fields.ts) explains why that field
// is never rendered as `kind: 'text'` here -- PdfField needs a `name`
// derived from the CURRENT `file` value, and only this screen (which holds
// the whole record) has that.
//
// Deliberately no Add/Remove/Reorder here, unlike every ArraySection above:
// this task's brief only asks that she be able to REPLACE an existing
// menu's printed PDF, and confirmed directly, nothing on the public site
// reads `menus.json` at all today -- src/components/SignatureMocktails.tsx's
// own menu link is hand-written directly to the food menu PDF's public path,
// not driven by this file -- so there is no live consumer a THIRD or missing
// entry here would need to stay in sync with. A future task that wires the
// public site to this file for real should revisit whether add/remove
// belongs here too.
type MenusLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: MenuFile[]; sha: string };

// worker/upload.ts's `menuAssetPath` commits to `public/menus/<name>.pdf` --
// name-based, not content-addressed, so a REPLACEMENT under the same name
// must derive the exact same name every time, or it lands at a brand new
// path instead of overwriting the one menus.json already points at. The
// real, committed menus.json stores a `file` value rooted at "/menus/" with
// a stem like "food-menu.pdf" -- note the stem ("food-menu") is NOT simply
// the record's own `id` ("food") -- so the name has to come from the CURRENT
// `file` value, not
// `id`. Falls back to `id` only for a menu with no file yet (nothing to
// derive a stem from), matching worker/upload.ts's own MENU_NAME_PATTERN
// shape closely enough that a sane `id` reaches the Worker as a valid name;
// an `id` that doesn't match is refused there, the same "not re-validated
// client-side" precedent PdfField.tsx's own comment already documents for
// `name`.
const MENU_FILE_NAME = /\/([a-z0-9-]{1,64})\.pdf$/;
function menuNameFor(menu: MenuFile): string {
  const match = menu.file.match(MENU_FILE_NAME);
  return match ? match[1] : menu.id;
}

function MenusSection({
  stage,
  registry,
  restoreDraft,
}: {
  stage: (key: string, file: StagedFile | null) => void;
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
}) {
  const [state, setState] = useState<MenusLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('menus.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'menus.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('menus.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading menus…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load menus: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: MenuFile[]) {
    registry.updateData('menus.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // The bare, whole-file message (validateMenus' "the site needs at least
  // one downloadable menu", only reachable if menus.json were hand-edited
  // down to an empty array -- this screen has no Remove button that could
  // produce it itself) plus any `[i].key` naming an index this screen isn't
  // currently rendering -- the identical "nowhere else for this to go"
  // reasoning RecordList's own unclaimedProblems documents.
  const banner = problems.filter((p) => {
    if (items.length === 0) return true;
    const index = arrayIndexOf(p.field);
    return index !== undefined && (index < 0 || index >= items.length);
  });

  return (
    <>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with menus no longer shown"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      <ul>
        {items.map((menu, index) => (
          <li key={menu.id} className="mb-6 rounded border border-gray-200 p-4">
            <Field
              id={`menu-${index}-id`}
              spec={MENU_FIELDS.id}
              value={menu.id}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, id: next }))}
              problems={problemsFor(problems, index, 'id')}
            />
            <Field
              id={`menu-${index}-label`}
              spec={MENU_FIELDS.label}
              value={menu.label}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, label: next }))}
              problems={problemsFor(problems, index, 'label')}
            />
            <PdfField
              id={`menu-${index}-file`}
              label="PDF file"
              name={menuNameFor(menu)}
              value={menu.file}
              onChange={(next) => commit(replaceAt(items, index, { ...menu, file: next ?? '' }))}
              onStaged={(staged) => stage(`menus.json:${menu.id}:file`, fromStagedMenuPdf(staged))}
              problems={problemsFor(problems, index, 'file')}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

// Blank starting points for "Add a dish/drink" -- every required field
// present and empty/neutral, so the freshly-added record renders (RecordForm
// has no notion of a field that doesn't exist yet) and immediately shows
// her, via the same debounced validation as everything else, exactly what it
// still needs.
function blankDish(): Dish {
  return { id: crypto.randomUUID(), name: '', description: '', image: '', tags: [] };
}

function blankDrink(): Drink {
  return { id: crypto.randomUUID(), name: '', description: '', category: 'mocktail', image: null };
}

export default MenuArea;
