import { describe, expect, it } from 'vitest';
import { shellOriginProblems, SHELL_PATH } from '../shell-origin-check.mjs';

const EXPECTED = { title: 'Via Bianca - Pastificio & Ristorante | Authentic Italian Dining in Delhi' };

// This site's own shell, trimmed to the four things the check reads.
const thisSite = (over = {}) => ({
  status: 200,
  csp: "default-src 'self'; img-src 'self' blob:",
  html: `<!doctype html><html><head><title>${EXPECTED.title}</title>`
    + '<script type="module" src="/assets/index-33f4ebe3-BbM-zvdY.js"></script>'
    + '</head><body><div id="root"></div></body></html>',
  ...over,
});

// THE ACTUAL RESPONSE from https://vb.pages.dev/, the hostname wrangler.toml
// shipped with. Fetched 2026-09-01: a 200, an unrelated Chinese link
// directory, no entry bundle, and no Content-Security-Policy header at all.
// Reproduce with `curl -si https://vb.pages.dev/`.
const strangersSite = () => ({
  status: 200,
  csp: null,
  html: '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">'
    + '<title>简约导航</title></head><body></body></html>',
});

describe('shellOriginProblems', () => {
  it('passes this project\'s own Pages alias', () => {
    expect(shellOriginProblems('https://vb-c7r.pages.dev', thisSite(), EXPECTED)).toEqual([]);
  });

  // The whole point of the file. Every signal the shape check could not see.
  it('rejects the stranger\'s website that the old shape check accepted', () => {
    const problems = shellOriginProblems('https://vb.pages.dev', strangersSite(), EXPECTED);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('is NOT this site');
    expect(problems[1]).toContain('no /assets/index-*.js');
    expect(problems[2]).toContain('no Content-Security-Policy');
    // And it says where the right answer comes from, because the wrong one
    // was arrived at by reasoning rather than by looking.
    expect(problems[0]).toContain('wrangler pages project list');
  });

  // Each signal alone, so a mutation that deletes one branch cannot hide
  // behind another branch still firing on the same fixture.
  it('reports a shell whose title belongs to a different site', () => {
    const problems = shellOriginProblems('https://vb-c7r.pages.dev', thisSite({
      html: '<html><head><title>Somebody Else</title><script src="/assets/index-a1b2c3d4-Xy.js"></script></head></html>',
    }), EXPECTED);
    expect(problems).toEqual([expect.stringContaining('is NOT this site')]);
  });

  it('reports a shell with no entry bundle', () => {
    const problems = shellOriginProblems('https://vb-c7r.pages.dev', thisSite({
      html: `<html><head><title>${EXPECTED.title}</title></head><body></body></html>`,
    }), EXPECTED);
    expect(problems).toEqual([expect.stringContaining('no /assets/index-*.js')]);
  });

  it('reports a shell served without a Content-Security-Policy', () => {
    const problems = shellOriginProblems('https://vb-c7r.pages.dev', thisSite({ csp: null }), EXPECTED);
    expect(problems).toEqual([expect.stringContaining('no Content-Security-Policy')]);
  });

  it('reports a missing title as absent rather than as an empty string', () => {
    const problems = shellOriginProblems('https://vb-c7r.pages.dev', thisSite({
      html: '<html><head><script src="/assets/index-a1b2c3d4-Xy.js"></script></head></html>',
    }), EXPECTED);
    expect(problems[0]).toContain('(absent)');
  });

  // A non-200 stops the body checks: complaining that a 404 page has the
  // wrong title is noise on top of the one fact that matters.
  it('reports a non-200 and says nothing further about the body', () => {
    const problems = shellOriginProblems('https://vb-c7r.pages.dev', { status: 522, csp: null, html: '' }, EXPECTED);
    expect(problems).toEqual([`https://vb-c7r.pages.dev${SHELL_PATH} answered 522`]);
  });

  it('says an unreachable origin was not reached, rather than "answered 0"', () => {
    expect(shellOriginProblems('https://vb-c7r.pages.dev', { status: 0, csp: null, html: '' }, EXPECTED))
      .toEqual([`https://vb-c7r.pages.dev${SHELL_PATH} could not be reached at all`]);
  });

  // Pages answers /index.html with a 308 to /. `fetch()` follows it, so a
  // caller that observes 308 has passed `redirect: 'manual'` -- which would
  // hand a visitor an empty redirect instead of the shell.
  it('treats an unfollowed 308 as a failure, not as success', () => {
    expect(shellOriginProblems('https://vb-c7r.pages.dev', { status: 308, csp: "default-src 'self'", html: '' }, EXPECTED))
      .toEqual([`https://vb-c7r.pages.dev${SHELL_PATH} answered 308`]);
  });

  // Shape. `${PAGES_ORIGIN}${SHELL_PATH}` is a concatenation, so a trailing
  // slash or a path is a different URL than the one anybody intended.
  it('rejects a declared origin that is not a bare https origin', () => {
    for (const bad of ['https://vb-c7r.pages.dev/', 'http://vb-c7r.pages.dev', 'https://vb-c7r.pages.dev/site', 'vb-c7r.pages.dev']) {
      expect(shellOriginProblems(bad, thisSite(), EXPECTED)[0]).toContain('not a bare https origin');
    }
  });

  it('reports an absent PAGES_ORIGIN once, and looks at nothing else', () => {
    expect(shellOriginProblems(undefined, thisSite(), EXPECTED)).toEqual([
      'wrangler.toml declares no PAGES_ORIGIN -- the shell subrequest has nowhere to go',
    ]);
  });
});
