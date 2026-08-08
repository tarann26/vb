// What a bookmark that no longer resolves, or a mistyped address, lands on.
//
// Three things it deliberately is not:
//
//   * Not a redirect to Menu. A stale bookmark would then silently become a
//     working URL and she would never learn that the address she saved is
//     wrong.
//   * Not the site-wide <NotFound />. That renders the public Navbar and
//     Footer -- the restaurant's own 404 page -- which inside a logged-in
//     tool reads as "you have been thrown out".
//   * Not a blank screen. The shell staying up, header and nav included, is
//     what makes the mistake recoverable in one tap.
//
// There is no HTTP status to set: the SPA catch-all already serves
// index.html at 200 for every route.
import React from 'react';
import AreaNav from './AreaNav';

export interface AreaNotFoundProps {
  // False when a sidebar is already on screen offering the same five links.
  // ManageShell owns that decision, so that exactly one nav exists at a
  // time -- see AreaNav's own header for why two is a bug rather than a
  // redundancy.
  showAreaList: boolean;
}

const AreaNotFound: React.FC<AreaNotFoundProps> = ({ showAreaList }) => (
  <div>
    <h2 className="mb-2 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">That page isn&rsquo;t here</h2>
    <p className="mb-6 font-['Montserrat'] text-sm text-gray-600">
      The address you followed doesn&rsquo;t match anything on this dashboard. Nothing is wrong with your website
      {showAreaList ? ' — pick one of these instead.' : ' — pick an area from the list beside this one.'}
    </p>
    {showAreaList && <AreaNav variant="list" activeSlug="" />}
  </div>
);

export default AreaNotFound;
