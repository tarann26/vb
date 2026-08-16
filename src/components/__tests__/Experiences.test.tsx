// jsdom has no layout engine, so nothing here claims anything about
// visibility, overflow or position -- those belong to
// e2e/experiences-carousel.spec.ts. What this file checks is markup: which
// element kind each card renders as (a router <Link> vs a plain, inert
// <div>), and that the degradation path -- a link to a page that has been
// switched off -- lands on the same static card a `comingSoon: true` item
// gets, not on a dead <Link>.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Experiences from '../Experiences';
import { ContentProvider, defaultBundle } from '../../content/ContentContext';
import type { Experience, Page } from '../../content/types';

function experience(overrides: Partial<Experience> & Pick<Experience, 'id'>): Experience {
  return {
    title: `Title ${overrides.id}`,
    description: `Description ${overrides.id}`,
    image: `/experiences/${overrides.id}.webp`,
    comingSoon: false,
    ...overrides,
  };
}

function page(slug: string, enabled: boolean): Page {
  return {
    slug,
    name: slug,
    inNav: true,
    enabled,
    seo: { title: slug, description: slug },
    sections: [],
  };
}

function renderExperiences(experiences: Experience[], pages: Page[] = []) {
  return render(
    <MemoryRouter>
      <ContentProvider value={{ ...defaultBundle, experiences, pages }}>
        <Experiences />
      </ContentProvider>
    </MemoryRouter>,
  );
}

describe('Experiences', () => {
  it('renders an item linked to an enabled page as an <a> with that href', () => {
    const items = [experience({ id: 'catering', link: '/catering' })];
    renderExperiences(items, [page('catering', true)]);
    const card = screen.getByTestId('experience-card-catering');
    expect(card.tagName).toBe('A');
    expect(card).toHaveAttribute('href', '/catering');
  });

  it('renders a comingSoon item as neither an <a> nor a <button>, and shows the stamp', () => {
    const items = [experience({ id: 'membership', comingSoon: true })];
    renderExperiences(items);
    const card = screen.getByTestId('experience-card-membership');
    expect(card.tagName).not.toBe('A');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('experience-stamp-membership')).toBeInTheDocument();
  });

  // The degradation path nothing else covers: a link that is well-formed and
  // not marked comingSoon, but whose target page has been switched off.
  it('renders an item linked to a DISABLED page as no <a>, with the stamp shown', () => {
    const items = [experience({ id: 'gifting', link: '/gifting' })];
    renderExperiences(items, [page('gifting', false)]);
    const card = screen.getByTestId('experience-card-gifting');
    expect(card.tagName).not.toBe('A');
    expect(screen.getByTestId('experience-stamp-gifting')).toBeInTheDocument();
  });

  it('renders the heading and intro from the injected copy', () => {
    renderExperiences([experience({ id: 'a' })]);
    expect(screen.getByText(defaultBundle.copy.experiences.heading)).toBeInTheDocument();
    expect(screen.getByText(defaultBundle.copy.experiences.intro)).toBeInTheDocument();
  });

  // A filter added later that silently dropped an item would show up here
  // as a card-count mismatch, not as a missing feature nobody happened to
  // notice.
  it('renders exactly one card per item in the list', () => {
    const items = [
      experience({ id: 'one', link: '/one' }),
      experience({ id: 'two', comingSoon: true }),
      experience({ id: 'three' }),
    ];
    renderExperiences(items, [page('one', true)]);
    expect(screen.getAllByTestId(/^experience-card-/)).toHaveLength(items.length);
  });
});
