// The client half of "undo my last publish": the record store that holds the
// offer, the sentence she reads before confirming, and the POST's own status
// mapping.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UNDO_STORAGE_KEY,
  clearUndoRecord,
  describePaths,
  describesAddedPhoto,
  loadUndoRecord,
  rememberPublish,
  requestUndo,
  UNDO_MAX_AGE_MS,
  type UndoRecord,
} from '../undo';
import { CONTENT_FILES, CONTENT_FILE_LABELS } from '../content';

afterEach(() => {
  window.localStorage.clear();
});

// A fixed instant, with every read below given an explicit `now` relative to
// it -- the record now carries an age bound (UNDO_MAX_AGE_MS), so a fixture
// pinned to a literal past timestamp and read against the real wall clock
// would be permanently expired.
const AT = 1_700_000_000_000;
const RECORD: UndoRecord = { sha: 'commit-1', at: AT, paths: ['src/content/dishes.json'] };

describe('the undo record store', () => {
  it('round-trips a record', () => {
    rememberPublish(RECORD);
    expect(loadUndoRecord(undefined, AT)).toEqual(RECORD);
  });

  // Review finding (Minor): there was no age bound at all, and
  // `rememberPublish` overwrites on every publish, so the first publish from
  // a browser made "Undo my last publish" a permanent fixture of both
  // surfaces -- an offer to revert a four-day-old change, described to her
  // as "the change you published", which a single-owner site's untouched
  // `main` would let the server actually carry out.
  //
  // Mutation this guards: deleting the `now - at > UNDO_MAX_AGE_MS` check in
  // loadUndoRecord.
  it('an offer older than the window reads as no offer', () => {
    rememberPublish(RECORD);
    expect(loadUndoRecord(undefined, AT + UNDO_MAX_AGE_MS + 1)).toBeNull();
    // Non-vacuous: one millisecond earlier, the same stored record is still
    // returned -- so this is a boundary, not "always null".
    expect(loadUndoRecord(undefined, AT + UNDO_MAX_AGE_MS)).toEqual(RECORD);
  });

  // A device whose clock is briefly behind (a laptop waking with a stale
  // time) must not silently destroy the offer -- and must not be able to
  // make one look infinitely fresh either; it simply reads as not expired.
  it('a record timestamped in the future is not treated as expired', () => {
    rememberPublish(RECORD);
    expect(loadUndoRecord(undefined, AT - 60_000)).toEqual(RECORD);
  });

  it('clearing it makes the offer unreachable, not merely refused', () => {
    rememberPublish(RECORD);
    // Non-vacuous: read at an instant where the age bound would NOT have
    // hidden it anyway, so the null below is the clear and nothing else.
    expect(loadUndoRecord(undefined, AT)).not.toBeNull();
    clearUndoRecord();
    expect(loadUndoRecord(undefined, AT)).toBeNull();
  });

  it('a corrupted or half-shaped value reads as no offer, never as a throw', () => {
    const cases = ['not json at all', '{}', '{"sha":"x"}', '{"sha":"x","at":"soon","paths":[]}', '{"sha":"x","at":1,"paths":[3]}', 'null'];
    cases.forEach((raw) => {
      window.localStorage.setItem(UNDO_STORAGE_KEY, raw);
      expect(loadUndoRecord()).toBeNull();
    });
  });

  // rememberPublish runs in the SUCCESS path of a publish that has already
  // landed on the branch. A storage failure there -- Safari's private mode,
  // a quota error -- must degrade to "no undo offered", never to an
  // exception thrown on top of a publish that actually worked.
  it('never throws when storage itself throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;

    expect(() => rememberPublish(RECORD, hostile)).not.toThrow();
    expect(() => clearUndoRecord(hostile)).not.toThrow();
    expect(loadUndoRecord(hostile)).toBeNull();
  });
});

describe('describePaths: what she is told she is putting back', () => {
  // Total over the real file list -- an eleventh content file added without
  // a label would fail `tsc -b` at CONTENT_FILE_LABELS, and this proves the
  // mapping is actually reached for every one of them here too.
  it('names every content file by its dashboard heading', () => {
    CONTENT_FILES.forEach((file) => {
      expect(describePaths([`src/content/${file}`])).toBe(CONTENT_FILE_LABELS[file]);
    });
  });

  it('joins two sections readably', () => {
    expect(describePaths(['src/content/dishes.json', 'src/content/site.json'])).toBe('Dishes and Opening hours');
  });

  // The leak this exists to prevent. PublishBar already carries a review
  // finding about putting internal paths in front of her; a filename with an
  // extension is the same mistake.
  it('never emits a raw path or filename, for any shape', () => {
    const shapes = [
      ['src/content/dishes.json'],
      ['assets-source/food/9f2c1a4b7e03.jpg'],
      ['public/menus/food-menu.pdf'],
      ['src/content/not-a-real-file.json'],
      ['something/entirely/unexpected.txt'],
      [],
    ];
    shapes.forEach((paths) => {
      const described = describePaths(paths);
      expect(described).not.toMatch(/src\/content|assets-source|public\/menus|\.json|\.jpg|\.pdf|\//);
    });
  });

  it('falls back to a generic phrase rather than the path when nothing is recognised', () => {
    expect(describePaths(['something/entirely/unexpected.txt'])).toBe('your last change');
    expect(describePaths([])).toBe('your last change');
  });

  // A menu PDF must be named: its path is name-based, so replacing one
  // leaves menus.json unchanged and the blob restore is the ONLY thing that
  // puts the old file back. Saying nothing here would leave her told
  // "nothing to undo" at exactly the moment she needs it most.
  it('names a menu PDF, because restoring it is the whole point in that case', () => {
    expect(describePaths(['public/menus/food-menu.pdf'])).toBe('a menu PDF');
    expect(describePaths(['src/content/menus.json', 'public/menus/food-menu.pdf'])).toBe('Menus and a menu PDF');
  });

  // A photo is deliberately NOT named as something being put back. Photo
  // paths are content-addressed, so a photo publish is always an ADD at a
  // fresh path, and an undo skips added paths entirely -- it restores the
  // JSON that points at a photo, never the photo file.
  it('does not claim to put a photo back, and says the honest negative instead', () => {
    expect(describePaths(['src/content/dishes.json', 'assets-source/food/abc.jpg'])).toBe('Dishes');
    expect(describesAddedPhoto(['src/content/dishes.json', 'assets-source/food/abc.jpg'])).toBe(true);
    expect(describesAddedPhoto(['src/content/dishes.json'])).toBe(false);
  });
});

describe('requestUndo: status in, meaning out', () => {
  function respondWith(status: number, body: unknown = {}) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  }

  it('200 with a sha is success', async () => {
    await expect(requestUndo('commit-1', respondWith(200, { sha: 'undo-commit' }) as unknown as typeof fetch)).resolves.toEqual({
      status: 'success',
      sha: 'undo-commit',
    });
  });

  it('200 without a sha is a server error, not a silent success', async () => {
    await expect(requestUndo('commit-1', respondWith(200, {}) as unknown as typeof fetch)).resolves.toEqual({ status: 'server-error' });
  });

  it('401 is unauthenticated', async () => {
    await expect(requestUndo('commit-1', respondWith(401) as unknown as typeof fetch)).resolves.toEqual({ status: 'unauthenticated' });
  });

  // Both server-side refusals -- a stale sha and "this cannot be put back" --
  // answer 409, and this branches on STATUS alone, never on message text.
  it('409 is a conflict, whatever the message says', async () => {
    await expect(
      requestUndo('commit-1', respondWith(409, { message: 'Something else has been published since.' }) as unknown as typeof fetch),
    ).resolves.toEqual({ status: 'conflict' });
    await expect(
      requestUndo('commit-1', respondWith(409, { message: 'there is nothing to put back' }) as unknown as typeof fetch),
    ).resolves.toEqual({ status: 'conflict' });
  });

  it('502 is a server error', async () => {
    await expect(requestUndo('commit-1', respondWith(502) as unknown as typeof fetch)).resolves.toEqual({ status: 'server-error' });
  });

  it('a thrown fetch is a network error', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(requestUndo('commit-1', throwing)).resolves.toEqual({ status: 'network-error' });
  });

  it('sends the sha it was given', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second param exists only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ sha: 'u' }), { status: 200 }));
    await requestUndo('commit-abc', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/undo');
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({ sha: 'commit-abc' });
  });
});
