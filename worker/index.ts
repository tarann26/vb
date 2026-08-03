// The admin Worker's entry point. `/api/*` on the site's own zone is the
// only thing routed to this Worker (see wrangler.toml); every path other
// than /api/health, POST /api/login, POST /api/publish, POST /api/upload and
// GET /api/build-status still replies 404 until a later task adds a real
// route. Also exports `scheduled`, the cron handler that rebuilds the site
// only when scheduled content is actually due -- see `anythingPublishesToday`
// below.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json)
// rather than tsconfig.node.json: this file needs `Response`/`Request`/`fetch`/
// `crypto`, none of which tsconfig.node.json's ES2023-only `lib` declares.
import { verifyPassword, signToken, verifyToken, parseCookie } from './auth';
import { checkLoginRate, recordLoginFailure, clearLoginFailures, checkRate, recordHit } from './ratelimit';
import { commitFiles, getFileContent, DisallowedPathError, type CommitFile, type GitHubEnv } from './github';
import { validateContent, type ValidationProblem } from '../src/content/validate';
import { handleUpload } from './upload';
import { handleBuildStatus, type PagesEnv } from './status';
import { isPublished, todayInKolkata } from '../src/content/publish';

// Grows as later tasks need more bindings -- only what this file actually
// reads belongs here. GITHUB_OWNER/REPO/BRANCH/TOKEN come in via GitHubEnv
// (worker/github.ts); CLOUDFLARE_ACCOUNT_ID/PAGES_PROJECT/API_TOKEN come in
// via PagesEnv (worker/status.ts) -- each module owns the shape of the vars
// it actually reads, so there's one definition, not two that could drift.
export interface Env extends GitHubEnv, PagesEnv {
  KV: KVNamespace;
  ADMIN_PASSWORD_HASH: string;
  TOKEN_SECRET: string;
  // The Cloudflare Pages deploy hook URL the `scheduled` handler below
  // POSTs to. A Worker secret, not a wrangler.toml var, for the same reason
  // GITHUB_TOKEN is: anyone holding this URL can trigger a build (a minor
  // quota-exhaustion risk, not a data leak, but capability-bearing values
  // belong in secrets by this codebase's own convention regardless).
  DEPLOY_HOOK_URL: string;
}

// 7 days. Rotating ADMIN_PASSWORD_HASH alone does not invalidate a session
// token already issued under the old password -- a token's validity comes
// entirely from TOKEN_SECRET (see worker/auth.ts's verifyToken), not from
// whether the password that produced it is still current. Revoking an
// outstanding session requires rotating TOKEN_SECRET too; see
// docs/cloudflare-cutover.md.
const SESSION_SECONDS = 604_800;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  // IP-only limiting, checked before the request body is even read -- see
  // worker/ratelimit.ts for why this is KV rather than the Workers Rate
  // Limiting binding. `CF-Connecting-IP` is set by Cloudflare itself on
  // every request that reaches a Worker; unlike an arbitrary header, a
  // client cannot forge it to pin someone else's IP or dodge the limiter
  // for its own.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkLoginRate(env.KV, ip))) {
    return json(429, { message: 'Too many attempts. Try again in 15 minutes.' });
  }

  let password: unknown;
  try {
    const body: unknown = await request.json();
    password = (body as { password?: unknown } | null)?.password;
  } catch {
    return json(400, { message: 'Invalid request body.' });
  }

  if (typeof password !== 'string' || password.length === 0) {
    return json(400, { message: 'Password required.' });
  }

  // The supplied password is never logged, in any form, on any path below
  // -- not the plaintext, not a hash of it, whether the login succeeds or
  // fails.
  if (!(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await recordLoginFailure(env.KV, ip);
    return json(401, { message: 'Incorrect password.' });
  }

  await clearLoginFailures(env.KV, ip);

  // Checked here, not left for signToken to discover: `crypto.subtle`
  // rejects a zero-length HMAC key with an unhandled throw rather than a
  // clean failure (see worker/auth.ts's verifyToken for the same issue on
  // the read side). Without this, an operator who sets ADMIN_PASSWORD_HASH
  // but not TOKEN_SECRET yet -- entirely possible mid-setup, see
  // docs/cloudflare-cutover.md's Step 10 -- would type the correct
  // password and get a Cloudflare error page instead of the clean failure
  // the runbook promises.
  if (!env.TOKEN_SECRET) {
    return json(500, { message: 'Login is not configured.' });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = await signToken(env.TOKEN_SECRET, expiresAt);
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': `vb_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
    },
  });
}

// path -> filename, e.g. "src/content/dishes.json" -> "dishes.json". Hand
// rolled rather than imported from "node:path": validateContent (Task 2)
// keys its RULES table by bare filename, not by the full repo-relative path
// the dashboard sends, and pulling in a Node built-in for one string split
// isn't worth it in a Worker.
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// ---------------------------------------------------------------------------
// The scheduled-rebuild cron (Task 8 of the worker plan).
//
// Cloudflare Pages Free allows 500 builds/month. Every publish and every
// photo upload is its own git commit, and Cloudflare's own GitHub
// integration already builds on every push to GITHUB_BRANCH -- that part
// needs no code here at all. What that integration *cannot* do is build on
// a day nothing was pushed: a dish scheduled with a future `publishAt` is
// committed once, today, and then nothing commits again on the day it
// actually becomes due. That is the one gap this cron closes, and it is
// the *only* gap it closes -- an unconditional hourly hook would also
// rebuild on every one of the other 743 hours a month where nothing changed
// at all, which is what exhausts the 500-build quota around day 21 (see
// wrangler.toml's `[triggers]` comment).
//
// The three content files `isPublished`/`publishAt` apply to -- kept as a
// literal list, the same hand-maintained shape plugins/filter-unpublished.ts's
// own TARGET_SUFFIXES uses, and for the same reason: there is no compiler
// link from src/content/types.ts's `Schedulable` back to "these three
// files", so a fourth schedulable type would need this list updated too.
const SCHEDULABLE_CONTENT_FILES = new Set(['dishes.json', 'drinks.json', 'press.json']);

// One KV key holding BOTH the pending-dates record and the reconciliation
// marker (`lastReconciled`, see `reconcileScheduleFromSource` below) --
// deliberately one object, not two keys, so the cron's per-tick predicate
// (`anythingPublishesToday`) and the once-a-day decision "have I already
// reconciled today" can share a single KV read. A second key would mean
// every one of the ~23 daily "nothing due" ticks paid for two reads just to
// ask two related questions about the same piece of state.
const SCHEDULE_KV_KEY = 'schedule:pending-dates';

interface Schedule {
  // Each schedulable file's own most-recently-known list of still-future
  // `publishAt` dates, e.g. `{ "dishes.json": ["2026-09-01"], ... }`.
  files: Record<string, string[]>;
  // The IST date (YYYY-MM-DD) this record was last reconciled against
  // GitHub directly, or `null` if that has never happened. Compared against
  // `today` in `scheduled` below to run reconciliation at most once a day.
  lastReconciled: string | null;
}

function emptySchedule(): Schedule {
  return { files: {}, lastReconciled: null };
}

async function readSchedule(kv: KVNamespace): Promise<Schedule> {
  const raw = await kv.get(SCHEDULE_KV_KEY);
  if (!raw) return emptySchedule();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptySchedule();
    const obj = parsed as Record<string, unknown>;
    const files =
      obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)
        ? (obj.files as Record<string, string[]>)
        : {};
    const lastReconciled = typeof obj.lastReconciled === 'string' ? obj.lastReconciled : null;
    return { files, lastReconciled };
  } catch {
    // A corrupted or hand-edited KV value must not crash the cron or a
    // publish -- fail closed to "nothing known to be pending, never
    // reconciled", the same posture as an empty/missing key. Forcing a
    // reconciliation on the next tick (rather than trusting a value that
    // failed to parse) is itself the recovery path here.
    return emptySchedule();
  }
}

async function writeSchedule(kv: KVNamespace, schedule: Schedule): Promise<void> {
  await kv.put(SCHEDULE_KV_KEY, JSON.stringify(schedule));
}

// A single item's `publishAt` is "still pending" (not yet published, and
// worth tracking for the cron) when it parses as a real date strictly after
// `today`. `isPublished` throws on a malformed date -- `validateContent`
// (Task 2) has no rule for `publishAt`'s format at all, so a bad one really
// can reach here -- and that throw must cost only THIS item's date, not
// every other item's in the same file. An earlier version of this function
// let the throw propagate out of a bare `.filter()`, which aborted the
// whole file's slice over one bad date; confirmed by reproduction, fixed by
// moving the try/catch to per-item scope.
function isStillPending(publishAt: unknown, today: string): boolean {
  if (typeof publishAt !== 'string') return false;
  try {
    return !isPublished({ publishAt }, today);
  } catch {
    // Skipped, not tracked -- the malformed date still surfaces loudly at
    // build time (plugins/filter-unpublished.ts throws the same way, which
    // fails `npm run build` rather than shipping the bad item), just not
    // through this cron's bookkeeping.
    return false;
  }
}

// `!isPublished({ publishAt }, today)` (via `isStillPending`) -- not a bare
// `publishAt > today` -- is what makes this the one place besides the Vite
// plugin that consumes `isPublished` itself, and is deliberate rather than
// equivalent-by-luck: it reuses the exact same "is this item live yet"
// definition the Vite plugin filters the production bundle with, so this
// record can never disagree with what actually ships. Only dates that are
// NOT YET published are worth tracking here -- an item whose publishAt is
// today or already past is already covered by the commit that just landed
// (Cloudflare's own build-on-push already handles it), so tracking it too
// would just be a second, redundant source of "is it due".
function futurePublishAtDates(items: unknown[], today: string): string[] {
  const dates = items
    .filter((item): item is { publishAt?: unknown } => typeof item === 'object' && item !== null)
    .map((item) => item.publishAt)
    .filter((d): d is string => isStillPending(d, today));
  return Array.from(new Set(dates)).sort();
}

// Called from handlePublish, after a successful commit, once per published
// file, SEQUENTIALLY (see the `for...of` in handlePublish below, not
// `Promise.all`). Replaces -- does not merge with -- that one file's own
// slice of the schedule record, so an edit that removes or reschedules an
// item is reflected immediately rather than leaving a stale date behind
// forever. The other files' slices are left exactly as they were last
// recorded, which is the best information available without an extra
// GitHub read for files this publish didn't touch.
//
// MUST be awaited one call at a time, never concurrently, against this
// single KV key: two files published in the same request each do their own
// read-modify-write, and running them concurrently is a classic lost
// update -- confirmed by reproduction with the previous `Promise.all`
// version: publishing dishes.json and drinks.json together left only
// whichever file's write landed last in KV, silently losing the other
// file's schedule entirely.
async function recordScheduledDates(env: Env, path: string, parsed: unknown, today: string): Promise<void> {
  const file = basename(path);
  if (!SCHEDULABLE_CONTENT_FILES.has(file) || !Array.isArray(parsed)) return;
  const schedule = await readSchedule(env.KV);
  schedule.files[file] = futurePublishAtDates(parsed, today);
  await writeSchedule(env.KV, schedule);
}

// Pure: does this schedule have anything due by `today`? Split out from
// `anythingPublishesToday` below so `scheduled` can re-check it against an
// in-memory `Schedule` (e.g. right after reconciling) without a second KV
// read.
//
// `d <= today`, not `d === today`: catch-up matters here as much as it does
// for `isPublished` itself. If a cron tick is ever missed on a date's exact
// day -- Cloudflare Cron Trigger downtime, or DEPLOY_HOOK_URL rotated to a
// bad value for a stretch -- the next tick that actually runs must still
// treat that now-past date as due, not silently skip it forever because
// "today" has since moved on. `clearDueDates` below already drops every
// date `<= today` once the hook fires, which is exactly the set this check
// needs to agree with -- using `===` here while that uses `<=` would leave
// a permanently-missed date sitting inert in the schedule with nothing ever
// asking about it again.
function anythingDueIn(schedule: Schedule, today: string): boolean {
  return Object.values(schedule.files).some((dates) => dates.some((d) => d <= today));
}

// The cron's own predicate, and the one exported for direct testing: is
// anything due to be live by today, as far as the schedule record knows?
// One KV read, regardless of how many files or dates are tracked --
// deliberately cheap enough to run every hour without it mattering, unlike
// the thing it's guarding: a Pages build. (`scheduled` itself below does
// NOT call this -- it calls `readSchedule` once and reuses that same value
// for both this check and, on reconciliation ticks, the re-check after --
// this wrapper exists so callers outside `scheduled`, including this
// file's own tests, still have a one-read, single-call way to ask.)
export async function anythingPublishesToday(env: Env, today: string): Promise<boolean> {
  return anythingDueIn(await readSchedule(env.KV), today);
}

// After the deploy hook has actually fired successfully for `today`, drop
// every date `<= today` from every file's slice -- otherwise the next
// hourly tick, still the same day, would see the same date still sitting in
// the schedule and fire the hook again, and again, once per remaining hour
// in the day. Only called from the "something is due" branch of `scheduled`
// below, never from `anythingPublishesToday` itself: if the fetch to
// DEPLOY_HOOK_URL fails, the date must NOT be cleared, or a genuinely failed
// attempt would never be retried on the next tick.
//
// Also stamps `lastReconciled = today`, unconditionally. Reasoned through,
// not incidental: `plugins/filter-unpublished.ts` filters at BUILD time by
// comparing each item's `publishAt` against the wall clock directly, not
// against anything in this KV record -- so the build the hook above just
// triggered will ship EVERY currently-due item on `main`, including any
// hand-committed one `reconcileScheduleFromSource` might otherwise have
// discovered, whether or not this schedule record ever knew about it.
// Leaving `lastReconciled` untouched here was confirmed to cause exactly
// the failure mode this whole feature exists to avoid: the very next tick,
// finding nothing due (this file's own dates having just been cleared) and
// `lastReconciled` still not today, immediately re-triggered a reconciliation
// attempt for no benefit -- three pointless GitHub reads on a day a build
// had already just happened.
async function clearDueDates(env: Env, today: string): Promise<void> {
  const schedule = await readSchedule(env.KV);
  for (const file of Object.keys(schedule.files)) {
    schedule.files[file] = schedule.files[file].filter((d) => d > today);
  }
  schedule.lastReconciled = today;
  await writeSchedule(env.KV, schedule);
}

// Once a day (gated on `schedule.lastReconciled`, part of the same KV value
// `scheduled` already read this tick -- no second read spent deciding
// whether to run this), re-derive the schedule record from GitHub directly
// rather than trusting only what `recordScheduledDates` has ever recorded.
// Closes three gaps a purely publish-driven record cannot:
//  1. Content that reached `main` by any route OTHER than POST /api/publish
//     -- a direct commit, the GitHub web UI, a revert -- never runs through
//     recordScheduledDates at all, so a hand-committed future `publishAt`
//     would otherwise be invisible to this cron forever. (Confirmed this is
//     not a hypothetical for this repository: every dish in
//     src/content/dishes.json today arrived by hand commit, not through
//     this Worker.)
//  2. A brand new KV namespace -- freshly created, e.g. the moment
//     wrangler.toml's placeholder KV id is finally replaced with a real one
//     -- starts with no memory at all of anything already committed before
//     the Worker was first deployed.
//  3. `isStillPending`'s per-item try/catch (above) already stops one
//     malformed `publishAt` from losing every other item's date in the same
//     publish; this is the second, independent backstop for the same class
//     of gap, since it re-derives from source rather than trusting whatever
//     the last publish happened to record.
//
// Preserves (does not discard) whatever's already recorded for any file
// this read fails on -- a transient GitHub error must not make
// reconciliation WORSE than not running it at all by wiping a known-good
// slice down to nothing; it just means that one file goes uncorrected until
// tomorrow's attempt.
//
// Cost: up to 3 extra GitHub reads, once a day (~93/month) -- not once an
// hour. The other ~23 daily ticks never call this at all (see `scheduled`
// below), so the "one KV read" cost `anythingPublishesToday` promises on
// the common path stays true.
//
// Deliberately does NOT itself trigger a build, and `scheduled` below does
// NOT re-check "is anything due" against this call's result. Reasoned
// through, not an oversight: this only ever stores dates that are STILL
// STRICTLY FUTURE (`futurePublishAtDates`/`isStillPending`, same as
// `recordScheduledDates` uses), by construction -- an earlier version of
// this function's caller re-checked `anythingDueIn` on the freshly
// reconciled record expecting it could now be due, which is impossible: if
// nothing was due when `scheduled` checked (the precondition for calling
// this at all), and this only ever adds entries `> today`, the result can
// never contain anything `<= today` either. That recheck was dead code
// with a comment claiming behavior that could not happen; removed rather
// than left in place. The real, closed loop is one tick later: once a
// tracked future date's day arrives, the ordinary `anythingDueIn` check at
// the top of the NEXT tick finds it `<= today` and fires normally -- no
// different from a date `recordScheduledDates` tracked directly.
//
// Known, accepted residual gap this leaves open (not silently -- recorded
// here): an item hand-committed with a `publishAt` that is ALREADY in the
// past the very first time reconciliation ever reads that file will not be
// tracked at all (it fails `isStillPending`, the same as any already-due
// item does) and will not, by itself, trigger a rebuild. It still goes
// live at the next rebuild triggered for any other reason -- a regular
// publish, or a different item's date coming due -- exactly as if this
// reconciliation didn't exist. Closing that fully would require detecting
// "an item is due AND was not already known to be due", which needs
// tracking already-seen overdue items to avoid re-firing forever on every
// item that has ever gone live -- real complexity this task's brief did
// not ask for and that a same-tick "just fire if anything's <= today" check
// would get wrong (it would fire on EVERY reconciliation tick, forever, the
// moment any content has ever had a past `publishAt`).
async function reconcileScheduleFromSource(env: Env, schedule: Schedule, today: string): Promise<void> {
  const files: Record<string, string[]> = { ...schedule.files };
  for (const file of SCHEDULABLE_CONTENT_FILES) {
    try {
      const raw = await getFileContent(env, `src/content/${file}`);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      files[file] = futurePublishAtDates(parsed, today);
    } catch {
      // Leaves `files[file]` exactly as it already was -- see this
      // function's own comment above for why that, not clearing it, is the
      // safe default on a read failure.
    }
  }
  await writeSchedule(env.KV, { files, lastReconciled: today });
}
// ---------------------------------------------------------------------------

function isPublishFile(value: unknown): value is CommitFile {
  if (!value || typeof value !== 'object') return false;
  const { path, content, encoding } = value as Record<string, unknown>;
  return typeof path === 'string' && typeof content === 'string' && (encoding === 'utf-8' || encoding === 'base64');
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  // 1. Verify token -- first, and unconditionally. Nothing below this line
  // runs for an unauthenticated request, which in particular means no
  // GitHub call of any kind: a bad or missing session cookie can't spend
  // any of the N+5 subrequests a real publish costs (see github.ts), let
  // alone write anything.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  // 2. Parse. A malformed envelope (not JSON, no `files` array, a file
  // missing `path`/`content`/`encoding`) is a clean 400 here -- distinct
  // from step 3 below, which is about the *content* of otherwise
  // well-formed files.
  let files: CommitFile[];
  let message: string;
  try {
    const body: unknown = await request.json();
    const rawFiles = (body as { files?: unknown } | null)?.files;
    if (!Array.isArray(rawFiles) || rawFiles.length === 0 || !rawFiles.every(isPublishFile)) {
      return json(400, { message: 'No files to publish.' });
    }
    files = rawFiles;
    // Security review Minor 1: two entries for the same path produce two
    // blobs and two tree entries with the same path; GitHub's tree API
    // keeps the *last* one, not both, so she'd silently get one of two
    // edits she believed were both applied, with no error anywhere. Checked
    // here, in the same "malformed envelope" step as the array-shape check
    // above -- a request naming one path twice is malformed the same way a
    // request missing `path` is, before content validation is ever reached.
    if (new Set(files.map((f) => f.path)).size !== files.length) {
      return json(400, { message: 'The same file was sent twice.' });
    }
    const rawMessage = (body as { message?: unknown } | null)?.message;
    message = typeof rawMessage === 'string' && rawMessage.trim().length > 0 ? rawMessage : 'Update site content';
  } catch {
    return json(400, { message: 'Invalid request body.' });
  }

  // 3. Validate every file before committing any of them. `validateContent`
  // (Task 2) never throws, but `JSON.parse` on her submitted content -- not
  // on the request envelope parsed in step 2 -- can, and this try/catch is
  // what keeps a malformed file body from becoming a 500 reading "something
  // went wrong" one line before the function whose entire contract is
  // "never throws".
  const problems: ValidationProblem[] = files.flatMap((f) => {
    // `encoding` is client-supplied. A security review found that labelling
    // any file `'base64'` -- including one whose *path* is a `.json` file
    // under src/content/ -- skipped validateContent entirely: this used to
    // be a bare `if (f.encoding !== 'utf-8') return [];` with no exception,
    // so a request could opt a content file out of validation just by
    // mislabelling its own encoding. A `.json` path always gets checked
    // regardless of what `encoding` claims; only a genuinely non-JSON path
    // (an image under assets-source/) is exempt from JSON parsing here.
    if (f.encoding !== 'utf-8') {
      return f.path.endsWith('.json') ? [{ field: f.path, message: 'This file must be sent as text.' }] : [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.content);
    } catch {
      return [{ field: f.path, message: 'This file is not valid JSON.' }];
    }
    return validateContent(basename(f.path), parsed);
  });
  if (problems.length) return json(422, { problems });

  // 4. Commit only if every file passed. commitFiles carries its own,
  // independent path allowlist (worker/github.ts) -- so a request that
  // somehow reached this point with a path outside src/content/ or
  // assets-source/ still can't make it to GitHub.
  try {
    const { sha } = await commitFiles(env, files, message);

    // 5. Best-effort schedule bookkeeping for the cron (Task 8). The commit
    // has already landed -- nothing below this line may turn this response
    // into anything other than the 200 the publish itself earned, so every
    // step is wrapped to swallow its own failure rather than throw into the
    // response. Re-parses `f.content` rather than threading step 3's
    // already-parsed value down here: that value lives inside the `flatMap`
    // callback above and validateContent's own default-deny already proved
    // it round-trips JSON.parse cleanly for every `.json` file that reached
    // this point without a problem.
    //
    // A plain `for...of` with `await` inside, NOT `files.map(...)` +
    // `Promise.all` -- `recordScheduledDates` is a read-modify-write against
    // one shared KV key, and running two of them concurrently is a lost
    // update: reproduced directly with the `Promise.all` version this
    // replaced, publishing dishes.json and drinks.json together in one
    // request left only whichever file's write happened to land last in KV,
    // silently discarding the other file's schedule. Sequential awaits make
    // each file's read-modify-write finish before the next one starts.
    const today = todayInKolkata();
    for (const f of files.filter((f) => f.encoding === 'utf-8' && f.path.endsWith('.json'))) {
      try {
        const parsed: unknown = JSON.parse(f.content);
        await recordScheduledDates(env, f.path, parsed, today);
      } catch {
        // Never lets schedule bookkeeping fail a publish that already
        // succeeded on GitHub -- worst case, the cron's own record of
        // upcoming dates for this one file goes stale until the next
        // successful publish of it (or the next daily reconciliation).
      }
    }

    return json(200, { sha });
  } catch (error) {
    // A disallowed path is a client mistake, not a GitHub failure -- give it
    // its own 400 rather than falling into the generic 502 below, which
    // would misdirect diagnosis toward "GitHub is broken".
    if (error instanceof DisallowedPathError) {
      return json(400, { message: error.message });
    }
    return json(502, { message: error instanceof Error ? error.message : 'Publish failed.' });
  }
}

// ---------------------------------------------------------------------------
// POST/GET /api/wa -- server-side tap counter for the "Reserve a Table"
// button (Task 10 of the worker plan). Cloudflare's free Web Analytics has
// no custom-event API -- verified by downloading the real beacon and
// finding zero occurrences of `trackEvent`, after a client-side attempt to
// wire one up had already been built -- so this Worker is the only place
// that can count the one action on this site that turns into revenue.
//
// Unauthenticated by design: src/components/Hero.tsx fires
// `navigator.sendBeacon('/api/wa')` on every click, same-origin, with no
// session cookie involved (a visitor reserving a table has never logged
// in). That makes POST the one route on this Worker anyone on the internet
// can call directly, with no proof they ever saw the button -- so unlike
// every other route here, its whole job is surviving abuse rather than
// trusting a session:
//   1. Origin must match the site's own origin exactly. A same-origin
//      sendBeacon call always carries this header (the Fetch spec sets
//      `Origin` on every non-GET/HEAD request, same-origin or not, which is
//      also why this check works at all without CORS being involved); a
//      missing or mismatched Origin cannot be this page.
//   2. Rate-limited by IP, the way login is -- reusing worker/ratelimit.ts's
//      generic checkRate/recordHit rather than a second hand-rolled
//      limiter, with this route's own, more generous policy: an
//      unauthenticated public button a real visitor might legitimately tap
//      more than once is a different threat model than a password guess.
//   3. A daily write cap, because KV Free allows only 1,000 writes/day
//      *shared across this entire namespace* -- including login's own
//      rate-limit bookkeeping (worker/ratelimit.ts). `while true; do curl -X
//      POST .../api/wa; done` from a single IP is already stopped almost
//      immediately by (2); this cap is the backstop against inflating the
//      number she makes decisions on and exhausting the day's KV write
//      quota -- which would silently disable login rate limiting too --
//      from any angle (2) doesn't cover, at the cost of the count itself
//      simply stopping for the rest of the day rather than the route
//      failing.
//
// Storage is deliberately minimal: ONE KV key (WA_COUNTS_KV_KEY) holding
// `{ "<IST date>": <count> }` and nothing else -- no IP, no user agent, no
// timestamp beyond the date. There is no consent banner on this site and
// none should be needed for that shape of data.
//
// The rate limiter's own per-IP keys (`wa:<ip>`, worker/ratelimit.ts) are a
// separate thing from that count and not an exception to it: they hold a
// short-lived hit counter with a 60-second TTL for abuse prevention, the
// same mechanism -- and the same non-permanence -- login's own `login:<ip>`
// keys already use, not a record kept about who tapped the button.
//
// The number this produces is a LOWER BOUND, not a count: capped,
// origin-checked, best-effort -- a request that fails validation, gets
// rate-limited, or lands after the daily cap is never counted, and
// sendBeacon itself is fire-and-forget, so a dropped request is invisible
// to both the client and this route. GET's response says so explicitly, in
// `lowerBound`, rather than implying a precision this number does not have.
// Plan 4's dashboard must carry that same caveat into its copy, not just
// this response shape -- and must show this number as an estimate, not a
// count.
// ---------------------------------------------------------------------------

const WA_ORIGIN = 'https://viabiancadelhi.com';
const WA_RATE_MAX = 20;
const WA_RATE_WINDOW_SECONDS = 60;
// Comfortably under KV Free's 1,000 writes/day cap for the WHOLE
// namespace, not just this key -- leaving headroom for every other write
// this Worker makes against the same KV binding (login's own rate-limit
// bookkeeping chief among them; see the file comment above). Exported so
// count.test.ts can seed a fake KV at exactly this value rather than
// looping a few hundred real requests to reach it.
export const WA_DAILY_CAP = 500;
const WA_COUNTS_KV_KEY = 'wa:counts';

function waRateKeyFor(ip: string): string {
  return `wa:${ip}`;
}

// Never throws: a corrupted or hand-edited KV value must not crash this
// route -- fail closed to "nothing recorded yet", the same posture
// readSchedule (above) takes on its own malformed KV value. Silently drops
// any entry whose value isn't a finite number rather than propagating a
// bad one forward -- the only way a non-numeric value could exist here is
// hand-editing this key directly, since every write below only ever stores
// `previous + 1`.
async function readWaCounts(kv: KVNamespace): Promise<Record<string, number>> {
  const raw = await kv.get(WA_COUNTS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) counts[date] = value;
    }
    return counts;
  } catch {
    return {};
  }
}

async function handleRecordWaTap(request: Request, env: Env): Promise<Response> {
  // Origin first, before any KV is even read -- see the file comment above
  // for why this is the one route on this Worker that needs it at all.
  if (request.headers.get('Origin') !== WA_ORIGIN) {
    return json(403, { message: 'Not allowed.' });
  }

  // Same CF-Connecting-IP-based limiter login uses (worker/ratelimit.ts),
  // with this route's own key prefix and its own, more generous policy --
  // see the file comment above for why the two routes' thresholds differ.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkRate(env.KV, waRateKeyFor(ip), WA_RATE_MAX))) {
    return json(429, { message: 'Too many requests.' });
  }
  await recordHit(env.KV, waRateKeyFor(ip), WA_RATE_WINDOW_SECONDS);

  const today = todayInKolkata();
  const counts = await readWaCounts(env.KV);
  const todayCount = counts[today] ?? 0;
  // Stops writing once the daily cap is reached -- see the file comment
  // above for the KV Free quota this protects. The response is 204 either
  // way: sendBeacon never reads it, and a uniform response gives a caller
  // probing this endpoint no signal about whether the cap has been hit.
  if (todayCount < WA_DAILY_CAP) {
    counts[today] = todayCount + 1;
    await env.KV.put(WA_COUNTS_KV_KEY, JSON.stringify(counts));
  }

  return new Response(null, { status: 204 });
}

async function handleReadWaCounts(request: Request, env: Env): Promise<Response> {
  // Same auth gate as every other admin route (handlePublish,
  // handleBuildStatus) -- a session cookie, verified, before the counts are
  // ever read. Unlike POST above, this side is not meant for the general
  // public: it is the number Plan 4's dashboard shows her, not a beacon
  // target a browser fires blind.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  const counts = await readWaCounts(env.KV);
  // `lowerBound: true`, always -- see the file comment above for why this
  // number can never be presented as an exact count.
  return json(200, { counts, lowerBound: true });
}
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Unauthenticated by design and reveals nothing (no version, no commit
    // sha, no env var, no account/zone detail) -- its only job is letting a
    // human confirm the Worker route is actually live rather than the
    // request having silently fallen through to the Pages SPA catch-all.
    // public/_redirects cannot express that check itself (Cloudflare Pages'
    // _redirects only accepts a handful of status codes, none of which can
    // signal "this path is unrouted" -- see that file's own comment), so
    // this is the endpoint docs/cloudflare-cutover.md's deploy-time curl
    // check hits: `text/html` back means the SPA answered instead of this
    // Worker, `application/json` means the route is working.
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/api/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    if (url.pathname === '/api/build-status' && request.method === 'GET') {
      return handleBuildStatus(request, env);
    }

    if (url.pathname === '/api/wa' && request.method === 'POST') {
      return handleRecordWaTap(request, env);
    }

    if (url.pathname === '/api/wa' && request.method === 'GET') {
      return handleReadWaCounts(request, env);
    }

    return new Response('Not found', { status: 404 });
  },

  // Cloudflare Cron Trigger, `[triggers].crons` in wrangler.toml -- runs
  // hourly, but only actually rebuilds the site when today is a date some
  // already-published content is waiting on (see `anythingPublishesToday`
  // above). No `ctx` parameter: unlike a `fetch` handler racing the
  // response against the runtime tearing the isolate down, this handler
  // `await`s everything it does before returning, so there is nothing left
  // to keep alive with `ctx.waitUntil` -- the same reason `fetch` above
  // never takes one either.
  //
  // Reads the schedule record exactly ONCE per tick (`readSchedule` below),
  // not via the `anythingPublishesToday` wrapper -- that wrapper does its
  // own read, and calling it here as well as calling
  // `reconcileScheduleFromSource` (which needs the same value) would spend
  // a second KV read on every single tick just to decide whether today's
  // once-a-day reconciliation is due. Sharing one in-memory `Schedule`
  // across both checks keeps the ~23 "nothing due, already reconciled
  // today" ticks at exactly the one read `anythingPublishesToday`'s own
  // comment promises; only the reconciliation tick itself pays extra, and
  // only in GitHub reads, not KV ones.
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const today = todayInKolkata();
    const schedule = await readSchedule(env.KV);
    const due = anythingDueIn(schedule, today);

    if (!due) {
      // At most once a day: refresh the future-dates record from GitHub
      // directly, so a hand-committed future `publishAt` this record never
      // learned about gets picked up before its own day arrives. See
      // reconcileScheduleFromSource's own comment for exactly what this
      // closes -- and, importantly, what it deliberately does not: this
      // call cannot itself make `due` become true this tick (it only ever
      // stores dates that are still strictly in the future), so there is
      // nothing to re-check here. A newly tracked date fires normally on
      // whichever later tick its own day arrives.
      if (schedule.lastReconciled !== today) {
        await reconcileScheduleFromSource(env, schedule, today);
      }
      return;
    }

    const res = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
    if (!res.ok) {
      // Surfaced, not swallowed: a scheduled handler that throws is recorded
      // as a failed cron invocation in the Cloudflare dashboard (and retried
      // per Cloudflare's own cron-retry policy), which is the only signal
      // anyone gets that an automated rebuild didn't happen -- there is no
      // dashboard polling this specific failure the way build-status polls
      // a publish. Swallowing it here would silently recreate exactly the
      // "her work evaporates" failure mode this whole task exists to close,
      // just for scheduled content instead of a manual publish.
      throw new Error(`deploy hook failed: Cloudflare returned ${res.status}`);
    }

    // Only reached once the hook has actually been accepted -- see
    // clearDueDates's own comment for why a failed fetch above must leave
    // today's date(s) in place for the next hourly retry instead.
    await clearDueDates(env, today);
  },
};
