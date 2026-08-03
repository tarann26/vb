import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { anythingPublishesToday, type Env } from '../index';
import { hashPassword, signToken } from '../auth';
import { makeGitHubStub, utf8, type GitHubStub } from './githubStub';

// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment).

const SCHEDULE_KV_KEY = 'schedule:pending-dates';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
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

function seedSchedule(kv: FakeKV, schedule: Record<string, string[]>): void {
  kv.store.set(SCHEDULE_KV_KEY, JSON.stringify(schedule));
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

  it('does not call the deploy hook at all when nothing is due', async () => {
    const kv = new FakeKV();
    seedSchedule(kv, { 'dishes.json': ['2099-01-01'] });
    const env = await buildEnv(kv);
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    await worker.scheduled!(FAKE_CONTROLLER, env);

    expect(fetchStub).not.toHaveBeenCalled();
  });

  // Same "not at all" case with no schedule recorded whatsoever -- the
  // ordinary state for a site that has never published anything with a
  // future `publishAt`. Distinct from the case above (a future date that
  // just isn't today yet): this proves an empty/missing KV key doesn't
  // somehow read as "due" too.
  it('does not call the deploy hook when nothing has ever been scheduled', async () => {
    const env = await buildEnv(new FakeKV());
    const fetchStub = vi.fn();
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
  // format at all -- confirmed directly: it has no rule for that field.
  // `isPublished` throws on a malformed one ("expected a real calendar date
  // as YYYY-MM-DD"), so a publish carrying one reaches recordScheduledDates's
  // `futurePublishAtDates` and hits that throw for real, not hypothetically.
  // The commit has already landed on GitHub by that point -- the publish
  // must still return its 200, not turn a successful publish into a 500
  // over bookkeeping for a cron that hasn't even run yet.
  it('a malformed publishAt does not turn an otherwise-successful publish into a failure', async () => {
    const cookie = await sessionCookie();
    const malformed = { ...futureDish, publishAt: 'next tuesday' };
    const response = await worker.fetch(
      publishRequest({ files: [utf8('src/content/dishes.json', JSON.stringify([malformed]))] }, cookie),
      env,
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
