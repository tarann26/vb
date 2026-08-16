// Phase 3. The homepage carousel, and the thing that replaces the nav's
// Experiences dropdown (Task 5). Content comes from the build-time snapshot
// like every other bespoke section except Awards -- see the phase plan's
// storage section for why this one is committed JSON and Awards is not --
// so the whole carousel is live at first paint with no fetch and no
// chrome-only degraded state to design.
import React from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import type { Experience } from '../content/types';

const CARD_BASE =
  'flex-shrink-0 w-80 h-80 relative rounded-2xl overflow-hidden shadow-xl ' +
  'transition-all duration-300 group';

const Experiences: React.FC = () => {
  const content = useContent();
  const { copy, experiences, pages } = content;

  // Resolved at RENDER time against the live pages list, not at import time
  // and not in a validator. A page she has switched off, or one that was
  // removed, must not throw and must not render a <Link> to a route that
  // answers NotFound -- so it degrades to exactly what an item with no link
  // already is: a static Coming Soon card. See assertExperiences' own
  // comment (guards.ts) for why the alternative -- an import-time
  // cross-check -- is an outage rather than a safety net.
  const openable = new Set(pages.filter((page) => page.enabled).map((page) => `/${page.slug}`));
  const navigable = (item: Experience): boolean =>
    !item.comingSoon && item.link !== undefined && openable.has(item.link);

  return (
    <section id="experiences" className="py-20 bg-cream">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-6">
            {content.renderText('experiences.heading', copy.experiences.heading)}
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            {content.renderText('experiences.intro', copy.experiences.intro)}
          </p>
        </div>

        <div className="relative">
          <div className="overflow-x-auto scrollbar-hide">
            <div
              data-testid="experiences-track"
              className="flex space-x-6 pb-4 px-1 py-2"
              style={{ width: 'max-content' }}
            >
              {experiences.map((item) => {
                const body = <ExperienceCardBody item={item} />;
                // A navigable card is a router <Link>; a coming-soon card is
                // a plain <div> with no href, no onClick and no tabIndex, so
                // it is not focusable, not activatable by Enter, and does
                // nothing on click -- the spec's "do not respond to clicks"
                // as a property of the element rather than a handler that
                // swallows the event. pointer-events-none was rejected: it
                // would also stop the card being scrolled by a drag on
                // touch, which is how the whole carousel is operated.
                return navigable(item) ? (
                  <Link
                    key={item.id}
                    to={item.link as string}
                    data-testid={`experience-card-${item.id}`}
                    className={`${CARD_BASE} hover:shadow-2xl cursor-pointer`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    key={item.id}
                    data-testid={`experience-card-${item.id}`}
                    className={`${CARD_BASE} cursor-default`}
                  >
                    {body}
                    <span
                      data-testid={`experience-stamp-${item.id}`}
                      // Accent on white, not brand on white: brand is 1.45:1
                      // and unreadable as text, which e2e/brand-contrast
                      // measures and fails the build over. White on accent
                      // is 6.03:1 the other way round and is what the rest
                      // of the site uses for an emphasised label.
                      className="absolute top-4 right-4 rounded-full bg-accent px-3 py-1
                                 font-['Montserrat'] text-xs uppercase tracking-wider text-white"
                    >
                      Coming Soon
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-cream to-transparent" />
        </div>
      </div>
    </section>
  );
};

function ExperienceCardBody({ item }: { item: Experience }) {
  return (
    <div className="relative w-full h-full">
      <img
        src={item.image}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div className="absolute bottom-4 left-4 right-4 text-white">
        <h3 className="font-['Montserrat'] font-semibold text-xl">{item.title}</h3>
        <p className="font-['Open_Sans'] text-sm text-white/85">{item.description}</p>
      </div>
    </div>
  );
}

export default Experiences;
