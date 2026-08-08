// Thumbnail in isolation: precedence, the two fallbacks, and the fact that
// it never retries a broken URL.
//
// These cases pass identically whether Thumbnail is mounted on six row types
// or on none, which is why the row-by-row walk in
// src/admin/__tests__/thumbnail-rows.test.tsx exists alongside them.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Thumbnail from '../Thumbnail';
import type { ImagePreviews } from '../../previews';

function previewsWith(urls: Record<string, string>): ImagePreviews {
  return { urls, set: () => {} };
}

function img(): HTMLImageElement | null {
  return document.querySelector('img');
}

describe('Thumbnail', () => {
  it('renders the content path when there is nothing staged', () => {
    render(<Thumbnail path="/food/a.webp" />);
    expect(img()).toHaveAttribute('src', '/food/a.webp');
  });

  // She has just picked a photo. PhotoField optimistically wrote the
  // eventual published contentPath into the record, and there is no file
  // behind it until the build finishes -- rendering it would show a broken
  // image for two minutes at exactly the moment she is looking for
  // reassurance.
  it('a staged preview beats the content path', () => {
    render(
      <Thumbnail
        path="/food/aaa111.webp"
        previewKey="dishes.json:a:image"
        previews={previewsWith({ 'dishes.json:a:image': 'blob:just-picked' })}
      />,
    );
    expect(img()).toHaveAttribute('src', 'blob:just-picked');
  });

  it('a preview stored under a DIFFERENT key does not leak into this row', () => {
    render(
      <Thumbnail
        path="/food/a.webp"
        previewKey="dishes.json:a:image"
        previews={previewsWith({ 'dishes.json:b:image': 'blob:someone-else' })}
      />,
    );
    expect(img()).toHaveAttribute('src', '/food/a.webp');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the empty string', ''],
  ])('renders a neutral placeholder when the path is %s', (_label, path) => {
    const { container } = render(<Thumbnail path={path} />);
    expect(img()).toBeNull();
    // Not a browser broken-image glyph, and not nothing: collapsing the box
    // makes the rows ragged, which reads as broken.
    const box = container.querySelector('[aria-hidden="true"]');
    expect(box).not.toBeNull();
  });

  it('has an EMPTY alt, so a screen reader does not announce the dish twice', () => {
    render(<Thumbnail path="/food/a.webp" />);
    expect(img()).toHaveAttribute('alt', '');
  });

  it('is lazily loaded', () => {
    render(<Thumbnail path="/food/a.webp" />);
    expect(img()).toHaveAttribute('loading', 'lazy');
  });

  // A just-published photo the CDN has not caught up with, or a path
  // hand-edited to something wrong.
  it('falls back to the placeholder on a load error, ONCE, with no retry loop', () => {
    const { container } = render(<Thumbnail path="/food/missing.webp" />);
    const el = img();
    expect(el).not.toBeNull();

    fireEvent.error(el!);

    expect(img()).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Mutation this guards: track the failure as a bare boolean cleared on
    // every render -- the <img> comes back and fires `error` again forever.
    fireEvent.error(el!);
    expect(img()).toBeNull();
  });

  // The other half of that: the failure is remembered per SRC, not
  // permanently, so picking a new photo after a broken one shows the new
  // one. A bare boolean would leave this row a placeholder for good.
  it('gives a NEW src a fresh chance after an earlier one failed', () => {
    const { rerender } = render(<Thumbnail path="/food/missing.webp" />);
    fireEvent.error(img()!);
    expect(img()).toBeNull();

    rerender(<Thumbnail path="/food/replacement.webp" />);
    expect(img()).toHaveAttribute('src', '/food/replacement.webp');
  });

  it('the placeholder is hidden from the accessibility tree', () => {
    render(<Thumbnail path={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
