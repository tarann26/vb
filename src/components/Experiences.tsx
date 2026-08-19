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
    <section id="experiences" className="py-20 relative bg-wash-deep">
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
                //
                // It carries no cursor utility either. A <div> with no href
                // and no handler already computes to `cursor: auto`, which
                // is the arrow everywhere on this card except over the
                // title and description, where a browser shows the text
                // I-beam because that text really is selectable. The
                // utility that used to be here bought only that one
                // cosmetic difference, and its rule was one of the four
                // that pushed the entry stylesheet past the ceiling in
                // src/test/bundle.post-build.test.ts and broke `npm run
                // build` on this branch -- not a trade worth making.
                // Verified in Chromium after removing it: the two
                // coming-soon cards compute `auto`, the four linked ones
                // `pointer`. (Named by description rather than
                // by class name on purpose -- Tailwind's content scanner is
                // a plain text extractor with no JS parser, so writing a
                // retired utility's literal name in a comment inside the
                // content glob re-emits its rule and undoes the saving.)
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
                    className={CARD_BASE}
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
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-wash-deep to-transparent" />
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
      {/*
        AN INLINE GRADIENT, NOT TWO UTILITY CLASSES. (The pixels are NOT
        unchanged -- the stops were darkened later in this same block; see
        MINOR 3 below for why and by how much.) This scrim used to be written
        as a pair of Tailwind
        gradient-stop utilities whose two values -- black at 75% at the
        bottom, black at 20% at the midpoint -- existed nowhere else in this
        codebase. Each emitted a brand-new rule, and together with the
        caption's one-off white and a redundant cursor utility they added
        477 bytes to a stylesheet that had 145 bytes of headroom. That is
        what made `npm run build` exit 1 on this branch, deploy command and
        all (src/test/bundle.post-build.test.ts).

        Two ways out were measured rather than argued about, on the hardest
        card in the row -- Cooking Class, whose photo is a near-white
        pamphlet, so its white caption has the least to sit on:

          this inline gradient (identical to what shipped)  4.22:1
          the site's shared class idiom, from-black/70
            over a transparent midpoint                     3.45:1

        Sampled from a real Chromium screenshot of that card: mean luminance
        of the 60px strip the caption occupies, against white. Reusing the
        shared idiom is the tidier-looking fix and it costs 0.77 of contrast
        on the one card that can least afford it, so it was not taken. An
        inline style is what CollageTile.tsx already documents as the escape
        hatch for exactly this ceiling, and it costs zero CSS bytes because
        it produces no rule at all. A fix for a build failure should not
        quietly restyle six homepage cards.

        The caption keeps `text-white/80`, which the whole site already
        ships (FoodGallery.tsx, Drinks.tsx, ItemListSection.tsx) -- 0.2 of
        contrast below the one-off 85% it replaces, on the same card, and
        free.

        The retired class names are spelled out in words above rather than
        written as tokens: Tailwind's content scanner is a plain text
        extractor with no JS parser, so a utility-looking token in a comment
        inside the content glob emits its rule for real and would put the
        bytes straight back.

        MINOR 3, closed. 4.22:1 above was the caption's BACKDROP contrast
        against a hypothetical pure-white glyph -- not what a reader's eye
        actually sees, which is `text-white`/`text-white/80` composited with
        that backdrop, per line. `brand-contrast` (e2e/brand-contrast.spec.ts)
        cannot measure this: the backdrop is a photo plus this gradient, two
        sibling layers with no `background-color` for `getComputedStyle` to
        read, which is the exact case `sitsOverImageLayer` exists to skip.
        Measured here the way that test measures everything else it CAN
        reach -- WCAG relative luminance, the same `over()` alpha compositing
        for a translucent foreground -- just against real pixels instead of
        computed style: screenshot the card with the caption's own text
        hidden (`opacity: 0`, layout untouched) so the sampled backdrop has
        no glyph pixels in it, average the pixels directly behind each of
        `h3`/`p`'s own box, then composite each line's actual rendered colour
        (white for the title; white at the `/80` this file already ships,
        for the description) onto that backdrop. On Cooking Class, the same
        worst-of-six card as above:

          stops as shipped (0.75 / 0.2)   title 5.14:1   description 5.69:1
          stops darkened to  (0.82 / 0.3)  title 6.83:1   description 7.20:1

        Both already clear 4.5:1 as shipped under this per-line method --
        the 4.22:1 figure above turns out to have been pessimistic, an
        artefact of averaging the WHOLE caption box (title, description, and
        the bright glyph pixels themselves) into one backdrop sample, which
        pulls the apparent backdrop toward white and understates the real
        ratio. Darkened anyway, to (a) leave a real margin above 4.5 rather
        than resting on a boundary a different sampling method reads as
        already-passing, and (b) because these two rgba stops are still an
        INLINE style, so widening them costs the same zero CSS bytes the
        scrim itself already does -- `0.75`/`0.2` and `0.82`/`0.3` are the
        identical string length, so this doesn't even move
        homepage-bytes.test.tsx's pinned byte count. All six cards checked,
        not just this one: Cooking Class stays the worst by a wide margin
        (Retail, the next-lightest photo, sits at 7.76:1 title / 7.87:1
        description at these same stops).
      */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.3) 50%, transparent)' }}
      />
      <div className="absolute bottom-4 left-4 right-4 text-white">
        <h3 className="font-['Montserrat'] font-semibold text-xl">{item.title}</h3>
        <p className="font-['Open_Sans'] text-sm text-white/80">{item.description}</p>
      </div>
    </div>
  );
}

export default Experiences;
