import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';
import { copy } from '../../content';

describe('unmatched routes', () => {
  it('renders a 404 with a way home', () => {
    render(
      <MemoryRouter initialEntries={['/not-a-real-page']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    // Matched against copy.notFound.* itself, not a hardcoded pattern like
    // /not found/i -- rewording either string is a legitimate content edit
    // and must not fail the deploy gate. Same pattern as NavBar.test.tsx.
    expect(screen.getByRole('heading', { name: copy.notFound.heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.notFound.back })).toBeInTheDocument();
  });
});
