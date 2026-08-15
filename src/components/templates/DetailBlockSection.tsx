import React from 'react';
import { useContent } from '../../content/ContentContext';
import type { DetailBlockTemplateContent } from '../../content/types';
import WhatsAppButton from './WhatsAppButton';

export interface DetailBlockSectionProps {
  id: string;
  content: DetailBlockTemplateContent;
}

// Detail block -- kids' classes: a few short facts (day/time/price, say)
// plus a button (Task 2's own table), distinct from Text's free-form
// paragraphs. Facts render as a definition list, VisitUs.tsx's own
// centered-card layout as the model for spacing and the accent rule.
const DetailBlockSection: React.FC<DetailBlockSectionProps> = ({ id, content }) => {
  const contentApi = useContent();
  const base = `sections.${id}.content`;
  return (
    <section className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-8">
          {contentApi.renderText(`${base}.heading`, content.heading)}
        </h2>
        <p className="font-['Open_Sans'] text-gray-700 leading-relaxed mb-10">
          {contentApi.renderText(`${base}.body`, content.body)}
        </p>
        {content.facts.length > 0 && (
          <dl className="mx-auto mb-10 grid max-w-xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
            {content.facts.map((fact, index) => (
              <div key={index} className="border-l-4 border-brand pl-4">
                <dt className="font-['Montserrat'] text-xs uppercase tracking-wide text-brand">
                  {contentApi.renderText(`${base}.facts.${index}.label`, fact.label)}
                </dt>
                <dd className="font-['Open_Sans'] text-ink">
                  {contentApi.renderText(`${base}.facts.${index}.value`, fact.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {content.whatsapp && <WhatsAppButton button={content.whatsapp} />}
      </div>
    </section>
  );
};

export default DetailBlockSection;
