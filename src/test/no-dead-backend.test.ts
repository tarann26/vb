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

  it('keeps the reservation components on disk for later revival', () => {
    expect(existsSync('src/components/AdminReservations.tsx')).toBe(true);
    expect(existsSync('src/components/ReservationForm.tsx')).toBe(true);
    expect(existsSync('src/components/ReservationPage.tsx')).toBe(true);
  });
});
