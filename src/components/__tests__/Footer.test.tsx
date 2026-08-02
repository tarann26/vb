import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '../Footer';
import { site, copy } from '../../content';
import { formatTimeRange } from '../../content/hours';

describe('Footer', () => {
  it('shows the current copyright year from content', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`© ${site.copyrightYear}`))).toBeInTheDocument();
  });

  it('formats a same-day range without an AM closing time', () => {
    // Fixture, not live site.hours: a closing time past midnight (e.g.
    // "00:30") is a real, documented shape (see hours.ts's formatTimeRange
    // comment -- the restaurant now has a bar service that closes after
    // midnight), and that AM closing time is the *correct* rendering of
    // that fact, not a bug. Asserting against live content here would fail
    // the deploy gate the moment the owner enters a legitimate past-midnight
    // closing time. This fixture only pins the same-day case.
    expect(formatTimeRange('12:00', '23:30')).not.toMatch(/–\s*\d{1,2}:\d{2}\s*AM/);
  });

  it('renders every phone number from content', () => {
    render(<Footer />);
    site.phones.forEach((phone) => {
      expect(screen.getByText(phone)).toBeInTheDocument();
    });
  });
});

// Branches on `site.socials.linkedin` in isolation, via a mocked '../../content'
// module rather than the live site.json. Both arms must run on every suite
// execution regardless of what the real content currently holds -- if
// site.json's linkedin field is non-null (as it is today), a test that only
// reads live content would never exercise the null/omitted branch, and the
// guard in Footer.tsx could be deleted without the suite noticing.
describe('Footer LinkedIn link', () => {
  afterEach(() => {
    vi.doUnmock('../../content');
    vi.resetModules();
  });

  it('renders the LinkedIn link when content provides a URL', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        site: { ...actual.site, socials: { ...actual.site.socials, linkedin: 'https://linkedin.com/company/test-fixture' } },
      };
    });
    const { default: FooterWithLink } = await import('../Footer');

    render(<FooterWithLink />);

    // copy.footer.linkedinLabel (the link's aria-label) is not part of what
    // this mock overrides, so it's still the real, owner-editable copy.json
    // value here -- look it up rather than pinning today's wording.
    expect(screen.getByLabelText(copy.footer.linkedinLabel)).toHaveAttribute(
      'href',
      'https://linkedin.com/company/test-fixture',
    );
  });

  it('omits the LinkedIn link when content has none', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        site: { ...actual.site, socials: { ...actual.site.socials, linkedin: null } },
      };
    });
    const { default: FooterWithoutLink } = await import('../Footer');

    render(<FooterWithoutLink />);

    expect(screen.queryByLabelText(/LinkedIn/i)).toBeNull();
  });
});
