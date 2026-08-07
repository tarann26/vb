// A DOM baseline for each of the ten dashboard panels, taken BEFORE their
// implementations are carried out of AdminApp.tsx and into the five area
// modules, and asserted unchanged afterwards.
//
// Why this exists. The move is roughly 1300 lines, and the rule it has to
// obey is that a panel's body arrives in its new file byte-identical apart
// from imports -- any behaviour change smuggled in alongside a move that
// large is unreviewable. "Byte-identical apart from imports" is not
// something a test can assert directly. This is the enforcement that can be:
// if a field label, an input id, a button, an aria attribute or the order of
// anything inside a panel changes, exactly one snapshot goes red and names
// the panel.
//
// It is the COMPLEMENT of the areas.ts completeness pin, not a substitute.
// That one catches a panel DROPPED; this one catches a panel subtly
// ALTERED. Neither catches the other's failure.
//
// PER-PANEL, never page-level, and that is deliberate: the regrouping
// changes the ORDER panels appear in (Menus moves above Galleries), and a
// page-level snapshot would go red for that reordering while saying nothing
// about whether any panel's own contents survived -- a false alarm that
// would train whoever runs it to re-record without reading.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderDashboard } from './renderDashboard';
import { stubFetch } from './dashboardFixtures';
import { AREAS, PANELS } from '../manage/areas';
import type { PanelId } from '../manage/areas';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// Which route each panel is reachable from. Derived from AREAS rather than
// hand-listed, so a panel moved between areas is a change to one constant
// and not to this file.
const ROUTE_FOR_PANEL = new Map<PanelId, string>(
  AREAS.flatMap((area) => area.panelIds.map((id) => [id, `/edit/manage/${area.slug}`] as const)),
);

async function snapshotPanel(id: PanelId): Promise<HTMLElement> {
  const { heading } = PANELS[id];
  stubFetch();
  renderDashboard(ROUTE_FOR_PANEL.get(id));

  // Opened, because a folded panel's body is behind the `hidden` attribute
  // and the whole subject here is what is inside it.
  const toggle = await screen.findByRole('button', { name: heading });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);

  const panel = document.getElementById(`section-panel-${id}`);
  if (!panel) throw new Error(`no panel element for "${id}"`);

  // The fetch has resolved...
  await waitFor(() => {
    expect(within(panel).queryByText(/^Loading /)).not.toBeInTheDocument();
  });
  // ...and useValidation's 400ms debounce has definitively settled, so a
  // problem banner cannot arrive one tick after the snapshot was taken and
  // make this file flake. Without this wait the snapshot records a race,
  // which is worse than recording nothing.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });

  return panel;
}

describe('the ten panels, as they render today', () => {
  (Object.keys(PANELS) as PanelId[]).forEach((id) => {
    it(`${PANELS[id].heading} (${id})`, async () => {
      expect(await snapshotPanel(id)).toMatchSnapshot();
    });
  });
});
