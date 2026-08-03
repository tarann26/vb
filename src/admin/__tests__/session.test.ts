import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSession } from '../session';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

describe('useSession', () => {
  it('starts as checking, before the probe has answered', () => {
    // Never resolves during this test -- the point is only to observe the
    // synchronous initial state, before any microtask from the probe below
    // has had a chance to run.
    stubFetch(() => new Promise<Response>(() => {}));
    const { result } = renderHook(() => useSession());
    expect(result.current.status).toBe('checking');
  });

  it('probes GET /api/wa, same-origin, to decide the initial status', () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderHook(() => useSession());
    expect(fetch).toHaveBeenCalledWith('/api/wa', { credentials: 'same-origin' });
  });

  it('resolves to "in" when the probe does not come back 401', async () => {
    stubFetch(async () => new Response(JSON.stringify({ counts: {}, lowerBound: true }), { status: 200 }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('in'));
  });

  it('resolves to "out" when the probe comes back 401', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('out'));
  });

  // The stale-flag failure this hook exists to avoid (see session.ts's own
  // comment): a network failure proves nothing about whether the cookie is
  // still valid, so it must fail toward 'out' (a recoverable login form),
  // never 'in' (a dashboard that then 401s on every real action).
  it('resolves to "out", not "in", when the probe request itself fails', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('out'));
  });

  it('logIn sets status to "in" without a second probe', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('out'));

    const callsBeforeLogin = vi.mocked(fetch).mock.calls.length;
    act(() => result.current.logIn());

    expect(result.current.status).toBe('in');
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBeforeLogin);
  });

  it('logOut sets status to "out"', async () => {
    stubFetch(async () => new Response(null, { status: 200 }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('in'));

    act(() => result.current.logOut());

    expect(result.current.status).toBe('out');
  });

  // No test for the `cancelled` guard in useSession's own effect (the flag
  // that skips setStatus after unmount): confirmed directly, by deleting
  // both `if (!cancelled)` checks and re-running this whole file, that
  // doing so does not turn anything here red. React 18 silently no-ops a
  // setState call on an already-unmounted component -- no warning, no
  // re-render, nothing any test in this file can observe -- so a test
  // asserting "no update after unmount" would pass identically whether the
  // guard exists or not. The guard stays (skipping a needless setState
  // call is still correct, and a defensible one for a future React version
  // that reintroduces the warning), but nothing here claims to cover it.
});
