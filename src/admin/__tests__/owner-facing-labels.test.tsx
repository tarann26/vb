// A pin against the exact defect this task fixed: the homepage story
// section's dashboard name was renamed from "Our Story" to "About" in some
// places and not others, so the owner-facing surface called one thing two
// names at once. The fix is that "Our Story" no longer appears anywhere she
// can see -- headings, banners, buttons, aria-labels -- across all ten
// panels. `panel-snapshots.test.tsx` already renders every panel open for a
// different reason (byte-identical-move pinning); this borrows the same
// render-and-open shape rather than inventing a second one, and asks a
// different question of it.
//
// This deliberately does NOT grep source files the way
// src/test/palette.test.ts greps for the retired green: `our_story` (the
// upload category), `galleries.ourStory` (the content key) and `ourStory`
// (the section id) are correct, load-bearing, and appear throughout
// src/admin/ on purpose (see areas.ts, GalleryList.tsx, fields.ts). A text
// grep for "Our Story" would also have to carve out comments and test
// fixtures that quote the old name deliberately (a historical bug title in
// EditableImage.test.tsx, arbitrary sample content in StoryForm.test.tsx).
// None of that ambiguity exists once the question is "what does the DOM
// actually render": those identifiers never surface with a capital letter
// and a space, and nothing legitimate ever renders literally "Our Story" to
// her screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderDashboard } from './renderDashboard';
import { stubFetch } from './dashboardFixtures';
import { AREAS, PANELS } from '../manage/areas';
import type { PanelId } from '../manage/areas';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ROUTE_FOR_PANEL = new Map<PanelId, string>(
  AREAS.flatMap((area) => area.panelIds.map((id) => [id, `/edit/manage/${area.slug}`] as const)),
);

// Every string she could plausibly read off this panel: the text content
// (headings, banners, button labels, form labels) plus every `aria-label`
// (screen-reader-only text with no text node of its own -- `textContent`
// alone would miss "Move Our Story photo 1 down" entirely, since the
// visible button text is just "Up"/"Down").
function ownerFacingStrings(panel: HTMLElement): string[] {
  const strings = [panel.textContent ?? ''];
  panel.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label');
    if (label) strings.push(label);
  });
  return strings;
}

async function openPanel(id: PanelId): Promise<HTMLElement> {
  const { heading } = PANELS[id];
  const toggle = await screen.findByRole('button', { name: heading });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);

  const panel = document.getElementById(`section-panel-${id}`);
  if (!panel) throw new Error(`no panel element for "${id}"`);

  await waitFor(() => {
    expect(panel.textContent).not.toMatch(/^Loading /);
  });
  // The same 400ms validation debounce panel-snapshots.test.tsx waits out,
  // for the same reason: a problem banner arriving a tick late would make
  // this file flake rather than fail on its actual subject.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });

  return panel;
}

describe('no panel ever says "Our Story"', () => {
  (Object.keys(PANELS) as PanelId[]).forEach((id) => {
    it(`${PANELS[id].heading} (${id}) reads About, not Our Story, everywhere on the panel`, async () => {
      stubFetch();
      renderDashboard(ROUTE_FOR_PANEL.get(id));
      const panel = await openPanel(id);

      const offenders = ownerFacingStrings(panel).filter((s) => s.includes('Our Story'));
      expect(offenders).toEqual([]);
    });
  });
});
