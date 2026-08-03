import { useCallback, useEffect, useState } from 'react';

export type SessionStatus = 'checking' | 'out' | 'in';

export interface Session {
  status: SessionStatus;
  logIn: () => void;
  logOut: () => void;
}

// worker/index.ts's POST /api/login sets `vb_session` as HttpOnly, so no
// script running in this browser -- this one included -- can ever read it
// directly. That's deliberate (see that route's own comment), which means
// the only way this hook can learn whether a session is currently valid is
// to ask the server with a request that requires one and read the status
// code back.
//
// GET /api/wa (worker/index.ts's handleReadWaCounts) already does exactly
// that: it's authenticated, it has no side effects worth worrying about
// from a stray probe, and it answers a clean 401 the moment the cookie is
// missing, expired, or fails HMAC verification -- so it doubles as the
// session probe rather than this task adding a dedicated "am I logged in"
// endpoint. Treat 401 as logged out; anything else (200 today; any future
// non-auth error this route might grow) as logged in, since 401 is the
// only status this route uses to mean "not authenticated."
async function probeSession(): Promise<boolean> {
  const response = await fetch('/api/wa', { credentials: 'same-origin' });
  return response.status !== 401;
}

// Deliberately not backed by localStorage (or anything else persisted
// client-side). A stored "logged in" flag goes stale the moment the 7-day
// token expires -- she'd open the dashboard, see it as logged in from the
// stale flag, and get a 401 on the first real action instead of the login
// form she actually needs. Re-probing on every mount is the only way this
// stays honest about the *session*, not a cached belief about it. (Drafts
// are a different, later concern -- see this task's brief.)
export function useSession(): Session {
  const [status, setStatus] = useState<SessionStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    probeSession()
      .then((loggedIn) => {
        if (!cancelled) setStatus(loggedIn ? 'in' : 'out');
      })
      .catch(() => {
        // A network failure proves nothing about whether the cookie is
        // still valid -- fail toward 'out' (a login form, one submit away
        // from working) rather than 'in' (a dashboard that then 401s on
        // every action), for the same reason the localStorage approach
        // above was rejected.
        if (!cancelled) setStatus('out');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Called after a successful POST /api/login (204) -- Login.tsx already
  // knows the login succeeded at that point, so this is a plain state
  // transition, not a second probe.
  const logIn = useCallback(() => setStatus('in'), []);

  // No POST /api/logout exists on the Worker (worker/index.ts's route list
  // has none): the 7-day cookie itself, or a TOKEN_SECRET rotation (see
  // docs/cloudflare-cutover.md), are the only things that ever end a
  // session server-side. logOut is a client-side-only transition -- it
  // re-shows the login form immediately, which is what matters the moment
  // any authenticated call this dashboard makes comes back 401 (e.g. the
  // token expired mid-session) -- it does not and cannot invalidate the
  // cookie itself.
  const logOut = useCallback(() => setStatus('out'), []);

  return { status, logIn, logOut };
}
