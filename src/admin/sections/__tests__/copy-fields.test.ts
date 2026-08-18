// copy-fields.ts had no test file at all before Task 9. The one thing worth
// pinning here is the non-collision copy-fields.ts's own header comment
// documents: every COPY_GROUPS heading doubles as an ItemList row name AND,
// once that row is opened, an EditorSheet <h3> -- and every PANELS heading
// is a CollapsibleSection <h2> on the very same page. Two `role="heading"`
// (or heading-named-button) elements sharing a name make `getByRole(...,
// { name })` ambiguous everywhere on the dashboard, not just here.
import { describe, expect, it } from 'vitest';
import { COPY_GROUPS } from '../copy-fields';
import { PANELS } from '../../manage/areas';

describe('COPY_GROUPS headings', () => {
  it('no copy group heading collides with a panel heading', () => {
    const panelHeadings = new Set(Object.values(PANELS).map((p) => p.heading));
    COPY_GROUPS.forEach((g) => expect(panelHeadings.has(g.heading)).toBe(false));
  });
});
