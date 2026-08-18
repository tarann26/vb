import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Owner's report: "All the experiences pages, when we open them, they are
// auto scrolled all the way to the bottom making it weird."
//
// THE MECHANISM, measured rather than reasoned about. A router navigation is
// a same-document one: React swaps the tree, the browser never loads a new
// document, and the scroll offset is a property of the document, so nothing
// resets it. Nothing in this codebase reset it either -- the only two
// window.scrollTo calls in src/ (BlogsPage.tsx, blog/BlogIndex.tsx) both live
// inside PAGINATION handlers that fire on a setState with no URL change, so
// neither has ever run on arrival at anything.
//
// The reason the landing spot is the BOTTOM, and not merely "wherever they
// were", is clamping, and it is the part that makes this look intentional:
// the homepage is 8869px tall at 390px wide and the Experiences carousel sits
// near its foot, so a visitor clicking a card is at y=2894; /catering is
// 1869px tall, and an offset past a document's own maximum gets clamped by
// the browser to exactly that maximum. The arrival offset therefore equals
// `scrollHeight - innerHeight` precisely -- the literal end of the page --
// every time, on all four pages, at both widths. Measured before the fix:
//
//     390px   /catering       arrived 1025 of max 1025
//     390px   /cooking-class  arrived 1483 of max 1483
//    1280px   /catering       arrived  753 of max  753
//    1280px   /cooking-class  arrived 1204 of max 1204
//    1280px   /blog           arrived  414 of max  414
//
// So it was never an experiences bug. It was every in-app navigation to any
// route shorter than the offset it inherited, which is why the fix is here --
// one hook, mounted once in AppRoutes -- and not a third private copy of
// window.scrollTo in a third component.
//
// WHY THIS ALSO OWNS *RESTORING* SCROLL, which is more machinery than a
// scroll reset appears to need, and was not the plan until it was measured.
//
// The obvious shape is "scroll to top unless this is a Back/Forward, and let
// the browser restore those, because it already does". The second half of
// that sentence is false in this app, and the first version of this fix
// shipped it and broke the Back button -- caught by the guard test in
// e2e/scroll-on-navigate.spec.ts before it went anywhere near the owner.
//
// What the trace showed. On Back, `popstate` fires while the DOM on screen is
// still the OLD route's -- React has not rendered the target route yet -- so
// when Chromium applies the saved offset it clamps it against the wrong,
// shorter document, exactly the same clamp that causes the original bug:
//
//    without any fix   leaving /catering at y=753 (its own max, i.e. the bug)
//                      Back restored 2648  <- correct, but by luck: 753 was
//                      already the clamp target, so no scroll was performed
//                      and Chromium's own deferred re-apply still ran later
//    with reset only   leaving /catering at y=0 (the bug now fixed)
//                      Back restored  753  <- Chromium scrolled 0 -> 753,
//                      counted that as the restore, and never re-applied
//
// That 753 is /catering's maximum scroll showing up on the homepage, which is
// the giveaway. Verified it is not the `scroll-behavior: smooth` in
// src/index.css interfering: forcing `scroll-behavior: auto` for the whole
// session produces the identical 753. The browser simply cannot restore a
// position it has to measure against a document that has not been built yet,
// and that is inherent to client-side routing rather than anything this app
// does oddly.
//
// So restoration moves here, where it can run at the only moment it is
// answerable -- a layout effect, after React has committed the target route's
// DOM and before the browser paints it. `history.scrollRestoration` goes to
// 'manual' so Chromium stops applying its own clamped guess on top of ours.
//
// Deliberately NOT set until a mount effect has run, which is after the
// browser has already done its restore for a genuine document load. That
// split is the point: a real reload keeps the browser's restoration (it is
// measuring against the right document in that case, because the document
// really was reloaded), while same-document history moves become ours.
//
// WHY IT SKIPS A HASH. A URL with a fragment has an explicit scroll target,
// and off-homepage nav links are exactly that shape -- NavBar.tsx rewrites
// its section links to '/#experiences' and friends when `offHomePage` is set.
// Scrolling anywhere on those would be fighting the anchor for the same
// pixels. (Separately and pre-existing: those anchors do not currently land
// on their section anyway -- '/#experiences' measures y=0 with the section
// still 2678px down the viewport, because the fragment target is resolved
// before React has mounted the section. Its own bug, its own cause, neither
// caused nor worsened by this hook; written up in this task's report rather
// than fixed here.)
//
// WHY 'instant' IS SPELLED OUT ON EVERY CALL. src/index.css sets
// `scroll-behavior: smooth` on <html>, which is the default that any scrollTo
// with behavior 'auto' inherits. Without this word a visitor would watch the
// page glide up from its bottom on every navigation -- the same wrong
// position, now with an animation drawing the eye to it -- and Back would
// animate rather than land. That is also the difference from the two
// pagination handlers mentioned above, which pass 'smooth' deliberately and
// correctly: page 2 of a list the reader is already inside is a continuation
// of a page they have seen, so the animation communicates "same list, moved"
// and earns its duration. Arriving on a route they have never seen is not a
// continuation of anything -- there is no relationship between the two
// positions for an animation to express, and the frames in between are of a
// document being left behind. Those two stay smooth, these are instant, and
// the two never interact: theirs fire on a setState that changes no URL, so
// this effect, keyed on the location, cannot run for them.
//
// useLayoutEffect, not useEffect, so both the reset and the restore land in
// the same paint as the new route rather than one frame after it. With
// useEffect the clamped bottom-of-page is genuinely painted once before being
// corrected, which is a visible flash of the exact bug being fixed.

// Keyed by react-router's own per-history-entry `location.key`, which is
// stable across a Back/Forward to the same entry -- that is what makes a
// restore possible at all. Module scope rather than a ref because it has to
// outlive the unmount of any one route, and a plain Map rather than
// sessionStorage because it is only ever needed within a single document's
// lifetime: once the document is genuinely reloaded, the browser's own
// restoration (left switched on above) is the thing answering.
const savedPositions = new Map<string, number>();

export function useScrollReset(): void {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();

  // Read inside a scroll listener that outlives any single location, so it
  // has to be a ref rather than the closed-over `key`.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    // Recorded continuously rather than captured on the way out. There is no
    // reliable "about to navigate" moment to read window.scrollY at: by the
    // time any effect cleanup for the old route runs, the DOM has already
    // been swapped and the offset has already been clamped to the new page.
    // A passive listener that writes one number to a Map is cheap enough to
    // leave running for the life of the document.
    const onScroll = (): void => {
      savedPositions.set(keyRef.current, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'auto';
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (hash !== '') return;
    if (navigationType === 'POP') {
      const saved = savedPositions.get(key);
      // Nothing recorded means this entry was never scrolled in this
      // document -- the first load, or a Forward to a page the visitor left
      // at the top. Leaving it alone is right in both cases; scrolling to 0
      // would be indistinguishable in practice but would also stomp the
      // browser's own restoration on that very first load.
      if (saved === undefined) return;
      window.scrollTo({ top: saved, left: 0, behavior: 'instant' });
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash, key, navigationType]);
}
