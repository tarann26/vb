// One way to mount the dashboard in a test, so that the shell's two
// dependencies -- a router and a viewport width -- are supplied deliberately
// rather than by accident.
//
// Why this exists at all, and why it landed BEFORE the shell did. Forty of
// AdminApp.test.tsx's cases called `render(<AdminApp />)` bare. The moment
// AdminApp renders anything that reads the router, every one of them throws
// "useLocation() may be used only in the context of a <Router>" -- forty
// simultaneous failures, indistinguishable from a panel genuinely lost in
// the move. Moving them onto this helper first, with no production change at
// all, is what makes a red case afterwards mean something.
//
// TWO THINGS IT SUPPLIES.
//
// 1. A `MemoryRouter` at a real `/edit/manage/...` entry. Each case is given
//    the route of the area whose panel it asserts on. Until the shell lands,
//    the route is inert -- AdminApp renders all ten panels regardless -- which
//    is precisely why this can be done as its own commit.
//
// 2. A per-test `matchMedia` stub, never a mutation of the shared
//    src/test/setup.ts. That file stubs `matchMedia` globally to answer
//    `matches: false` for every query, for the whole suite, which means the
//    laptop layout is never the accidental default and has to be opted into
//    -- `{ wide: true }`. `usePrefersReducedMotion.test.ts` is the existing
//    precedent for stubbing it per test rather than globally.
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import AdminApp from '../AdminApp';

export interface RenderDashboardOptions {
  // True for the laptop layout, where the persistent sidebar exists and the
  // bare /edit/manage URL redirects to the first area. False (the default,
  // matching the shared setup file) for the phone layout, where the bare URL
  // is the drill-down home list.
  wide?: boolean;
}

// A `matchMedia` that answers a min-width query honestly and everything else
// the way the shared setup file does. Deliberately NOT a blanket
// `matches: wide`: `usePrefersReducedMotion` and anything else that asks a
// preference question would then get "yes" purely because the test wanted a
// wide viewport, which is a different question entirely.
function stubMatchMedia(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query) ? wide : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

export function renderDashboard(
  route = '/edit/manage/menu',
  { wide = false }: RenderDashboardOptions = {},
): RenderResult {
  stubMatchMedia(wide);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AdminApp />
    </MemoryRouter>,
  );
}
