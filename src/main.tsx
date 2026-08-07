import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';

const root = document.getElementById('root')!;

// index.html seeds #root with a "this page did not load" message, styled to
// stay invisible for its first few seconds (see that file's own comment).
// Clearing it here is what makes it a FALLBACK rather than content: it is
// removed the instant this module runs, so the only way a visitor ever sees
// it is if this module never ran at all.
//
// Cleared explicitly rather than left for React to overwrite. createRoot()
// does not adopt or replace existing children -- it renders alongside them
// and warns -- so without this the message would sit above the real site.
root.replaceChildren();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
