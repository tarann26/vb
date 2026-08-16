import React, { useState } from 'react';

interface LoginProps {
  onLogin: () => void;
  // Review finding: PublishBar's own "You've been signed out. Log in and
  // your changes will still be here." lives inside PublishBar itself -- but
  // `onUnauthenticated` (this callback's own trigger) calls `logOut`, which
  // flips AdminApp's status to 'out' and unmounts PublishBar (and every
  // section) IMMEDIATELY, in the same render. That message was being set
  // into React state and thrown away before a single paint could ever show
  // it to her -- reproduced directly (AdminApp.test.tsx's own "does not
  // destroy the draft on re-login" test never actually saw that text on
  // screen until this prop existed). AdminApp now holds the notice itself
  // (survives the unmount, since it lives one level up) and hands it here
  // to render inside the one screen she's actually looking at when it
  // matters.
  notice?: string;
}

// One message per status this route can actually return (worker/index.ts's
// handleLogin), plus a fallback for anything else (a network failure, a
// stray 4xx/5xx nothing here names). Never the raw response body: an error
// message straight from the server is a detail she has no way to act on,
// and none of this route's real responses carry one worth surfacing raw
// anyway.
function messageFor(status: number): string {
  switch (status) {
    case 401:
      return "That password didn't work.";
    case 429:
      return 'Too many attempts. Try again in 15 minutes.';
    case 500:
      return "Login isn't set up yet — ask your developer.";
    default:
      return 'Something went wrong. Try again.';
  }
}

const Login: React.FC<LoginProps> = ({ onLogin, notice }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.status === 204) {
        // Never held onto a moment longer than the one request that needed
        // it -- not in state, not logged, not echoed anywhere.
        setPassword('');
        onLogin();
        return;
      }

      setError(messageFor(response.status));
    } catch {
      setError(messageFor(-1));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f5f0] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md"
        aria-label="Admin login"
      >
        <h1 className="mb-6 font-['Parisienne'] text-3xl text-ink">Via Bianca</h1>

        {notice && (
          <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-ink">
            {notice}
          </p>
        )}

        <label
          htmlFor="admin-password"
          className="mb-2 block font-['Montserrat'] text-sm uppercase tracking-wide text-accent"
        >
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-ink focus:border-accent focus:outline-none"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded bg-brand py-2 font-['Montserrat'] uppercase tracking-wide text-ink transition hover:bg-brand-dark disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
};

export default Login;
