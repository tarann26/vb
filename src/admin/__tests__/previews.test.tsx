// The preview store, which is where the local preview of a just-picked photo
// lives now that it may not live inside EditableImage (see previews.ts's own
// header for the three separate times an unmount destroyed it there).
//
// Every assertion here is about object-URL LIFETIME, which is the whole
// reason this module exists: a URL that is revoked while something still
// shows it becomes a broken image, and a URL that is never revoked is a leak
// that holds a multi-megabyte photo in memory for the rest of the session.
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useImagePreviews, NO_IMAGE_PREVIEWS } from '../previews';
import type { ImagePreviews } from '../previews';

function mountStore() {
  let store: ImagePreviews | null = null;
  function Probe() {
    store = useImagePreviews();
    return null;
  }
  const view = render(<Probe />);
  // Non-null by construction: render() has already called Probe.
  return { get: () => store as ImagePreviews, view };
}

describe('useImagePreviews', () => {
  it('holds a url under the path that asked for it, and nothing under any other', () => {
    const { get } = mountStore();
    act(() => get().set('galleries.heroCollage.photo-1', 'blob:one'));
    expect(get().urls).toEqual({ 'galleries.heroCollage.photo-1': 'blob:one' });
    act(() => get().set('galleries.heroCollage.photo-2', 'blob:two'));
    expect(get().urls).toEqual({
      'galleries.heroCollage.photo-1': 'blob:one',
      'galleries.heroCollage.photo-2': 'blob:two',
    });
  });

  it('revokes the url a path was already holding when that path picks again', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { get } = mountStore();
      act(() => get().set('dishes.abc.image', 'blob:first'));
      expect(revoke).not.toHaveBeenCalled();
      act(() => get().set('dishes.abc.image', 'blob:second'));
      expect(revoke.mock.calls).toEqual([['blob:first']]);
      expect(get().urls['dishes.abc.image']).toBe('blob:second');
    } finally {
      revoke.mockRestore();
    }
  });

  it('does not revoke a url that is being re-set to itself', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { get } = mountStore();
      act(() => get().set('dishes.abc.image', 'blob:same'));
      act(() => get().set('dishes.abc.image', 'blob:same'));
      expect(revoke).not.toHaveBeenCalled();
      expect(get().urls['dishes.abc.image']).toBe('blob:same');
    } finally {
      revoke.mockRestore();
    }
  });

  it('drops the entry and revokes it for null', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { get } = mountStore();
      act(() => get().set('press.x.image', 'blob:gone'));
      act(() => get().set('press.x.image', null));
      expect(revoke.mock.calls).toEqual([['blob:gone']]);
      expect(get().urls).toEqual({});
    } finally {
      revoke.mockRestore();
    }
  });

  it('releases every url it still holds when the screen itself goes away', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { get, view } = mountStore();
      act(() => get().set('a', 'blob:a'));
      act(() => get().set('b', 'blob:b'));
      expect(revoke).not.toHaveBeenCalled();
      view.unmount();
      expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:a', 'blob:b']);
    } finally {
      revoke.mockRestore();
    }
  });

  // The point of this one: `set` reads the CURRENT map from a ref, not from a
  // value captured when the callback was created. Two writes inside one
  // React batch -- neither of which has re-rendered yet -- must both survive.
  it('keeps both writes when two paths stage inside the same batch', () => {
    const { get } = mountStore();
    act(() => {
      get().set('one', 'blob:1');
      get().set('two', 'blob:2');
    });
    expect(get().urls).toEqual({ one: 'blob:1', two: 'blob:2' });
  });
});

describe('NO_IMAGE_PREVIEWS', () => {
  // What `buildBundle` falls back to when a caller hands it no store. It has
  // to be inert in BOTH directions: no preview to read, and no revoke to
  // perform on a url it never owned.
  it('never holds anything and never revokes anything', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      NO_IMAGE_PREVIEWS.set('anything', 'blob:x');
      expect(NO_IMAGE_PREVIEWS.urls).toEqual({});
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      revoke.mockRestore();
    }
  });
});
