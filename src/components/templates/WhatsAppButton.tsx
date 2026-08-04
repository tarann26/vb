import React from 'react';
import { useContent } from '../../content/ContentContext';
import type { TemplateWhatsAppButton as WhatsAppButtonContent } from '../../content/types';

export interface WhatsAppButtonProps {
  button: WhatsAppButtonContent;
  className?: string;
}

const DEFAULT_CLASSNAME =
  "inline-block bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide shadow-lg hover:shadow-xl transition-all duration-300";

// Plan 7, Task 2, Step 2: the one WhatsApp button every template section may
// carry (D8: "every call to action is a WhatsApp deep link"), built once
// and reused by all four templates, exactly the shape the plan's own Step 2
// asks for.
//
// Mirrors Hero.tsx's own `openReservationWhatsApp` exactly in SHAPE --
// `window.open` runs first, synchronously, as the very first statement,
// nothing above it may throw or await, and the beacon below is wrapped the
// same fire-and-forget, never-lets-a-broken-beacon-affect-the-click way.
// See that function's own comment for the full reasoning; it is not
// repeated here. The `site.whatsapp.number` read is the same one field
// every WhatsApp link on this site resolves through -- a template button's
// own content only ever supplies the LABEL and the MESSAGE (see
// TemplateWhatsAppButton's own comment, types.ts), never a phone number of
// its own, so it is structurally impossible for a template button to point
// at a different WhatsApp number than the rest of the site.
//
// Decision, recorded (Step 2's own "decide whether a template button counts
// as a conversion"): YES -- it reuses Hero's exact `navigator.sendBeacon
// ('/api/wa')` path, not a distinguishable second one. worker/index.ts's
// own WA_COUNTS_KV_KEY already documents itself as "a LOWER BOUND, not a
// count" -- an approximate, best-effort signal, not a precise metric the
// owner already reads a narrow "reservations only" meaning into (no
// dashboard screen displays this number at all yet, confirmed directly --
// there is no existing label this could contradict). Given that, a template
// button tap is exactly the same shape of signal Hero's own button already
// produces: someone reached for WhatsApp because of something on this site.
// Reusing the identical path is also what keeps this component simple and
// adds no new server-side surface -- no new route, no new KV key, nothing
// for a future task to keep in sync with worker/index.ts's own counter.
// Building a SEPARATE, per-source counter (so "reservation intent" and "an
// enquiry about the kids' classes" could be told apart later) is real,
// useful future work this plan does not ask for and this component does
// not attempt -- recorded here rather than silently declined.
const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({ button, className }) => {
  const { site } = useContent();

  function openWhatsApp(): void {
    window.open(
      `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(button.message)}`,
      '_blank',
      'noopener',
    );
    try {
      navigator.sendBeacon?.('/api/wa');
    } catch {
      // Never lets a broken beacon affect the click above -- see
      // Hero.tsx's own openReservationWhatsApp for the full reasoning.
    }
  }

  return (
    <button type="button" onClick={openWhatsApp} className={className ?? DEFAULT_CLASSNAME}>
      {button.label}
    </button>
  );
};

export default WhatsAppButton;
