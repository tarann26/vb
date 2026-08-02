import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolchain', () => {
  it('build script type-checks before bundling', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.build).toBe('npm run images && tsc -b && vite build');
  });

  it('package is not named after the starter template', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.name).not.toBe('vite-react-typescript-starter');
  });
});
