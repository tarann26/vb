// ExperiencesArea's own tests -- the panel this task closes the one
// known-red test on (areas.test.tsx's "every panel names a real content
// file, and every content file has a panel"). Four things pinned, matching
// this task's own brief: two loaded items are both editable, "Add a
// coming-soon item" commits a new entry that is coming-soon with no `link`
// key at all, editing a field commits through `registry.updateData`, and an
// item edited into an invalid state surfaces the real validator's message
// (not a stub) through useValidation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExperiencesArea from '../ExperiencesArea';
import { saveSectionOpen } from '../../open-sections';
import type { ContentEntries, ContentRegistry } from '../../publish';
import type { ContentFileName } from '../../content';
import type { Experience } from '../../../content/types';
import { NO_IMAGE_PREVIEWS } from '../../previews';

// A real-enough fake: `register`/`updateData` actually mutate a backing map,
// so `getEntries()` (and this test's own assertions on it) reflect what the
// component really did, not merely what it was told to do. Modelled on
// AwardsArea.test.tsx's own fakeRegistry.
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
      expect(url.searchParams.get('path')).toBe('src/content/experiences.json');
      return handler(url.pathname);
    }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderExperiences(registry: ContentRegistry) {
  return render(
    <ExperiencesArea
      registry={registry}
      restoreDraft={null}
      stage={() => {}}
      publishLocked={false}
      previews={NO_IMAGE_PREVIEWS}
    />,
  );
}

const TWO_EXPERIENCES: Experience[] = [
  {
    id: 'catering',
    title: 'Catering',
    description: 'Bespoke menus for up to 100 guests.',
    image: '/atmosphere/table.webp',
    link: '/catering',
    comingSoon: false,
  },
  {
    id: 'retail',
    title: 'Retail',
    description: 'Our pantry shelf.',
    image: '/experiences/retail.webp',
    comingSoon: true,
  },
];

beforeEach(() => {
  // The section starts FOLDED (open-sections.ts's own default) -- every
  // test here needs its content actually in the accessibility tree, not
  // merely mounted-and-hidden.
  saveSectionOpen('experiences', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('ExperiencesArea', () => {
  it('renders two loaded items, both editable', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify(TWO_EXPERIENCES), sha: 'experiences-sha-1' }));
    const { registry } = fakeRegistry();
    renderExperiences(registry);

    const titles = await screen.findAllByLabelText('Title');
    expect(titles).toHaveLength(2);
    expect((titles[0] as HTMLInputElement).value).toBe('Catering');
    expect((titles[1] as HTMLInputElement).value).toBe('Retail');
    titles.forEach((input) => expect(input).not.toBeDisabled());

    const descriptions = screen.getAllByLabelText('Short description');
    expect((descriptions[0] as HTMLTextAreaElement).value).toBe('Bespoke menus for up to 100 guests.');
    expect((descriptions[1] as HTMLTextAreaElement).value).toBe('Our pantry shelf.');
  });

  it('"Add a coming-soon item" commits a new entry that is coming-soon, with no link key at all', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify(TWO_EXPERIENCES), sha: 'experiences-sha-2' }));
    const { registry, updateDataCalls } = fakeRegistry();
    renderExperiences(registry);

    const addButton = await screen.findByRole('button', { name: 'Add a coming-soon item' });
    fireEvent.click(addButton);

    await waitFor(() => expect(updateDataCalls.length).toBeGreaterThan(0));
    const [file, data] = updateDataCalls[updateDataCalls.length - 1];
    expect(file).toBe('experiences.json');
    const items = data as Experience[];
    expect(items).toHaveLength(3);
    const added = items[2];
    expect(added.comingSoon).toBe(true);
    // Not toBeUndefined() -- validateKnownKeys distinguishes an absent key
    // from a present-but-undefined one, and this proves which one a fresh
    // item actually gets.
    expect('link' in added).toBe(false);
  });

  // A separate case from the one above, so a regression in EITHER property
  // (the shape blankExperience seeds, or the validator's own pair rule
  // agreeing that shape is fine) goes red on its own, rather than one
  // assertion masking the other. A freshly added item is a VALID
  // coming-soon record the instant it appears -- no alert for the
  // comingSoon/link pair, once the debounce settles. If blankExperience
  // ever seeded `comingSoon: false` with no `link`, validateExperience
  // would refuse exactly that shape (the pair rule) and this would go red
  // too -- proving the panel's Add button and the real validator agree
  // about the same rule.
  it('a freshly-added coming-soon item raises no comingSoon/link validation problem', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify(TWO_EXPERIENCES), sha: 'experiences-sha-2b' }));
    const { registry } = fakeRegistry();
    renderExperiences(registry);

    const addButton = await screen.findByRole('button', { name: 'Add a coming-soon item' });
    fireEvent.click(addButton);

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(screen.queryByText(/needs a page to open, or mark it coming soon/i)).not.toBeInTheDocument();
  });

  it('editing a title commits through registry.updateData, with the new value in place', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify([TWO_EXPERIENCES[0]]), sha: 'experiences-sha-3' }));
    const { registry, updateDataCalls } = fakeRegistry();
    renderExperiences(registry);

    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Catering, Revised' } });

    await waitFor(() => expect(updateDataCalls.length).toBeGreaterThan(0));
    const [file, data] = updateDataCalls[updateDataCalls.length - 1];
    expect(file).toBe('experiences.json');
    expect(data).toEqual([{ ...TWO_EXPERIENCES[0], title: 'Catering, Revised' }]);
  });

  it('an item edited into an invalid state surfaces the real validator\'s message through useValidation', async () => {
    stubFetch(() => jsonResponse(200, { content: JSON.stringify([TWO_EXPERIENCES[0]]), sha: 'experiences-sha-4' }));
    const { registry } = fakeRegistry();
    renderExperiences(registry);

    const title = await screen.findByLabelText('Title');
    // Blanking the only item's title is what validateExperience refuses --
    // see src/content/validate.ts's own `isBlank(item.title)` branch. If
    // this panel were wired to a stub validator rather than the real one,
    // this message could never appear.
    fireEvent.change(title, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByText('this item needs a title')).toBeInTheDocument();
    });
  });
});
