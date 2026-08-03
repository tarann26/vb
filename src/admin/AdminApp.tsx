import React from 'react';
import { useSession } from './session';
import Login from './Login';

// Default export, deliberately: React.lazy (src/App.tsx) requires one --
// there is no lazy() form that takes a named export.
//
// This is the whole dashboard for this task: the route, the bundle guard
// that keeps everything under src/admin/ out of the main chunk (see
// src/test/bundle.test.ts and src/test/bundle.post-build.test.ts), and the
// login gate in front of it. The actual content-editing screens are later
// tasks in this plan.
const AdminApp: React.FC = () => {
  const { status, logIn } = useSession();

  if (status === 'checking') {
    // src/App.tsx's <Suspense fallback={null}> already covers the moment
    // this chunk itself is still downloading; this covers the moment right
    // after it has loaded but before GET /api/wa (the session probe) has
    // answered. Rendering nothing here too avoids a login-form flash for
    // someone who is, in fact, already logged in.
    return null;
  }

  if (status === 'out') {
    return <Login onLogin={logIn} />;
  }

  // status === 'in'. The real dashboard (content forms, publish, uploads)
  // is built in later tasks of this plan -- this placeholder is here only
  // so a successful login has something to show instead of a blank page.
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f5f0] px-4">
      <p className="font-['Montserrat'] text-[#222]">Dashboard coming soon.</p>
    </div>
  );
};

export default AdminApp;
