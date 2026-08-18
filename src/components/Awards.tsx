// Phase 2 Task 9: the pilot section. Every other bespoke section reads its
// content straight from src/content/index.ts's build-time snapshot, already
// live at first paint; this one is the first whose LIST is fetched at
// runtime, from D1, through the same public read path worker/published.ts
// serves (GET /api/published?path=awards.json). The section's own heading
// and intro stay in copy.json (Copy['awards'], src/content/types.ts) on
// purpose -- see that field's own comment for why -- so the chrome below
// never depends on this fetch succeeding.
import { useEffect, useState } from 'react';
import { useContent } from '../content/ContentContext';
import type { Award } from '../content/types';
import { fetchAwards } from './awards-api';

export interface AwardsProps {
  fetchImpl?: typeof fetch;
}

// Entries are fetched at runtime; the heading and intro come from the
// content context, live at first paint the way every other section's own
// copy already is. A fetch failure (including jsdom's own relative-URL
// rejection -- see fetchAwards' own comment) leaves `awards` at its initial
// `[]` and is otherwise swallowed: the section degrades to its chrome, never
// to a crash and never to an error message a visitor can see.
function Awards({ fetchImpl = fetch }: AwardsProps = {}) {
  const content = useContent();
  const { copy } = content;
  const [awards, setAwards] = useState<Award[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAwards(fetchImpl)
      .then((result) => {
        if (!cancelled) setAwards(result);
      })
      .catch(() => {
        // Chrome-only degradation -- nothing rendered here, on purpose.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  return (
    <section id="awards" className="py-20 relative bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-6">
            {content.renderText('awards.heading', copy.awards.heading)}
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            {content.renderText('awards.intro', copy.awards.intro)}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {awards.map((award) => (
            <div
              key={award.id}
              className="bg-white border border-gray-200 rounded-2xl shadow-lg p-6 text-center"
            >
              {award.image && (
                <img
                  src={award.image}
                  alt=""
                  loading="lazy"
                  className="mx-auto mb-4 h-16 w-16 object-contain"
                />
              )}
              <h3 className="font-['Montserrat'] font-bold text-lg text-ink mb-2">{award.title}</h3>
              <p className="font-['Open_Sans'] text-sm text-accent font-semibold uppercase tracking-wide mb-1">
                {award.awardedBy}
              </p>
              <p className="font-['Open_Sans'] text-sm text-gray-500">{award.year}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default Awards;
