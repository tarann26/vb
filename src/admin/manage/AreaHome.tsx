// The phone drill-down home: five rows, nothing else.
//
// It exists on phones only. On a laptop the sidebar IS the home, permanently,
// and a laptop home screen would be a second copy of it two clicks deep --
// which is why the bare /edit/manage URL redirects there instead (see
// ManageShell).
//
// Nothing here is promoted or buried. All five are peers, at the same size,
// in a fixed order: she has no dominant task, so a ranking would be a guess,
// and a wrong guess is worse than no ranking because it hides something
// under a heading that claims to be complete.
import React from 'react';
import AreaNav from './AreaNav';

export interface AreaHomeProps {
  problemSlugs: string[];
  unsavedSlugs: string[];
}

const AreaHome: React.FC<AreaHomeProps> = ({ problemSlugs, unsavedSlugs }) => (
  <div>
    <h2 className="mb-4 font-['Montserrat'] text-sm uppercase tracking-wide text-gray-500">What would you like to change?</h2>
    <AreaNav variant="list" activeSlug="" problemSlugs={problemSlugs} unsavedSlugs={unsavedSlugs} />
  </div>
);

export default AreaHome;
