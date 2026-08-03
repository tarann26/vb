// sections.json: the homepage's own ordered, toggleable section list
// (D6, docs/superpowers/specs/2026-08-02-phase-b-c-dashboard-and-sections-design.md).
//
// assertSections (src/content/guards.ts) enforces THREE rules, not the two
// an earlier draft of this plan noticed:
//   1. `hero` cannot be disabled.
//   2. no `publishAt` key on any section (Section itself has no such field
//      at all -- src/content/types.ts -- so nothing this component's own
//      form could ever produce reaches that check; there is no UI path here
//      that could add one).
//   3. every SectionId must appear EXACTLY ONCE (guards.ts:150-153) -- the
//      one a reorder/remove UI can actually break.
//
// D6: "Nothing is ever deleted, only disabled." This component offers
// REORDER and TOGGLE only -- deliberately **no Add and no Remove button
// anywhere**. That is what makes rule 3 unreachable BY CONSTRUCTION, not
// merely checked after the fact: reordering only ever PERMUTES the seven
// entries this screen was handed, and toggling only ever flips `enabled` on
// one of them -- neither operation can change WHICH SectionIds are present.
// Starting from a real, already-valid sections.json (exactly seven unique
// ids, guaranteed by the same guard at build time) means every state this
// component can produce still has exactly those same seven ids, always.
// Rule 1 (hero) is enforced the same way, at the single row it applies to:
// hero's own toggle is rendered `disabled`, so this screen cannot even
// SUBMIT a click that would turn it off, rather than merely showing a
// message after the fact.
import type { Section, SectionId } from '../content/types';
import type { ValidationProblem } from '../content/validate';
import { MOVE_BUTTON_CLASSNAME } from './RecordList';

export interface SectionListProps {
  items: Section[];
  onChange: (index: number, next: Section) => void;
  onReorder: (ids: SectionId[]) => void;
  // The FULL sections.json problem list. validateSections
  // (src/content/validate.ts) wraps assertSections and, on ANY failure,
  // returns exactly ONE file-level problem (`field: ''`) -- assertSections
  // has no per-id error shape at all (a duplicate id, a missing one, and a
  // disabled hero are all reported as one message about the whole file), so
  // unlike HoursField/RecordList there is nothing to distribute per row;
  // every problem here goes in one banner.
  problems: ValidationProblem[];
}

// Human names, not SectionIds, and the live anchor each one links to --
// neither is her vocabulary. `atmosphere` renders "Atmosfera" (its own
// on-page heading, copy.json's `atmosphere.heading`) and lives at `#gallery`
// (copy.json's `nav.links[].href` for it) -- the id, the heading and the
// anchor are three independently-chosen strings by design (see
// src/content/types.ts's own comment on SectionId), and none of the three
// is interchangeable with either of the others.
//
// A hand-maintained `Record<SectionId, ...>` literal, not derived from
// copy.json at runtime -- src/admin/content.ts's own header comment is why
// nothing under src/admin/ reads a build-time content snapshot, and this
// dashboard never fetches copy.json just to label a DIFFERENT file's
// screen. `SECTION_COMPONENTS` (src/App.tsx) and `SECTION_ID_SET`
// (src/content/guards.ts) are the same hand-maintained-`Record<SectionId,
// ...>` shape for the identical completeness-over-derivation reason.
// `hero` and `drinks` have no anchor at all -- types.ts's own comment on
// `NavLink` notes neither has a nav entry.
const SECTION_NAMES: Record<SectionId, { name: string; anchor: string | null }> = {
  hero: { name: 'Hero', anchor: null },
  ourStory: { name: 'Our Story', anchor: '#our-story' },
  atmosphere: { name: 'Atmosfera', anchor: '#gallery' },
  food: { name: 'Menu', anchor: '#menu' },
  drinks: { name: 'Drinks', anchor: null },
  press: { name: 'Stories', anchor: '#blogs' },
  visit: { name: 'Visit Us', anchor: '#visit' },
};

function SectionList({ items, onChange, onReorder, problems }: SectionListProps) {
  function swap(index: number, otherIndex: number): void {
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    ids[index] = ids[otherIndex];
    ids[otherIndex] = moved;
    onReorder(ids);
  }

  return (
    <div>
      {problems.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with the homepage section order"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {items.map((section, index) => {
          const { name, anchor } = SECTION_NAMES[section.id];
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isHero = section.id === 'hero';
          const toggleId = `section-enabled-${section.id}`;
          return (
            <li key={section.id} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <span className="font-['Montserrat'] text-base text-[#222]">{name}</span>
                  <span className="ml-2 text-xs text-gray-500">{anchor ?? 'not in the navigation menu'}</span>
                </div>
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move ${name} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move ${name} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
              </div>
              <label htmlFor={toggleId} className="flex items-center gap-2 font-['Montserrat'] text-sm text-[#222]">
                <input
                  id={toggleId}
                  type="checkbox"
                  checked={section.enabled}
                  disabled={isHero}
                  onChange={(event) => onChange(index, { ...section, enabled: event.target.checked })}
                  className="h-5 w-5 rounded border-gray-300"
                />
                Shown on homepage
              </label>
              {isHero && (
                <p className="mt-1 text-xs text-gray-500">
                  The homepage always needs a hero — this cannot be turned off here.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default SectionList;
