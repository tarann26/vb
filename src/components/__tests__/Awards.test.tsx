import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Awards from '../Awards';
import { AWARDS_ENDPOINT, fetchAwards } from '../awards-api';
import { copy } from '../../content';
import type { Award } from '../../content/types';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const AWARD_A: Award = { id: 'a', title: 'Best New Restaurant', awardedBy: 'City Foodie Awards', year: '2024' };
const AWARD_B: Award = { id: 'b', title: "Critics' Choice", awardedBy: 'Delhi Times', year: '2025' };

// ---------------------------------------------------------------------------
// fetchAwards -- the pure fetch-and-shape-check function, independent of the
// component. `fetchImpl` is injected exactly the same posture requestPublish
// and fetchBuildStatus already take (src/admin/publish.ts), so none of this
// needs vi.stubGlobal.
describe('fetchAwards', () => {
  it('requests the public read path and returns the parsed list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [AWARD_A, AWARD_B]));
    const result = await fetchAwards(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(AWARDS_ENDPOINT);
    expect(result).toEqual([AWARD_A, AWARD_B]);
  });

  it('throws on a non-ok response, naming the status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { message: 'nope' }));
    await expect(fetchAwards(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/status 500/);
  });

  // Content from a database with no build-time guard in front of it -- the
  // shape has to be checked where it arrives. `{}` is not an array at all.
  it('returns an empty list, not a crash, when the response is not an array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    expect(await fetchAwards(fetchImpl as unknown as typeof fetch)).toEqual([]);
  });

  // Non-vacuous half of the shape check: a malformed ENTRY inside an
  // otherwise-real array is dropped, not merely passed through because the
  // outer value happened to be an array.
  it('filters out an entry missing a required field, keeping the well-formed ones', async () => {
    const malformed = { id: 'c', title: 'No awarding body', year: '2020' };
    const fetchImpl = vi.fn(async () => jsonResponse(200, [AWARD_A, malformed]));
    expect(await fetchAwards(fetchImpl as unknown as typeof fetch)).toEqual([AWARD_A]);
  });

  it('filters out an entry whose year is not a string', async () => {
    const malformed = { ...AWARD_A, id: 'd', year: 2020 };
    const fetchImpl = vi.fn(async () => jsonResponse(200, [malformed]));
    expect(await fetchAwards(fetchImpl as unknown as typeof fetch)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// <Awards /> -- the section itself. Heading and intro are always present
// (copy.json, live at first paint); the list depends on the injected fetch.
describe('Awards', () => {
  it('renders the heading and intro immediately, before any fetch resolves', () => {
    render(<Awards fetchImpl={vi.fn(() => new Promise(() => {})) as unknown as typeof fetch} />);
    expect(screen.getByText(copy.awards.heading)).toBeInTheDocument();
    expect(screen.getByText(copy.awards.intro)).toBeInTheDocument();
  });

  it('renders every award title once the injected fetch resolves', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [AWARD_A, AWARD_B]));
    render(<Awards fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByText(AWARD_A.title)).toBeInTheDocument());
    expect(screen.getByText(AWARD_B.title)).toBeInTheDocument();
    expect(screen.getByText(AWARD_A.awardedBy)).toBeInTheDocument();
    expect(screen.getByText(AWARD_B.year)).toBeInTheDocument();
  });

  // The brief's own requirement: a fetch failure degrades to chrome only --
  // never a crash, never an error message a visitor can see.
  it('renders the heading and no error text when the fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    render(<Awards fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    // Give the rejected promise's .catch a turn to settle before asserting
    // nothing crashed and nothing error-shaped rendered.
    await waitFor(() => expect(screen.getByText(copy.awards.heading)).toBeInTheDocument());
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The brief's own third case: a non-array response is handled the same
  // way fetchAwards itself handles it -- no crash, an empty list, still no
  // visible error.
  it('renders no crash and an empty list when the fetch resolves to a non-array body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    render(<Awards fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(copy.awards.heading)).toBeInTheDocument());
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  // `alt=""` is deliberate (a badge next to its own already-visible title,
  // awarding body and year -- see Awards.tsx's own comment), which also
  // means jsdom drops it from the accessibility tree entirely (no `img`
  // role for an empty-alt image), so this queries the DOM directly rather
  // than through `getByRole`.
  it('renders a badge image only for an award that has one', async () => {
    const withBadge: Award = { ...AWARD_A, image: '/awards/badge.webp' };
    const fetchImpl = vi.fn(async () => jsonResponse(200, [withBadge, AWARD_B]));
    render(<Awards fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByText(withBadge.title)).toBeInTheDocument());
    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', '/awards/badge.webp');
  });

  it('renders inside a real <section id="awards">', () => {
    render(<Awards fetchImpl={vi.fn(() => new Promise(() => {})) as unknown as typeof fetch} />);
    expect(document.querySelector('#awards')).not.toBeNull();
  });
});
