import React, { useState } from 'react';

interface LoginProps {
  onLogin: () => void;
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

const Login: React.FC<LoginProps> = ({ onLogin }) => {
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
        <h1 className="mb-6 font-['Parisienne'] text-3xl text-[#222]">Via Bianca</h1>

        <label
          htmlFor="admin-password"
          className="mb-2 block font-['Montserrat'] text-sm uppercase tracking-wide text-[#6B8B59]"
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
          className="w-full rounded border border-gray-300 px-3 py-2 text-[#222] focus:border-[#6B8B59] focus:outline-none"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded bg-[#6B8B59] py-2 font-['Montserrat'] uppercase tracking-wide text-white transition hover:bg-[#5a7349] disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
};

export default Login;
