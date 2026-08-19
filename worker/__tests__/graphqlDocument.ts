// What a GraphQL document DECLARES, read off the document itself, so a stub
// can refuse a request the real API would refuse.
//
// WHY THIS EXISTS. `worker/analytics.ts` keeps ONE document and TWO senders:
// the panel (`handleAnalytics`) and the nightly archive (`totalVisitsFor`).
// A later task added `$sincePrevious: Time!` to that document and updated one
// sender. GraphQL rejects the whole request at variable-coercion time when a
// non-null variable with no default is absent, so the archive's every call
// came back `data: null` -- and every stub in this directory answered its
// canned body anyway, because each was keyed on the query TEXT and none of
// them ever looked at the variables. The archive reported success and wrote
// nothing, night after night, with no test able to see it.
//
// So the check is not "does this one sender send the right seven strings" --
// that assertion existed, on the sender that was already correct. It is "does
// every request a stub answers actually satisfy the document it carries". A
// sender that omits one reddens wherever it is exercised, including a sender
// written after this file.
//
// Deliberately TEXT over the document rather than a GraphQL parser: the
// declaration block is the whole of what coercion reads, and a dependency
// would put a second implementation of "what does this document require"
// beside the one Cloudflare actually runs.

const DECLARATION_BLOCK = /query\s+\w*\s*\(([\s\S]*?)\)\s*\{/;
const ONE_DECLARATION = /^\$(\w+)\s*:\s*([^=]+)(=.*)?$/;

// The variables a document cannot be executed without: non-null (`!`) and
// carrying no default (`= ...`). Everything else is optional to the coercion
// step, whatever the sender happens to do with it.
export function requiredVariables(query: string): string[] {
  // The declaration block: `query Name( ... ) {`. Types on this API are
  // scalars and input objects -- no parentheses inside them -- so the first
  // `)` before the selection set closes the block.
  const header = query.match(DECLARATION_BLOCK);
  if (!header) return [];
  const required: string[] = [];
  for (const declaration of header[1].split(/[,\n]/)) {
    const parsed = declaration.trim().match(ONE_DECLARATION);
    if (!parsed) continue;
    if (parsed[3]) continue; // has a default, so absence is legal
    if (!parsed[2].trim().endsWith('!')) continue; // nullable, so absence is legal
    required.push(parsed[1]);
  }
  return required;
}

// The names the request would be rejected for, given the body a sender built.
export function missingVariables(body: string): string[] {
  const parsed = JSON.parse(body) as { query?: unknown; variables?: unknown };
  if (typeof parsed.query !== 'string') return [];
  const sent = (parsed.variables ?? {}) as Record<string, unknown>;
  return requiredVariables(parsed.query).filter((name) => sent[name] === undefined || sent[name] === null);
}

// What Cloudflare answers: HTTP 200 with a populated `errors` array and no
// data at all. Shaped like the real refusal rather than like a network error,
// because that is the shape both readers in worker/analytics.ts walk -- and
// answering 500 here would let a sender pass a test the real API fails.
export function variableCoercionError(missing: string[]): Response {
  return new Response(
    JSON.stringify({
      data: null,
      errors: missing.map((name) => ({
        message: `Variable "$${name}" of required type was not provided.`,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// The one call a stub makes: hand it the request body, get back the refusal
// the real API would send, or null to answer normally.
export function refusalFor(body: string): Response | null {
  const missing = missingVariables(body);
  return missing.length === 0 ? null : variableCoercionError(missing);
}
