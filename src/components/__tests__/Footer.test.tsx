import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '../Footer';
import { site } from '../../content';

describe('Footer', () => {
  it('shows the current copyright year from content', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`© ${site.copyrightYear}`))).toBeInTheDocument();
  });

  it('never shows a closing time in the morning', () => {
    render(<Footer />);
    site.hours.forEach((h) => {
      expect(h.value).not.toMatch(/–\s*\d{1,2}:\d{2}\s*AM/);
    });
  });

  it('renders every phone number from content', () => {
    render(<Footer />);
    site.phones.forEach((phone) => {
      expect(screen.getByText(phone)).toBeInTheDocument();
    });
  });

  it('renders the LinkedIn link only when content provides one', () => {
    render(<Footer />);
    const link = screen.queryByLabelText(/LinkedIn/i);
    if (site.socials.linkedin === null) {
      expect(link).toBeNull();
    } else {
      expect(link).toHaveAttribute('href', site.socials.linkedin);
    }
  });
});
