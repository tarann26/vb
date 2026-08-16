// The content fixtures every test that mounts the whole dashboard needs, in
// one place.
//
// Extracted from AdminApp.test.tsx when a second file (the per-panel DOM
// snapshot baseline) had to render the same ten panels from the same ten
// files. Two copies of these, drifting apart, would make the snapshot
// baseline stop describing the thing the behavioural tests actually
// exercise, which is the one property that makes the baseline worth having.
import { vi } from 'vitest';
import type {
  Article,
  Copy,
  Dish,
  Drink,
  Galleries,
  MenuFile,
  Section,
  SiteContent,
  StoryContent,
} from '../../content/types';
// The real, committed files -- not hand-typed fixtures -- for galleries.json,
// menus.json, story.json and copy.json specifically: each one has real
// structural rules (assertCopy's nav.links shape and non-blank sweep,
// validateGalleries' non-empty lists, MENU_FILE_NAME's own path shape) that
// a hand-typed fixture would have to reproduce by hand and could easily get
// subtly wrong. Reusing the real files is the same choice
// useValidation.test.tsx's own REAL_DISHES already makes, for the identical
// reason (see that file's own comment).
import galleriesJson from '../../content/galleries.json';
import menusJson from '../../content/menus.json';
import storyJson from '../../content/story.json';
import copyJson from '../../content/copy.json';

export function dish(id: string, name: string): Dish {
  return { id, name, description: `${name}, described.`, image: `/food/${id}.webp`, tags: [] };
}
export function drink(id: string, name: string): Drink {
  return { id, name, description: `${name}, described.`, category: 'cocktail', image: null };
}
export function article(id: string, title: string): Article {
  return { id, title, publication: 'Times', date: '2026-01-01', excerpt: 'An excerpt.', url: null, image: `/press/${id}.webp` };
}

export const DISHES = [dish('a', 'Dish A'), dish('b', 'Dish B')];
export const DRINKS = [drink('x', 'Drink X'), drink('y', 'Drink Y')];
export const PRESS = [article('p', 'Article P'), article('q', 'Article Q')];
export const SECTIONS: Section[] = [
  { kind: 'bespoke', id: 'hero', enabled: true },
  { kind: 'bespoke', id: 'ourStory', enabled: true },
  { kind: 'bespoke', id: 'atmosphere', enabled: true },
  { kind: 'bespoke', id: 'food', enabled: true },
  { kind: 'bespoke', id: 'drinks', enabled: true },
  { kind: 'bespoke', id: 'press', enabled: true },
  { kind: 'bespoke', id: 'awards', enabled: true },
  { kind: 'bespoke', id: 'visit', enabled: true },
];
export const SITE: SiteContent = {
  name: 'Via Bianca',
  tagline: 'Pastificio & Ristorante',
  strapline: 'Sip Italiano',
  address: { street: '1 Test Street', locality: 'Delhi', postalCode: '110048', country: 'IN' },
  phones: ['+91 00000 00000'],
  whatsapp: { number: '910000000000', prefilledMessage: 'Hi' },
  socials: { instagram: 'https://instagram.com/test', linkedin: null },
  hours: [{ days: ['Mo', 'Tu'], opens: '12:00', closes: '23:00' }],
  seo: { title: 'Via Bianca', description: 'An Italian kitchen', keywords: 'italian', ogImage: '/og.jpg', url: 'https://example.com', locale: 'en_IN' },
  copyrightYear: 2026,
};

export const GALLERIES = galleriesJson as Galleries;
export const MENUS = menusJson as MenuFile[];
export const STORY = storyJson as StoryContent;
export const COPY = copyJson as Copy;

export const WA_RESPONSE = () =>
  new Response(JSON.stringify({ lowerBound: true }), { status: 200, headers: { 'content-type': 'application/json' } });

export function contentResponse(data: unknown, sha: string): Response {
  return new Response(JSON.stringify({ content: JSON.stringify(data), sha }));
}

// `dishesResponse` is a Promise, not a Response, precisely so a caller can
// gate it with a deferred(); every other file resolves immediately,
// matching how the real GET /api/content calls actually behave (ten
// independent requests, not sequenced).
export function stubFetch(dishesResponse: Promise<Response> | Response = contentResponse(DISHES, 'sha-dishes')) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/wa') return WA_RESPONSE();
      if (url.includes('dishes.json')) return dishesResponse;
      if (url.includes('drinks.json')) return contentResponse(DRINKS, 'sha-drinks');
      if (url.includes('press.json')) return contentResponse(PRESS, 'sha-press');
      if (url.includes('sections.json')) return contentResponse(SECTIONS, 'sha-sections');
      if (url.includes('site.json')) return contentResponse(SITE, 'sha-site');
      if (url.includes('galleries.json')) return contentResponse(GALLERIES, 'sha-galleries');
      if (url.includes('menus.json')) return contentResponse(MENUS, 'sha-menus');
      if (url.includes('story.json')) return contentResponse(STORY, 'sha-story');
      if (url.includes('copy.json')) return contentResponse(COPY, 'sha-copy');
      if (url.includes('pages.json')) return contentResponse([], 'sha-pages');
      // Phase 2, Task 11: awards.json, matching pages.json's own precedent
      // just above -- an empty list with a real sha, not a 404. A missing
      // branch here does not answer 404 (AwardsArea.tsx's own empty-list
      // case, which this fixture could arguably leave untested) -- this
      // `stubFetch` throws on anything unhandled, which AwardsArea reads as
      // a genuine load FAILURE (its role="alert"/"needs attention" path),
      // not as the empty-document state. That is exactly the shift
      // e2e/edit-backend.ts's own header comment warns about for the e2e
      // fixture: a name missing here silently shows an error banner over
      // content another test is asserting on, and Task 11's own dashboard
      // tests (AdminApp.test.tsx's "marks the folded section as needing
      // attention" among them) confirmed it directly -- a second, unrelated
      // "needs attention" marker for Awards, not present before this file
      // existed.
      if (url.includes('awards.json')) return contentResponse([], 'sha-awards');
      throw new Error(`dashboardFixtures: unexpected fetch to ${url}`);
    }),
  );
}
