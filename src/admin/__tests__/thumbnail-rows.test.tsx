// A row-by-row walk of every row type that gets a thumbnail, and every one
// that must not.
//
// Thumbnail's own isolated tests pass identically whether the component is
// mounted on six row types or on zero, so they say nothing about the wiring.
// This file is the wiring. It queries `[data-thumbnail]` rather than any
// `<img>` inside the row, deliberately: several of these rows ALSO render
// PhotoField's own 96px preview of the same photo, so a test that merely
// found "an <img> with this src" could not fail.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { markEveryAreaSeeded, renderDashboard } from './renderDashboard';
import { COPY, GALLERIES, MENUS, PRESS, SECTIONS, SITE, STORY, WA_RESPONSE, contentResponse, dish } from './dashboardFixtures';
import TemplateContentForm from '../TemplateContentForm';
import type { Drink, TemplateSection } from '../../content/types';

// Drinks carrying a real image path, unlike the shared fixture's `null` --
// the null case is Thumbnail's own placeholder test, and this file is about
// whether the component is mounted at all.
const DRINKS_WITH_PHOTOS: Drink[] = [
  { id: 'x', name: 'Drink X', description: 'X, described.', category: 'cocktail', image: '/mocktails/x.webp' },
];

function stubFetchWithPhotos(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url.includes('dishes.json')) return contentResponse([dish('a', 'Dish A')], 'sha-dishes');
      if (url.includes('drinks.json')) return contentResponse(DRINKS_WITH_PHOTOS, 'sha-drinks');
      if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
      if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
      return new Response('nope', { status: 500 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// Opens a panel by its heading and returns the panel element.
async function openPanel(heading: string, panelId: string): Promise<HTMLElement> {
  const toggle = await screen.findByRole('button', { name: heading });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  const panel = document.getElementById(`section-panel-${panelId}`);
  if (!panel) throw new Error(`no panel for ${panelId}`);
  await waitFor(() => expect(within(panel).queryByText(/^Loading /)).not.toBeInTheDocument());
  return panel;
}

function thumbnails(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll('[data-thumbnail]'));
}

// ---------------------------------------------------------------------------
describe('the six row types that get a thumbnail', () => {
  it.each([
    { label: 'Dishes', route: '/edit/manage/menu', heading: 'Dishes', panel: 'dishes', src: '/food/a.webp' },
    { label: 'Drinks', route: '/edit/manage/menu', heading: 'Drinks', panel: 'drinks', src: '/mocktails/x.webp' },
    { label: 'Press', route: '/edit/manage/story', heading: 'Press', panel: 'press', src: '/press/p.webp' },
  ])('$label rows carry one, showing the record\'s own image path', async ({ route, heading, panel, src }) => {
    markEveryAreaSeeded();
    stubFetchWithPhotos();
    renderDashboard(route);
    const el = await openPanel(heading, panel);

    const found = thumbnails(el);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((node) => node.getAttribute('src') === src)).toBe(true);
    // Mutation this guards: delete the <Thumbnail/> from RecordList --
    // exactly these three rows go red and no others.
  });

  it('Galleries rows carry one, for atmosphere and Our Story photos', async () => {
    markEveryAreaSeeded();
    stubFetchWithPhotos();
    renderDashboard('/edit/manage/story');
    const el = await openPanel('Galleries', 'galleries');

    const found = thumbnails(el);
    expect(found.some((node) => node.getAttribute('src') === GALLERIES.atmosphere[0].src)).toBe(true);
    expect(found.some((node) => node.getAttribute('src') === GALLERIES.ourStory[0].src)).toBe(true);
  });

  // The hero collage is deliberately excluded: it is not a list of rows, and
  // its own editor shows the real photographs at real size already.
  it('the hero collage rows carry none', async () => {
    markEveryAreaSeeded();
    stubFetchWithPhotos();
    renderDashboard('/edit/manage/story');
    const el = await openPanel('Galleries', 'galleries');

    const photoFields = within(el).getAllByLabelText('Photo');
    const collageRow = photoFields[photoFields.length - 1].closest('li');
    expect(collageRow).not.toBeNull();
    expect(thumbnails(collageRow as HTMLElement)).toHaveLength(0);
  });
});

describe("the template form's own two row types", () => {
  const ITEM_LIST: TemplateSection = {
    kind: 'template',
    id: 'plates',
    template: 'itemList',
    enabled: true,
    content: {
      heading: 'Plates',
      items: [{ name: 'Focaccia', description: 'Warm.', image: '/food/focaccia.webp' }],
    },
  } as TemplateSection;

  const GALLERY: TemplateSection = {
    kind: 'template',
    id: 'shots',
    template: 'gallery',
    enabled: true,
    content: { heading: 'Shots', images: [{ src: '/atmosphere/one.webp', alt: 'One' }] },
  } as TemplateSection;

  it.each([
    { label: 'item-list rows', section: ITEM_LIST, src: '/food/focaccia.webp' },
    { label: 'gallery-image rows', section: GALLERY, src: '/atmosphere/one.webp' },
  ])('$label carry one', ({ section, src }) => {
    const { container } = render(
      <TemplateContentForm
        section={section}
        onChange={() => {}}
        rowPrefix="[0]"
        problems={[]}
        idPrefix="section"
        stage={() => {}}
      />,
    );
    const found = thumbnails(container);
    expect(found.some((node) => node.getAttribute('src') === src)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the panels that get no thumbnail at all', () => {
  // Menus are PDFs -- rendering a first page needs pdf.js in the admin
  // bundle for a 48px picture, and a file glyph beside a label that already
  // says "Food menu" adds nothing. The other four have no image field: a
  // placeholder box on a row that can never hold a picture is decoration,
  // and decoration on a row that means nothing is the "bland" complaint in
  // miniature.
  it.each([
    { label: 'Menus', route: '/edit/manage/menu', heading: 'Menus', panel: 'menus' },
    { label: 'Pages', route: '/edit/manage/pages', heading: 'Pages', panel: 'pages' },
    { label: 'Homepage sections', route: '/edit/manage/pages', heading: 'Homepage sections', panel: 'sections' },
    { label: 'Opening hours', route: '/edit/manage/details', heading: 'Opening hours', panel: 'hours' },
    { label: 'Page copy', route: '/edit/manage/details', heading: 'Page copy', panel: 'copy' },
  ])('$label has none', async ({ route, heading, panel }) => {
    markEveryAreaSeeded();
    stubFetchWithPhotos();
    renderDashboard(route);
    const el = await openPanel(heading, panel);
    expect(thumbnails(el)).toHaveLength(0);
  });
});
