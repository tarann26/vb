// The five areas, as links. ONE component with a `variant`, never two navs
// rendered together.
//
// The obvious alternative -- a sidebar and a list rendered side by side,
// each shown at one breakpoint -- was rejected for a specific reason, not a
// stylistic one: it puts every link in the accessibility tree twice and in
// every `getByRole` query twice. Under vitest that is not even hidden by a
// breakpoint, because jsdom loads no CSS and evaluates no media query, so
// both copies would simply be present. It is also unnecessary. At most one
// nav exists at any moment:
//
//   * the sidebar, on a laptop, on every screen;
//   * the drill-down list, on a phone, at the bare /edit/manage URL and on
//     the area-not-found screen;
//   * neither, on a phone area screen, which has a back control instead.
//
// ManageShell owns that choice; this component only draws whichever one it
// was asked for.
import React from 'react';
import { Link } from 'react-router-dom';
import { AREAS, areaPath } from './areas';

export interface AreaNavProps {
  variant: 'sidebar' | 'list';
  // Areas whose content is currently reporting a problem -- a failed load, a
  // validation message -- anywhere inside them.
  //
  // CollapsibleSection already carries this idea one level down, and its own
  // decision #2 records why: "a dishes.json that would not load looked
  // exactly like a dishes.json she had simply not opened yet". This redesign
  // adds a SECOND level of hiding, so a failed copy.json now raises its
  // marker inside a container she cannot see while she is in Menu. Without
  // this the message exists, correctly, somewhere she will never look.
  problemSlugs?: string[];
  // Areas holding unsaved work. A DIFFERENT signal from the one above, and
  // the two must be visually and nameably distinguishable -- one means
  // "something here is wrong", the other means "something here is not
  // published yet", and reading either as the other is worse than showing
  // neither.
  unsavedSlugs?: string[];
  // The slug currently on screen. `''` at the bare URL, and a slug matching
  // no area on the not-found screen -- in both cases nothing is marked
  // current, which is correct: neither screen IS one of the five.
  activeSlug: string;
}

// The current item is marked with `aria-current="page"` and an accent left
// rule. Never by removing it from the list, and never by disabling its link:
// a list that changes length depending on where you are is a list you cannot
// learn, and a disabled current item is a control that looks broken.
const SIDEBAR_ITEM = 'block border-l-2 py-2 pl-3 pr-2 transition';
const SIDEBAR_CURRENT = 'border-accent bg-accent/10';
const SIDEBAR_IDLE = 'border-transparent hover:border-brand/40 hover:bg-brand/5';

// A full-width tap target on the phone home. Generous vertical padding is
// not decoration here: the whole claim this screen has to keep is that all
// five rows fit one 390x844 viewport without scrolling AND that each row's
// own centre pixel hit-tests to itself.
const LIST_ITEM =
  'flex items-center justify-between gap-3 rounded border border-brand/30 bg-white px-4 py-4 transition hover:border-brand';

const AreaNav: React.FC<AreaNavProps> = ({ variant, activeSlug, problemSlugs = [], unsavedSlugs = [] }) => {
  const sidebar = variant === 'sidebar';
  return (
    // `data-variant` is not styling: the sidebar and the drill-down list
    // share one accessible name, so it is the only thing an e2e assertion
    // can use to say "the SIDEBAR element never existed in the DOM at
    // 390px" -- which is the claim that rules out a flash of the wrong
    // layout, as distinct from the layout merely settling correctly.
    <nav aria-label="Areas" data-variant={variant} className={sidebar ? 'w-56 shrink-0' : ''}>
      <ul className={sidebar ? 'space-y-1' : 'space-y-3'}>
        {AREAS.map((area) => {
          const current = area.slug === activeSlug;
          return (
            <li key={area.slug}>
              <Link
                to={areaPath(area.slug)}
                aria-current={current ? 'page' : undefined}
                className={
                  sidebar ? `${SIDEBAR_ITEM} ${current ? SIDEBAR_CURRENT : SIDEBAR_IDLE}` : LIST_ITEM
                }
              >
                <span className="block">
                  <span className="block font-['Montserrat'] text-sm uppercase tracking-wide text-ink">
                    {area.label}
                  </span>
                  {/* The same one-line description at both variants, from
                      the same string. An earlier draft dropped it from the
                      sidebar -- the device with the most room for it --
                      while arguing in the same breath that it exists
                      because the grouping is new to her. */}
                  <span className="mt-1 block font-['Montserrat'] text-xs text-gray-500">{area.description}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {problemSlugs.includes(area.slug) && (
                    // An accessible NAME, not colour alone: the two markers
                    // have to be told apart by a screen reader as well as by
                    // eye, and red-versus-sage is not a distinction everyone
                    // can make.
                    <span
                      role="img"
                      aria-label={`${area.label} needs attention`}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white"
                    >
                      !
                    </span>
                  )}
                  {unsavedSlugs.includes(area.slug) && (
                    <span
                      role="img"
                      aria-label={`${area.label} has unpublished changes`}
                      className="h-2 w-2 rounded-full bg-accent"
                    />
                  )}
                  {!sidebar && (
                    <span aria-hidden="true" className="font-['Montserrat'] text-lg text-accent">
                      ›
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default AreaNav;
