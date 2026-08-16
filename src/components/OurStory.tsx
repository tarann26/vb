import React, { Fragment, useEffect, useState } from 'react';
import { useContent } from '../content/ContentContext';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const OurStory: React.FC = () => {
  const content = useContent();
  const { story, galleries } = content;
  // Defensively, not `const { chef } = story` -- unreachable TODAY (
  // EMPTY_STORY carries a blank `chef`, /edit drafts cannot hold
  // `story.json`, and the worker validates before commit), but Task 7's D1
  // swap changes exactly those preconditions: content will come from a
  // fetch rather than a build-time, guard-checked import, and nothing
  // upstream of this component will still guarantee `chef` is present.
  // Mirrors StoryForm's own identical fallback (src/admin/StoryForm.tsx),
  // and validateStory's own `asRecord()` fallback (src/content/validate.ts)
  // -- the same defense at a third boundary, not a new rule.
  const chef = story.chef ?? { name: '', role: '', portrait: '', portraitAlt: '' };
  const [currentIndex, setCurrentIndex] = useState(0);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % galleries.ourStory.length);
    }, 3200); // 3.2 seconds
    return () => clearInterval(interval);
  }, [reduceMotion, galleries.ourStory.length]);

  return (
    <section id = "our-story" className="py-20 bg-cream-alt">
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
              <img
                data-testid="chef-portrait"
                src={chef.portrait}
                alt={chef.portraitAlt}
                loading="lazy"
                className="h-24 w-24 shrink-0 rounded-full object-cover"
              />
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
