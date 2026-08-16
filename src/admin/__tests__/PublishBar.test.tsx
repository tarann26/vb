// PublishBar is what turns everything the earlier nine tasks built into an
// actual, reported publish. This suite covers: the summary line, the
// flush-the-focused-field requirement (Step 1's carried requirement 2),
// every row of Step 5's translation table, the 401-mid-poll case, and the two
// slow terminal states (stalled/mismatch) via the injectable `pollClock`
// (see PublishBar.tsx's own comment on why that exists).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import PublishBar, { DraftBanner } from '../PublishBar';
import { useContentRegistry, MAX_STAGED_PHOTOS_PER_PUBLISH } from '../publish';
import { useStagedFiles } from '../staged';
import type { ContentRegistry } from '../publish';
import type { StagedFile, StagedFiles } from '../staged';
import type { ContentFileName } from '../content';
import type { ValidationProblem } from '../../content/validate';
import { DRAFT_STORAGE_KEY, type DraftSurface } from '../drafts';
import { UNDO_MAX_AGE_MS, UNDO_STORAGE_KEY, loadUndoRecord, rememberPublish } from '../undo';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A fake clock whose `sleep` resolves instantly (advancing a counter rather
// than really waiting) -- lets a test reach trackPublish's slow terminal
// states (10-minute stall, 60-second mismatch) without a real wait. The
// backoff/timeout MATH itself is publish.test.ts's job; this is only here
// so PublishBar's own RENDERING of those terminal states has something to
// test against.
function instantClock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
}

let captured: { registry: ContentRegistry; stagedFiles: StagedFiles } | null = null;

function Harness({
  onUnauthenticated = vi.fn(),
  pollClock,
  withTagsField = false,
  // Which content file the tags input below commits into on blur. Defaults
  // to the file every pre-existing test in this suite already assumes.
  // Pointing it at a SECOND file is what lets a test prove the confirm
  // panel's own section list is built from the flushed state rather than
  // the pre-flush state -- with both edits landing in one file, "1 section
  // edited" reads identically whether the flush happened or not.
  tagsFile = 'dishes.json',
  holdDraftClear = false,
  onPublishLockChange,
  reload,
  problems,
  draftSurface = 'dashboard',
}: {
  onUnauthenticated?: (notice: string) => void;
  pollClock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  withTagsField?: boolean;
  tagsFile?: ContentFileName;
  holdDraftClear?: boolean;
  onPublishLockChange?: (locked: boolean) => void;
  reload?: () => void;
  // Only /edit passes these for real (EditMode wires useValidation into
  // them); AdminApp shows every one of them inline next to its own field.
  problems?: ValidationProblem[];
  // Defaults to what every pre-existing test in this suite already assumed.
  draftSurface?: DraftSurface;
}) {
  const registry = useContentRegistry();
  const stagedFiles = useStagedFiles();
  captured = { registry, stagedFiles };
  const [tagsText, setTagsText] = useState('a, b');

  return (
    <PublishBar
      registry={registry}
      stagedFiles={stagedFiles}
      draftSurface={draftSurface}
      onUnauthenticated={onUnauthenticated}
      pollClock={pollClock}
      holdDraftClear={holdDraftClear}
      onPublishLockChange={onPublishLockChange}
      reload={reload}
      problems={problems}
    >
      {withTagsField && (
        <input
          aria-label="tags"
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          // Mirrors Field.tsx's real TagsInput: commits its typed buffer
          // into the registry only when it loses focus, exactly the buffer
          // this whole requirement is about flushing before a keyboard
          // submit reads it.
          onBlur={() =>
            registry.register(
              tagsFile,
              [{ id: 'x', tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) }],
              'sha-1',
            )
          }
        />
      )}
    </PublishBar>
  );
}

// Every test that actually wants a POST now has to walk through the
// confirmation -- a raw submit or a click on Publish only opens it. One
// helper rather than three lines repeated twenty times.
function acceptConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
}

function clickPublishAndAccept() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  acceptConfirm();
}

function dirty(registry: ContentRegistry, file: 'dishes.json' = 'dishes.json') {
  act(() => {
    registry.register(file, [{ id: 'a', name: '' }], 'sha-1');
    registry.register(file, [{ id: 'a', name: 'Edited' }], 'sha-1');
  });
}

describe('PublishBar: idle summary and the disabled/enabled Publish button', () => {
  it('nothing dirty -> "No changes to publish yet.", Publish disabled', () => {
    render(<Harness />);
    expect(screen.getByText('No changes to publish yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('one edited section -> the button is enabled and the summary reflects it', () => {
    render(<Harness />);
    dirty(captured!.registry);
    expect(screen.getByText('1 section edited — ready to publish.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('a staged file with no dirty content -> "N files staged", no "sections edited" clause', () => {
    render(<Harness />);
    act(() => {
      captured!.stagedFiles.stage('menus.json:food:file', {
        path: 'public/menus/food-menu.pdf',
        content: 'AAAA',
        encoding: 'base64',
        contentPath: '/menus/food-menu.pdf',
      });
    });
    expect(screen.getByText('1 file staged — ready to publish.')).toBeInTheDocument();
  });

  // I6 review finding: `tooManyStaged` (PublishBar.tsx) had no test at all
  // -- mutating it to a hardcoded `false` left 153 tests green, meaning
  // neither the disabled button nor the cap message was ever actually
  // proven. One over the cap disables Publish even though the registry is
  // otherwise clean, and tells her the same plain-language reason
  // buildPublishRequest itself would refuse the request for.
  it('more staged files than the cap disables Publish and shows the plain-language reason', () => {
    render(<Harness />);
    act(() => {
      for (let i = 0; i <= MAX_STAGED_PHOTOS_PER_PUBLISH; i++) {
        captured!.stagedFiles.stage(`dishes.json:dish-${i}:image`, {
          path: `assets-source/food/photo-${i}.jpg`,
          content: 'AAAA',
          encoding: 'base64',
          contentPath: `/food/photo-${i}.webp`,
        });
      }
    });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(
      screen.getByText(
        `You have ${MAX_STAGED_PHOTOS_PER_PUBLISH + 1} photos or PDFs staged; only ${MAX_STAGED_PHOTOS_PER_PUBLISH} can publish at once. Remove some before publishing.`,
      ),
    ).toBeInTheDocument();
  });
});

describe('PublishBar: Step 1 carried requirement 2 -- flushes the focused field before reading the payload', () => {
  it('a form SUBMIT (not a click) still includes the tag typed but never blurred away from', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second param exists only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const { container } = render(<Harness withTagsField pollClock={instantClock()} />);
    dirty(captured!.registry);

    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    tagsInput.focus();
    fireEvent.change(tagsInput, { target: { value: 'a, b, c' } });
    // Still focused -- deliberately never blurred (no click elsewhere, no
    // Tab) before the form submits, the exact gap a keyboard Enter-to-submit
    // leaves open.
    expect(document.activeElement).toBe(tagsInput);

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // A raw form submit no longer POSTs -- it opens the confirmation (see
    // this file's own "the confirmation step" describe block for why, and
    // for the keystroke path that made it necessary). The flush this test
    // exists for now runs at BOTH points: once here, when the panel opens,
    // and again when accept is clicked. Accepting from inside the panel is
    // what still makes this assertion about the real POST body.
    fireEvent.submit(form!);
    acceptConfirm();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));
    const publishCall = fetchImpl.mock.calls.find(([url]) => url === '/api/publish')!;
    const body = JSON.parse((publishCall[1] as RequestInit).body as string) as { files: { path: string; content: string }[] };
    const dishesFile = body.files.find((f) => f.path === 'src/content/dishes.json')!;
    expect(JSON.parse(dishesFile.content)).toEqual([{ id: 'x', tags: ['a', 'b', 'c'] }]);
  });
});

// ---------------------------------------------------------------------------
// The confirmation step. The reason it exists is not politeness: every
// content section renders inside PublishBar's single <form> and the Publish
// button is `type="submit"`, so before this, Enter in any text input
// anywhere on the dashboard committed straight to the live branch. These
// tests pin that the panel is the only way through, that what it SAYS is
// true at the moment she reads it, and that what gets published is what the
// registry holds when she accepts -- not what it held when the panel opened.
describe('PublishBar: the confirmation step before anything is pushed', () => {
  function neverResolvingFetch() {
    return vi.fn(async () => new Promise<Response>(() => {}));
  }

  it('clicking Publish opens a dialog and sends nothing', () => {
    const fetchImpl = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness />);
    dirty(captured!.registry);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(screen.getByRole('dialog', { name: /publish/i })).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/publish', expect.anything());
  });

  // The panel's WHAT-is-changing summary is derived live from the registry,
  // never captured when the panel opened. Same property as the payload test
  // below, on the display side: an upload that was in flight when she
  // clicked Publish lands in the staged map while the panel is open, and a
  // captured summary would keep telling her about the world as it was.
  it('the summary and section list keep up with the registry while the panel is open', () => {
    render(<Harness />);
    dirty(captured!.registry);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('dialog', { name: /publish/i })).toHaveTextContent('1 section edited — ready to publish.');
    expect(screen.getByRole('dialog', { name: /publish/i })).toHaveTextContent('Changing: Dishes.');

    // A second file becomes dirty while she is reading the panel.
    act(() => {
      captured!.registry.register('press.json', [{ id: 'p', title: '' }], 'sha-p');
      captured!.registry.register('press.json', [{ id: 'p', title: 'Edited' }], 'sha-p');
    });

    const dialog = screen.getByRole('dialog', { name: /publish/i });
    expect(dialog).toHaveTextContent('2 sections edited — ready to publish.');
    expect(dialog).toHaveTextContent('Changing: Dishes, Press.');
  });

  // The flush that runs when the panel OPENS, proven the only way it can be
  // proven from jsdom -- and reported honestly, because the first version of
  // this test could not fail and had to be replaced.
  //
  // What was wrong with it: it asserted that the panel, opened while a tags
  // field still held an uncommitted buffer, reads "2 sections edited". That
  // is true either way. Moving focus into the dialog -- the focus trap's own
  // opening act -- blurs whatever field was focused, which fires that
  // field's onBlur and commits the buffer regardless of whether openConfirm
  // blurred anything itself. Under jsdom the whole sequence collapses inside
  // one `act`, so the settled DOM is identical with and without the line.
  //
  // What IS still true, and what this asserts: after a keyboard submit from
  // a still-focused field, what the panel names must match what a publish
  // would actually send. That is the user-visible guarantee; which of the
  // two flushes delivers it in a given browser is not something this test
  // needs to care about. Recorded in the source comment on openConfirm: in a
  // real browser the open-time flush is what stops a single painted frame of
  // stale summary, since passive effects run after paint -- a difference
  // jsdom has no paint to show.
  it('a keyboard submit from a still-focused field opens a panel that names that field\'s own section', () => {
    render(<Harness withTagsField tagsFile="press.json" />);
    act(() => captured!.registry.register('press.json', [{ id: 'x', tags: ['a', 'b'] }], 'sha-p'));
    dirty(captured!.registry);

    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    tagsInput.focus();
    fireEvent.change(tagsInput, { target: { value: 'a, b, c' } });
    expect(document.activeElement).toBe(tagsInput);

    fireEvent.submit(tagsInput.closest('form')!);

    const dialog = screen.getByRole('dialog', { name: /publish/i });
    expect(dialog).toHaveTextContent('2 sections edited — ready to publish.');
    expect(dialog).toHaveTextContent('Changing: Dishes, Press.');
  });

  // The single most important correctness property here. An EditableImage
  // upload that was in flight when she clicked Publish resolves into the
  // staged map seconds later, while the panel is open -- a payload captured
  // at open time would silently drop it.
  it('publishes what the registry holds at ACCEPT, not what it held when the panel opened', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second param exists only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    act(() => captured!.registry.updateData('dishes.json', [{ id: 'a', name: 'Typed while the panel was open' }]));
    acceptConfirm();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));
    const call = fetchImpl.mock.calls.find(([url]) => url === '/api/publish')!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as { files: { path: string; content: string }[] };
    const dishes = body.files.find((f) => f.path === 'src/content/dishes.json')!;
    expect(JSON.parse(dishes.content)).toEqual([{ id: 'a', name: 'Typed while the panel was open' }]);
  });

  it('says, in so many words, that this is public, what she can undo afterwards, and roughly how long it takes', () => {
    render(<Harness />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      screen.getByText('This puts your changes on the public website, where anyone visiting can see them.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Afterwards you'll be offered one undo, for a little while. Once that has gone, changing something back means editing it again and publishing again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('It usually takes about 2-3 minutes for the site to show the change.'),
    ).toBeInTheDocument();
  });

  // Review finding (Critical). The panel used to state, on every single
  // publish, "There is no undo button. To change something back, edit it
  // again and publish again." -- and then a button labelled exactly "Undo my
  // last publish" rendered in this same bar seconds later. Both strings were
  // reachable in one session, and the false one was pinned by a getByText,
  // so it could not drift out on its own.
  //
  // Mutation this guards: putting that sentence back. This test asserts the
  // two facts together, in one session, which is the only shape that catches
  // it -- either sentence read alone is unremarkable.
  it('never promises there is no undo, given the undo button appears seconds later', async () => {
    let liveSha = 'commit-1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
        if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
        if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
        if (url === '/build-info.json') return jsonResponse(200, { sha: liveSha, builtAt: 'now' });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    liveSha = 'commit-1';
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = screen.getByRole('dialog', { name: /publish/i });
    expect(dialog).not.toHaveTextContent('There is no undo button');
    expect(dialog).not.toHaveTextContent(/no undo/i);

    acceptConfirm();
    await screen.findByText('Your changes are live.');
    // The thing the old sentence denied, on screen in the same session.
    expect(screen.getByRole('button', { name: 'Undo my last publish' })).toBeInTheDocument();
  });

  // Review finding (Minor): this whole block had no test at all. /edit passes
  // real `problems` from useValidation, and the panel is meant to warn her
  // about what the server would refuse with a 422 in the same place she is
  // about to click Publish -- deleting the block left her reading only
  // "ready to publish" and learning about the emptied field after the round
  // trip.
  //
  // Mutation this guards: removing the `{problems.length > 0 && (...)}` block
  // from ConfirmPanel.
  it('the panel lists the client-side problems the server would refuse, without claiming the button is blocked', () => {
    render(
      <Harness
        problems={[
          { field: 'hero.logoName', message: 'The restaurant name cannot be empty.' },
          { field: 'hero.tagline', message: 'The tagline cannot be empty.' },
        ]}
      />,
    );
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = screen.getByRole('dialog', { name: /publish/i });
    expect(dialog).toHaveTextContent('Publishing will be refused until these are fixed:');
    expect(dialog).toHaveTextContent('The restaurant name cannot be empty.');
    expect(dialog).toHaveTextContent('The tagline cannot be empty.');
    // Deliberately still clickable -- useValidation's result may never decide
    // what a publish is ALLOWED to send -- so the sentence above must not
    // describe it as blocked.
    expect(screen.getByRole('button', { name: 'Yes, publish to the live site' })).toBeEnabled();
    expect(dialog).not.toHaveTextContent(/before this can publish/);
  });

  it('Cancel closes it, sends nothing, and puts focus back on the Publish button', () => {
    const fetchImpl = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness />);
    dirty(captured!.registry);
    const trigger = screen.getByRole('button', { name: 'Publish' });

    // Focused explicitly first. Reported honestly, because the comment that
    // used to sit here claimed this assertion was non-vacuous "because the
    // panel moves focus into itself on open" -- it was not: jsdom's
    // fireEvent.click never focuses the trigger to begin with, so the
    // assertion passed identically with the focus effect deleted, proving
    // only that .focus() was called on cancel starting from document.body.
    // Starting from a genuinely focused trigger is what makes the return
    // trip below mean something. (The focus effect itself has its own test.)
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/publish', expect.anything());
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes it and sends nothing', () => {
    const fetchImpl = neverResolvingFetch();
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/publish', expect.anything());
  });

  // handlePublish's `plan.files.length === 0` early return is commented as
  // defensive-only "because the button is disabled for this case". A panel
  // that can stay open across a registry change is exactly what would
  // falsify that, silently, if accept were not gated the same way.
  it('accept is disabled if the registry goes clean while the panel is open', () => {
    render(<Harness />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('button', { name: 'Yes, publish to the live site' })).toBeEnabled();

    act(() => captured!.registry.updateData('dishes.json', [{ id: 'a', name: '' }]));

    expect(screen.getByRole('button', { name: 'Yes, publish to the live site' })).toBeDisabled();
  });

  // Review finding (Important): the focus effect and the Tab trap were both
  // entirely un-failable -- the whole admin suite stayed green through
  // deleting each of them. That matters here more than in an ordinary
  // dialog: this panel exists BECAUSE Enter in any text field used to submit
  // straight to the live site, so `aria-modal="true"` with focus left behind
  // in the field she was typing in is a lie about the one hazard it was
  // built for.
  //
  // Mutation this guards: replacing the body of ConfirmPanel's focus
  // useEffect with a comment.
  it('a keyboard submit lands focus INSIDE the panel, not back in the field she was typing in', () => {
    render(<Harness withTagsField />);
    dirty(captured!.registry);
    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    tagsInput.focus();
    expect(document.activeElement).toBe(tagsInput);

    fireEvent.submit(tagsInput.closest('form')!);

    const dialog = screen.getByRole('dialog', { name: /publish/i });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes, publish to the live site' }));
  });

  // Mutation this guards: `return;` inserted immediately after
  // `if (event.key !== 'Tab') return;` in ConfirmPanel's handleKeyDown --
  // i.e. the trap removed while the dialog still claims aria-modal.
  it('Tab cycles within the panel instead of walking the page underneath', () => {
    render(<Harness />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = screen.getByRole('dialog', { name: /publish/i });
    const accept = screen.getByRole('button', { name: 'Yes, publish to the live site' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    // Forward off the LAST focusable wraps to the first, rather than moving
    // on to whatever the page behind happens to render next.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(accept);

    // ...and backward off the first wraps to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  // Not cosmetic. This panel renders inside the same <form> the Publish
  // button submits, so a `type="submit"` here re-fires that form's onSubmit
  // -- which now OPENS this panel -- and never reaches handlePublish at all.
  it('every button inside the dialog is type="button"', () => {
    render(<Harness />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const buttons = [...screen.getByRole('dialog').querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
  });
});

describe('PublishBar: the time expectation while she waits', () => {
  it('polling shows BOTH the build state and the 2-3 minute line', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
      // Never resolves -- holds the bar at the first polling state
      // (`buildState: 'queued'`), which is the sentence she actually reads
      // first, before "building".
      if (url.startsWith('/api/build-status')) return new Promise<Response>(() => {});
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await screen.findByText('Publishing… waiting for the build to start.');
    expect(
      screen.getByText(/This usually takes about 2-3 minutes\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/you can close this tab/)).toBeInTheDocument();
  });

  // Pinned to the phases where "already saved" is actually TRUE. During
  // 'publishing' the POST is still in flight and nothing has landed
  // anywhere, so the same sentence there would be a lie.
  it('the 2-3 minute line is NOT shown while the request itself is still in flight', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(() => {})));
    render(<Harness />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    // getByRole('status'), not getByText: the button's own busy label is
    // also the literal string "Publishing…".
    expect(screen.getByRole('status')).toHaveTextContent('Publishing…');
    expect(screen.queryByText(/This usually takes about 2-3 minutes\./)).not.toBeInTheDocument();
  });
});

// The ordering that makes the editing pause safe to ship. Disabling a
// fieldset blurs whatever is focused inside it, so if the pause engaged
// BEFORE the flush, a still-buffered field's value would be gone by the
// time the payload was read -- silently, with a green "live" at the end of
// it. handlePublish flushes first and sets 'publishing' after, and this is
// what pins that order.
describe('PublishBar: the flush happens before the pause, never after', () => {
  it('a value typed but never blurred away from is in the payload, and the field is paused afterwards', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second param exists only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/publish') return new Promise<Response>(() => {});
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const lockStates: boolean[] = [];
    render(<Harness withTagsField onPublishLockChange={(value) => lockStates.push(value)} />);
    dirty(captured!.registry);

    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    tagsInput.focus();
    fireEvent.change(tagsInput, { target: { value: 'a, b, c' } });
    expect(document.activeElement).toBe(tagsInput);

    fireEvent.submit(tagsInput.closest('form')!);
    acceptConfirm();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));
    const call = fetchImpl.mock.calls.find(([url]) => url === '/api/publish')!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as { files: { path: string; content: string }[] };
    const dishes = body.files.find((f) => f.path === 'src/content/dishes.json')!;
    expect(JSON.parse(dishes.content)).toEqual([{ id: 'x', tags: ['a', 'b', 'c'] }]);

    // ...and the pause really did engage, so the assertion above is about
    // ordering rather than about a pause that never happened.
    expect(lockStates).toContain(true);
  });
});

describe('PublishBar: assembling the request', () => {
  it('attaches baseSha to a dirty content file (carried requirement 1)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- both params exist only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { sha: 'commit-1', publishId: 'p1' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    act(() => captured!.registry.register('dishes.json', [{ id: 'a', name: '' }], 'sha-original'));
    act(() => captured!.registry.register('dishes.json', [{ id: 'a', name: 'Edited' }], 'sha-original'));

    clickPublishAndAccept();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string) as { files: { baseSha?: string }[] };
    expect(body.files[0].baseSha).toBe('sha-original');
  });

  // Review finding: this test's own original name/comment claimed a click
  // "already blurs" the previously focused field as a browser default,
  // offered as proof the click path needs no help from handlePublish's own
  // explicit un-focus line. That claim was never actually true universally
  // -- Safari has never focused a plain `<button>` on click by default, so
  // a click there leaves a field's typed buffer just as un-flushed as a
  // keyboard submit would -- and `fireEvent.click` here reproduces exactly
  // that non-focusing behavior (jsdom does not simulate a real click's
  // focus side effects either), which is WHY this test can prove anything
  // at all: if the explicit `.blur()` line in handlePublish were the one
  // this suite's other test already covers and this path genuinely needed
  // no help, deleting that line would leave this test green. It does not.
  it('a click on the Publish button flushes the same way a keyboard submit does -- not because the click itself already blurred it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- both params exist only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { sha: 'commit-1', publishId: 'p1' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness withTagsField pollClock={instantClock()} />);
    dirty(captured!.registry);
    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    fireEvent.change(tagsInput, { target: { value: 'a, b, c' } });
    tagsInput.focus();

    clickPublishAndAccept();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string) as { files: { path: string; content: string }[] };
    const dishesFile = body.files.find((f) => f.path === 'src/content/dishes.json')!;
    expect(JSON.parse(dishesFile.content)).toEqual([{ id: 'x', tags: ['a', 'b', 'c'] }]);
  });
});

describe('PublishBar: Step 5 translation table', () => {
  async function publishAndGetAlert(status: number, body: unknown) {
    const fetchImpl = vi.fn(async () => jsonResponse(status, body));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();
    return screen.findByRole('alert');
  }

  it('409 (baseSha conflict body) -> the plain-language conflict sentence', async () => {
    const alert = await publishAndGetAlert(409, { problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this.' }] });
    expect(alert).toHaveTextContent(
      'This may already be published — from another tab or device, including one of your own. Reload to see the latest, then make your change again.',
    );
  });

  it('409 (PublishConflictError message body) -> the SAME sentence -- branch on status, not message text', async () => {
    const alert = await publishAndGetAlert(409, { message: 'someone else published while you were editing -- reload and try again' });
    expect(alert).toHaveTextContent(
      'This may already be published — from another tab or device, including one of your own. Reload to see the latest, then make your change again.',
    );
  });

  it('502 (GitHub 5xx) -> the "nothing was lost" sentence', async () => {
    const alert = await publishAndGetAlert(502, { message: 'could not update main (GitHub returned 503)' });
    expect(alert).toHaveTextContent("Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute.");
  });

  it('a thrown fetch (offline) -> the SAME "nothing was lost" sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute.");
  });

  // Wires publish.test.ts's own reconcileAfterConflict unit coverage into
  // the real component: a 409 whose underlying content re-check confirms it
  // already landed (the committed content matches exactly what THIS attempt
  // sent) is reconciled rather than left as a false conflict she'd retry
  // into forever. Proven end to end by the button itself going back to
  // disabled -- dishes.json is no longer dirty once the reconcile confirms
  // it already landed.
  //
  // Fix round 1 review, Minor 2: reconciliation is now AWAITED before any
  // state renders (handlePublish no longer fires it and shows the generic
  // conflict sentence in the same breath), so the ONLY thing that ever
  // paints for this case is the dedicated "already saved" status line --
  // never the generic "someone else changed this" alert, not even for one
  // frame. That is the assertion that actually catches a regression back to
  // the old fire-and-forget shape: a test that only checked the FINAL state
  // would still pass if the wrong sentence flashed first.
  it('409 after content that matches what was sent resolves straight to "already saved" -- the generic conflict sentence never renders', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(409, { problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this.' }] });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Edited' }]), sha: 'fresh-sha' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await screen.findByText("That went through after all — it's already saved, so there's nothing left to publish.");
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled());
    const entry = captured!.registry.getEntries()['dishes.json']!;
    expect(entry.sha).toBe('fresh-sha');
  });

  // The other half: a 409 whose cause is a genuinely DIFFERENT committed
  // value must leave the file dirty and refusing, with the GENERIC conflict
  // sentence -- reconciliation never silently clears a real conflict, and
  // never claims "already saved" for one either.
  //
  // The re-read is a manually-controlled promise here (not an immediately-
  // resolving mock, as the matching-case test above uses) specifically so
  // this test can prove reconciliation genuinely ran and genuinely decided
  // "no match" -- asserting the alert text immediately would otherwise be
  // indistinguishable from the alert simply not having rendered yet.
  // Because reconciliation is now awaited before any state renders (Minor
  // 2's own fix), the alert CANNOT appear at all until this promise
  // resolves -- proven directly below before it does.
  it('409 after content that does NOT match what was sent stays dirty -- a real conflict is never silently cleared', async () => {
    let resolveContent!: (response: Response) => void;
    const contentResponse = new Promise<Response>((resolve) => {
      resolveContent = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(409, { problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this.' }] });
      if (url.startsWith('/api/content')) return contentResponse;
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/api/content'), expect.anything()));
    // Still suspended inside reconcileAfterConflict's own fetch -- nothing
    // has rendered a terminal state yet, proving the await (not the fire-
    // and-forget it replaced) is what actually runs here.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/already saved/)).not.toBeInTheDocument();

    await act(async () => {
      resolveContent(jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Someone else’s edit' }]), sha: 'their-fresh-sha' }));
      // Flushes reconcileAfterConflict's own await chain (fetchContent's
      // response.json(), then the JSON.stringify compare) past the point
      // where a match WOULD have called markPublished, before anything
      // below reads the registry or the DOM.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This may already be published');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    const entry = captured!.registry.getEntries()['dishes.json']!;
    expect(entry.sha).toBe('sha-1');
  });

  // Review finding (Important): rendering `problem.field` raw put an
  // internal validator path ("[0].name") in front of her -- reachable in
  // one click, and unreadable ("this dish needs a name" already tells her
  // what's wrong; "[0].name:" does not). Dropped in favour of a plain
  // lead-in line, since every message already names the dish/article it
  // belongs to and Task 6 already marks the matching field red inline.
  it('422 -> the message is shown, the RAW field path is not, and she is pointed at the marked fields', async () => {
    const alert = await publishAndGetAlert(422, { problems: [{ field: '[0].name', message: 'Name is required.' }] });
    expect(alert).toHaveTextContent('Fix the fields marked in red below.');
    expect(alert).toHaveTextContent('Name is required.');
    expect(alert).not.toHaveTextContent('[0].name');
  });

  it('a problem whose field matches no rendered input still appears on screen', async () => {
    const alert = await publishAndGetAlert(422, { problems: [{ field: 'an-unrendered-field', message: 'Something obscure is wrong.' }] });
    expect(alert).toHaveTextContent('Something obscure is wrong.');
  });

  // Review finding (Minor), the second half of it: "the fields marked in red
  // below" describes /edit/manage, where every problem really is routed
  // inline next to its field in red. /edit makes emptying a field a
  // first-class action and has no per-field marking anywhere on the real
  // page, so on that surface the same sentence sent her looking for
  // something that does not exist.
  //
  // Mutation this guards: rendering the dashboard sentence unconditionally.
  it('on /edit the 422 does NOT send her looking for red fields that surface has none of', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, { problems: [{ field: '[0].name', message: 'Name is required.' }] })));
    render(<Harness draftSurface="edit" pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Fix these, then publish again.');
    expect(alert).toHaveTextContent('Name is required.');
    expect(alert).not.toHaveTextContent('marked in red');
  });

  it('401 on the publish itself -> the pre-publish signed-out sentence, and onUnauthenticated fires with it', async () => {
    const onUnauthenticated = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'Not authenticated.' })));
    render(<Harness onUnauthenticated={onUnauthenticated} pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've been signed out. Log in and your changes will still be here.");
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(onUnauthenticated).toHaveBeenCalledWith("You've been signed out. Log in and your changes will still be here.");
  });
});

describe('PublishBar: Step 3 -- polling to live, confirmed against build-info.json', () => {
  it('queued -> building -> live, confirmed, ends in "Your changes are live."', async () => {
    let statusCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) {
        statusCall += 1;
        const state = statusCall === 1 ? 'queued' : statusCall === 2 ? 'building' : 'live';
        return jsonResponse(200, { state, deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/commit-1' });
      }
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await screen.findByText('Your changes are live.');
  });

  // Task 10's own reason to exist: an awards-only publish touches D1 alone,
  // produces no commit, and is live the instant this response arrives --
  // there is no Cloudflare build to poll for. Untreated, this dashboard
  // would poll build-status for a deployment that will never exist, sit on
  // "queued" for ten minutes, and end on "stalled": the failure state, for
  // the fastest publish this dashboard can make.
  //
  // The `fetchBuildStatus` assertion is the one that actually catches that
  // -- a test asserting only the final state would pass even while a poll
  // ran in the background and simply hadn't reported back yet by the time
  // `findByText` resolved.
  it('a publish with sha: null (D1-only, no commit) never polls build-status and lands straight on live', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: null, publishId: 'p1', d1Paths: ['src/content/awards.json'] });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await screen.findByText('Your changes are live.');
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('/api/build-status'), expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith('/build-info.json', expect.anything());
  });

  it('never reaching live -> "taking longer than it should", with the commit link', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) {
        return jsonResponse(200, { state: 'queued', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/commit-1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent('This is taking longer than it should.');
    expect(alert).toHaveTextContent('send this link to your developer');
    expect(screen.getByRole('link', { name: 'https://github.com/x/y/commit/commit-1' })).toBeInTheDocument();
  }, 15_000);

  it('live but build-info.json never catches up -> "hasn\'t picked it up yet"', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'some-other-sha', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent("Published, but the site hasn't picked it up yet.");
  }, 15_000);

  it('a build state of "failed" -> the developer-link sentence, without waiting out the timeout', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'failed', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/commit-1' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong publishing.');
    expect(screen.getByRole('link', { name: 'https://github.com/x/y/commit/commit-1' })).toBeInTheDocument();
  });

  // Step 3's own explicit instruction: GET /api/build-status is
  // authenticated too, and a 401 can arrive MID-POLL (the 7-day session
  // expiring while she waits), not only on the publish itself.
  //
  // Review finding (Important): this used to assert the SAME sentence as
  // the pre-publish 401 above -- wrong, because by the time trackPublish can
  // ever report `unauthenticated`, requestPublish already returned success:
  // the commit landed and clearDraft() already ran. "Your changes will
  // still be here" is false for this case, not merely imprecise, and after
  // logging back in she had no way to learn whether the build finished.
  it('a 401 mid-poll -> a DIFFERENT sentence (the commit already landed), onUnauthenticated fires with it, polling stops', async () => {
    const onUnauthenticated = vi.fn();
    let statusCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) {
        statusCall += 1;
        if (statusCall === 1) return jsonResponse(200, { state: 'building', deploymentUrl: null, commitUrl: 'https://c' });
        return jsonResponse(401, { message: 'Not authenticated.' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness onUnauthenticated={onUnauthenticated} pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your changes were already published (commit commit-1).');
    expect(alert).not.toHaveTextContent("You've been signed out. Log in and your changes will still be here.");
    expect(onUnauthenticated).toHaveBeenCalledWith(expect.stringContaining('Your changes were already published'));
    expect(statusCall).toBe(2);
  });
});

describe('PublishBar: after a successful publish', () => {
  it('clears exactly the staged keys that were sent, and refreshes baseSha (a second publish would not falsely conflict)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Edited' }]), sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    act(() => {
      captured!.stagedFiles.stage('dishes.json:a:image', { path: 'assets-source/food/x.jpg', content: 'AAAA', encoding: 'base64', contentPath: '/food/x.webp' });
    });

    clickPublishAndAccept();
    await screen.findByText('Your changes are live.');

    expect(captured!.stagedFiles.files).toEqual({});
    expect(captured!.registry.getEntries()['dishes.json']?.sha).toBe('sha-fresh');
  });

  // I6 review finding: the ONLY assertion on this guarantee was
  // `toEqual({})` on the happy path above -- true whether the code clears
  // "exactly the staged keys this request included" (the comment's own
  // claim) or unconditionally wipes every staged file regardless of what
  // this specific request sent, because nothing was EVER staged mid-flight
  // in that test, so there was never a SECOND file whose survival could
  // tell the two apart. Here, one is staged after the request is already
  // built (while the first is still in flight) -- it must survive.
  it('a file staged mid-flight (after the request was built, before it resolved) survives -- only the keys THIS request sent are cleared', async () => {
    let resolvePublish!: (response: Response) => void;
    const publishResponse = new Promise<Response>((resolve) => {
      resolvePublish = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return publishResponse;
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Edited' }]), sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    const midFlightFile: StagedFile = { path: 'assets-source/mocktails/y.jpg', content: 'BBBB', encoding: 'base64', contentPath: '/mocktails/y.webp' };
    act(() => {
      captured!.stagedFiles.stage('dishes.json:a:image', { path: 'assets-source/food/x.jpg', content: 'AAAA', encoding: 'base64', contentPath: '/food/x.webp' });
    });

    clickPublishAndAccept();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));
    // She stages a SECOND photo, on a different field, WHILE the first
    // request is still in flight.
    act(() => {
      captured!.stagedFiles.stage('drinks.json:x:image', midFlightFile);
    });

    resolvePublish(jsonResponse(200, { sha: 'commit-1', publishId: 'p1' }));
    await screen.findByText('Your changes are live.');

    // Deleting the clearing call entirely fires this assertion (it would
    // see BOTH files still staged, not just the mid-flight one) -- the same
    // failure a wipe-the-whole-map "clear everything" implementation would
    // produce from the other direction (it would see NEITHER file, having
    // taken the mid-flight one down with it). Either way, only a clear
    // scoped to exactly `plan.stagedKeys` leaves this assertion green.
    expect(captured!.stagedFiles.files).toEqual({ 'drinks.json:x:image': midFlightFile });
  });

  // The same-key case, which the mid-flight test above does NOT cover: it
  // stages a SECOND file under a DIFFERENT key ('drinks.json:x:image'), so
  // it proves only that an unrelated key survives. Re-picking a photo for
  // the field that was already in the request is a different and much worse
  // shape, and it was live on the deployed site.
  //
  // What went wrong: the success path cleared by KEY
  // (`plan.stagedKeys.forEach((key) => stage(key, null))`) through a
  // functional updater, so it deleted whatever sat at that key AT THAT
  // MOMENT -- the NEW upload, not the one that was published. Meanwhile
  // EditableImage's onReplace had already written the new contentPath into
  // the registry. The result is a content file naming an asset whose bytes
  // exist nowhere: not staged any more, and never committed. dirtyDraftMap
  // cannot catch it either -- scrubStagedReferences only scrubs paths that
  // are CURRENTLY staged, and this one no longer is -- so the dangling path
  // reaches localStorage too. The next publish commits it, and
  // src/content/__tests__/assets.test.ts then fails every Cloudflare build
  // from that point on until someone hand-edits the JSON.
  //
  // `clearSent` clears by IDENTITY instead: a key whose value is no longer
  // the object that was actually sent is left alone.
  it('re-picking a photo for the SAME field mid-flight keeps the new bytes -- only what was sent is cleared', async () => {
    let resolvePublish!: (response: Response) => void;
    const publishResponse = new Promise<Response>((resolve) => {
      resolvePublish = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return publishResponse;
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Edited' }]), sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);

    const KEY = 'dishes.json:a:image';
    const fileA: StagedFile = { path: 'assets-source/food/a.jpg', content: 'AAAA', encoding: 'base64', contentPath: '/food/a.webp' };
    const fileB: StagedFile = { path: 'assets-source/food/b.jpg', content: 'BBBB', encoding: 'base64', contentPath: '/food/b.webp' };
    act(() => captured!.stagedFiles.stage(KEY, fileA));

    clickPublishAndAccept();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));

    // She taps the same camera badge again while the request is in flight.
    // EditableImage fires onStaged(null) the instant a new pick starts, then
    // onStaged(theNewFile) once it has uploaded -- both reproduced here.
    act(() => captured!.stagedFiles.stage(KEY, null));
    act(() => captured!.stagedFiles.stage(KEY, fileB));

    resolvePublish(jsonResponse(200, { sha: 'commit-1', publishId: 'p1' }));
    await screen.findByText('Your changes are live.');

    expect(captured!.stagedFiles.files).toEqual({ [KEY]: fileB });
  });

  it('clears the localStorage draft on a 200', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ 'dishes.json': { data: [], savedAt: 1 } }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();
    await screen.findByText('Your changes are live.');
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});

describe('PublishBar: draft persistence and beforeunload', () => {
  it('writes a draft to localStorage once something is dirty', () => {
    render(<Harness />);
    dirty(captured!.registry);
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)['dishes.json'].data).toEqual([{ id: 'a', name: 'Edited' }]);
  });

  // Review finding (Important): reachable directly off the Restore path --
  // she clicks Restore, PublishBar mounts with an EMPTY registry (no
  // section has resolved its GET /api/content yet), and the persistence
  // effect's first run must not read that emptiness as "nothing to
  // publish" and delete the very draft she just asked to restore. A
  // content-load failure right after (a flaky network, a stray 401 on the
  // read route) would otherwise leave nothing to recover from at all.
  it('mounting with an EMPTY registry never clears a pre-existing draft', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ 'dishes.json': { data: [{ id: 'a', name: 'Restored' }], savedAt: 1 } }),
    );
    render(<Harness />); // captured!.registry starts empty -- nothing registered yet
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)['dishes.json'].data).toEqual([
      { id: 'a', name: 'Restored' },
    ]);
  });

  // C2 review finding (Critical), a different route to the SAME "an empty
  // registry must never reach clearDraft()" Critical the test above pins:
  // a LOADED-but-CLEAN registry is not the same fact as "nothing
  // unpublished exists" either -- it is also exactly what a fresh mount
  // looks like in the instant BEFORE an unresolved restore-or-discard
  // decision has been answered (EditMode.tsx's own case, which cannot use
  // AdminApp's render-the-banner-INSTEAD-of-this-bar ternary -- Task 2's
  // invariant is that the real page, and therefore this bar wrapping it,
  // never unmounts). `holdDraftClear` is the caller's own way of saying
  // "a decision is still pending" independent of registry emptiness.
  it('holdDraftClear=true stops a LOADED, clean registry from clearing a pre-existing draft', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ 'dishes.json': { data: [{ id: 'a', name: 'Restored' }], savedAt: 1 } }),
    );
    render(<Harness holdDraftClear />);
    // Registers the SAME clean value twice -- register's own contract
    // (publish.ts) pins `initial` on the first call and updates `data`
    // only after, so this is a genuinely LOADED, genuinely CLEAN entry
    // (`isDirty` false), not an empty registry the way the test above
    // covers.
    act(() => {
      captured!.registry.register('dishes.json', [{ id: 'a', name: 'Loaded' }], 'sha-1');
    });
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
  });

  // The mirror image: once the hold is released (she has answered), a
  // clean registry clears the draft exactly as it always did -- this prop
  // must not leave a permanent leak that outlives the decision it guards.
  it('holdDraftClear=false lets a loaded, clean registry clear the draft, same as before this prop existed', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ 'dishes.json': { data: [{ id: 'a', name: 'Restored' }], savedAt: 1 } }),
    );
    render(<Harness holdDraftClear={false} />);
    act(() => {
      captured!.registry.register('dishes.json', [{ id: 'a', name: 'Loaded' }], 'sha-1');
    });
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('warns on beforeunload while dirty, not while clean', () => {
    render(<Harness />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    dirty(captured!.registry);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });
});

describe('DraftBanner', () => {
  it('shows a relative time and Restore/Discard buttons, and calls the right callback', () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <DraftBanner
        draft={{ 'dishes.json': { data: [], savedAt: Date.now() - 65_000 } }}
        staleStagedCount={0}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('You have unsaved changes from 1 minute ago.');
    // Nothing to warn about -- no second line about lost staged files.
    expect(screen.queryByText(/picked/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  // Review finding: a restored draft can reference a photo/PDF that was
  // staged but never published (the bytes only ever lived in memory) --
  // publishing that reference would commit JSON pointing at a blob that was
  // never written. Since the exact field can't be identified after the
  // fact, the banner names a COUNT instead of staying silent about it.
  it('one lost staged file -- singular wording', () => {
    render(
      <DraftBanner
        draft={{ 'dishes.json': { data: [], savedAt: Date.now() } }}
        staleStagedCount={1}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("A photo or PDF you picked in that session wasn't saved and will need to be picked again.")).toBeInTheDocument();
  });

  it('several lost staged files -- plural wording with the count', () => {
    render(
      <DraftBanner
        draft={{ 'dishes.json': { data: [], savedAt: Date.now() } }}
        staleStagedCount={3}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("3 photos or PDFs you picked in that session weren't saved and will need to be picked again.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Undo my last publish. The offer is held client-side, written when a publish
// returns 200 and deleted the instant an undo lands -- never derived from
// whatever happens to be at the branch head, which is what makes it
// structurally impossible to offer to revert a developer's hand commit and
// call it "the change you published".
describe('PublishBar: undo my last publish', () => {
  const RECORD = {
    sha: 'commit-1',
    publishId: 'p1',
    at: Date.now() - 4 * 60_000,
    paths: ['src/content/dishes.json', 'src/content/site.json'],
  };

  function undoFetch(undoResponse: () => Promise<Response>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/undo') return undoResponse();
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'undo-commit', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it('offers nothing when there is no record', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  // Offering to put back the last publish while she has fresh unpublished
  // edits on screen would invite her to lose them -- the reload an undo ends
  // with really would.
  it('withdraws the offer while she has unpublished edits', () => {
    rememberPublish(RECORD);
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Undo my last publish' })).toBeInTheDocument();

    dirty(captured!.registry);

    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  // Two clicks, never one. An undo is irreversible through this UI by
  // design, so a single click is not defensible, and a redo added to make
  // one click safe is exactly the extra concept this feature exists without.
  it('the first click arms a confirmation and sends nothing', () => {
    rememberPublish(RECORD);
    const fetchImpl = undoFetch(async () => jsonResponse(200, { sha: 'undo-commit' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));

    expect(screen.getByRole('button', { name: 'Yes, undo it' })).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/undo', expect.anything());
  });

  it('the confirmation names the sections and a relative time, and never a raw path', () => {
    rememberPublish(RECORD);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Dishes and Opening hours');
    expect(alert).toHaveTextContent('4 minutes ago');
    expect(alert).not.toHaveTextContent('dishes.json');
    expect(alert).not.toHaveTextContent('src/content');
  });

  // The honest negative -- the one thing a non-technical owner would
  // otherwise assume was covered.
  // Review finding (Important): this sentence used to read "It will not
  // delete the photo you uploaded." -- true of the blob in the repository,
  // and the exact opposite of what she watches happen. The undo restores the
  // JSON that POINTS at the photo, so the dish reverts to its previous
  // photo, or to none at all if this was the first one.
  it('says out loud that the photo she added comes off the site too', () => {
    rememberPublish({ ...RECORD, paths: ['src/content/dishes.json', 'assets-source/food/abc.jpg'] });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The photo you added comes off the site as well.');
    expect(alert).not.toHaveTextContent('will not delete the photo');
  });

  it('a successful publish writes the record, and a successful undo clears it', async () => {
    // build-info answers whichever commit is actually current, so the
    // confirm step matches for the publish AND then for the undo.
    let liveSha = 'commit-1';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
      if (url === '/api/undo') {
        liveSha = 'undo-commit';
        return jsonResponse(200, { sha: 'undo-commit' });
      }
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: liveSha, builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} reload={vi.fn()} />);
    dirty(captured!.registry);
    clickPublishAndAccept();
    await screen.findByText('Your changes are live.');

    expect(loadUndoRecord()).toEqual(expect.objectContaining({ sha: 'commit-1', paths: ['src/content/dishes.json'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

    await screen.findByText('Your site is back to how it was.');
    expect(loadUndoRecord()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  // The undo run drives the same phases a publish does, so the existing
  // `busy` disables the Publish button with no new mutual-exclusion logic.
  it('Publish is disabled while the undo is in flight', () => {
    rememberPublish(RECORD);
    vi.stubGlobal('fetch', undoFetch(() => new Promise<Response>(() => {})));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Putting it back…');
  });

  // Reloading before the build reports live would show her the PRE-undo site
  // and teach her the button did nothing.
  it('reloads only once the build reports live, never as soon as the POST returns', async () => {
    rememberPublish(RECORD);
    const reload = vi.fn();
    // The build is HELD at 'building' by a gate this test controls, rather
    // than by counting polls: with an instant clock, a count-based stub
    // races straight through to 'live' before any assertion can observe the
    // in-between state, which would make "not reloaded yet" vacuous.
    let releaseBuild!: () => void;
    const buildFinished = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    let buildLive = false;
    void buildFinished.then(() => {
      buildLive = true;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/undo') return jsonResponse(200, { sha: 'undo-commit' });
      if (url.startsWith('/api/build-status')) {
        return jsonResponse(200, { state: buildLive ? 'live' : 'building', deploymentUrl: null, commitUrl: 'https://c' });
      }
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'undo-commit', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    // A clock that never advances and yields to the macrotask queue between
    // polls: `instantClock` would burn through the ten-minute ceiling in the
    // same tick and land on 'stalled' before this test could release the
    // build.
    const heldClock = { now: () => 0, sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)) };
    render(<Harness pollClock={heldClock} reload={reload} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

    await screen.findByText('Putting it back… building.');
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      releaseBuild();
      await buildFinished;
    });

    await screen.findByText('Your site is back to how it was.');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // A D1-only publish's own undo, undoing the exact case Task 10 exists for
  // from the other direction: no commit, so no build to poll for, and the
  // restored content is already live. Without this branch, `trackPublish`
  // would be handed a `null` sha and poll a deployment that will never
  // exist -- the same ten-minute stall the publish side was fixed for.
  it('undoing a D1-only publish (sha: null) never polls build-status and reloads immediately', async () => {
    const d1Record = { sha: null, publishId: 'pub-1', at: Date.now() - 4 * 60_000, paths: ['src/content/awards.json'] };
    rememberPublish(d1Record);
    const reload = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/undo') return jsonResponse(200, { sha: null, restored: ['src/content/awards.json'] });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} reload={reload} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

    await screen.findByText('Your site is back to how it was.');
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('/api/build-status'), expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith('/build-info.json', expect.anything());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // The offer is dead either way: either the branch genuinely moved, or the
  // undo landed and its response was lost. Clearing it is what makes
  // "pressing undo twice" unreachable rather than merely refused.
  it('a 409 clears the record and says so, never "your site is back"', async () => {
    rememberPublish(RECORD);
    vi.stubGlobal('fetch', undoFetch(async () => jsonResponse(409, { message: 'Something else has been published since.' })));
    render(<Harness reload={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something else has been published since');
    expect(alert).toHaveTextContent('Your site may already be back to how it was.');
    expect(screen.queryByText('Your site is back to how it was.')).not.toBeInTheDocument();
    expect(loadUndoRecord()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  it('"Keep it" closes the confirmation and sends nothing', () => {
    rememberPublish(RECORD);
    const fetchImpl = undoFetch(async () => jsonResponse(200, { sha: 'undo-commit' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('button', { name: 'Yes, undo it' })).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/undo', expect.anything());
    // Still offered -- keeping the change does not consume the offer.
    expect(screen.getByRole('button', { name: 'Undo my last publish' })).toBeInTheDocument();
  });

  it('a corrupted stored record simply means no offer', () => {
    window.localStorage.setItem(UNDO_STORAGE_KEY, 'not json');
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  // Review finding (Minor): loadUndoRecord had no age bound and
  // rememberPublish overwrites on every publish, so from the very first
  // publish onward this button was a permanent fixture of both surfaces --
  // offering, weeks later, to revert a change she has long since forgotten
  // the details of, and (on a single-owner site, where nothing else has
  // moved `main`) actually succeeding.
  it('an offer older than the window is not made at all', () => {
    rememberPublish({ ...RECORD, at: Date.now() - UNDO_MAX_AGE_MS - 1 });
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
  });

  // ...and it ages out while she is looking at it, not only across a reload:
  // `undoRecord` is read once at mount, and the dashboard is exactly the kind
  // of page that stays open all afternoon.
  //
  // Mutation this guards: deleting the expiry effect in PublishBar.
  it('the offer withdraws itself on a tab that stays open past the window', async () => {
    vi.useFakeTimers();
    try {
      rememberPublish({ ...RECORD, at: Date.now() - UNDO_MAX_AGE_MS + 5_000 });
      render(<Harness />);
      expect(screen.getByRole('button', { name: 'Undo my last publish' })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(6_000);
      });

      expect(screen.queryByRole('button', { name: 'Undo my last publish' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Review finding (Important): the line that records uploaded photo/PDF
  // paths into the undo record had ZERO coverage -- deleting it left all
  // 2131 tests green. Both tests that exercise the sentence it feeds
  // hand-build the record with rememberPublish({...paths}) instead of
  // publishing, so neither could ever reach the production line that
  // assembles it.
  //
  // Mutation this guards: deleting
  // `...plan.files.filter((file) => file.encoding === 'base64').map((file) => file.path)`
  // from handlePublish.
  it('a real publish records the uploaded photo path too, not just the content JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1', publishId: 'p1' });
        if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
        if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
        if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    act(() => {
      captured!.stagedFiles.stage('dishes.json:a:image', {
        path: 'assets-source/food/9f2c1a4b7e03.jpg',
        content: 'AAAA',
        encoding: 'base64',
        contentPath: '/food/9f2c1a4b7e03.webp',
      });
    });

    clickPublishAndAccept();
    await screen.findByText('Your changes are live.');

    expect(loadUndoRecord()!.paths).toEqual(
      expect.arrayContaining(['src/content/dishes.json', 'assets-source/food/9f2c1a4b7e03.jpg']),
    );
    // ...and that is what makes the honest sentence appear for a publish she
    // actually made, rather than only for a hand-built fixture.
    fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The photo you added comes off the site as well.');
  });

  // ---------------------------------------------------------------------
  // Review findings (Important): every sentence an undo can reach used to be
  // written for a publish. She is taking a change OFF the site, and the bar
  // told her it was going ON.
  describe('an undo never describes itself as a publish', () => {
    it('the pause is named, so a greyed page reads as busy rather than broken', () => {
      rememberPublish(RECORD);
      vi.stubGlobal('fetch', undoFetch(() => new Promise<Response>(() => {})));
      const lockLog: boolean[] = [];
      render(<Harness onPublishLockChange={(locked) => lockLog.push(locked)} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      // Non-vacuous: the surface really is locked, which is what makes the
      // missing sentence a defect rather than a nicety.
      expect(lockLog[lockLog.length - 1]).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent('Putting it back… editing on this page is paused for a moment.');
      // The escape hatch is offered, and now belongs to a sentence.
      expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    });

    it('the 2-3 minute line talks about putting back, never about changes going live', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/undo') return jsonResponse(200, { sha: 'undo-commit' });
          if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'building', deploymentUrl: null, commitUrl: 'https://c' });
          if (url === '/build-info.json') return jsonResponse(200, { sha: 'nothing-yet', builtAt: 'now' });
          throw new Error(`unexpected fetch ${url}`);
        }),
      );
      const heldClock = { now: () => 0, sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)) };
      render(<Harness pollClock={heldClock} reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      await screen.findByText('Putting it back… building.');
      expect(
        screen.getByText(
          'This usually takes about 2-3 minutes. The change has already been put back — the site will catch up even if you close this tab.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/your changes are already saved/i)).not.toBeInTheDocument();
    });

    it('a build that never confirms says "put back", not "Published"', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/undo') return jsonResponse(200, { sha: 'undo-commit' });
          if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
          // Never catches up to the undo commit -> trackPublish times out
          // into 'mismatch'.
          if (url === '/build-info.json') return jsonResponse(200, { sha: 'some-older-commit', builtAt: 'now' });
          throw new Error(`unexpected fetch ${url}`);
        }),
      );
      render(<Harness pollClock={instantClock()} reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByText("Put back, but the site hasn't caught up yet.");
      expect(alert).toBeInTheDocument();
      expect(screen.queryByText(/^Published, but/)).not.toBeInTheDocument();
    });

    it('a failed build says "putting that back went wrong", not "publishing"', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/undo') return jsonResponse(200, { sha: 'undo-commit' });
          if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'failed', deploymentUrl: null, commitUrl: 'https://c' });
          if (url === '/build-info.json') return jsonResponse(200, { sha: 'some-older-commit', builtAt: 'now' });
          throw new Error(`unexpected fetch ${url}`);
        }),
      );
      render(<Harness pollClock={instantClock()} reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Something went wrong putting that back.');
      expect(alert).not.toHaveTextContent('Something went wrong publishing.');
    });

    // Review finding (Important): the one branch of PublishStatus that never
    // consulted `flow`. Her 7-day session expiring during the build poll of
    // an undo told her -- in the bar AND, via onUnauthenticated, on the login
    // screen afterwards -- "Your changes were already published", the exact
    // sentence the flow prop's own comment says must never appear here.
    it('a 401 mid-poll never says "your changes were already published"', async () => {
      rememberPublish(RECORD);
      let statusCalls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/undo') return jsonResponse(200, { sha: 'undo-commit' });
          if (url.startsWith('/api/build-status')) {
            statusCalls += 1;
            if (statusCalls >= 2) return jsonResponse(401, { message: 'Not authenticated.' });
            return jsonResponse(200, { state: 'building', deploymentUrl: null, commitUrl: 'https://c' });
          }
          if (url === '/build-info.json') return jsonResponse(200, { sha: 'nothing-yet', builtAt: 'now' });
          throw new Error(`unexpected fetch ${url}`);
        }),
      );
      const onUnauthenticated = vi.fn();
      render(<Harness pollClock={instantClock()} onUnauthenticated={onUnauthenticated} reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByText(/put back \(commit undo-commit\)/);
      expect(alert).toHaveTextContent('The change has already been put back (commit undo-commit).');
      expect(alert).not.toHaveTextContent('Your changes were already published');
      // The login screen gets the same corrected sentence, not the bar's own
      // corrected copy of a wrong one.
      expect(onUnauthenticated).toHaveBeenCalledWith(expect.stringContaining('has already been put back'));
      expect(onUnauthenticated).not.toHaveBeenCalledWith(expect.stringContaining('already published'));
    });

    it('a 500 on the undo itself says nothing was put back, never "nothing was lost"', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal('fetch', undoFetch(async () => jsonResponse(500, { message: 'boom' })));
      render(<Harness reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Nothing was put back — try again in a minute.");
      expect(alert).not.toHaveTextContent('Nothing was lost');
    });

    // Phase 2, Task 11: a mixed undo (Awards' D1 half plus a GitHub file) is
    // reachable now that Awards has an editable panel -- worker/index.ts's
    // own `handleUndo` runs the D1 leg first and reports `partial: true` on
    // any refusal reached after it landed. Before this task, `partial` was
    // parsed nowhere on the client, so this exact response used to fall into
    // the SAME generic sentence as an ordinary 500 -- "Nothing was put
    // back," false the moment the D1 half already succeeded.
    //
    // Mutation-provable: deleting `partial: result.status === 'server-error'
    // ? result.partial : undefined` from performUndo (PublishBar.tsx) and
    // hardcoding `undefined` makes this fail -- the alert reads "Nothing was
    // put back" instead of naming the part that already landed.
    it('a 500 on the undo AFTER the D1 half already landed says so, not "nothing was put back"', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal('fetch', undoFetch(async () => jsonResponse(500, { message: 'boom', partial: true })));
      render(<Harness reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Part of that change is already back. Couldn't reach the server for the rest — try again in a minute.");
      expect(alert).not.toHaveTextContent('Nothing was put back');
    });

    // The 409 sibling of the case above -- worker/index.ts's own
    // "Something else has been published since" refusal, reached after the
    // D1 half already restored.
    it('a 409 on the undo AFTER the D1 half already landed names the part that is already back', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        undoFetch(async () => jsonResponse(409, { message: 'Something else has been published since.', partial: true })),
      );
      render(<Harness reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Part of that change is already back — the rest may be too, possibly from another tab or device of your own. Reload to see what your site looks like now.',
      );
      expect(alert).not.toHaveTextContent('Your site may already be back to how it was.');
    });

    // The false-negative direction matters just as much: a `partial` that is
    // absent (an ordinary, non-mixed undo -- the overwhelming majority) or
    // explicitly `false` must still read exactly as it always has. Pinned
    // directly rather than only inferred from the pre-existing 500/409 tests
    // above, since those predate this field and would not notice `partial`
    // being read backwards (defaulting a MISSING flag to `true`).
    it('a 409 with no partial flag at all still reads as an ordinary conflict', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        undoFetch(async () => jsonResponse(409, { message: 'Something else has been published since.' })),
      );
      render(<Harness reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Something else has been published since — possibly from another tab or device of your own. Your site may already be back to how it was. Reload to see what it looks like now.',
      );
      expect(alert).not.toHaveTextContent('Part of that change is already back');
    });

    // Review finding (Minor): `flow` is component state and nothing reloads
    // the page after a refused undo, so without handlePublish's own
    // setFlow('publish') the NEXT publish -- a brand-new change she just
    // pushed live -- was reported as "Your site is back to how it was."
    //
    // Mutation this guards: deleting `setFlow('publish');` from handlePublish.
    it('a publish AFTER a failed undo is reported as a publish', async () => {
      rememberPublish(RECORD);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/undo') return jsonResponse(409, { message: 'Something else has been published since.' });
          if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-2', publishId: 'p2' });
          if (url.startsWith('/api/content')) return jsonResponse(200, { content: '[]', sha: 'sha-fresh' });
          if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
          if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-2', builtAt: 'now' });
          throw new Error(`unexpected fetch ${url}`);
        }),
      );
      render(<Harness pollClock={instantClock()} reload={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo my last publish' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }));
      await screen.findByText(/Something else has been published since/);

      dirty(captured!.registry);
      clickPublishAndAccept();

      expect(await screen.findByText('Your changes are live.')).toBeInTheDocument();
      expect(screen.queryByText('Your site is back to how it was.')).not.toBeInTheDocument();
    });
  });
});
