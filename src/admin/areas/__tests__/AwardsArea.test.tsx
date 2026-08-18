// AwardsArea's own tests -- the panel a brand-new document reaches through
// (content.ts's own ContentNotFoundError), not merely an ordinary list
// screen. Three things pinned, matching this task's own brief: two loaded
// awards are both editable, a 404 renders an empty list with an Add button
// rather than an error, and editing a field commits through
// `registry.updateData` (never `register` -- publish.ts's own comment on
// why a write path that called `register` instead would clobber a fresh
// sha).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AwardsArea from '../AwardsArea';
import { saveSectionOpen } from '../../open-sections';
import type { ContentEntries, ContentRegistry } from '../../publish';
import type { ContentFileName } from '../../content';
import type { Award } from '../../../content/types';
import { NO_IMAGE_PREVIEWS } from '../../previews';

// A real-enough fake: `register`/`updateData` actually mutate a backing map,
// so `getEntries()` (and this test's own assertions on it) reflect what the
// component really did, not merely what it was told to do. Modelled on
// publish.ts's own `useContentRegistry`, kept intentionally smaller --
// nothing here needs `markPublished` or `version` to behave like anything
// but a no-op/counter.
function fakeRegistry(): { registry: ContentRegistry; updateDataCalls: Array<[ContentFileName, unknown]> } {
  const entries: ContentEntries = {};
  const updateDataCalls: Array<[ContentFileName, unknown]> = [];
  const registry: ContentRegistry = {
    register: vi.fn((file: ContentFileName, data: unknown, sha: string) => {
      entries[file] = { data, initial: data, sha };
    }),
    updateData: vi.fn((file: ContentFileName, data: unknown) => {
      updateDataCalls.push([file, data]);
      const existing = entries[file];
      if (existing) entries[file] = { ...existing, data };
    }),
    getEntries: () => entries,
    markPublished: vi.fn(),
    version: 0,
  };
  return { registry, updateDataCalls };
}

function stubFetch(handler: (path: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      expect(url.pathname).toBe('/api/content');
      expect(url.searchParams.get('path')).toBe('src/content/awards.json');
      return handler(url.pathname);
    }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderAwards(registry: ContentRegistry) {
  return render(
    <AwardsArea
      registry={registry}
      restoreDraft={null}
      stage={() => {}}
      publishLocked={false}
      previews={NO_IMAGE_PREVIEWS}
    />,
  );
}

const TWO_AWARDS: Award[] = [
  { id: 'a1', title: 'Best New Restaurant', awardedBy: 'City Eats', year: '2025' },
  { id: 'a2', title: 'Chef of the Year', awardedBy: 'Regional Guild', year: '2024' },
];

beforeEach(() => {
  // The section starts FOLDED (open-sections.ts's own default) -- every
  // test here needs its content actually in the accessibility tree, not
  // merely mounted-and-hidden.
  saveSectionOpen('awards', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('AwardsArea', () => {
  // Task 3's redesign: only one record's fields are on screen at a time, so
  // "both editable" is now proven one editor at a time -- open the first
  // award's row, check its Title/Year, Done, then the same for the second.
  it('renders two loaded awards, both editable', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify(TWO_AWARDS), sha: 'awards-sha-1' }));
    const { registry } = fakeRegistry();
    renderAwards(registry);

    fireEvent.click(await screen.findByRole('button', { name: 'Best New Restaurant' }));
    const firstTitle = await screen.findByLabelText('Title');
    expect((firstTitle as HTMLInputElement).value).toBe('Best New Restaurant');
    // "editable": not disabled/readonly, unlike SITE_FIELDS' own
    // developer-owned readonly fields (fields.ts) -- a real, provable
    // property, not merely "present on screen".
    expect(firstTitle).not.toBeDisabled();
    expect((screen.getByLabelText('Year') as HTMLInputElement).value).toBe('2025');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Chef of the Year' }));
    const secondTitle = await screen.findByLabelText('Title');
    expect((secondTitle as HTMLInputElement).value).toBe('Chef of the Year');
    expect(secondTitle).not.toBeDisabled();
    expect((screen.getByLabelText('Year') as HTMLInputElement).value).toBe('2024');
  });

  // The brief's own carried requirement: a brand-new document 404s until the
  // first write, and that is an empty list, not an error.
  it('a 404 renders an empty list with an Add button, not an error', async () => {
    stubFetch(() => jsonResponse(404, { message: 'That file does not exist yet.' }));
    const { registry } = fakeRegistry();
    renderAwards(registry);

    // "Add a award", not "Add an award": RecordList's own Add button is
    // `Add a ${noun}` unconditionally (RecordList.tsx) -- the same
    // pre-existing article/vowel mismatch press.json's own "Add a article"
    // already ships with (StoryPhotosArea.tsx's `noun="article"`). Matched
    // to what the component actually renders, not to correct grammar this
    // task does not touch.
    const addButton = await screen.findByRole('button', { name: 'Add a award' });
    expect(addButton).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('editing a title commits through registry.updateData, with the new value in place', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify([TWO_AWARDS[0]]), sha: 'awards-sha-2' }));
    const { registry, updateDataCalls } = fakeRegistry();
    renderAwards(registry);

    fireEvent.click(await screen.findByRole('button', { name: 'Best New Restaurant' }));
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Best New Restaurant, Revised' } });

    await waitFor(() => expect(updateDataCalls.length).toBeGreaterThan(0));
    const [file, data] = updateDataCalls[updateDataCalls.length - 1];
    expect(file).toBe('awards.json');
    expect(data).toEqual([{ ...TWO_AWARDS[0], title: 'Best New Restaurant, Revised' }]);
  });
});
