// One message about a block, or about the list inside one, rendered where the
// field that would have carried it is not.
//
// A component rather than the same three attributes written out at four call
// sites across two files, which is what the first version of this task did:
// the class string was declared twice, once as BLOCK_MESSAGE_CLASSNAME and
// once as LIST_MESSAGE_CLASSNAME, character for character the same. It cost no
// bytes (the build was byte-identical), but a retyped Tailwind string is the
// drift Field.tsx and RecordList.tsx export their own bindings to prevent, and
// two copies is how the first character-off copy arrives.
//
// `role="alert"` is the load-bearing part and the reason this is one component:
// PostList's "take me to the first one" finds the first thing on the panel
// announcing itself as an alert, so the role is what makes a message REACHABLE
// as well as announced. One place to render one, one place for the role.
import type React from 'react';

export default function BlockProblemMessage({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className={`mb-3 font-['Montserrat'] text-sm text-red-600`}>
      {children}
    </p>
  );
}
