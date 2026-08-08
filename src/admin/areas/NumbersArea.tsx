// The Numbers area: how many people visited, which pages they looked at,
// where they came from, and whether this week was busier than last.
//
// A placeholder at this task; the four cards arrive with the one
// GET /api/analytics fetch behind them.
//
// THE `active` PROP IS NOT COSMETIC. Every area on this dashboard is mounted
// from the first render and hidden with the `hidden` attribute rather than
// unmounted (see ManageShell), so there is no mount event to hang a fetch
// on: mounting is not visiting. `IntersectionObserver` is no help either --
// it does not fire for an element inside a hidden ancestor, and it does not
// exist in jsdom at all. So the one signal that means "she is looking at
// this" has to be passed in, and it is true exactly when this is the visible
// area.
import React from 'react';

export interface NumbersAreaProps {
  active: boolean;
}

const NumbersArea: React.FC<NumbersAreaProps> = () => (
  <section className="mb-10">
    <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">Numbers</h2>
    <p className="font-['Montserrat'] text-sm text-gray-600">
      Visitor numbers are being connected. This screen will show how many people visited, which pages they looked at,
      where they came from, and whether this week was busier than last.
    </p>
  </section>
);

export default NumbersArea;
