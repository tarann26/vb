// The one write path this site's PUBLIC pages have, guarded the way
// POST /api/wa already is: origin-checked, rate limited per address, capped
// per day, and incapable of delaying a page.
//
// THE BUDGET, derived rather than assumed. An accepted arrival costs THREE D1
// row writes: one limiter row, one daily-cap row, one arrival row. A refused
// one costs one or two. Worst case is 3 * CAMPAIGN_DAILY_CAP = 6,000 rows a
// day against D1 Free's 100,000 -- six per cent, on a restaurant site that
// would have to be taking thousands of tagged visits a day to reach it.
//
// NOT KV, and that is the whole reason campaign_rate exists. KV Free allows
// 1,000 writes a day across the entire namespace and roughly 800 are already
// committed to the login counter, the three rate-limited admin routes and the
// tap counter. A public write path cannot borrow headroom that is not there.
//
// AND NOT AN ADDRESS IN A COLUMN. The spec's "It does not record who" is not
// negotiable, so the limiter's key is a truncated SHA-256 of the address, the
// window number and a committed salt: it cannot be reversed without the
// address, it cannot be linked across windows (the window is inside the
// hash), and the row is DELETED when it expires. What that gives up, stated:
// nobody can ever ask this counter which address was busy. Nothing needs to.
//
// UNAUTHENTICATED, deliberately, exactly like POST /api/wa: the person
// arriving through her Instagram link is a diner, not the owner.
import { CAMPAIGN_LABELS, normalizeSource } from '../src/shared/campaign-sources';
import { todayInKolkata } from '../src/shared/date';
import { sha256Hex } from './d1';
import { campaignTotals, recordArrival, takeRateSlot } from './analytics-store';
import type { AnalyticsCampaignRow } from '../src/shared/analytics-payload';
import type { D1Database } from '@cloudflare/workers-types';

// Ten a minute per address. A person arrives through a tagged link once; ten
// is generous enough that a shared office address never trips it and tight
// enough that one machine cannot fill the day's cap alone.
export const CAMPAIGN_RATE_MAX = 10;
export const CAMPAIGN_RATE_WINDOW_SECONDS = 60;

// Accepted arrivals per IST day. Above this the route answers 204 -- the SAME
// answer success gives, so a prober learns nothing about whether the cap was
// reached.
export const CAMPAIGN_DAILY_CAP = 2000;

// Not a secret and not pretending to be one: it is a domain separator, so a
// bucket string from this counter cannot be matched against a hash computed
// anywhere else. The address is already gone by the time anything is stored.
const BUCKET_SALT = 'vb:campaign:bucket:v1';

export interface CampaignEnv {
  DB: D1Database;
}

// The same one-liner worker/index.ts's own siteOriginOf is, restated here
// rather than imported, because worker/index.ts imports THIS module and a
// cycle between them is a real hazard in a Worker bundle.
//
// Derived from the request rather than hardcoded: a hardcoded literal
// pointing at a domain this site no longer used silently answered every real
// sendBeacon 403 and pinned the tap counter at zero for as long as it was
// deployed. `Origin` is set by the browser, not by the page, so a cross-site
// caller still cannot present this value.
function siteOriginOf(request: Request): string {
  return new URL(request.url).origin;
}

async function bucketFor(ip: string, window: number): Promise<string> {
  return `r:${(await sha256Hex(`${BUCKET_SALT}:${ip}:${String(window)}`)).slice(0, 24)}`;
}

export async function handleCampaignArrival(request: Request, env: CampaignEnv): Promise<Response> {
  // Origin first, before any storage is touched at all.
  if (request.headers.get('Origin') !== siteOriginOf(request)) {
    return new Response(null, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { source?: unknown } | null;
  const raw = typeof body?.source === 'string' ? body.source : '';
  if (raw === '') return new Response(null, { status: 204 });
  // Normalised HERE as well as in the browser, because the browser is not a
  // guard. This is what actually bounds the column.
  const source = normalizeSource(raw);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const window = Math.floor(nowSeconds / CAMPAIGN_RATE_WINDOW_SECONDS);
  const day = todayInKolkata();

  // The per-address bucket first, the daily cap second, both the same
  // statement shape so the cost is symmetric and a refused request never
  // reaches the arrival insert.
  //
  // BOTH BUCKETS NAME THEIR WINDOW -- the hash carries the window number, the
  // cap carries the IST date -- and takeRateSlot has nothing else to reset
  // on. Dropping the window from either bucket turns that limit into a
  // permanent ban. The `expires` argument is only the row's lifetime for the
  // nightly prune; it is not what decides a window.
  const underRate = await takeRateSlot(
    env.DB,
    await bucketFor(ip, window),
    CAMPAIGN_RATE_MAX,
    nowSeconds + CAMPAIGN_RATE_WINDOW_SECONDS,
  ).catch(() => false);
  if (!underRate) return new Response(null, { status: 204 });

  const underCap = await takeRateSlot(env.DB, `day:${day}`, CAMPAIGN_DAILY_CAP, nowSeconds + 172_800).catch(
    () => false,
  );
  if (!underCap) return new Response(null, { status: 204 });

  try {
    await recordArrival(env.DB, source, day, nowSeconds);
  } catch {
    // Best effort, exactly like the tap counter's own write. The visitor has
    // already arrived and is already reading the page; losing one row is a
    // smaller cost than any behaviour that could delay or break that, and an
    // unhandled rejection in a Worker is a 500 in a log nobody reads.
  }

  // 204 whether it was written, capped, refused or lost, deliberately: the
  // browser never reads this response, so a distinct status tells a prober
  // something and tells the visitor nothing.
  return new Response(null, { status: 204 });
}

// The READ half, for the panel's campaign card.
//
// NEVER THROWS. A D1 failure here degrades the campaign card to empty and
// leaves the six cards that have nothing to do with D1 alone -- the same
// contract readWaCounts already keeps for the tap number, and for the same
// reason: one storage failure must not take a screen down. The catch lives
// HERE and not in analytics-store.ts, because "what a failure costs" is a
// decision per caller and the nightly job makes the opposite one.
export async function readCampaignRows(db: D1Database, sinceDay: string): Promise<AnalyticsCampaignRow[]> {
  try {
    const totals = await campaignTotals(db, sinceDay);
    return totals.map((row) => ({
      source: row.source,
      // Falls back to the raw source rather than hiding a row whose label is
      // missing. A source string in the table this Worker has no words for is
      // a deploy that half-landed, and showing it is how that becomes visible
      // instead of becoming a missing row.
      label: CAMPAIGN_LABELS[row.source] ?? row.source,
      arrivals: row.arrivals,
    }));
  } catch {
    return [];
  }
}
