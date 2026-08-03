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
import { useContentRegistry } from '../publish';
import { useStagedFiles } from '../staged';
import type { ContentRegistry } from '../publish';
import type { StagedFiles } from '../staged';
import { DRAFT_STORAGE_KEY } from '../drafts';

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
}: {
  onUnauthenticated?: () => void;
  pollClock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  withTagsField?: boolean;
}) {
  const registry = useContentRegistry();
  const stagedFiles = useStagedFiles();
  captured = { registry, stagedFiles };
  const [tagsText, setTagsText] = useState('a, b');

  return (
    <PublishBar registry={registry} stagedFiles={stagedFiles} onUnauthenticated={onUnauthenticated} pollClock={pollClock}>
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
              'dishes.json',
              [{ id: 'x', tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) }],
              'sha-1',
            )
          }
        />
      )}
    </PublishBar>
  );
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
      captured!.stagedFiles.stage('menus.json:food:file', { path: 'public/menus/food-menu.pdf', content: 'AAAA', encoding: 'base64' });
    });
    expect(screen.getByText('1 file staged — ready to publish.')).toBeInTheDocument();
  });
});

describe('PublishBar: Step 1 carried requirement 2 -- flushes the focused field before reading the payload', () => {
  it('a form SUBMIT (not a click) still includes the tag typed but never blurred away from', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second param exists only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
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
    fireEvent.submit(form!);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/publish', expect.anything()));
    const publishCall = fetchImpl.mock.calls.find(([url]) => url === '/api/publish')!;
    const body = JSON.parse((publishCall[1] as RequestInit).body as string) as { files: { path: string; content: string }[] };
    const dishesFile = body.files.find((f) => f.path === 'src/content/dishes.json')!;
    expect(JSON.parse(dishesFile.content)).toEqual([{ id: 'x', tags: ['a', 'b', 'c'] }]);
  });
});

describe('PublishBar: assembling the request', () => {
  it('attaches baseSha to a dirty content file (carried requirement 1)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- both params exist only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { sha: 'commit-1' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    act(() => captured!.registry.register('dishes.json', [{ id: 'a', name: '' }], 'sha-original'));
    act(() => captured!.registry.register('dishes.json', [{ id: 'a', name: 'Edited' }], 'sha-original'));

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string) as { files: { baseSha?: string }[] };
    expect(body.files[0].baseSha).toBe('sha-original');
  });

  it('a click on the Publish button also blurs first (the ordinary path stays safe too)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- both params exist only to keep the mock's call-tuple type two elements wide, matched against below
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { sha: 'commit-1' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness withTagsField pollClock={instantClock()} />);
    dirty(captured!.registry);
    const tagsInput = screen.getByLabelText('tags') as HTMLInputElement;
    fireEvent.change(tagsInput, { target: { value: 'a, b, c' } });
    tagsInput.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    return screen.findByRole('alert');
  }

  it('409 (baseSha conflict body) -> the plain-language conflict sentence', async () => {
    const alert = await publishAndGetAlert(409, { problems: [{ field: 'src/content/dishes.json', message: 'Someone else changed this.' }] });
    expect(alert).toHaveTextContent('Someone else published while you were editing. Reload to get their changes, then try again.');
  });

  it('409 (PublishConflictError message body) -> the SAME sentence -- branch on status, not message text', async () => {
    const alert = await publishAndGetAlert(409, { message: 'someone else published while you were editing -- reload and try again' });
    expect(alert).toHaveTextContent('Someone else published while you were editing. Reload to get their changes, then try again.');
  });

  it('502 (GitHub 5xx) -> the "nothing was lost" sentence', async () => {
    const alert = await publishAndGetAlert(502, { message: 'could not update main (GitHub returned 503)' });
    expect(alert).toHaveTextContent("Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute.");
  });

  it('a thrown fetch (offline) -> the SAME "nothing was lost" sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute.");
  });

  it('422 -> each problem listed, field and message both on screen', async () => {
    const alert = await publishAndGetAlert(422, { problems: [{ field: '[0].name', message: 'Name is required.' }] });
    expect(alert).toHaveTextContent('[0].name');
    expect(alert).toHaveTextContent('Name is required.');
  });

  it('a problem whose field matches no rendered input still appears on screen', async () => {
    const alert = await publishAndGetAlert(422, { problems: [{ field: 'an-unrendered-field', message: 'Something obscure is wrong.' }] });
    expect(alert).toHaveTextContent('Something obscure is wrong.');
  });

  it('401 on the publish itself -> the signed-out sentence, and onUnauthenticated fires', async () => {
    const onUnauthenticated = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'Not authenticated.' })));
    render(<Harness onUnauthenticated={onUnauthenticated} pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've been signed out. Log in and your changes will still be here.");
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('PublishBar: Step 3 -- polling to live, confirmed against build-info.json', () => {
  it('queued -> building -> live, confirmed, ends in "Your changes are live."', async () => {
    let statusCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await screen.findByText('Your changes are live.');
  });

  it('never reaching live -> "taking longer than it should", with the commit link', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
      if (url.startsWith('/api/build-status')) {
        return jsonResponse(200, { state: 'queued', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/commit-1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent('This is taking longer than it should.');
    expect(alert).toHaveTextContent('send this link to your developer');
    expect(screen.getByRole('link', { name: 'https://github.com/x/y/commit/commit-1' })).toBeInTheDocument();
  }, 15_000);

  it('live but build-info.json never catches up -> "hasn\'t picked it up yet"', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'some-other-sha', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent("Published, but the site hasn't picked it up yet.");
  }, 15_000);

  it('a build state of "failed" -> the developer-link sentence, without waiting out the timeout', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'failed', deploymentUrl: null, commitUrl: 'https://github.com/x/y/commit/commit-1' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong publishing.');
    expect(screen.getByRole('link', { name: 'https://github.com/x/y/commit/commit-1' })).toBeInTheDocument();
  });

  // Step 3's own explicit instruction: GET /api/build-status is
  // authenticated too, and a 401 can arrive MID-POLL (the 7-day session
  // expiring while she waits), not only on the publish itself.
  it('a 401 mid-poll -> the signed-out sentence, onUnauthenticated fires, polling stops', async () => {
    const onUnauthenticated = vi.fn();
    let statusCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've been signed out. Log in and your changes will still be here.");
    expect(statusCall).toBe(2);
  });
});

describe('PublishBar: after a successful publish', () => {
  it('clears exactly the staged keys that were sent, and refreshes baseSha (a second publish would not falsely conflict)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
      if (url.startsWith('/api/content')) return jsonResponse(200, { content: JSON.stringify([{ id: 'a', name: 'Edited' }]), sha: 'sha-fresh' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    act(() => {
      captured!.stagedFiles.stage('dishes.json:a:image', { path: 'assets-source/food/x.jpg', content: 'AAAA', encoding: 'base64' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByText('Your changes are live.');

    expect(captured!.stagedFiles.files).toEqual({});
    expect(captured!.registry.getEntries()['dishes.json']?.sha).toBe('sha-fresh');
  });

  it('clears the localStorage draft on a 200', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ 'dishes.json': { data: [], savedAt: 1 } }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/publish') return jsonResponse(200, { sha: 'commit-1' });
      if (url.startsWith('/api/build-status')) return jsonResponse(200, { state: 'live', deploymentUrl: null, commitUrl: 'https://c' });
      if (url === '/build-info.json') return jsonResponse(200, { sha: 'commit-1', builtAt: 'now' });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<Harness pollClock={instantClock()} />);
    dirty(captured!.registry);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
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
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('You have unsaved changes from 1 minute ago.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
