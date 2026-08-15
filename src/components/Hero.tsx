import React from 'react';
import { ChefHat } from 'lucide-react';
import { useContent } from '../content/ContentContext';
import { COLLAGE_PHOTO_CLASSNAME, COLLAGE_SPLIT_CLASSNAME, collageNodePath } from '../content/context';
import type { CollageNode, ContentBundle } from '../content/types';

// The collage, drawn as nested flexbox from the split tree in
// `galleries.heroCollage`. There is no generated class name anywhere in here:
// a split's proportions arrive as numbers and leave as `flexGrow`, so
// Tailwind never needs to see them. That is the whole point of the tree --
// this project's content glob has never scanned `.json`, and the previous
// model (a Tailwind grid-placement string per photo, authored in exactly that
// unscanned file) cost it seven missing utilities and nine photos rendered
// into implicit rows that `overflow-hidden` clipped away.
//
// `flexBasis: 0` beside every `flexGrow` is not belt and braces. Without it a
// flex item's base size is its CONTENT's size, so a wide photograph and a
// narrow one in a 1:1 split render at different widths and the ratio silently
// stops meaning anything. Proven in a real browser rather than reasoned about
// -- jsdom has no layout engine and cannot see this at all -- by
// e2e/hero-collage.spec.ts.
//
// A plain function, not a component: it is called recursively with a
// different `style` per level, and every element it produces already comes
// from a content seam that /edit can override.
function renderCollageNode(content: ContentBundle, node: CollageNode, style: React.CSSProperties): React.ReactNode {
  const path = collageNodePath(node);
  if (node.kind === 'photo') {
    return content.renderCollagePhoto(
      path,
      node,
      { className: COLLAGE_PHOTO_CLASSNAME, style },
      content.renderImage(path, {
        src: node.src,
        alt: node.alt,
        className: 'w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity duration-500',
        // I-A review finding (repair of Plan 6, Task 4, Step 1): native
        // HTML5 image drag hijacks the pointer sequence a real drag needs on
        // desktop, but a `draggable={false}` HERE is not the fix -- it ships
        // an explicit `draggable="false"` attribute (React never omits it for
        // a literal `false`) on every collage <img> to every PUBLIC visitor,
        // +288 bytes for a requirement that only exists at `/edit`.
        // `dragstart` bubbles, so an /edit-only handler on the wrapper
        // cancels the child's native drag without this component -- or its
        // rendered output -- knowing anything is editable at all. The same
        // conclusion applies unchanged to Task 4's drag-to-swap; it is
        // recorded here because this is the call site that would otherwise
        // add the prop back again.
      }),
    );
  }
  return content.renderCollageSplit(
    path,
    node,
    { className: COLLAGE_SPLIT_CLASSNAME[node.direction], style },
    node.children.map((child, i) =>
      renderCollageNode(content, child, { flexGrow: node.sizes[i], flexBasis: 0 }),
    ),
  );
}

const Hero: React.FC = () => {
 const content = useContent();
 const { site, galleries, copy } = content;

 // `window.open` runs first, synchronously, as the very first statement --
 // nothing above it may ever throw or await, so the WhatsApp link opening
 // can never be delayed by (or made to depend on) the beacon below that
 // counts the tap for worker/index.ts's POST /api/wa. A counter that costs
 // her a customer is worse than no counter.
 //
 // The beacon itself is best-effort in two distinct ways, both guarded here:
 // `navigator.sendBeacon` is undefined in some environments (optional
 // chaining no-ops rather than throwing "not a function"), and even where
 // present, a call to it can itself throw -- neither may ever propagate out
 // of this handler. Fire-and-forget, not awaited: this is not `fetch`, so
 // there is nothing to wait on regardless, and awaiting it would reintroduce
 // exactly the delay this function exists to avoid.
 //
 // Defined inside the component body, not at module scope: it reads
 // `site.whatsapp`, which must come from whatever content this render is
 // showing (the live provider at /edit, the static default everywhere
 // else) rather than a module-level import frozen at build time.
 function openReservationWhatsApp(): void {
   window.open(
     `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
     '_blank',
     'noopener',
   );
   try {
     navigator.sendBeacon?.('/api/wa');
   } catch {
     // Never lets a broken beacon affect the click above -- see this
     // function's own comment.
   }
 }

 return (
  <section className="min-h-screen bg-white relative flex items-center justify-center overflow-hidden">
    {/* brick background */}
    {/* The one image anywhere in RENDERED_FILES with no content leaf behind
        it: this src is a hardcoded literal, never read from galleries,
        dishes, drinks or press, so there is no path an editing overlay
        could point at here. Deliberately left out of the seven renderImage
        call sites -- wrapping it would offer an edit affordance for a path
        that cannot exist. See the edit mode plan's own corrected coverage
        rule for the same call. */}
    <img
      src="/hero/brick.webp"
      alt=""
      className="absolute inset-0 -z-20 w-full h-full object-cover opacity-20"
    />
     {/* ===== Collage =====
         One flex container holding the tree's root node, which fills it.
         Every level below is another flex container -- see
         `renderCollageNode` above. `overflow-hidden` on the <section> still
         clips whatever the collage paints outside the hero, unchanged. */}
     <div className="absolute inset-0 flex">
       {galleries.heroCollage !== null &&
         renderCollageNode(content, galleries.heroCollage, { flexGrow: 1, flexBasis: 0 })}
     </div>


     {/* ===== White strip (blocks collage under the content) ===== */}
     <div className="absolute inset-0 flex justify-center pointer-events-none">
       {/* adjust max-w to tweak width of the clear strip */}
       <div className="w-full max-w-[600px] bg-white/95"></div>
     </div>


     {/* ===== Main content ===== */}
     <div className="relative z-10 text-center px-6">
       {/* circular logo */}
       <div aria-hidden="true" className="w-40 h-40 mx-auto mb-8 flex items-center justify-center rounded-full border-4 border-brand bg-white shadow-lg">
         <div className="select-none">
           <p className="font-['Parisienne'] text-3xl text-ink">{content.renderText('hero.logoName', copy.hero.logoName)}</p>
           <p className="font-['Montserrat'] text-xs uppercase tracking-wider text-brand">
             {content.renderText('hero.logoTagline', copy.hero.logoTagline)}
           </p>
         </div>
       </div>


       <h1 className="font-['Parisienne'] text-6xl md:text-7xl text-ink mb-4">{site.name}</h1>
       <p className="font-['Montserrat'] text-lg md:text-xl uppercase tracking-wide text-brand mb-6">
         {site.tagline}
       </p>
       {/* site.strapline, with every space swapped for a non-breaking one so
           the phrase never wraps mid-sentence -- the only reason it isn't
           rendered as-is. Editing the sentence in src/content/site.json is
           now enough to change what a visitor actually reads here. */}
       <p className="font-['Parisienne'] text-2xl md:text-3xl text-ink mb-8">
         {site.strapline.replace(/ /g, '\u00A0')}
       </p>


       {/* reservation numbers */}
       <div className="mb-8">
          <p className="font-['Montserrat'] text-xl font-bold tracking-wide uppercase text-brand">{content.renderText('hero.reservationsLabel', copy.hero.reservationsLabel)}</p>
          {site.phones.map((phone, i) => (
            <p key={i} className="font-['Open_Sans'] text-lg font-semibold text-ink whitespace-nowrap">{phone}</p>
          ))}
        </div>



       <button
  onClick={openReservationWhatsApp}
  className="bg-brand hover:bg-brand-dark text-ink px-8 py-4 rounded-lg font-semibold uppercase tracking-wide shadow-lg hover:shadow-xl transition-all duration-300"
>
  {content.renderText('hero.reserveButton', copy.hero.reserveButton)}
</button>

     </div>


     {/* scroll cue */}
     <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
       <ChefHat className="w-6 h-6 text-brand" />
     </div>
   </section>
 );
};


export default Hero;
