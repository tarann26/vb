import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '../Login';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchOnce(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status })),
  );
}

// Accepts an onLogin mock rather than always creating its own anonymous one:
// the 401 test below needs to hold a reference to assert against, and a
// fresh vi.fn() per call keeps every other caller's behavior unchanged.
async function submitWith(password: string, onLogin: () => void = vi.fn()) {
  const user = userEvent.setup();
  render(<Login onLogin={onLogin} />);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('Login', () => {
  it('renders one password field and one button', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('calls onLogin and never surfaces an error on a 204', async () => {
    stubFetchOnce(204);
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<Login onLogin={onLogin} />);
    await user.type(screen.getByLabelText(/password/i), 'correct-horse');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows "That didn\'t work" on a 401, never logs in, and echoes the password nowhere but the field she typed it into', async () => {
    stubFetchOnce(401);
    const onLogin = vi.fn();
    await submitWith('a-wrong-password', onLogin);
    expect(await screen.findByRole('alert')).toHaveTextContent("That password didn't work.");

    // A wrong password must never transition the parent to logged-in --
    // confirmed this can fail: calling onLogin() unconditionally after
    // setError() left this suite entirely green until this assertion was
    // added, since the 204 test only ever checks onLogin WAS called, never
    // that it wasn't on a rejected attempt.
    expect(onLogin).not.toHaveBeenCalled();

    // The controlled input legitimately holds what she typed -- that IS the
    // field she typed it into, and it is masked by type="password". A blanket
    // `body.innerHTML` check can therefore never pass, which is why an earlier
    // version of this test failed. The property actually worth guarding is that
    // the password appears nowhere ELSE: echoed into the error text, a title,
    // an aria-label, a data attribute.
    //
    // Blank only the field she actually typed into, by its own outerHTML --
    // not a blanket `replace(/value="[^"]*"/g, ...)` over every `value=` in
    // the document. That blanket form blanks EVERY input's value attribute
    // indiscriminately, including a `<input type="hidden" value={password} />`
    // planted anywhere else in the tree -- confirmed directly, adding one
    // left this assertion green. Scoping the blank-out to the one field she
    // typed into is what makes a leak into any OTHER element (hidden input,
    // title, data attribute) actually show up here.
    const field = screen.getByLabelText(/password/i);
    expect(document.body.innerHTML.replace(field.outerHTML, '')).not.toContain('a-wrong-password');
  });

  it('shows the rate-limit message on a 429', async () => {
    stubFetchOnce(429);
    await submitWith('whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.');
  });

  it('shows the not-configured message on a 500', async () => {
    stubFetchOnce(500);
    await submitWith('whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent("Login isn't set up yet");
  });

  it('shows a generic message when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await submitWith('whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('sends the typed password as JSON to POST /api/login', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await submitWith('correct-horse-battery-staple');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ password: 'correct-horse-battery-staple' }),
      }),
    );
  });
});
