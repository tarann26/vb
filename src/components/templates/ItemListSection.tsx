import React from 'react';
import { useContent } from '../../content/ContentContext';
import type { ItemListTemplateContent } from '../../content/types';
import WhatsAppButton from './WhatsAppButton';

export interface ItemListSectionProps {
  id: string;
  content: ItemListTemplateContent;
}

// Item list -- breads and dips, cheeseboards: photo + name + description
// (Task 2's own table). FoodGallery.tsx is the model, reused near-verbatim:
// the same horizontal-scroll card shell, the same gradient caption overlay.
const ItemListSection: React.FC<ItemListSectionProps> = ({ id, content }) => {
  const contentApi = useContent();
  const base = `sections.${id}.content`;
  return (
    <section className="py-20 relative bg-wash">
      <div className="max-w-7xl mx-auto px-4">
        <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-[#222] text-center mb-16">
          {contentApi.renderText(`${base}.heading`, content.heading)}
        </h2>
        <div className="relative">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex space-x-6 pb-4 px-1 py-2" style={{ width: 'max-content' }}>
              {content.items.map((item, index) => (
                <div
                  key={index}
                  className="flex-shrink-0 w-80 h-64 relative rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 group"
                >
                  <div className="relative w-full h-full transform hover:scale-105 transition-all duration-300">
                    {contentApi.renderImage(`${base}.items.${index}.image`, {
                      src: item.image,
                      alt: item.name,
                      className: 'w-full h-full object-cover group-hover:scale-110 transition-transform duration-500',
                      loading: 'lazy',
                    })}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4 text-white">
                      <h3 className="font-['Montserrat'] font-semibold text-xl">
                        {contentApi.renderText(`${base}.items.${index}.name`, item.name)}
                      </h3>
                      <p className="font-['Open_Sans'] text-sm text-white/80">
                        {contentApi.renderText(`${base}.items.${index}.description`, item.description)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-wash to-transparent" />
        </div>
        {content.whatsapp && (
          <div className="mt-10 text-center">
            <WhatsAppButton button={content.whatsapp} />
          </div>
        )}
      </div>
    </section>
  );
};

export default ItemListSection;
