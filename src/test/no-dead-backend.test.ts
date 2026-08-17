import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('dead backend', () => {
  it('has no supabase client', () => {
    expect(existsSync('src/integrations/supabase/client.ts')).toBe(false);
  });

  it('has no supabase dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined();
  });

  it('has no lovable-tagger', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['lovable-tagger']).toBeUndefined();
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('lovable-tagger');
  });

  it('does not route to the unauthenticated admin page', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toContain('path="/admin"');
    expect(app).not.toContain('path="/reservation"');
  });

  it('still routes to /blogs', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('path="/blogs"');
  });

  // The owner's constraint names all seven files below as never-delete,
  // regardless of whether this task's route removal touched them. Driven
  // from one array + it.each so an eighth protected file later is a
  // one-line addition rather than a new hand-written block.
  const protectedComponents = [
    'AdminReservations.tsx',
    'ReservationForm.tsx',
    'ReservationPage.tsx',
    'ChefGallery.tsx',
    'NewsPress.tsx',
    'SignatureMocktails.tsx',
    'BlogsPage.tsx',
    // Phase 5B: nothing routes to BlogTeaser after the homepage swap, and it
    // stays on disk under the owner's never-delete constraint -- the same
    // treatment NewsPress.tsx already has. The section it used to draw is the
    // blog now; the file is kept because she asked for nothing to be deleted.
    'BlogTeaser.tsx',
  ];

  it.each(protectedComponents)('keeps %s on disk for later revival', (file) => {
    expect(existsSync(`src/components/${file}`)).toBe(true);
  });
});
