// The hosts an AI assistant answers from, as ONE list, because two different
// paths ask the same question about a string and must not come to two
// different answers:
//
//   * bucketReferer (worker/analytics.ts), over the refererHost Cloudflare
//     reports -- somebody followed a link that was sitting inside an answer.
//   * normalizeSource (./campaign-sources.ts), over a utm_source WE did not
//     place -- ChatGPT is reported to append `utm_source=chatgpt.com` to the
//     links it serves.
//
// WHAT THE EVIDENCE ACTUALLY IS, said plainly, because this list reads more
// authoritative than it is. The second claim above could NOT be verified from
// any primary source: every page asserting it is a search-marketing article
// citing other search-marketing articles, none of them citing OpenAI, and it
// is behaviour that can be turned off tomorrow without anyone announcing it.
// The first is on firmer ground -- a referrer header is the browser's, not the
// assistant's -- but the set of hosts is still a guess at which products
// matter, and products appear and disappear faster than this file is edited.
//
// IT IS IN THE LIST ANYWAY, and the DESIGN is what makes that safe rather than
// the evidence. An entry that never matches anything costs one string
// comparison per arrival and one row that stays empty. That is also what this
// row is expected to read for a long time whatever we do (see
// AI_TRAFFIC_CAVEAT in src/admin/manage/analytics.ts), so a wrong guess here
// is indistinguishable from the ordinary state of the world and cannot mislead
// anyone who has read the sentence printed beside the number.
//
// Read it as a watch list, then, and not as a specification of anything.
export const AI_ASSISTANT_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'deepseek.com',
  'grok.com',
  'meta.ai',
  'you.com',
] as const;

// THE HOST, OR A SUBDOMAIN OF IT. Never a substring test, and the difference
// is not academic: `host.includes('chatgpt.com')` counts
// `notchatgpt.com.evil.example` as ChatGPT, and anyone at all can register a
// name like that and point it here. The whole value of this row is that the
// number under it means what its label says.
//
// The dot is part of the suffix compared, so `evilchatgpt.com` fails too --
// only a real label boundary matches.
export function isAiAssistantHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase();
  if (host === '') return false;
  return AI_ASSISTANT_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}
