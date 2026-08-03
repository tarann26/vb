import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

// "does not render admin code at /" was deliberately NOT added here (Plan 4
// Task 1 brief). At `/`, AppRoutes renders HomePage, which has no password
// field whether AdminApp is lazy, static, or inlined -- no mutation of the
// feature would ever turn a test like that red. A route/render test cannot
// observe a bundler's decision to put a module in its own chunk; that's
// what src/test/bundle.test.ts's import-graph check and
// src/test/bundle.post-build.test.ts's dist/assets/ grep are for.
describe('the admin route', () => {
  it('renders the login form at /edit/manage', async () => {
    // Stubbed, not left to hit the real network: useSession's probe
    // (GET /api/wa) needs to resolve to something definite for this test to
    // be deterministic, and 401 (logged out) is the one state that
    // guarantees AdminApp renders Login rather than the placeholder
    // dashboard. See src/admin/__tests__/session.test.ts for the hook's own
    // behavior under every status this route can return.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    render(
      <MemoryRouter initialEntries={['/edit/manage']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    // findBy, not getBy -- the route is lazy, so the chunk (and then the
    // session probe inside it) both resolve asynchronously after the
    // initial render.
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
  });
});
