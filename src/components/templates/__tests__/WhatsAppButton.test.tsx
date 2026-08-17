import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import WhatsAppButton from '../WhatsAppButton';
import { site } from '../../../content';

// Mirrored Hero.test.tsx's own "the Reserve a Table button" describe block --
// same mutations, same reasoning -- since this component's own header
// comment records that it reuses Hero.tsx's `/api/wa` beacon path exactly
// (Plan 7, Task 2, Step 2's decision). That Hero.tsx block (and the button
// it tested) is gone now, removed by owner request 2026-08-17 -- see that
// commit's brief -- but the reasoning it recorded still applies to THIS
// component's own openWhatsApp, which is untouched and still real
// production code; not repeated at the same length here.
describe('WhatsAppButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
  });

  const BUTTON = { label: 'Ask about classes', message: 'Hi, I would like to know more about the kids classes.' };

  function trackUncaughtErrors(): { events: ErrorEvent[]; stop: () => void } {
    const events: ErrorEvent[] = [];
    const onError = (event: ErrorEvent) => events.push(event);
    window.addEventListener('error', onError);
    return { events, stop: () => window.removeEventListener('error', onError) };
  }

  it('renders the button label from content, not a hardcoded string', () => {
    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    expect(getByRole('button', { name: 'Ask about classes' })).toBeInTheDocument();
  });

  it('opens wa.me with the site number and this button\'s own message, not site.whatsapp.prefilledMessage', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    Object.defineProperty(window.navigator, 'sendBeacon', { value: vi.fn(() => true), configurable: true });

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));

    expect(openSpy).toHaveBeenCalledWith(
      `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(BUTTON.message)}`,
      '_blank',
      'noopener',
    );
  });

  it('still opens WhatsApp when navigator.sendBeacon throws, and the throw never escapes as an uncaught error', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: vi.fn(() => {
        throw new Error('beacon failed');
      }),
      configurable: true,
    });
    const uncaught = trackUncaughtErrors();

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));
    uncaught.stop();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(uncaught.events).toEqual([]);
  });

  it('still opens WhatsApp when navigator.sendBeacon is undefined', () => {
    delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const uncaught = trackUncaughtErrors();

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));
    uncaught.stop();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(uncaught.events).toEqual([]);
  });

  it('calls window.open synchronously in the same tick as the click, never delayed by the beacon', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    Object.defineProperty(window.navigator, 'sendBeacon', { value: vi.fn(() => true), configurable: true });

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));

    // No await, no waitFor above -- fails if window.open had not already run.
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('fires the beacon at /api/wa, the same route Hero.tsx\'s own button fires -- the decision recorded in this file\'s own header comment', () => {
    const beaconSpy = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { value: beaconSpy, configurable: true });
    vi.spyOn(window, 'open').mockReturnValue(null);

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));

    expect(beaconSpy).toHaveBeenCalledWith('/api/wa');
  });

  it('calls window.open before firing the beacon -- not merely both, but in that order', () => {
    const order: string[] = [];
    vi.spyOn(window, 'open').mockImplementation(() => {
      order.push('open');
      return null;
    });
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: vi.fn(() => {
        order.push('beacon');
        return true;
      }),
      configurable: true,
    });

    const { getByRole } = render(<WhatsAppButton button={BUTTON} />);
    fireEvent.click(getByRole('button', { name: 'Ask about classes' }));

    expect(order).toEqual(['open', 'beacon']);
  });

  it('accepts a custom className, overriding the default styling', () => {
    const { getByRole } = render(<WhatsAppButton button={BUTTON} className="custom-class" />);
    expect(getByRole('button', { name: 'Ask about classes' })).toHaveClass('custom-class');
  });
});
