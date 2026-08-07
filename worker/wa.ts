// The one KV key behind the "Reserve a Table" tap counter, and the only
// function that reads it.
//
// Extracted from worker/index.ts (where it lived as two module-private
// declarations next to handleRecordWaTap) for exactly one reason: a SECOND
// reader now exists. worker/analytics.ts needs the same counts for the
// dashboard's "how many tapped Reserve a Table?" card, and the two ways of
// getting there without this file are both worse -- copying the key string
// and the parse guard into a second module is two things to keep in step,
// and exporting them ad hoc from index.ts would make index.ts and
// analytics.ts import each other in a circle (index.ts already imports
// handleAnalytics).
//
// The bodies below are the ones that were in index.ts, moved unchanged. The
// whole existing GET/POST /api/wa suite (worker/__tests__/count.test.ts)
// passes against them with no edit to that file, which is what makes this a
// move rather than a rewrite.
//
// What is deliberately NOT here: WA_DAILY_CAP, WA_RATE_MAX,
// WA_RATE_WINDOW_SECONDS and waRateKeyFor. Those belong to the WRITE path,
// which has exactly one caller and no reason to be shared -- moving them
// would widen this module from "the shape of the stored value" to "the whole
// tap-counting route", and worker/__tests__/count.test.ts imports
// WA_DAILY_CAP from index.ts today.

// `{ "<IST date>": <count> }` and nothing else -- no IP, no user agent, no
// timestamp beyond the date. See worker/index.ts's file comment on the
// /api/wa routes for why the stored shape is this minimal and why the number
// it produces is a lower bound rather than a count.
export const WA_COUNTS_KV_KEY = 'wa:counts';

// Never throws: a corrupted or hand-edited KV value must not crash this
// route -- fail closed to "nothing recorded yet" rather than propagating a
// parse error into a visitor-facing beacon response. Silently drops
// any entry whose value isn't a finite number rather than propagating a
// bad one forward -- the only way a non-numeric value could exist here is
// hand-editing this key directly, since every write below only ever stores
// `previous + 1`.
export async function readWaCounts(kv: KVNamespace): Promise<Record<string, number>> {
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
