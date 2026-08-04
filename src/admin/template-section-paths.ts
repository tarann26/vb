// Plan 7, Task 5, Step 1: "template sections are editable in place ... this
// should be wiring, not new machinery" -- true for the RENDERING half (Task
// 2 already wired every template component through content.renderText/
// renderImage), false for the COMMIT half, which this module is. Confirmed
// directly, the hard way: EditMode.tsx's own `renderText` unconditionally
// routes every path through `setCopyText(copy, path, next)` -- correct for
// every COPY_FIELDS leaf, but `setCopyText`'s own `path.split('.')` only
// ever reads the FIRST TWO segments (`[namespace, leaf] = path.split('.')`)
// and looks `namespace` up on `Copy`, which has no `sections` key at all.
// A path like `sections.<id>.content.heading` (exactly what TextSection.tsx
// and its three siblings pass to renderText) resolves `section =
// copy['sections']`, which is `undefined` -- `setCopyText`'s own malformed-
// namespace guard then returns `copy` UNCHANGED. Measured directly: typing
// into a template section's heading at /edit and blurring produces a
// SILENT no-op, with no error, no visual difference, and nothing telling
// her the edit never happened. This module is what EditMode.tsx's own
// `commitText`/`renderImage` check FIRST, before ever falling through to
// the copy.json path -- see that file's own comment at each call site.
//
// Scope, decided (Task 5, Step 3): /edit renders ONLY the homepage in this
// plan -- a page she creates is dashboard-only for now (see EditMode.tsx's
// own header comment on that decision, and why). That is what makes
// `sections.<id>.content.*` unambiguous here: the SAME template id can be
// reused on a page too (Task 1's own scoping decision, guards.test.ts's
// "allows the SAME template section id to be reused across two different
// pages"), which would make this path scheme genuinely ambiguous the
// moment /edit could render a page as well -- it cannot, so every path
// this module resolves names a sections.json entry, never a page's.
import type { TemplateSection, TemplateContent, TemplateListItem, GalleryImage, TemplateFact } from '../content/types';

export interface ParsedSectionContentPath {
  sectionId: string;
  // Everything after `sections.<id>.content.` -- e.g. "heading",
  // "paragraphs.0", "items.0.name", "images.0", "facts.0.value".
  rest: string;
}

const SECTION_CONTENT_PATH = /^sections\.([^.]+)\.content\.(.+)$/;

export function parseSectionContentPath(path: string): ParsedSectionContentPath | null {
  const match = path.match(SECTION_CONTENT_PATH);
  if (!match) return null;
  return { sectionId: match[1], rest: match[2] };
}

// Finds the one TemplateSection in `sections` whose id matches -- a bespoke
// section can never match (its own id is a SectionId, and no renderText/
// renderImage call site in App.tsx's SECTION_COMPONENTS ever builds a
// `sections.<id>.content.*` path for one; only the four template
// components do, for their own `section.id`).
export function findTemplateSection(sections: { kind: string; id: string }[], sectionId: string): TemplateSection | undefined {
  const found = sections.find((s) => s.kind === 'template' && s.id === sectionId);
  return found as TemplateSection | undefined;
}

// Rewrites exactly the one leaf `rest` names inside `section.content`,
// leaving every sibling field -- and every other section in the array,
// which this function does not touch at all -- unchanged. Mirrors
// TemplateContentForm.tsx's own per-template field shapes exactly (the
// dashboard's own editor for the same content), so a path this function
// doesn't recognise is a path that editor doesn't produce either: an
// unrecognised `rest` is a safe no-op (returns `content` unchanged), the
// same "unreachable state, not a reason to invent one" posture
// ContentRegistry's own `updateData` already takes elsewhere in this admin
// surface.
export function setTemplateSectionText(content: TemplateContent, rest: string, value: string): TemplateContent {
  const parts = rest.split('.');

  if (parts.length === 1 && parts[0] === 'heading') {
    return { ...content, heading: value };
  }

  if ('body' in content && parts.length === 1 && parts[0] === 'body') {
    return { ...content, body: value };
  }

  if ('paragraphs' in content && parts.length === 2 && parts[0] === 'paragraphs') {
    const index = Number(parts[1]);
    if (!Number.isInteger(index) || index < 0 || index >= content.paragraphs.length) return content;
    return { ...content, paragraphs: content.paragraphs.map((p, i) => (i === index ? value : p)) };
  }

  if ('items' in content && parts.length === 3 && parts[0] === 'items') {
    const index = Number(parts[1]);
    const field = parts[2];
    if (!Number.isInteger(index) || index < 0 || index >= content.items.length) return content;
    if (field !== 'name' && field !== 'description') return content;
    const patch: Partial<TemplateListItem> = { [field]: value };
    return { ...content, items: content.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) };
  }

  if ('facts' in content && parts.length === 3 && parts[0] === 'facts') {
    const index = Number(parts[1]);
    const field = parts[2];
    if (!Number.isInteger(index) || index < 0 || index >= content.facts.length) return content;
    if (field !== 'label' && field !== 'value') return content;
    const patch: Partial<TemplateFact> = { [field]: value };
    return { ...content, facts: content.facts.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)) };
  }

  return content;
}

// The image-editing twin of `setTemplateSectionText` above -- `rest` here
// is always one of the two shapes ItemListSection.tsx/GallerySection.tsx's
// own renderImage calls produce: `items.<i>.image` or `images.<i>` (the
// WHOLE GalleryImage's own `src`, addressed by index alone -- the same
// convention `galleries.atmosphere.${index}` already uses, not a `.src`
// suffix).
export function setTemplateSectionImage(content: TemplateContent, rest: string, contentPath: string): TemplateContent {
  const parts = rest.split('.');

  if ('items' in content && parts.length === 3 && parts[0] === 'items' && parts[2] === 'image') {
    const index = Number(parts[1]);
    if (!Number.isInteger(index) || index < 0 || index >= content.items.length) return content;
    return { ...content, items: content.items.map((item, i) => (i === index ? { ...item, image: contentPath } : item)) };
  }

  if ('images' in content && parts.length === 2 && parts[0] === 'images') {
    const index = Number(parts[1]);
    if (!Number.isInteger(index) || index < 0 || index >= content.images.length) return content;
    const patch: Partial<GalleryImage> = { src: contentPath };
    return { ...content, images: content.images.map((image, i) => (i === index ? { ...image, ...patch } : image)) };
  }

  return content;
}
