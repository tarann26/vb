import { beforeEach, describe, expect, it } from 'vitest';
import { ARRIVAL_STORAGE_KEY, arrivalToRecord } from '../campaign';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

describe('arrivalToRecord', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('records a tagged arrival once and refuses the same tag again in this tab', () => {
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBeNull();
    expect(storage.map.get(ARRIVAL_STORAGE_KEY)).toBe('instagram');
  });

  // The case a bare boolean would get wrong.
  it('records a DIFFERENT tag in the same tab as its own arrival', () => {
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=zomato', storage)).toBe('zomato');
  });

  // And the case marking with the BUCKET got wrong, which a bare boolean and
  // the bucket both fail for the same reason: every unrecognised tag counts
  // under one row, so two of them in one tab compared equal and the second
  // arrival vanished. The mark is the tag she actually placed.
  it('records two different unrecognised tags in one tab as two arrivals', () => {
    expect(arrivalToRecord('/', '?utm_source=partner-a', storage)).toBe('other');
    expect(arrivalToRecord('/', '?utm_source=partner-b', storage)).toBe('other');
    expect(storage.map.get(ARRIVAL_STORAGE_KEY)).toBe('partner-b');
    // The same unrecognised tag twice is still ONE arrival -- a refresh must
    // not become a second row just because the tag has no name of its own.
    expect(arrivalToRecord('/', '?utm_source=partner-b', storage)).toBeNull();
  });

  it('records nothing at all for an untagged visit', () => {
    for (const search of ['', '?', '?ref=x', '?utm_source=', '?utm_source=%20%20', '?utm_medium=cpc']) {
      expect(arrivalToRecord('/', search, storage)).toBeNull();
    }
    expect(storage.map.size).toBe(0);
  });

  it('never counts her own editing sessions', () => {
    expect(arrivalToRecord('/edit', '?utm_source=instagram', storage)).toBeNull();
    expect(arrivalToRecord('/edit/manage/menu', '?utm_source=instagram', storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('still counts a public page whose slug begins with those four letters', () => {
    // The off-by-one. `startsWith('/edit')` without the segment boundary
    // silently exempts every future page called /editorial.
    expect(arrivalToRecord('/editorial', '?utm_source=instagram', storage)).toBe('instagram');
  });

  it('counts the arrival rather than dropping it when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(arrivalToRecord('/', '?utm_source=instagram', refusing)).toBe('instagram');
  });

  it('normalises before it compares, so two spellings of one link are one arrival', () => {
    expect(arrivalToRecord('/', '?utm_source=Instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=INSTAGRAM', storage)).toBeNull();
  });

  it('normalises an unknown tag before it leaves the browser', () => {
    expect(arrivalToRecord('/', '?utm_source=fbclid-9911', storage)).toBe('other');
  });

  it('remembers under a versioned key', () => {
    expect(ARRIVAL_STORAGE_KEY).toBe('vb:arrival:v1');
  });
});
