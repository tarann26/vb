import { describe, it, expect, vi } from 'vitest';
import { STORY_ENDPOINT, fetchStory, isStoryContent } from '../story-api';
import type { StoryContent } from '../../content/types';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LIVE: StoryContent = {
  heading: 'About',
  paragraphs: ['A live paragraph, edited from the dashboard.'],
  chef: {
    name: 'Kamalika Anand',
    role: 'Chef and owner',
    portrait: '/team/kamalika-anand.webp',
    portraitAlt: 'Chef Kamalika Anand',
  },
};

describe('fetchStory', () => {
  it('requests the public read path and returns the parsed document', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, LIVE));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toEqual(LIVE);
    expect(fetchImpl).toHaveBeenCalledWith(STORY_ENDPOINT);
  });

  it('throws on a non-ok response, naming the status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: 'nope' }));
    await expect(fetchStory(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/status 503/);
  });

  // Everything below is the shape check, and it matters more here than it
  // did for awards: a malformed award is one missing card, a malformed
  // story is the whole section replaced with nothing. `null` means "keep
  // what you already have", never "render this".
  it('returns null for a body that is not an object', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, 'About'));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('returns null for an array, which JSON.parse would happily hand back', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it.each([
    ['no heading', { ...LIVE, heading: undefined }],
    ['a numeric heading', { ...LIVE, heading: 7 }],
    ['no paragraphs', { ...LIVE, paragraphs: undefined }],
    ['an empty paragraph list', { ...LIVE, paragraphs: [] }],
    ['a non-string inside paragraphs', { ...LIVE, paragraphs: ['ok', 3] }],
    ['no chef at all', { heading: LIVE.heading, paragraphs: LIVE.paragraphs }],
    ['a chef with no name', { ...LIVE, chef: { ...LIVE.chef, name: undefined } }],
    ['a chef with no portrait', { ...LIVE, chef: { ...LIVE.chef, portrait: undefined } }],
    ['a chef with a numeric portraitAlt', { ...LIVE, chef: { ...LIVE.chef, portraitAlt: 0 } }],
  ])('returns null for %s', async (_name, body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  // An off-site portrait must not be rendered just because the shape is
  // right. validateStory refuses it at the write boundary, but this body
  // comes from a database and a shape check that only looks at TYPES would
  // pass a URL straight into a homepage <img src>.
  it.each(['https://evil.example/x.webp', '//evil.example/x.webp', 'team/x.webp'])(
    'returns null for a portrait that is not a site-relative path: %s',
    async (portrait) => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { ...LIVE, chef: { ...LIVE.chef, portrait } }));
      expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
    },
  );

  it('accepts an extra key it does not know about, rather than rejecting the whole document', () => {
    expect(isStoryContent({ ...LIVE, somethingNew: true })).toBe(true);
  });
});
