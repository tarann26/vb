// The Posts panel -- Phase 5B. A stub in Task 3 and filled in Task 4: this
// task's job is the registration coupling (CONTENT_FILES, PANELS,
// content.test.ts's retired exception, e2e/edit-backend.ts), and shipping
// that with no panel on screen would leave `areas.test.tsx`'s
// panel-completeness assertion satisfied by a component that renders
// nothing anybody could find.
//
// It reads PANELS.posts.heading rather than repeating the string, and that
// is the first place in this dashboard that does. Every other panel paints a
// literal, which makes the constant's value load-bearing only through
// panel-snapshots.test.tsx and owner-facing-labels.test.tsx -- two files
// that catch a rename for reasons unrelated to the rename. Reading it here
// means a rename of PANELS.posts.heading changes what she sees, which is
// what the constant claims to be for.
//
// THE BODY IS NOT "Loading posts…", and that is deliberate rather than a
// missed detail. The sibling panels' loading string is honest for them
// because a fetch is actually in flight and clears it; this stub fetches
// nothing, so that string would be a load state that never ends -- and three
// separate places wait for exactly it to disappear before they measure
// anything: panel-snapshots.test.tsx's `queryByText(/^Loading /)`,
// owner-facing-labels.test.tsx's `textContent` check, and
// e2e/dashboard-sections.spec.ts's `openDashboard`, which gates EVERY spec in
// that file. All three hang on a permanent one, the last of them invisibly to
// `npm run gate`. A plain sentence is both truer and cheaper. Task 4 replaces
// it with the real fetch, and the loading string arrives with the thing that
// makes it true.
import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { PANELS } from '../manage/areas';
import type { AreaProps } from './area-props';

const PostsArea: React.FC<AreaProps> = ({ publishLocked }) => (
  <SectionErrorBoundary name={PANELS.posts.heading}>
    <CollapsibleSection id="posts" heading={PANELS.posts.heading} locked={publishLocked}>
      <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">Your blog posts will be editable here.</p>
    </CollapsibleSection>
  </SectionErrorBoundary>
);

export default PostsArea;
