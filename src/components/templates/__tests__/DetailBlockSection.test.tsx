import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DetailBlockSection from '../DetailBlockSection';
import type { DetailBlockTemplateContent } from '../../../content/types';

const CONTENT: DetailBlockTemplateContent = {
  heading: "Kids' Classes",
  body: 'Hands-on pasta-making for ages 6-12.',
  facts: [
    { label: 'Day', value: 'Saturdays' },
    { label: 'Time', value: '11:00 - 12:30' },
  ],
};

describe('DetailBlockSection', () => {
  it('renders the heading, body and every fact\'s label and value', () => {
    render(<DetailBlockSection id="kids-classes" content={CONTENT} />);
    expect(screen.getByRole('heading', { level: 2, name: "Kids' Classes" })).toBeInTheDocument();
    expect(screen.getByText('Hands-on pasta-making for ages 6-12.')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Saturdays')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('11:00 - 12:30')).toBeInTheDocument();
  });

  it('renders no facts list at all when facts is empty, rather than an empty <dl>', () => {
    const { container } = render(<DetailBlockSection id="x" content={{ ...CONTENT, facts: [] }} />);
    expect(container.querySelector('dl')).toBeNull();
  });

  it('renders no WhatsApp button when the section has none, and shows it when present', () => {
    const { rerender } = render(<DetailBlockSection id="kids-classes" content={CONTENT} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <DetailBlockSection
        id="kids-classes"
        content={{ ...CONTENT, whatsapp: { label: 'Book a class', message: 'Hi, I want to book a kids class.' } }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Book a class' })).toBeInTheDocument();
  });
});
