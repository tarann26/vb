import React from 'react';
import { useContent } from '../../content/ContentContext';
import type { GalleryTemplateContent } from '../../content/types';
import WhatsAppButton from './WhatsAppButton';

export interface GallerySectionProps {
  id: string;
  content: GalleryTemplateContent;
}

// Gallery -- product or venue photos (a horizontal scroller, PlaceGallery.tsx's
// own layout, reused near-verbatim for `layout: 'scroll'`) OR the templates
// merged in during implementation (Task 2 Step 1): B2B clients and press
// logos, `layout: 'grid'`, a plain responsive grid rather than a scroller --
// the same photo list either way, just arranged differently. "Logo grid"
// stopped being its own TemplateType because this is the whole difference;
// see TemplateType's own comment (types.ts) for the merge decision.
//
// READ THE `grid` BRANCH BEFORE POINTING CONTENT AT IT. It is the LOGO
// strip, not a photo grid: `h-24` (96px) cells, `object-contain`, and
// `grayscale` until hover. That is right for a press masthead and actively
// wrong for a photograph -- the final branch review found the catering
// gallery shipping as four grey stamps 96px tall and the cooking-class
// pamphlet as a 60x96 desaturated sliver, both because their content said
// `"layout": "grid"`. A photograph belongs in `scroll` (a set) or `hero`
// (one). The class names in this file are load-bearing content decisions,
// which is why they are spelled out here rather than left to be discovered
// in a browser.
//
// `hero` is the third branch: one photograph, in colour, at its own natural
// aspect ratio, centred and width-capped so a tall portrait document stays
// legible instead of being cropped to a 256px square (`scroll`) or squashed
// into a 96px logo cell (`grid`). Deliberately built out of classes this
// stylesheet already ships -- `mx-auto`, `max-w-md`, `rounded-xl`,
// `overflow-hidden`, `shadow-md`, `w-full` -- because src/test/
// bundle.post-build.test.ts caps the entry stylesheet's size and a new
// layout is exactly the kind of change that quietly spends that budget. The
// image carries no height utility on purpose: Tailwind preflight already
// sets `height: auto` on every `img`, so `w-full` alone preserves the
// aspect ratio at zero CSS cost.
const GallerySection: React.FC<GallerySectionProps> = ({ id, content }) => {
  const contentApi = useContent();
  const base = `sections.${id}.content`;
  return (
    <section className="py-20 bg-white" data-testid={`gallery-section-${id}`}>
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          {contentApi.renderText(`${base}.heading`, content.heading)}
        </h2>
        {content.layout === 'hero' && (
          <div className="mx-auto flex max-w-md flex-col gap-8">
            {content.images.map((image, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-xl shadow-md"
                data-testid={`gallery-image-${id}-${index}`}
              >
                {contentApi.renderImage(`${base}.images.${index}`, {
                  src: image.src,
                  alt: image.alt,
                  className: 'w-full',
                  loading: 'lazy',
                })}
              </div>
            ))}
          </div>
        )}
        {content.layout === 'scroll' && (
          <div className="relative">
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex space-x-8 pb-4 px-1 py-2" style={{ width: 'max-content' }}>
                {content.images.map((image, index) => (
                  <div
                    key={index}
                    className="flex-shrink-0 w-64 h-64 rounded-xl overflow-hidden shadow-md transition duration-300"
                    data-testid={`gallery-image-${id}-${index}`}
                  >
                    <div className="w-full h-full transform hover:scale-105 transition duration-300">
                      {contentApi.renderImage(`${base}.images.${index}`, {
                        src: image.src,
                        alt: image.alt,
                        className: 'w-full h-full object-cover',
                        loading: 'lazy',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent" />
          </div>
        )}
        {content.layout === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-8 items-center justify-items-center">
            {content.images.map((image, index) => (
              <div
                key={index}
                className="flex h-24 w-full items-center justify-center grayscale transition duration-300 hover:grayscale-0"
                data-testid={`gallery-image-${id}-${index}`}
              >
                {contentApi.renderImage(`${base}.images.${index}`, {
                  src: image.src,
                  alt: image.alt,
                  className: 'max-h-full max-w-full object-contain',
                  loading: 'lazy',
                })}
              </div>
            ))}
          </div>
        )}
        {content.whatsapp && (
          <div className="mt-10 text-center">
            <WhatsAppButton button={content.whatsapp} />
          </div>
        )}
      </div>
    </section>
  );
};

export default GallerySection;
