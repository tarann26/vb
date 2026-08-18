// The Hours & Wording area: opening hours, and the words on the homepage,
// menu and footer.
//
// The area is NOT called "Details". copy.json's top-level keys are nav,
// hero, atmosphere, food, drinks, press, visit, footer, blogsPage and
// notFound -- this is where the homepage headline, the navigation labels and
// the words on the Reserve-a-Table control live. Those are not details, and
// a bucket named after leftovers is the last place she would look for them.
// The URL slug stays `details`, because that is a link she may have
// bookmarked and there is no reason to make it prettier at the cost of a
// redirect.
//
// Both panel bodies below were MOVED here from AdminApp.tsx, byte-identical
// apart from imports -- see src/admin/__tests__/panel-snapshots.test.tsx.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import { COPY_GROUPS, leafValue, withLeaf, withVisibleNbsp } from '../sections/copy-fields';
import Field from '../Field';
import HoursField from '../HoursField';
import EditorSheet from '../manage/EditorSheet';
import ItemList, { type ItemRow } from '../manage/ItemList';
import { fetchContent } from '../content';
import { COPY_FIELDS } from '../fields';
import { useValidation } from '../useValidation';
import { problemsFor } from '../problems';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { Copy, SiteContent } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';
import type { AreaProps } from './area-props';

const DetailsArea: React.FC<AreaProps> = ({ registry, restoreDraft, publishLocked }) => (
  <>
    <SectionErrorBoundary name="Opening hours">
      <CollapsibleSection id="hours" heading="Opening hours" locked={publishLocked}>
        <HoursSection registry={registry} restoreDraft={restoreDraft} />
      </CollapsibleSection>
    </SectionErrorBoundary>
    <SectionErrorBoundary name="Words on the site">
      <CollapsibleSection id="copy" heading="Words on the site" locked={publishLocked}>
        <CopySection registry={registry} restoreDraft={restoreDraft} />
      </CollapsibleSection>
    </SectionErrorBoundary>
  </>
);

type HoursLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  // `initial` is the committed snapshot exactly as GET /api/content
  // returned it -- captured once, when the fetch resolves, and never
  // written to again. `data` is the live, editable copy `onChange` updates.
  // Kept as two separate fields (not one, re-derived) so `initial` cannot
  // possibly drift just because `data` does.
  | { status: 'loaded'; data: SiteContent; initial: SiteContent; sha: string };

// The one part of site.json this task's own scope covers. No task in this
// plan builds a full SiteForm for site.json's remaining leaf fields
// (strapline, address, phones, ...) -- see task-6-report.md's own note
// attributing HoursField specifically, not a whole site.json screen, to
// Task 7. Fetches the WHOLE site.json (there is no narrower read) and holds
// it all in memory, but only ever changes the `hours` key on write: `{
// ...data, hours: next }` preserves every other field exactly, the same
// spread-not-reconstruct guarantee `replaceAt`'s own header comment
// describes for a whole-array update.
function HoursSection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<HoursLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('site.json')
      .then((loaded) => {
        if (!cancelled) {
          // registerLoaded's own `data` return is what the REGISTRY (and
          // therefore a publish) sees; `initial` here is a SEPARATE, local
          // concept -- the developer-owned-fields comparison base just
          // below -- which must stay the server's own value regardless of a
          // restored draft (see this section's own comment on `initial`).
          const data = registerLoaded(registry, 'site.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, initial: loaded.data, sha: loaded.sha });
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
  const initial = state.status === 'loaded' ? state.initial : undefined;
  // `initial`, the untouched committed snapshot (see HoursLoadState's own
  // comment) -- not `data` -- so useValidation's site.json rule can tell a
  // developer-owned field (name, tagline, seo.*) apart from one this screen
  // actually changed (validateSiteDeveloperOwnedFields,
  // src/content/validate.ts). This screen structurally never touches any of
  // those fields (its only write is `{ ...data, hours: next }`), so this is
  // a defensive no-op today, not a fix for anything reachable here -- kept
  // anyway so this screen matches the same `current` contract a future full
  // SiteForm would need, rather than quietly omitting it.
  const problems = useValidation('site.json', data, initial);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading opening hours…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load opening hours: ${state.message}`}
      </p>
    );
  }

  return (
    <>
      <HoursField
        value={state.data.hours}
        onChange={(next) => {
          const nextData = { ...state.data, hours: next };
          registry.updateData('site.json', nextData);
          setState({ status: 'loaded', data: nextData, initial: state.initial, sha: state.sha });
        }}
        problems={problems}
      />
    </>
  );
}

type CopyLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Copy; sha: string };

function CopySection({ registry, restoreDraft }: { registry: ContentRegistry; restoreDraft: DraftMap | null }) {
  const [state, setState] = useState<CopyLoadState>({ status: 'loading' });
  const [openSection, setOpenSection] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContent('copy.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'copy.json', loaded, restoreDraft);
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
  const problems = useValidation('copy.json', data);

  if (state.status === 'loading') {
    return <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Loading page copy…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load page copy: ${state.message}`}
      </p>
    );
  }

  const openGroup = COPY_GROUPS.find((g) => g.section === openSection);

  const sha = (state as { status: 'loaded'; sha: string }).sha;
  function commit(next: Copy) {
    registry.updateData('copy.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  // Every group's own leaf problems, for the row markers below -- not the
  // partition itself. Only ONE group's Fields are ever mounted (the open
  // one), so `openGroupMatched` below -- built from that group alone -- is
  // what actually decides shown vs. banner; this is just `needsAttention`
  // per row.
  function leafProblems(key: string): ValidationProblem[] {
    return problemsFor(problems, undefined, key);
  }
  const rows0 = COPY_GROUPS.map((group) => ({
    ...group,
    fields: group.keys.map((key) => ({ key, problems: leafProblems(key) })),
  }));
  const rows: ItemRow[] = rows0.map((group) => ({
    id: group.section,
    name: group.heading,
    needsAttention: group.fields.some((f) => f.problems.length > 0),
  }));

  // Only the group whose sheet is open can claim a leaf problem, because
  // only its Fields are mounted. Every other leaf problem falls to the
  // banner below -- the same rule this dashboard's other twelve panels
  // follow, restated for a panel whose rows are groups rather than records.
  const openGroupMatched = new Set(
    openGroup === undefined ? [] : openGroup.keys.flatMap((key) => leafProblems(key)),
  );
  const banner = problems.filter((p) => !openGroupMatched.has(p));

  return (
    <>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with page copy"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      <ItemList rows={rows} onOpen={setOpenSection} />
      {openGroup !== undefined && (
        <EditorSheet title={openGroup.heading} onClose={() => setOpenSection(null)}>
          {rows0
            .find((g) => g.section === openGroup.section)!
            .fields.map(({ key, problems: fieldProblems }) => (
              <div key={key}>
                <Field
                  id={`copy-${key}`}
                  spec={COPY_FIELDS[key]}
                  value={leafValue(state.data, key)}
                  onChange={(next) => commit(withLeaf(state.data, key, next))}
                  problems={fieldProblems}
                />
                {key === 'footer.followLabel' && (
                  <p className="-mt-3 mb-4 text-xs text-gray-500">
                    {`Shown with its non-breaking space marked: ${withVisibleNbsp(leafValue(state.data, key))}`}
                  </p>
                )}
              </div>
            ))}
        </EditorSheet>
      )}
    </>
  );
}

export default DetailsArea;
