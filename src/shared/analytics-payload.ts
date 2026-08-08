// The body of GET /api/analytics: what the Worker produces and what the
// dashboard's Numbers screen renders.
//
// ONE module, shared by both sides, because the alternative is two
// declarations of the same shape drifting apart until the first integration
// is a rewrite. `worker/` already imports from `src/shared/` (base64,
// image-format, derivative-path, upload-categories) and nothing in `src/`
// imports `worker/`, so this keeps that one-way boundary intact.
//
// TYPE-ONLY plus one constant. Nothing here runs on a request path; the
// constant is the launch state and is used as a fixture by both sides.
//
// PROVENANCE, recorded honestly. worker/analytics.ts landed first, under an
// instruction not to touch anything outside `worker/`, and declared these
// shapes itself with a note saying they should move here. They are copied
// here verbatim rather than rewritten, and
// `src/shared/__tests__/analytics-payload.test.ts` compares the two so a
// change to either side that is not made to both is red -- until the Worker
// stream imports this module and deletes its copy, at which point that guard
// notices and says so.

// Which of Card C's four buckets a referring host fell into. `kind` is the
// machine value the UI switches on; `label` is the words the spec fixes,
// kept beside it so the Worker's bucketing and the screen's wording cannot
// disagree about what a bucket IS. `host` is set only for `other`, where the
// card shows the real hostname in smaller text under "Other links".
export type RefererBucketKind = 'direct' | 'instagram' | 'google' | 'other';

export interface AnalyticsRefererBucket {
  kind: RefererBucketKind;
  label: string;
  host: string | null;
  visits: number;
}

export interface AnalyticsPathRow {
  // Already normalised: no query string, no trailing slash except for `/`
  // itself. Deliberately NOT translated into a page name here -- that is
  // `labelForPath` on the dashboard, which has pages.json to hand and is a
  // pure function with its own table test.
  path: string;
  visits: number;
}

export interface AnalyticsPayload {
  // 28. Stated in the body rather than assumed by the reader, because every
  // number below is scoped to it and the card copy quotes it.
  windowDays: number;
  // An ESTIMATE. `rumPageloadEventsAdaptiveGroups` is an adaptive, sampled
  // dataset, which is why Card A reads "about 4,100 visits" and not "4,100".
  visits: number;
  visitsAreEstimate: true;
  byPath: AnalyticsPathRow[];
  byReferer: AnalyticsRefererBucket[];
  thisWeekVisits: number;
  priorWeekVisits: number;
  // A LOWER BOUND, not a count -- origin-checked, rate-limited, capped per
  // day and delivered by fire-and-forget sendBeacon (see worker/index.ts's
  // /api/wa file comment). `lowerBound` is in the body, not just in a
  // comment, so the dashboard cannot forget: the card says "at least 41
  // tapped Reserve a Table", never "41 bookings".
  bookingTaps: { total: number; days: number; lowerBound: true };
}

export type AnalyticsFailureReason = 'unreachable' | 'upstream-auth' | 'upstream-error';

export interface AnalyticsError {
  reason: AnalyticsFailureReason;
  message: string;
}

// The launch state, and the fixture both sides test against. Every count is
// zero and every list is empty -- which is what "the beacon shipped
// yesterday" looks like, and is NOT an error. That distinction is the whole
// reason the failure bodies above carry a `reason` instead of the route
// answering 200-with-nothing for both.
export const ZERO_DATA_PAYLOAD: AnalyticsPayload = {
  windowDays: 28,
  visits: 0,
  visitsAreEstimate: true,
  byPath: [],
  byReferer: [],
  thisWeekVisits: 0,
  priorWeekVisits: 0,
  bookingTaps: { total: 0, days: 28, lowerBound: true },
};
