import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import OurStory from '../OurStory';
import { story, galleries } from '../../content';
import { ContentProvider, defaultBundle } from '../../content/ContentContext';
import type { StoryContent } from '../../content/types';

// Deliberately NOT story.chef.portrait/portraitAlt -- those are the real,
// committed values, which is exactly what let a hardcoded literal hide in
// this component before: OurStory.tsx could read
// '/team/kamalika-anand.webp' directly instead of `chef.portrait` and every
// test using the real `story` import (this file's own `story.chef.portrait`
// among them) would keep passing, because a hardcoded copy of the real
// value and a real binding to it render identically. A fixture value that
// DIFFERS from the real one is what makes the two distinguishable at all.
const FIXTURE_PORTRAIT = '/team/fixture-only-portrait-not-the-real-photo.webp';
const FIXTURE_ALT = 'Fixture-only alt text, never the real photo description';

function bundleWithChef(chef: StoryContent['chef'] | undefined) {
  return {
    ...defaultBundle,
    story: { ...defaultBundle.story, chef } as StoryContent,
  };
}

describe('OurStory', () => {
  // "No trailing ellipsis" moved to src/content/validate.ts: it rejects a
  // bad story.json before the commit exists, rather than after the build
  // has already run against it.

  // Task 7: this test, the carousel test below it, and both byline tests
  // in the nested describe now render a component that ALSO fetches. They
  // still pass, but not because they prove the D1 path -- `<OurStory />`
  // here gets no `fetchImpl`, so it falls through to the real global
  // `fetch`, and jsdom rejects a relative URL (the same reason Awards.tsx's
  // own swallowed `.catch` exists). That rejection is caught and swallowed,
  // `story` never leaves its compiled-in initial state, and these four
  // assertions end up checking the FALLBACK render, same as before Task 7.
  // The live-swap path is proved separately, below, by the tests that pass
  // an explicit `fetchImpl`.
  it('renders every paragraph', () => {
    render(<OurStory />);
    story.paragraphs.forEach((p) => {
      expect(screen.getByText(p)).toBeInTheDocument();
    });
  });

  // Scoped to the carousel, not to the whole section. Before Phase 4 this
  // counted every <img> on the page and that happened to equal the carousel
  // length; the byline portrait is now a second kind of image in the same
  // section, so an unscoped count would have had to be bumped to
  // `length + 1` -- a number that stays correct no matter what goes wrong
  // with the portrait, i.e. an assertion that could no longer fail for its
  // stated reason.
  it('carousel images come from content, not a filename list', () => {
    const { container } = render(<OurStory />);
    const carousel = container.querySelector('[data-testid="our-story-carousel"]');
    expect(carousel).not.toBeNull();
    const images = within(carousel as HTMLElement).getAllByRole('img');
    expect(images).toHaveLength(galleries.ourStory.length);
    images.forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Slide \d+$/);
    });
  });

  describe('the chef byline', () => {
    it('names her and says what she is', () => {
      render(<OurStory />);
      const byline = screen.getByTestId('chef-byline');
      expect(within(byline).getByText(story.chef.name)).toBeInTheDocument();
      expect(within(byline).getByText(story.chef.role)).toBeInTheDocument();
    });

    it('shows her portrait, from content, with her own description of it', () => {
      render(<OurStory />);
      const portrait = screen.getByTestId('chef-portrait');
      expect(portrait).toHaveAttribute('src', story.chef.portrait);
      expect(portrait).toHaveAttribute('alt', story.chef.portraitAlt);
    });

    // Closes the known limit Task 2's own commit recorded: "the jsdom test
    // cannot tell {chef.portrait} from a hardcoded
    // '/team/kamalika-anand.webp', because they are the same string today."
    // The test above still can't -- it asserts against `story.chef.portrait`,
    // the SAME real value a hardcoded literal would coincidentally match, so
    // hardcoding src={'/team/kamalika-anand.webp'} in OurStory.tsx leaves it
    // green. This one renders through a ContentProvider carrying a FIXTURE
    // portrait/alt that differ from the real, committed story.json, so a
    // hardcoded real-literal reaches this assertion as a visible mismatch
    // instead of a coincidental match. Proven by mutation: hardcoding
    // OurStory.tsx's img src/alt to story.json's real two literals reddens
    // THIS test (and only this one -- the rest of the suite, including the
    // test above, stays green against that exact mutation).
    it('the portrait binding is real, not a hardcoded copy of the real value', () => {
      render(
        <ContentProvider value={bundleWithChef({ name: 'X', role: 'Y', portrait: FIXTURE_PORTRAIT, portraitAlt: FIXTURE_ALT })}>
          <OurStory />
        </ContentProvider>,
      );
      const portrait = screen.getByTestId('chef-portrait');
      expect(portrait).toHaveAttribute('src', FIXTURE_PORTRAIT);
      expect(portrait).toHaveAttribute('alt', FIXTURE_ALT);
    });

    // Task 7's D1 swap removes the three preconditions that make an
    // undefined `chef` unreachable today (this file's own header comment on
    // OurStory.tsx names them). Reproduced ahead of that task landing: a
    // content bundle with no `chef` at all -- the exact shape a fetch gone
    // wrong or a pre-migration record could hand this component once content
    // comes from D1 rather than a guard-checked build-time import.
    it('does not crash when `chef` itself is missing from content', () => {
      expect(() =>
        render(
          <ContentProvider value={bundleWithChef(undefined)}>
            <OurStory />
          </ContentProvider>,
        ),
      ).not.toThrow();
      // Still renders the rest of the page -- a missing byline is not a
      // missing story.
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
    });

    // The portrait is the last thing on the page's eighth section. Eager
    // loading it would put a 114KB request on the critical path for an
    // image almost nobody scrolls to.
    it('defers the portrait until it is scrolled to', () => {
      render(<OurStory />);
      expect(screen.getByTestId('chef-portrait')).toHaveAttribute('loading', 'lazy');
    });

    // The byline sits BELOW the prose, not above it: the paragraphs are
    // already written in her voice, so the signature belongs at the end of
    // the letter. Asserted by document order rather than by a class name,
    // which would survive a reorder.
    it('sits after the last paragraph', () => {
      render(<OurStory />);
      const lastParagraph = screen.getByText(story.paragraphs[story.paragraphs.length - 1]);
      const byline = screen.getByTestId('chef-byline');
      expect(lastParagraph.compareDocumentPosition(byline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('the live copy from D1', () => {
    const LIVE = {
      heading: 'About Via Bianca',
      paragraphs: ['A paragraph she edited five seconds ago.'],
      chef: {
        name: 'K. Anand',
        role: 'Chef, owner, and pasta maker',
        portrait: '/team/kamalika-anand.webp',
        portraitAlt: 'A different description',
      },
    };

    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    it('paints the compiled-in copy before the fetch resolves', () => {
      // A promise that never settles: whatever renders here is what a
      // visitor sees at first paint, which for this section must never be
      // nothing.
      const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.getByTestId('chef-byline')).toHaveTextContent(story.chef.name);
    });

    it('swaps in the live copy when it arrives', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(LIVE));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      expect(await screen.findByText(LIVE.paragraphs[0])).toBeInTheDocument();
      expect(screen.getByText(LIVE.heading)).toBeInTheDocument();
      expect(screen.getByTestId('chef-portrait')).toHaveAttribute('alt', LIVE.chef.portraitAlt);
      expect(screen.queryByText(story.paragraphs[0])).toBeNull();
    });

    it('keeps the compiled-in copy when the response is malformed', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ heading: 'Broken' }));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.queryByText('Broken')).toBeNull();
    });

    it('keeps the compiled-in copy, and shows no error, when the fetch fails outright', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('offline');
      });
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    // The carousel comes from galleries.json, which did not move. A D1
    // document must not be able to change the photos, and this pins that
    // the two are independent rather than merely happening not to interact.
    it('does not let the live copy touch the carousel', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(LIVE));
      const { container } = render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await screen.findByText(LIVE.paragraphs[0]);
      const carousel = container.querySelector('[data-testid="our-story-carousel"]') as HTMLElement;
      expect(within(carousel).getAllByRole('img')).toHaveLength(galleries.ourStory.length);
    });
  });
});
