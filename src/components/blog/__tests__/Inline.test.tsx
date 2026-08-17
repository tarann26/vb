import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Inline from '../Inline';

function renderInline(text: string) {
  return render(
    <MemoryRouter>
      <p data-testid="host">
        <Inline text={text} />
      </p>
    </MemoryRouter>,
  );
}

describe('Inline', () => {
  it('renders plain prose as text', () => {
    const { getByTestId } = renderInline('Rest the dough for an hour.');
    expect(getByTestId('host').textContent).toBe('Rest the dough for an hour.');
  });

  it('renders bold as a strong element carrying no class', () => {
    const { container } = renderInline('Use **00 flour** here.');
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('00 flour');
    // Preflight already makes <strong> bold. A class here would be 0 bytes
    // of CSS and a lie about where the weight comes from.
    expect(strong?.getAttribute('class')).toBeNull();
  });

  it('renders italic as an em element carrying no class', () => {
    const { container } = renderInline('It is *soffritto*.');
    const em = container.querySelector('em');
    expect(em?.textContent).toBe('soffritto');
    expect(em?.getAttribute('class')).toBeNull();
  });

  it('renders inline code as a code element and does not parse inside it', () => {
    const { container } = renderInline('Set it to `220 **C**`.');
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('220 **C**');
    expect(code?.querySelector('strong')).toBeNull();
  });

  it('renders an off-site link as an anchor that opens safely', () => {
    const { container } = renderInline('See [the piece](https://example.com/a).');
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/a');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.textContent).toBe('the piece');
  });

  it('renders a site-relative link as a router link with no target', () => {
    const { container } = renderInline('Book [catering](/catering).');
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/catering');
    expect(anchor?.getAttribute('target')).toBeNull();
  });

  it('nests bold inside a link', () => {
    const { container } = renderInline('[the **full** piece](https://example.com/a)');
    expect(container.querySelector('a strong')?.textContent).toBe('full');
  });
});

// THE XSS BOUNDARY, PROVED STRUCTURALLY.
//
// The obvious version of this test -- render a payload and assert nothing
// executed -- cannot fail in jsdom, and src/test/html-sinks.test.ts's own
// header documents exactly why: setting inner markup on a <script> parses in
// the raw-text state, so a breakout and a safe render are indistinguishable
// there. That test was written once in this repository, passed, and then
// passed just as happily against a component deliberately rewritten to use a
// parsing sink.
//
// So this asserts STRUCTURE: which elements exist, and what the text content
// of the host is, character for character. A parsing sink would produce a
// <script> node and a shorter textContent; both are checkable.
describe('Inline: a malicious paste is words on a page and nothing else', () => {
  it.each([
    ['a script tag', 'Hello <script>alert(1)</script> world'],
    ['an image tag with an inline handler', 'Look: <img src=x onerror="alert(1)">'],
    ['an iframe', 'Look: <iframe src="https://evil.example"></iframe>'],
    ['a closing tag breakout attempt', '</p><script>alert(1)</script><p>'],
  ])('%s survives as literal text with no element of its own', (_name, payload) => {
    const { container, getByTestId } = renderInline(payload);
    expect(getByTestId('host').textContent).toBe(payload);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it.each([
    'Click [here](javascript:alert(1)) now',
    'Click [here](data:text/html,<script>alert(1)</script>) now',
    'Click [here](vbscript:msgbox(1)) now',
    'Click [here](//evil.example/x) now',
  ])('%s renders NO anchor at all', (payload) => {
    const { container, getByTestId } = renderInline(payload);
    expect(container.querySelector('a')).toBeNull();
    // And the refusal is visible rather than silent: she can see the target
    // she pasted, brackets and all, which is what lets her fix it.
    expect(getByTestId('host').textContent).toBe(payload);
  });
});
