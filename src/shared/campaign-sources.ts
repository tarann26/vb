// The links SHE places, and the two buckets everything else falls into.
//
// A card that lists every string it has ever seen fills with noise: Facebook
// appends fbclid, other sites append their own tags, and visitors paste links
// that already carry somebody else's. She names her links; the rest is one
// row.
//
// This list is ALSO the write path's guard. normalizeSource runs before a row
// is written, so the `source` column can only ever hold one of these strings
// -- which bounds the stored values to a committed list rather than to
// whatever a stranger puts after utm_source=. That is what lets a public
// endpoint write to the database the whole site's content lives in.
//
// THE COST, STATED: adding a source she wants named is a one-line edit here
// plus `npx wrangler deploy`, not a dashboard field. That is the right trade
// for a list that changes perhaps twice a year and the wrong one if it
// changes weekly.
import { isAiAssistantHost } from './ai-assistants';

export const OTHER_SOURCE = 'other' as const;

// A tag nobody here placed, arriving on its own. ChatGPT is reported to append
// `utm_source=chatgpt.com` to the links it serves, so an arrival can carry a
// tag that was never copied out of the dashboard -- see ./ai-assistants.ts for
// how thin the evidence for that is and why the entry is worth keeping anyway.
// It is deliberately NOT one of the four below: she cannot place it, so it can
// never be offered as a link to copy, and it must still be storable rather
// than collapsing into `other` beside somebody's fbclid.
export const AI_SOURCE = 'ai' as const;

// FOUR PRESETS, one per link the dashboard hands her finished and ready to
// paste (src/admin/areas/NumbersArea.tsx). That is the whole list now, and the
// shortness is the point: every one of these has a Copy button beside it, so a
// fifth entry is a fifth row on a card she reads on a phone, and a source with
// no link to copy is a row that can only ever read zero.
//
// `general` is the catch-all she uses anywhere a named one does not fit -- a
// printed menu, a business card, a message to a regular. It exists so that
// "somewhere I put a link" is still a row of her own rather than landing in
// `other` with everybody else's tags.
//
// Gone from this list, and gone deliberately: whatsapp, google, newsletter,
// print. Each was a word she would have had to type into a URL by hand, which
// is the thing the Copy buttons replace. `campaign_arrivals` held zero rows
// when they were removed -- verified directly against the live database -- so
// no stored value was orphaned and no migration was owed.
export const KNOWN_CAMPAIGN_SOURCES = ['general', 'instagram', 'zomato', 'swiggy'] as const;

// Her words, beside the machine value, for the same reason
// REFERER_BUCKET_LABELS sits beside RefererBucketKind: the card and the
// counter cannot come to two different opinions about what a row IS.
//
// "Instagram link", not "Instagram", deliberately. The referrer card already
// has a row called Instagram meaning "the click came from instagram.com", and
// the two cards sit on one screen. Two rows reading Instagram and disagreeing
// is the contradiction the spec warns about; naming this one after the LINK
// is what tells them apart at a glance, before she reads the sentence that
// explains it.
export const CAMPAIGN_LABELS: Record<string, string> = {
  general: 'General link',
  instagram: 'Instagram link',
  zomato: 'Zomato link',
  swiggy: 'Swiggy link',
  // Not "AI assistants". That is the REFERRER card's wording for its own AI
  // row (REFERER_BUCKET_LABELS in worker/analytics.ts), and the two rows count
  // different things: that one is "the click came from an assistant", this one
  // is "the link carried a tag an assistant put on it". Same collision as
  // Instagram above, same answer -- name this one after the link.
  ai: 'AI assistant’s link',
  other: 'Someone else’s link',
};

// The tag AS WRITTEN, tidied but not bucketed: lowercased, trimmed, and
// capped so a megabyte of query string is a cheap string operation and not a
// cheap denial of service.
//
// This is not what gets STORED anywhere -- normalizeSource below is the write
// boundary and the column's whole domain. It is what tells two of HER links
// apart in one tab (src/campaign.ts's once-per-arrival mark), which the
// bucketed value cannot do: every unrecognised tag normalises to the same
// string, so `?utm_source=partner-a` followed by `?utm_source=partner-b` in
// one tab counted once. Case and surrounding space are folded here on
// purpose, so `Instagram` and `instagram` remain ONE link rather than two.
export function campaignTag(raw: string): string {
  return raw.trim().slice(0, 64).toLocaleLowerCase('en');
}

// Anything unrecognised becomes `other`, over the tidied tag above -- with ONE
// exception, and it is the one tag on the whole internet that arrives without
// anybody choosing it.
//
// A tag matching an AI assistant's own host (./ai-assistants.ts) becomes `ai`
// rather than `other`. It cannot be one of the four presets -- she has no way
// to place it -- and folding it into `other` would bury the one arrival that
// might be worth noticing under everybody else's fbclid. Matched as a HOST,
// exactly or as a subdomain, never as a substring: `notchatgpt.com.evil.example`
// is somebody else's link and must stay one.
//
// The column's value space is therefore six strings forever: the four above,
// `ai`, and `other`.
export function normalizeSource(raw: string): string {
  const trimmed = campaignTag(raw);
  if ((KNOWN_CAMPAIGN_SOURCES as readonly string[]).includes(trimmed)) return trimmed;
  if (isAiAssistantHost(trimmed)) return AI_SOURCE;
  return OTHER_SOURCE;
}

// The finished link, for the preset `source` -- the whole of what the
// dashboard's Copy buttons hand her, built here rather than in the component
// so the link that CREATES a tag and the guard that READS one are declared in
// one file and cannot drift apart.
//
// `origin` is passed in, never read from a global: the caller decides whether
// the address is the site's own configured one or the one in the address bar,
// and this function has no business preferring either (NumbersArea.tsx's
// siteOrigin makes that choice and says why).
//
// A trailing slash on the origin is dropped so the link is always exactly one
// `/` before the query, and the value is percent-encoded even though every
// preset today is one plain word in small letters -- the day one is not, this
// stays a URL rather than becoming a broken one.
export function campaignLink(origin: string, source: string): string {
  return `${origin.replace(/\/+$/, '')}/?utm_source=${encodeURIComponent(source)}`;
}
