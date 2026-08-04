import { describe, it, expect } from 'vitest';
import {
  parseSectionContentPath,
  findTemplateSection,
  setTemplateSectionText,
  setTemplateSectionImage,
} from '../template-section-paths';
import type { Section, TemplateContent } from '../../content/types';

describe('parseSectionContentPath', () => {
  it('parses a well-formed section content path', () => {
    expect(parseSectionContentPath('sections.promo.content.heading')).toEqual({ sectionId: 'promo', rest: 'heading' });
    expect(parseSectionContentPath('sections.promo.content.paragraphs.0')).toEqual({ sectionId: 'promo', rest: 'paragraphs.0' });
  });

  it('returns null for a path with no "content" segment, or a totally different shape', () => {
    expect(parseSectionContentPath('galleries.atmosphere.0')).toBeNull();
    expect(parseSectionContentPath('dishes.a.image')).toBeNull();
    expect(parseSectionContentPath('nav.wordmark')).toBeNull();
    expect(parseSectionContentPath('sections.promo.enabled')).toBeNull();
  });
});

describe('findTemplateSection', () => {
  const sections: Section[] = [
    { kind: 'bespoke', id: 'hero', enabled: true },
    { kind: 'template', id: 'promo', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } },
  ];

  it('finds the template section with a matching id', () => {
    expect(findTemplateSection(sections, 'promo')?.id).toBe('promo');
  });

  it('never matches a bespoke section, even one whose id happens to equal the query', () => {
    expect(findTemplateSection(sections, 'hero')).toBeUndefined();
  });

  it('returns undefined for an id naming nothing', () => {
    expect(findTemplateSection(sections, 'does-not-exist')).toBeUndefined();
  });
});

describe('setTemplateSectionText', () => {
  it('sets heading, for every template (the one field all four share)', () => {
    const text: TemplateContent = { heading: 'old', paragraphs: ['p'] };
    expect(setTemplateSectionText(text, 'heading', 'new')).toEqual({ heading: 'new', paragraphs: ['p'] });
  });

  it('sets one paragraph by index, leaving its siblings untouched', () => {
    const text: TemplateContent = { heading: 'H', paragraphs: ['a', 'b', 'c'] };
    expect(setTemplateSectionText(text, 'paragraphs.1', 'B')).toEqual({ heading: 'H', paragraphs: ['a', 'B', 'c'] });
  });

  it('sets an item\'s name or description by index, leaving image and siblings untouched', () => {
    const itemList: TemplateContent = {
      heading: 'H',
      items: [
        { image: '/a.webp', name: 'A', description: 'da' },
        { image: '/b.webp', name: 'B', description: 'db' },
      ],
    };
    expect(setTemplateSectionText(itemList, 'items.1.name', 'Renamed')).toEqual({
      heading: 'H',
      items: [
        { image: '/a.webp', name: 'A', description: 'da' },
        { image: '/b.webp', name: 'Renamed', description: 'db' },
      ],
    });
  });

  it('sets a fact\'s label or value by index', () => {
    const detail: TemplateContent = { heading: 'H', body: 'B', facts: [{ label: 'Day', value: 'Sat' }] };
    expect(setTemplateSectionText(detail, 'facts.0.value', 'Sun')).toEqual({
      heading: 'H',
      body: 'B',
      facts: [{ label: 'Day', value: 'Sun' }],
    });
  });

  it('sets body, only on detailBlock content', () => {
    const detail: TemplateContent = { heading: 'H', body: 'old', facts: [] };
    expect(setTemplateSectionText(detail, 'body', 'new')).toEqual({ heading: 'H', body: 'new', facts: [] });
  });

  // The mutation this test exists to catch: a path this function doesn't
  // recognise must be a safe no-op, never a crash and never a silent
  // corruption of an unrelated field -- the same "unreachable state, not a
  // reason to invent one" posture ContentRegistry's own `updateData`
  // already takes.
  it('is a no-op for a path shape this function does not recognise', () => {
    const text: TemplateContent = { heading: 'H', paragraphs: ['p'] };
    expect(setTemplateSectionText(text, 'nonsense.path', 'x')).toEqual(text);
    expect(setTemplateSectionText(text, 'paragraphs.99', 'x')).toEqual(text); // out of range
    expect(setTemplateSectionText(text, 'body', 'x')).toEqual(text); // text has no body
  });

  it('never touches an item\'s own image field -- that is setTemplateSectionImage\'s job, not this one\'s', () => {
    const itemList: TemplateContent = { heading: 'H', items: [{ image: '/a.webp', name: 'A', description: 'd' }] };
    expect(setTemplateSectionText(itemList, 'items.0.image', 'should-not-apply')).toEqual(itemList);
  });
});

describe('setTemplateSectionImage', () => {
  it('replaces an item\'s own image by index', () => {
    const itemList: TemplateContent = {
      heading: 'H',
      items: [
        { image: '/old-a.webp', name: 'A', description: 'da' },
        { image: '/old-b.webp', name: 'B', description: 'db' },
      ],
    };
    const result = setTemplateSectionImage(itemList, 'items.1.image', '/new-b.webp');
    expect(result).toEqual({
      heading: 'H',
      items: [
        { image: '/old-a.webp', name: 'A', description: 'da' },
        { image: '/new-b.webp', name: 'B', description: 'db' },
      ],
    });
  });

  it('replaces a gallery image\'s own src by index, leaving alt untouched', () => {
    const gallery: TemplateContent = {
      heading: 'H',
      layout: 'scroll',
      images: [{ src: '/old.webp', alt: 'Old alt' }],
    };
    expect(setTemplateSectionImage(gallery, 'images.0', '/new.webp')).toEqual({
      heading: 'H',
      layout: 'scroll',
      images: [{ src: '/new.webp', alt: 'Old alt' }],
    });
  });

  it('is a no-op for a path shape this function does not recognise', () => {
    const text: TemplateContent = { heading: 'H', paragraphs: ['p'] };
    expect(setTemplateSectionImage(text, 'heading', '/x.webp')).toEqual(text);
  });
});
