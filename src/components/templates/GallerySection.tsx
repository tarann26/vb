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
const GallerySection: React.FC<GallerySectionProps> = ({ id, content }) => {
  const contentApi = useContent();
  const base = `sections.${id}.content`;
  return (
    <section className="py-20 bg-white" data-testid={`gallery-section-${id}`}>
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          {contentApi.renderText(`${base}.heading`, content.heading)}
        </h2>
        {content.layout === 'scroll' ? (
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
        ) : (
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
