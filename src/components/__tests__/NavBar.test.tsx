import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '../NavBar';

describe('Navbar', () => {
  it('exposes a menu toggle for small screens', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
  });

  it('opens and closes the menu', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu after a link is followed', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);
    await user.click(screen.getByRole('link', { name: /our story/i }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
