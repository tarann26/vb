// What Cloudflare's RUM dataset actually answers, established by running the
// document rather than by reading documentation about it. The evidence is in
// docs/analytics-schema-verification.md (the introspected dimension list, the
// requests, the responses, the verdict); this file is the same answer in a
// shape tsc can read.
//
// The two dimension names are SPELLINGS READ OFF AN INTROSPECTION REPLY, not
// names somebody remembered. `dimensions` carries the whole list the reply
// gave, because that is what makes the two names above checkable by a reader
// who was not there.
//
// Three tasks branch on this and none of them may guess: Task 13 (whether
// the trend chart backfills), Task 15 (whether the busiest-times chart
// exists at all), Task 21 (whether it is drawn). Setting a value here from
// anything other than a real probe run reintroduces the exact defect this
// file closes.
export interface RumCapabilities {
  /** ISO date the probe was actually run. Not the day it was written. */
  verifiedOn: string;
  /** True only if the exact document in worker/analytics.ts returned data with no errors[]. */
  baseDocumentAccepted: boolean;
  /**
   * WHICH document that was: sha256 of the ANALYTICS_QUERY text the probe
   * extracted from worker/analytics.ts, truncated. The flag above is a claim
   * about a document, and the document is edited far more often than the
   * probe is run -- it was edited twice, silently, while this file still said
   * the document had been accepted. worker/__tests__/analytics-schema.test.ts
   * re-hashes the committed query and reddens when the two part company, so
   * the next edit has to re-run the probe rather than inherit an old verdict.
   */
  documentFingerprint: string;
  /** The dimension that groups rows by calendar day, EXACTLY as Cloudflare spells it, or null. */
  dateDimension: string | null;
  /** The dimension that groups rows by hour, EXACTLY as Cloudflare spells it, or null. */
  hourDimension: string | null;
  /** Every dimension name introspection returned, sorted. The evidence behind the two above. */
  dimensions: string[];
}

export const RUM_CAPABILITIES: RumCapabilities = {
  verifiedOn: '2026-08-19',
  baseDocumentAccepted: true,
  documentFingerprint: 'sha256:fdf21b7a7eb3beb5',
  dateDimension: 'date',
  hourDimension: 'datetimeHour',
  dimensions: [
    'bot',
    'countryName',
    'customTagInternalSxg',
    'date',
    'datetimeFifteenMinutes',
    'datetimeFiveMinutes',
    'datetimeHalfOfHour',
    'datetimeHour',
    'datetimeMinute',
    'deliveryType',
    'deviceType',
    'navigationType',
    'refererHost',
    'refererPath',
    'refererScheme',
    'requestHost',
    'requestPath',
    'requestScheme',
    'siteTag',
    'userAgentBrowser',
    'userAgentOS',
  ],
};
