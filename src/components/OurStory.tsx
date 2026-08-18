import React, { Fragment, useEffect, useState } from 'react';
import { useContent } from '../content/ContentContext';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { fetchStory } from './story-api';

export interface OurStoryProps {
  fetchImpl?: typeof fetch;
}

const OurStory: React.FC<OurStoryProps> = ({ fetchImpl = fetch }: OurStoryProps = {}) => {
  const content = useContent();
  const { galleries } = content;
  // The compiled-in copy is the INITIAL value, not a placeholder: it is
  // real, valid, published content, and it is what a crawler, a reader with
  // JS off, and every first paint see. The fetch below replaces it only
  // when a fully shape-checked document arrives, so a database outage, a
  // malformed row or an offline visitor all degrade to "slightly older
  // prose" rather than to an empty section.
  //
  // About is the eighth of nine homepage sections, well below the fold, so
  // in practice the swap has happened long before anyone scrolls to it.
  // Said plainly rather than sold: a reader already sitting on this section
  // when she publishes an edit could see a word change under them.
  const [story, setStory] = useState(content.story);
  // Defensively, not `const { chef } = story` -- guards the INITIAL value,
  // which still comes from whatever `content.story` the caller's
  // ContentProvider hands this component (a test bundle with no `chef` is
  // exactly this file's own "does not crash when `chef` itself is missing"
  // case, below). The fetch below can never reintroduce the gap: fetchStory's
  // own shape check (story-api.ts) refuses a body with no `chef` and returns
  // `null`, which never reaches `setStory`. Mirrors StoryForm's own identical
  // fallback (src/admin/StoryForm.tsx), and validateStory's own `asRecord()`
  // fallback (src/content/validate.ts) -- the same defense at a third
  // boundary, not a new rule.
  const chef = story.chef ?? { name: '', role: '', portrait: '', portraitAlt: '' };
  const [currentIndex, setCurrentIndex] = useState(0);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    fetchStory(fetchImpl)
      .then((live) => {
        if (!cancelled && live !== null) setStory(live);
      })
      .catch(() => {
        // The compiled-in copy stands -- nothing rendered here, on purpose,
        // and never an error message a visitor can see.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  useEffect(() => {
    if (reduceMotion) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % galleries.ourStory.length);
    }, 3200); // 3.2 seconds
    return () => clearInterval(interval);
  }, [reduceMotion, galleries.ourStory.length]);

  return (
    <section id = "our-story" className="py-20 relative bg-wash-warm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Story Text */}
          <div className="space-y-6">
            <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-8">
              {story.heading}
            </h2>
            <div className="space-y-4 font-['Open_Sans'] text-gray-700 leading-relaxed">
              {story.paragraphs.map((paragraph, idx) => (
                <p key={idx}>{paragraph}</p>
              ))}
            </div>

            {/* Her byline. The six paragraphs above are already in her first
                person and already sign off in her name, so this is
                attribution and a face rather than a second introduction --
                which is what makes it belong at the END of the prose, the
                way a signature does, and not above it.

                Built entirely from utilities already in the shipped
                stylesheet: the entry CSS budget is 145 bytes (38555 against
                a 38700 ceiling, src/test/bundle.post-build.test.ts) and one
                responsive variant would spend most of it. There is no
                sm:/md: prefix here on purpose -- a 96px avatar beside two
                short lines fits a 390px viewport, which
                e2e/about-byline.spec.ts measures rather than assumes. */}
            <div data-testid="chef-byline" className="mt-10 flex items-center gap-4 border-t border-gray-200 pt-8">
              {/* chef.portrait is blank only via the `?? {...}` fallback
                  above (no chef at all) or a fetch that somehow slipped past
                  fetchStory's shape check -- neither reachable today, but an
                  <img src=""> resolves to the CURRENT PAGE URL and browsers
                  re-request it, which is worth skipping for a one-line
                  guard. */}
              {chef.portrait && (
                <img
                  data-testid="chef-portrait"
                  src={chef.portrait}
                  alt={chef.portraitAlt}
                  loading="lazy"
                  className="h-24 w-24 shrink-0 rounded-full object-cover"
                />
              )}
              <div>
                <p className="font-['Montserrat'] text-lg font-bold text-ink">{chef.name}</p>
                <p className="font-['Open_Sans'] text-sm font-semibold uppercase tracking-wide text-accent">
                  {chef.role}
                </p>
              </div>
            </div>
          </div>

          {/* Rotating Image Carousel */}
          <div
            data-testid="our-story-carousel"
            className="relative overflow-hidden rounded-2xl shadow-2xl h-[400px]"
          >
            <div
              className="flex transition-transform duration-[800ms] ease-in-out"
              style={{ transform: `translateX(-${currentIndex * 100}%)` }}
            >
              {galleries.ourStory.map((image, idx) => (
                <Fragment key={idx}>
                  {content.renderImage(`galleries.ourStory.${idx}`, {
                    src: image.src,
                    alt: image.alt,
                    className: 'w-full flex-shrink-0 object-cover h-[400px]',
                  })}
                </Fragment>
              ))}
            </div>
            {/* Torn paper effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-white/10 pointer-events-none"></div>
            {/* Decorative circle */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-brand rounded-full opacity-20 pointer-events-none"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OurStory;
