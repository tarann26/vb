import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { anythingPublishesToday, type Env } from '../index';
import { hashPassword, signToken } from '../auth';
import { makeGitHubStub, utf8, type GitHubStub } from './githubStub';

// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment).

const SCHEDULE_KV_KEY = 'schedule:pending-dates';

class FakeKV {
  store = new Map<string, string>();
  // Counts real `.get()` calls, not `.store` accesses -- used by the
  // "common path stays one KV read" test below, which needs to observe the
  // actual number of KV round-trips `scheduled` makes, not just infer it
  // from behavior.
  getCalls = 0;
  async get(key: string): Promise<string | null> {
    this.getCalls++;
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// A real Workers KV binding can genuinely throw (a network blip, a
// transient rate limit) -- this is what proves handlePublish's try/catch
// around schedule bookkeeping (worker/index.ts, step 5) is load-bearing
// rather than defensive dead code. Removing that try/catch was confirmed
// NOT to fail the malformed-publishAt test below: `isStillPending`
// (worker/index.ts) already handles a bad date internally without ever
// throwing, so that scenario alone doesn't exercise the outer catch at all
// -- only a genuine KV failure does.
class ThrowingKV extends FakeKV {
  override async put(): Promise<void> {
    throw new Error('KV temporarily unavailable');
  }
}

const TOKEN_SECRET = 'scheduled-test-token-secret';
const PASSWORD = 'the real restaurant password';
const DEPLOY_HOOK_URL = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/scheduled-test-not-real';

async function buildEnv(kv = new FakeKV()): Promise<Env> {
  return {
    KV: kv as unknown as KVNamespace,
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    TOKEN_SECRET,
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'scheduled-test-github-token-not-real',
    CLOUDFLARE_ACCOUNT_ID: 'scheduled-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'scheduled-test-project',
    CLOUDFLARE_API_TOKEN: 'scheduled-test-fixture-cf-token-not-real',
    DEPLOY_HOOK_URL,
  };
}

// `files` matches worker/index.ts's `Schedule.files` shape; `lastReconciled`
// defaults to `null` (never reconciled) unless a test needs otherwise, e.g.
// the "runs at most once a day" test seeding "already reconciled today".
function seedSchedule(kv: FakeKV, files: Record<string, string[]>, lastReconciled: string | null = null): void {
  kv.store.set(SCHEDULE_KV_KEY, JSON.stringify({ files, lastReconciled }));
}

// GitHub's Contents API shape, base64-encoded -- what worker/github.ts's
// getFileContent (used only by reconcileScheduleFromSource) actually reads.
// ASCII-only fixtures throughout, so plain `btoa` round-trips cleanly.
function contentsApiResponse(items: unknown[]): Response {
  return new Response(JSON.stringify({ content: btoa(JSON.stringify(items)), encoding: 'base64' }), { status: 200 });
}

// A fetch stub for the reconciliation path: answers GitHub's Contents API
// GET for each of the three schedulable files (404 for any not given a
// fixture -- getFileContent treats that as "nothing to reconcile", not an
// error) and the deploy hook POST. Records every URL requested so tests can
// assert exactly how many GitHub reads happened, not just what the outcome
// was.
function makeReconciliationFetchStub(
  fixtures: { 'dishes.json'?: unknown[]; 'drinks.json'?: unknown[]; 'press.json'?: unknown[] },
  opts: { deployHookStatus?: number; failFiles?: Set<string> } = {},
) {
  const calls: string[] = [];
  const fetchStub = vi.fn(async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    calls.push(url);
    if (url === DEPLOY_HOOK_URL) return new Response(null, { status: opts.deployHookStatus ?? 200 });
    for (const file of ['dishes.json', 'drinks.json', 'press.json'] as const) {
      if (url.includes(`/contents/src/content/${file}`)) {
        // A genuine GitHub failure (not "file doesn't exist") -- 500, not
        // 404. getFileContent throws on this, which is exactly the case
        // reconcileScheduleFromSource's own preserve-on-failure behavior
        // exists for.
        if (opts.failFiles?.has(file)) return new Response('server error', { status: 500 });
        const items = fixtures[file];
        return items === undefined ? new Response('not found', { status: 404 }) : contentsApiResponse(items);
      }
    }
    throw new Error(`reconciliation fetch stub: unexpected request ${url}`);
  });
  return { fetch: fetchStub as unknown as typeof fetch, calls };
}

// worker.scheduled's own signature only needs `env` -- see worker/index.ts's
// comment on why it takes no `ctx` -- but real Cron Triggers always pass a
// controller as the first argument, so this fixture is threaded through for
// shape-fidelity even though its fields are never read.
const FAKE_CONTROLLER = { scheduledTime: 0, cron: '0 * * * *', noRetry: () => {} } as unknown as ScheduledController;

// `worker.scheduled` and `anythingPublishesToday` both resolve "today" via
// `todayInKolkata()`, which reads the real clock (see src/content/publish.ts).
// Every test below that depends on an exact "is this date == today" match
// pins the clock with fake timers rather than hardcoding a date and hoping
// the suite happens to run on it -- the same reason
// plugins/__tests__/filter-unpublished.test.ts's own `todayInKolkata` tests
// use `vi.setSystemTime` instead of relying on the real date. 15:30 IST,
// comfortably inside the day and nowhere near the UTC/IST boundary that
// file's own tests are about.
const FIXED_NOW = new Date('2026-08-02T10:00:00Z');
const TODAY = '2026-08-02';

describe('scheduled (the cron handler)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls the deploy hook exactly once when something is due today', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': [TODAY] });
    const env = await buildEnv(kv);
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEPLOY_HOOK_URL);
    expect(init.method).toBe('POST');
  });

  // These two tests seed a KV state that's already "reconciled today"
  // (`lastReconciled: TODAY`), so `scheduled` never reaches the
  // reconciliation branch and this fetch stub is only ever asked (or, per
  // the assertion, NOT asked) about the deploy hook -- keeping each test
  // scoped to exactly the "is anything due" property it's named for, rather
  // than incidentally also exercising reconciliation as an unnamed side
  // effect. Reconciliation itself, including a from-scratch KV with no
  // `lastReconciled` at all, is covered by the dedicated tests below.
  it('does not call the deploy hook at all when nothing is due', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': ['2099-01-01'] }, TODAY);
    const env = await buildEnv(kv);
    // Returns a real Response, not `undefined` -- a mutation that removed
    // the "is anything due" gate must fail on the named assertion below
    // (the hook WAS called), not on an unrelated `Cannot read properties of
    // undefined (reading 'ok')` a bare `vi.fn()` would throw instead.
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).not.toHaveBeenCalled();
  });

  // Same "not at all" case with no schedule recorded whatsoever -- the
  // ordinary state for a site that has never published anything with a
  // future `publishAt`. Distinct from the case above (a future date that
  // just isn't today yet): this proves an empty/missing KV key doesn't
  // somehow read as "due" too. `lastReconciled` seeded to TODAY for the same
  // reason as above -- an empty, never-reconciled schedule would otherwise
  // (correctly) trigger reconciliation, which is covered separately below.
  it('does not call the deploy hook when nothing has ever been scheduled', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, {}, TODAY);
    const env = await buildEnv(kv);
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx deploy hook response rather than swallowing it', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': [TODAY] });
    const env = await buildEnv(kv);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await expect(worker.scheduled!(FAKE_CONTROLLER, env)).rejects.toThrow();
  });

  // The anti-repeat property `clearDueDates` exists for: once the hook has
  // fired successfully for today's due date, a second tick later the same
  // day must not fire it again. Without this, a single item due "today"
  // would refire the hook on every remaining hourly tick of that day --
  // exactly the quota-burning failure mode this whole task exists to avoid,
  // just bounded to one day instead of the full month.
  it('does not call the hook again on a later tick the same day, after it already fired once', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': [TODAY] });
    const env = await buildEnv(kv);
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);
    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  // A failed hook call must NOT clear the date -- the whole point of
  // surfacing the failure is that the next tick gets another chance.
  it('a failed hook call leaves the date in place, so the next tick retries it', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': [TODAY] });
    const env = await buildEnv(kv);
    const fetchStub = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchStub);

    await expect(worker.scheduled!(FAKE_CONTROLLER, env)).rejects.toThrow();
    // A second tick, now stubbed to succeed, still sees the date as due.
    fetchStub.mockImplementation(async () => new Response(null, { status: 200 }));
    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  // Catch-up: a date that fell in the past without ever successfully firing
  // (e.g. several missed ticks) must still be treated as due, not silently
  // dropped just because "today" has moved past it.
  it('treats a stale past date as still due (catch-up), not silently expired', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'press.json': ['2026-07-15'] });
    const env = await buildEnv(kv);
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  // Important 3 (review round 2): the daily reconciliation. Gap 1 named by
  // the review, reproduced by the reviewer directly against this
  // repository's own history: `git log -- src/content/dishes.json` shows
  // every dish arrived by hand commit, never through POST /api/publish --
  // so a hand-committed future publishAt is invisible to `handlePublish`'s
  // own bookkeeping (recordScheduledDates) by construction. This is the
  // "second, independent" recovery path: read the real content from GitHub
  // directly, not trust only what a publish happened to record.
  describe('daily reconciliation', () => {
    it('recovers a hand-committed future publishAt that never went through handlePublish', async () => {
      const kv = new FakeKV(); // empty: nothing has ever gone through POST /api/publish
      const env = await buildEnv(kv);
      const handCommittedDish = {
        id: 'hand-committed',
        name: 'Hand-Committed Dish',
        description: 'Added by a direct commit, not the dashboard.',
        image: '/food/x.webp',
        tags: [],
        publishAt: '2099-03-01',
      };
      const { fetch: fetchStub } = makeReconciliationFetchStub({
        'dishes.json': [handCommittedDish],
        'drinks.json': [],
        'press.json': [],
      });
      vi.stubGlobal('fetch', fetchStub);

      // Nothing due today -> reconciliation runs -> reads dishes.json
      // straight from GitHub -> finds the hand-committed future date.
      await worker.scheduled!(FAKE_CONTROLLER, env);

      expect(await anythingPublishesToday(env, '2099-03-01')).toBe(true);
    });

    it('runs at most once a day, not on every tick', async () => {
      const kv = new FakeKV();
      const env = await buildEnv(kv);
      const { fetch: fetchStub, calls } = makeReconciliationFetchStub({
        'dishes.json': [],
        'drinks.json': [],
        'press.json': [],
      });
      vi.stubGlobal('fetch', fetchStub);

      await worker.scheduled!(FAKE_CONTROLLER, env);
      const githubReadsAfterFirstTick = calls.length;
      await worker.scheduled!(FAKE_CONTROLLER, env);

      expect(githubReadsAfterFirstTick).toBe(3); // dishes.json, drinks.json, press.json
      // The second tick made no additional requests at all -- reconciliation
      // did not run again, and nothing became due as a result of the first
      // tick's reconciliation either.
      expect(calls.length).toBe(githubReadsAfterFirstTick);
    });

    // The property the whole combined-KV-key design (Schedule.lastReconciled
    // living alongside Schedule.files under one key) exists for: a tick that
    // neither finds something due nor needs to reconcile spends exactly one
    // KV read, the same cost `anythingPublishesToday`'s own comment claims
    // for the common path -- not two, which a naive "check a second KV key
    // to decide whether to reconcile" implementation would cost instead.
    it('a tick that is neither due nor due for reconciliation costs exactly one KV read', async () => {
      const kv = new FakeKV();
      seedSchedule(kv, { 'dishes.json': ['2099-01-01'] }, TODAY); // future date, already reconciled today
      const env = await buildEnv(kv);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));

      await worker.scheduled!(FAKE_CONTROLLER, env);

      expect(kv.getCalls).toBe(1);
    });

    it('a malformed publishAt in the GitHub content does not abandon the rest of that file during reconciliation', async () => {
      const kv = new FakeKV();
      const env = await buildEnv(kv);
      const validFutureDish = {
        id: 'valid-future',
        name: 'Valid Future Dish',
        description: 'd',
        image: '/food/x.webp',
        tags: [],
        publishAt: '2099-04-01',
      };
      const malformedDish = { id: 'bad-date', name: 'Bad Date Dish', description: 'd', image: '/food/y.webp', tags: [], publishAt: 'next tuesday' };
      const { fetch: fetchStub } = makeReconciliationFetchStub({
        'dishes.json': [validFutureDish, malformedDish],
        'drinks.json': [],
        'press.json': [],
      });
      vi.stubGlobal('fetch', fetchStub);

      await worker.scheduled!(FAKE_CONTROLLER, env);

      expect(await anythingPublishesToday(env, '2099-04-01')).toBe(true);
    });

    // A transient GitHub failure on one file must not make reconciliation
    // WORSE than not running it at all -- confirmed by reproduction: a
    // first draft rebuilt `files` from an empty object every time, so a
    // failed read for one file silently wiped its already-known-good
    // tracked date down to nothing instead of leaving it untouched. This is
    // the one property none of the other tests above happen to exercise --
    // they all either fetch successfully or hit a 404 (genuinely "no such
    // file", correctly treated as nothing to reconcile), never a real
    // failure on a file with pre-existing state.
    it('preserves an already-tracked date for a file reconciliation fails to read fresh', async () => {
      const kv = new FakeKV();
      seedSchedule(kv, { 'dishes.json': ['2099-05-01'] }); // already known, from a prior real publish
      const env = await buildEnv(kv);
      const { fetch: fetchStub } = makeReconciliationFetchStub(
        { 'drinks.json': [], 'press.json': [] }, // dishes.json omitted from fixtures
        { failFiles: new Set(['dishes.json']) }, // ...and explicitly made to fail, not 404
      );
      vi.stubGlobal('fetch', fetchStub);

      await worker.scheduled!(FAKE_CONTROLLER, env);

      expect(await anythingPublishesToday(env, '2099-05-01')).toBe(true);
    });
  });
});

describe('anythingPublishesToday', () => {
  it('is false for an empty schedule', async () => {
    const env = await buildEnv(new FakeKV());
    expect(await anythingPublishesToday(env, TODAY)).toBe(false);
  });

  it('is true when any tracked file carries a date on or before today', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'drinks.json': [TODAY] });
    const env = await buildEnv(kv);
    expect(await anythingPublishesToday(env, TODAY)).toBe(true);
  });

  it('is false when every tracked date is still in the future', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'drinks.json': ['2026-08-03'] }); // one day after TODAY
    const env = await buildEnv(kv);
    expect(await anythingPublishesToday(env, TODAY)).toBe(false);
  });
});

// The other half of the feature: handlePublish (worker/index.ts) records
// each schedulable file's still-future publishAt dates into the same KV key
// `anythingPublishesToday` reads, so the cron can answer without ever
// fetching dishes/drinks/press.json from GitHub itself.
describe('handlePublish records scheduled dates for the cron', () => {
  let stub: GitHubStub;
  let env: Env;
  let kv: FakeKV;

  beforeEach(async () => {
    stub = makeGitHubStub();
    vi.stubGlobal('fetch', stub.fetch);
    kv = new FakeKV();
    env = await buildEnv(kv);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sessionCookie(): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = await signToken(TOKEN_SECRET, expiresAt);
    return `vb_session=${token}`;
  }

  function publishRequest(body: unknown, cookie: string): Request {
    return new Request('https://viabiancadelhi.com/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  }

  const futureDish = {
    id: 'truffle-special',
    name: 'Truffle Special',
    description: 'A seasonal special.',
    image: '/food/truffle.webp',
    tags: [],
    publishAt: '2099-01-01',
  };

  it('publishing a dish with a future publishAt makes anythingPublishesToday true on that date', async () => {
    const cookie = await sessionCookie();
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([futureDish]))] }, cookie),
      env,
    );
    expect(response.status).toBe(200);

    expect(await anythingPublishesToday(env, '2099-01-01')).toBe(true);
    expect(await anythingPublishesToday(env, '2098-12-31')).toBe(false);
  });

  // validateContent (src/content/validate.ts) does not check `publishAt`'s
  // format at all -- confirmed directly: it has no rule for that field. A
  // publish carrying a malformed one reaches recordScheduledDates for real,
  // not hypothetically. `isStillPending` (worker/index.ts) catches the
  // resulting `isPublished` throw per-item now, so this specific scenario no
  // longer exercises handlePublish's own outer try/catch (confirmed: removing
  // that catch does not fail this test) -- see the KV-failure test below for
  // what that outer catch actually guards. Kept anyway, since the property
  // itself ("a malformed date never turns a landed commit into a 500") is
  // still real and still worth its own name.
  it('a malformed publishAt does not turn an otherwise-successful publish into a failure', async () => {
    const cookie = await sessionCookie();
    const malformed = { ...futureDish, publishAt: 'next tuesday' };
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([malformed]))] }, cookie),
      env,
    );
    expect(response.status).toBe(200);
  });

  // The test that actually exercises handlePublish's outer try/catch around
  // schedule bookkeeping: a real KV failure, not a malformed date. The
  // commit already landed on GitHub before this runs -- the publish must
  // still return its 200, not turn a successful publish into a 500 over
  // bookkeeping for a cron that hasn't even run yet.
  it('a KV failure during schedule bookkeeping does not turn a successful publish into a 500', async () => {
    const throwingEnv = await buildEnv(new ThrowingKV());
    const cookie = await sessionCookie();
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([futureDish]))] }, cookie),
      throwingEnv,
    );
    expect(response.status).toBe(200);
  });

  // A dish dated today or already past needs no cron help at all -- the
  // commit that just landed already triggers Cloudflare's own build-on-push.
  // Tracking it too would just be redundant bookkeeping.
  it('does not track a dish whose publishAt is today or already past', async () => {
    const cookie = await sessionCookie();
    const notFuture = { ...futureDish, id: 'todays-dish', publishAt: '2020-01-01' };
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([notFuture]))] }, cookie),
      env,
    );
    expect(response.status).toBe(200);
    expect(await anythingPublishesToday(env, '2020-01-01')).toBe(false);
  });

  // Republishing the same file with the scheduled item removed must clear
  // the stale date -- not leave it sitting in KV forever, which would make
  // the cron fire a build for content that no longer exists.
  it('republishing the same file without the scheduled item clears its date', async () => {
    const cookie = await sessionCookie();
    await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([futureDish]))] }, cookie),
      env,
    );
    expect(await anythingPublishesToday(env, '2099-01-01')).toBe(true);

    const withoutSchedule = { ...futureDish, publishAt: undefined };
    delete (withoutSchedule as { publishAt?: string }).publishAt;
    await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([withoutSchedule]))] }, cookie),
      env,
    );

    expect(await anythingPublishesToday(env, '2099-01-01')).toBe(false);
  });

  // Publishing one schedulable file must not clobber another file's
  // already-recorded dates -- each file owns its own slice of the record.
  it('publishing one file preserves a different file\'s already-recorded dates', async () => {
    const cookie = await sessionCookie();
    const futureDrink = {
      id: 'winter-spritz',
      name: 'Winter Spritz',
      description: 'A seasonal cocktail.',
      category: 'cocktail',
      image: null,
      publishAt: '2099-06-01',
    };
    await worker.fetch(
      publishRequest({ files: [utf8('src/content/drinks.json', JSON.stringify([futureDrink]))] }, cookie),
      env,
    );
    await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([futureDish]))] }, cookie),
      env,
    );

    expect(await anythingPublishesToday(env, '2099-01-01')).toBe(true);
    expect(await anythingPublishesToday(env, '2099-06-01')).toBe(true);
  });

  // Important 2 (review round 2): the case above uses two SEPARATE
  // requests, which cannot catch a lost update -- each request's
  // read-modify-write against the shared schedule KV key completes before
  // the next one starts regardless of how recordScheduledDates itself
  // schedules its own work. A SINGLE request naming two schedulable files
  // is what actually exercises concurrent read-modify-writes against that
  // one key: reproduced against the `Promise.all` version this replaced --
  // publishing dishes.json and drinks.json together left only whichever
  // file's write happened to land last in KV, silently discarding the
  // other file's schedule entirely. `commitFiles` is built for N files
  // (worker/github.ts) and a multi-file publish is already exercised
  // elsewhere (worker/__tests__/index.test.ts's `publishes every valid
  // file in one commit`), so this is a real, reachable request shape today,
  // not a hypothetical one.
  it('publishing two schedulable files in ONE request records both -- no lost update', async () => {
    const cookie = await sessionCookie();
    const futureDrink = {
      id: 'winter-spritz-together',
      name: 'Winter Spritz Together',
      description: 'A seasonal cocktail.',
      category: 'cocktail',
      image: null,
      publishAt: '2099-07-01',
    };
    const response = await worker.fetch(
      publishRequest(
        {
          files: [
            utf8('src/content/dishes.json', JSON.stringify([futureDish])),
            utf8('src/content/drinks.json', JSON.stringify([futureDrink])),
          ],
        },
        cookie,
      ),
      env,
    );
    expect(response.status).toBe(200);

    expect(await anythingPublishesToday(env, '2099-01-01')).toBe(true);
    expect(await anythingPublishesToday(env, '2099-07-01')).toBe(true);
  });

  // A file with no publishAt-bearing content at all (site.json) must never
  // touch the schedule record -- proven by asserting the key stays entirely
  // unset, not just "returns false", which a bug in the file-name check
  // could also produce by accident.
  it('publishing a non-schedulable file never writes the schedule KV key', async () => {
    const cookie = await sessionCookie();
    const validSite = {
      name: 'Via Bianca',
      tagline: 'A Roman trattoria',
      strapline: 'Handmade pasta, Delhi',
      address: { street: '1 Test Street', locality: 'Test Locality', postalCode: '110001', country: 'India' },
      phones: ['+911234567890'],
      whatsapp: { number: '+911234567890', prefilledMessage: 'Hi, I would like to book a table.' },
      socials: { instagram: 'https://instagram.com/viabianca' },
      hours: [{ days: ['Mo'], opens: '09:00', closes: '22:00' }],
      seo: { title: 'Via Bianca', description: 'A Roman trattoria in Delhi.' },
      copyrightYear: 2026,
    };
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/site.json', JSON.stringify(validSite))] }, cookie),
      env,
    );
    expect(response.status).toBe(200);
    expect(kv.store.has(SCHEDULE_KV_KEY)).toBe(false);
  });
});
