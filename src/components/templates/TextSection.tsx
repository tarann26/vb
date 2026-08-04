import React from 'react';
import { useContent } from '../../content/ContentContext';
import type { TextTemplateContent } from '../../content/types';
import WhatsAppButton from './WhatsAppButton';

export interface TextSectionProps {
  // The section's own id (sections.json's `id`, or one of a page's own
  // section ids) -- used to build this section's own editable-content
  // paths, never rendered. `sections.<id>.content.*` matches the dotted
  // scheme every existing renderText/renderImage call site already uses
  // (`galleries.heroCollage.${i}`, `dishes.${dish.id}.image`), so /edit
  // (Task 5) gets a stable, predictable path for every leaf here with no
  // new addressing scheme to invent.
  id: string;
  content: TextTemplateContent;
}

// Text -- membership, catering intro, or any prose block (Task 2's own
// table). Reuses OurStory.tsx's own type scale and spacing (the same
// heading size/weight, the same `font-['Open_Sans'] text-gray-700
// leading-relaxed` body copy) rather than inventing a second visual
// language -- see this plan's own Risk note on drift.
const TextSection: React.FC<TextSectionProps> = ({ id, content }) => {
  const contentApi = useContent();
  const base = `sections.${id}.content`;
  return (
    <section className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] mb-8">
          {contentApi.renderText(`${base}.heading`, content.heading)}
        </h2>
        <div className="space-y-4 font-['Open_Sans'] text-gray-700 leading-relaxed text-left">
          {content.paragraphs.map((paragraph, index) => (
            <p key={index}>{contentApi.renderText(`${base}.paragraphs.${index}`, paragraph)}</p>
          ))}
        </div>
        {content.whatsapp && (
          <div className="mt-10">
            <WhatsAppButton button={content.whatsapp} />
          </div>
        )}
      </div>
    </section>
  );
};

export default TextSection;
