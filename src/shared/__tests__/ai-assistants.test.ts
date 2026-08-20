import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_HOSTS, isAiAssistantHost } from '../ai-assistants';

describe('isAiAssistantHost', () => {
  it('matches every host on the list, exactly', () => {
    for (const host of AI_ASSISTANT_HOSTS) expect(isAiAssistantHost(host)).toBe(true);
  });

  it('matches a real subdomain of one', () => {
    expect(isAiAssistantHost('chat.openai.com')).toBe(true);
    expect(isAiAssistantHost('www.perplexity.ai')).toBe(true);
    expect(isAiAssistantHost('help.chatgpt.com')).toBe(true);
  });

  it('refuses a host that merely CONTAINS one, which is the whole point', () => {
    // Anybody at all can register these and point them here. A substring test
    // -- `host.includes('chatgpt.com')` -- counts every one of them, and the
    // only thing this row has going for it is that the number under it means
    // what the label says.
    expect(isAiAssistantHost('notchatgpt.com.evil.example')).toBe(false);
    expect(isAiAssistantHost('chatgpt.com.evil.example')).toBe(false);
    expect(isAiAssistantHost('evilchatgpt.com')).toBe(false);
    expect(isAiAssistantHost('xclaude.ai')).toBe(false);
    // The label boundary is a dot, not a hyphen or an underscore.
    expect(isAiAssistantHost('my-grok.com')).toBe(false);
  });

  it('is not fooled by case or by the spaces a header can carry', () => {
    expect(isAiAssistantHost('  ChatGPT.com  ')).toBe(true);
    expect(isAiAssistantHost('GEMINI.GOOGLE.COM')).toBe(true);
  });

  it('says no to an empty host rather than to everything', () => {
    // An absent referrer is "typed it in or used a bookmark", and it reaches
    // this function as an empty string on the way past. A suffix test against
    // an empty needle would match every host on earth.
    expect(isAiAssistantHost('')).toBe(false);
    expect(isAiAssistantHost('   ')).toBe(false);
  });

  it('carries the hosts the panel was built to watch', () => {
    // A LITERAL list, so deleting an entry reddens here rather than quietly
    // moving traffic into "Other links". It is a watch list and not a
    // specification -- src/shared/ai-assistants.ts says exactly how good the
    // evidence behind it is -- but it is a committed one.
    expect([...AI_ASSISTANT_HOSTS]).toEqual([
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
    ]);
  });
});
