// The links SHE places, and the one bucket everything else falls into.
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
export const OTHER_SOURCE = 'other' as const;

export const KNOWN_CAMPAIGN_SOURCES = [
  'instagram',
  'whatsapp',
  'google',
  'zomato',
  'newsletter',
  'print',
] as const;

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
  instagram: 'Instagram link',
  whatsapp: 'WhatsApp link',
  google: 'Google link',
  zomato: 'Zomato link',
  newsletter: 'Newsletter link',
  print: 'Printed link',
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

// Anything unrecognised becomes `other`, over the tidied tag above.
export function normalizeSource(raw: string): string {
  const trimmed = campaignTag(raw);
  return (KNOWN_CAMPAIGN_SOURCES as readonly string[]).includes(trimmed) ? trimmed : OTHER_SOURCE;
}
