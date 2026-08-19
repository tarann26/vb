// The probe worker/analytics.ts has been carrying an honest apology about
// since it was written: nobody had ever run its GraphQL document against the
// real API. Run this, paste what it prints into
// docs/analytics-schema-verification.md, and set worker/analytics-schema.ts
// from the verdict block.
//
// INTROSPECTION FIRST, and that ordering is the point. Firing speculative
// documents and reading the rejections cannot tell "this dataset has no hour
// grouping" from "I guessed the field name wrong" -- the two look identical
// from out here and only one of them is an answer. So this asks the schema
// what dimensions exist and reads the SPELLING off the reply, and only then
// runs the committed document to prove it is accepted.
//
// Needs a Cloudflare API token with Account Analytics: Read. An agent cannot
// obtain one; a human runs:
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   CF_WEB_ANALYTICS_SITE_TAG=... node scripts/verify-analytics-schema.mjs
//
// It only ever READS. Nothing is written anywhere, so a wrong token fails
// loudly and costs nothing.
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
const siteTag = process.env.CF_WEB_ANALYTICS_SITE_TAG;
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!accountTag || !siteTag || !token) {
  console.error('Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CF_WEB_ANALYTICS_SITE_TAG.');
  process.exit(2);
}

const DAY_MS = 86_400_000;
const midnight = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const until = new Date(midnight).toISOString();
const since = new Date(midnight - 28 * DAY_MS).toISOString();

async function post(body) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, text, parsed };
}

// Candidate type names, tried in order. Cloudflare has spelled this type
// differently for zone-scoped and account-scoped datasets over time, so a
// 'null' answer for one name is NOT evidence of a missing dimension -- it is
// evidence of a wrong type name, which is a different thing entirely.
const DIMENSION_TYPES = [
  'AccountRumPageloadEventsAdaptiveGroupsDimensions',
  'ZoneRumPageloadEventsAdaptiveGroupsDimensions',
  'RumPageloadEventsAdaptiveGroupsDimensions',
];

async function introspectDimensions() {
  for (const name of DIMENSION_TYPES) {
    const { text, parsed } = await post({
      query: `{ __type(name: "${name}") { name fields { name type { name kind } } } }`,
    });
    console.log(`\n=== introspect ${name} ===`);
    console.log(text.slice(0, 4000));
    const fields = parsed?.data?.__type?.fields;
    if (Array.isArray(fields) && fields.length > 0) {
      return { typeName: name, names: fields.map((field) => field.name).sort() };
    }
  }
  // Not "there are no dimensions". This is "none of the three names I know
  // exists", and the next step is to introspect the account type by hand and
  // find whichever ...Dimensions type hangs off the dataset.
  console.log('\nNO KNOWN DIMENSIONS TYPE MATCHED. Introspect by hand before recording anything:');
  console.log('  { __type(name: "Account") { fields { name type { name } } } }');
  return { typeName: null, names: [] };
}

// The measures, introspected for the same reason the dimensions are: the
// committed document asks for `sum { visits }` and every card is a sum over
// that one field. A reader who wants to know whether `pageViews` is also
// available should be able to read the answer here rather than guess.
async function introspectSums(dimensionTypeName) {
  if (!dimensionTypeName) return { typeName: null, names: [] };
  const name = dimensionTypeName.replace(/Dimensions$/, 'Sum');
  const { text, parsed } = await post({
    query: `{ __type(name: "${name}") { name fields { name type { name kind ofType { name kind } } } } }`,
  });
  console.log(`\n=== introspect ${name} ===`);
  console.log(text.slice(0, 4000));
  const fields = parsed?.data?.__type?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return { typeName: null, names: [] };
  return { typeName: name, names: fields.map((field) => field.name).sort() };
}

// The EXACT shape worker/analytics.ts sends today, reduced to one aliased
// node. If this is rejected, every card is already broken in production and
// the reason is in errors[].
const BASE = `query VerifyBase($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    last28: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
      limit: 1000
      orderBy: [sum_visits_DESC]
    ) { sum { visits } dimensions { requestPath refererHost } }
  } }
}`;

// Does `requestPath` arrive with its query string attached? The whole
// campaign design turns on the answer. If the dimension carries `?utm_source=`
// then a tagged link fractures the pages list into near-identical rows and
// `normalizePath` is what merges them back; if it does not, the tag never
// reaches Cloudflare at all and first-party rows are the ONLY place a
// campaign count can come from. Either answer is recorded; neither is
// assumed.
const PATHS = `query VerifyPaths($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    paths: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
      limit: 200
      orderBy: [sum_visits_DESC]
    ) { sum { visits } dimensions { requestPath bot } }
  } }
}`;

// The two dimensions the plan's conditional surfaces need, asked for in a
// real document rather than trusted from the introspection reply alone. A
// name can exist on the Dimensions type and still be refused in a grouping.
const GROUPINGS = `query VerifyGroupings($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    byDay: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until, bot: 0 }
      limit: 100
      orderBy: [date_ASC]
    ) { sum { visits } dimensions { date } }
    byHour: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until, bot: 0 }
      limit: 200
      orderBy: [datetimeHour_ASC]
    ) { sum { visits } dimensions { datetimeHour } }
  } }
}`;

// A NEGATIVE CONTROL, and the reason it is here is the same reason every
// test in this repo carries a mutation row: a probe that cannot report a
// rejection is not evidence that nothing was rejected. `datetimeDay` is a
// name introspection does NOT list, so this node MUST come back with an
// errors[] entry. If it ever comes back accepted, `baseDocumentAccepted`
// above means nothing and the run is to be thrown away.
const NEGATIVE = `query VerifyNegative($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    nope: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
      limit: 10
      orderBy: [sum_visits_DESC]
    ) { sum { visits } dimensions { datetimeDay } }
  } }
}`;

const dimensions = await introspectDimensions();
const sums = await introspectSums(dimensions.typeName);

const base = await post({ query: BASE, variables: { accountTag, siteTag, since, until } });
console.log('\n=== base document ===');
console.log(`HTTP ${base.status}`);
console.log(base.text.slice(0, 4000));

const errors = Array.isArray(base.parsed?.errors) ? base.parsed.errors : [];
const accepted = base.status === 200 && errors.length === 0 && base.parsed?.data != null;

const paths = await post({ query: PATHS, variables: { accountTag, siteTag, since, until } });
console.log('\n=== requestPath, with the bot flag beside it ===');
console.log(`HTTP ${paths.status}`);
console.log(paths.text.slice(0, 4000));

const pathRows = paths.parsed?.data?.viewer?.accounts?.[0]?.paths ?? [];
const pathValues = pathRows.map((row) => row?.dimensions?.requestPath).filter((value) => typeof value === 'string');
const withQuery = pathValues.filter((value) => value.includes('?'));
console.log('\n=== requestPath verdict ===');
console.log(`rows: ${pathRows.length}, distinct paths: ${new Set(pathValues).size}, carrying a query string: ${withQuery.length}`);
console.log(withQuery.length > 0 ? `examples: ${JSON.stringify(withQuery.slice(0, 5))}` : 'no returned requestPath contained a "?"');

const groupings = await post({ query: GROUPINGS, variables: { accountTag, siteTag, since, until } });
console.log('\n=== date and datetimeHour groupings, with bot: 0 ===');
console.log(`HTTP ${groupings.status}`);
console.log(groupings.text.slice(0, 4000));

// The dimension names are READ OFF the introspection reply, never assumed.
// Cloudflare has used `date` and `datetimeDay` for the day grouping and
// `datetimeHour` for the hour one; whichever of them the reply actually
// lists is the one that goes in the constant.
const dateDimension = ['date', 'datetimeDay'].find((name) => dimensions.names.includes(name)) ?? null;
const hourDimension = ['datetimeHour', 'hour'].find((name) => dimensions.names.includes(name)) ?? null;

const negative = await post({ query: NEGATIVE, variables: { accountTag, siteTag, since, until } });
const negativeErrors = Array.isArray(negative.parsed?.errors) ? negative.parsed.errors : [];
console.log('\n=== negative control: a dimension introspection did NOT list ===');
console.log(`HTTP ${negative.status}`);
console.log(negative.text.slice(0, 2000));
console.log(
  negativeErrors.length > 0
    ? 'REJECTED as required, so an acceptance above is a real acceptance.'
    : 'ACCEPTED, WHICH IS IMPOSSIBLE. Throw this run away: this probe cannot tell accepted from rejected.',
);

console.log('\n=== sum fields ===');
console.log(JSON.stringify(sums.names));

console.log('\n=== paste this into worker/analytics-schema.ts and the doc ===');
console.log(
  JSON.stringify(
    {
      verifiedOn: new Date().toISOString().slice(0, 10),
      baseDocumentAccepted: accepted,
      dateDimension,
      hourDimension,
      dimensions: dimensions.names,
    },
    null,
    2,
  ),
);
