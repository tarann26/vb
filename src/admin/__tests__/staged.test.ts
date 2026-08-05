import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStagedFiles, fromStagedPhoto, fromStagedMenuPdf } from '../staged';
import type { StagedPhoto } from '../PhotoField';
import type { StagedMenuPdf } from '../PdfField';

const PHOTO_A: StagedPhoto = {
  path: 'assets-source/food/aaa.jpg',
  contentPath: '/food/aaa.webp',
  content: 'YQ==',
  encoding: 'base64',
};
const PHOTO_B: StagedPhoto = {
  path: 'assets-source/mocktails/bbb.jpg',
  contentPath: '/mocktails/bbb.webp',
  content: 'Yg==',
  encoding: 'base64',
};

describe('useStagedFiles: the one collector every staging screen shares', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useStagedFiles());
    expect(result.current.files).toEqual({});
  });

  it('stages a file under its own key', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => {
      result.current.stage('dishes.json:negroni:image', { path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
    });
    expect(result.current.files).toEqual({
      'dishes.json:negroni:image': { path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath },
    });
  });

  // The exact property Task 9's brief names: "multiple photos staged across
  // different records all reach one publish." Proven here at the collector
  // itself, independent of any particular screen's own key-building scheme.
  it('two different keys coexist -- staging a second file does not evict the first', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => {
      result.current.stage('dishes.json:negroni:image', { path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
    });
    act(() => {
      result.current.stage('drinks.json:viola:image', { path: PHOTO_B.path, content: PHOTO_B.content, encoding: 'base64', contentPath: PHOTO_B.contentPath });
    });
    expect(Object.keys(result.current.files).sort()).toEqual(['dishes.json:negroni:image', 'drinks.json:viola:image']);
    expect(result.current.files['dishes.json:negroni:image']).toEqual({ path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
    expect(result.current.files['drinks.json:viola:image']).toEqual({ path: PHOTO_B.path, content: PHOTO_B.content, encoding: 'base64', contentPath: PHOTO_B.contentPath });
  });

  // PhotoField.tsx/PdfField.tsx's own `onStaged` contract: `null` means "a
  // fresh pick just started, drop whatever this field staged before." A
  // caller that only ever wrote `files[key] = file` and ignored `null` would
  // leave stale bytes sitting in the map -- confirmed directly below that
  // `stage` actually removes the key, not merely sets it to some falsy
  // placeholder value that would still show up in `Object.keys`.
  it('staging null under an existing key removes it entirely', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => {
      result.current.stage('dishes.json:negroni:image', { path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
    });
    act(() => {
      result.current.stage('dishes.json:negroni:image', null);
    });
    expect(result.current.files).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(result.current.files, 'dishes.json:negroni:image')).toBe(false);
  });

  // `toEqual({})` alone cannot fail on the defect this guards against: it
  // would stay green even if `stage`'s null-branch replaced `files` with a
  // BRAND NEW empty object on every call, which is exactly what
  // staged.ts's own comment says NOT to do ("no need to trigger a
  // re-render for it"). `toBe` on the SAME reference is what actually
  // proves the no-op -- every consumer of `files` (every section on the
  // page) re-renders on identity change, so a needless new object here
  // would re-render the whole dashboard on a pick that changed nothing.
  it('staging null under a key that was never staged is a harmless no-op -- the SAME files object, not a new empty one', () => {
    const { result } = renderHook(() => useStagedFiles());
    const before = result.current.files;
    act(() => {
      result.current.stage('dishes.json:negroni:image', null);
    });
    expect(result.current.files).toBe(before);
  });

  it('restaging the same key overwrites its own previous value, not the whole map', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => {
      result.current.stage('dishes.json:negroni:image', { path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
      result.current.stage('drinks.json:viola:image', { path: PHOTO_B.path, content: PHOTO_B.content, encoding: 'base64', contentPath: PHOTO_B.contentPath });
    });
    act(() => {
      result.current.stage('dishes.json:negroni:image', { path: 'assets-source/food/ccc.jpg', content: 'Yw==', encoding: 'base64', contentPath: '/food/ccc.webp' });
    });
    expect(result.current.files['dishes.json:negroni:image']).toEqual({ path: 'assets-source/food/ccc.jpg', content: 'Yw==', encoding: 'base64', contentPath: '/food/ccc.webp' });
    // The OTHER key is untouched.
    expect(result.current.files['drinks.json:viola:image']).toEqual({ path: PHOTO_B.path, content: PHOTO_B.content, encoding: 'base64', contentPath: PHOTO_B.contentPath });
  });
});

// Review finding (Critical): "drop the rest" used to include `contentPath`,
// which is exactly the field publish.ts's dirtyDraftMap needs to recognise
// a leaf that names bytes THIS collector holds -- a restored draft could
// otherwise carry a reference to a photo the tab lost, with nothing left in
// StagedFile to tell that reference apart from an ordinary committed path.
describe('fromStagedPhoto / fromStagedMenuPdf: pick path/content/encoding/contentPath, drop only the rest', () => {
  it('fromStagedPhoto keeps path/content/encoding, and contentPath', () => {
    expect(fromStagedPhoto(PHOTO_A)).toEqual({ path: PHOTO_A.path, content: PHOTO_A.content, encoding: 'base64', contentPath: PHOTO_A.contentPath });
  });

  it('fromStagedPhoto(null) is null', () => {
    expect(fromStagedPhoto(null)).toBeNull();
  });

  it('fromStagedMenuPdf keeps path/content/encoding, and its own `file` as contentPath', () => {
    const staged: StagedMenuPdf = { path: 'public/menus/food-menu.pdf', file: '/menus/food-menu.pdf', content: 'ZA==', encoding: 'base64' };
    expect(fromStagedMenuPdf(staged)).toEqual({ path: staged.path, content: staged.content, encoding: 'base64', contentPath: staged.file });
  });

  it('fromStagedMenuPdf(null) is null', () => {
    expect(fromStagedMenuPdf(null)).toBeNull();
  });
});

// `clearSent` is what a finished publish uses to drop what it actually sent.
// Matching by object identity rather than by key is the whole point: a
// re-pick under the SAME key while the request was in flight produces a
// genuinely different StagedFile, and clearing by key would delete its bytes
// while the registry kept naming its contentPath -- a content file pointing
// at an asset that exists nowhere, which the deploy gate then fails on every
// build until someone hand-edits the JSON.
describe('useStagedFiles: clearSent drops what a publish sent, by identity', () => {
  const fileA = { path: 'assets-source/food/a.jpg', content: 'YQ==', encoding: 'base64' as const, contentPath: '/food/a.webp' };
  const fileB = { path: 'assets-source/food/b.jpg', content: 'Yg==', encoding: 'base64' as const, contentPath: '/food/b.webp' };

  it('drops exactly the entries that were sent', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => {
      result.current.stage('k1', fileA);
      result.current.stage('k2', fileB);
    });
    const sent = { k1: fileA };
    act(() => result.current.clearSent(sent));
    expect(result.current.files).toEqual({ k2: fileB });
  });

  it('leaves a key alone when its value is no longer the object that was sent', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => result.current.stage('k1', fileA));
    const sent = { ...result.current.files };
    // She re-picks for the same field while the request is still open.
    act(() => result.current.stage('k1', null));
    act(() => result.current.stage('k1', fileB));

    act(() => result.current.clearSent(sent));

    expect(result.current.files).toEqual({ k1: fileB });
  });

  it('is a no-op that does not replace the map when nothing matches', () => {
    const { result } = renderHook(() => useStagedFiles());
    act(() => result.current.stage('k1', fileA));
    const before = result.current.files;
    act(() => result.current.clearSent({ k9: fileB }));
    // Same object, not an equal copy -- the same posture `stage` already
    // takes for a removal that removes nothing.
    expect(result.current.files).toBe(before);
  });
});
