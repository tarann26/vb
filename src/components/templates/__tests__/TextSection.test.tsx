import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TextSection from '../TextSection';
import type { TextTemplateContent } from '../../../content/types';

const CONTENT: TextTemplateContent = {
  heading: 'Membership',
  paragraphs: ['First paragraph about membership.', 'Second paragraph, a different sentence.'],
};

describe('TextSection', () => {
  it('renders the heading and every paragraph, in order', () => {
    render(<TextSection id="membership" content={CONTENT} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Membership' });
    expect(heading).toBeInTheDocument();
    const paragraphs = screen.getAllByText(/paragraph/);
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'First paragraph about membership.',
      'Second paragraph, a different sentence.',
    ]);
  });

  it('renders no WhatsApp button when the section has none', () => {
    render(<TextSection id="membership" content={CONTENT} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the WhatsApp button when the section content includes one', () => {
    const withButton: TextTemplateContent = {
      ...CONTENT,
      whatsapp: { label: 'Ask about membership', message: 'Hi, tell me about membership.' },
    };
    render(<TextSection id="membership" content={withButton} />);
    expect(screen.getByRole('button', { name: 'Ask about membership' })).toBeInTheDocument();
  });

  it('renders an empty paragraph list without crashing', () => {
    expect(() => render(<TextSection id="x" content={{ heading: 'H', paragraphs: [] }} />)).not.toThrow();
  });
});
