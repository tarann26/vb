// The dashboard's sections fold now. The owner's report: "/edit/manage
// renders every section fully expanded, so reaching the last one means
// scrolling past every dish, drink and article."
//
// Two of the decisions in CollapsibleSection.tsx are the ones worth pinning,
// because both are silent when they break: folded must HIDE and never
// UNMOUNT (unmounting would remount the section, re-fetch, and overwrite her
// unpublished edit with the committed content), and a folded section that
// has something to say must still say it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleSection from '../CollapsibleSection';
import { SECTION_OPEN_KEY_PREFIX } from '../open-sections';

beforeEach(() => {
  window.localStorage.clear();
});

function toggleFor(heading: string): HTMLElement {
  return screen.getByRole('button', { name: heading });
}

function panelFor(heading: string): HTMLElement {
  const section = screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;
  return section.querySelector('[id^="section-panel-"]') as HTMLElement;
}

describe('CollapsibleSection: folded by default', () => {
  // Mutation this guards: seeding the state with `useState(true)` instead of
  // `useState(() => loadSectionOpen(id))` -- confirmed red.
  it('starts folded, with its heading still readable', () => {
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <button type="button">Add a dish</button>
      </CollapsibleSection>,
    );
    expect(screen.getByRole('heading', { name: 'Dishes' })).toBeInTheDocument();
    expect(toggleFor('Dishes')).toHaveAttribute('aria-expanded', 'false');
    expect(panelFor('Dishes')).toHaveAttribute('hidden');
  });

  // The half a `hidden` attribute buys that a plain CSS class would not:
  // the content is genuinely out of the accessibility tree, so nothing
  // inside a folded section is reachable by role -- which is what a real
  // user, and a real screen reader, experience.
  it('puts its content out of reach while folded, and back in reach when opened', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <button type="button">Add a dish</button>
      </CollapsibleSection>,
    );
    expect(screen.queryByRole('button', { name: 'Add a dish' })).not.toBeInTheDocument();

    await user.click(toggleFor('Dishes'));
    expect(toggleFor('Dishes')).toHaveAttribute('aria-expanded', 'true');
    expect(panelFor('Dishes')).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Add a dish' })).toBeInTheDocument();
  });
});

describe('CollapsibleSection: folding never unmounts what it hides', () => {
  // The whole reason this is `hidden` rather than `{open && children}`.
  // Every dashboard section holds its fetched data and her edits in its own
  // local state and re-fetches on mount, calling registerLoaded -- which
  // writes the SERVER value back into the shared registry. So an unmount
  // here is not a lost scroll position, it is a silently discarded edit.
  //
  // Mutation this guards: `<div hidden={!open}>{children}</div>` replaced
  // with `{open && children}` -- confirmed red, the counter resets to 0.
  it('keeps its children mounted, and their state intact, across a fold and re-open', async () => {
    const user = userEvent.setup();
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((c) => c + 1)}>{`count ${count}`}</button>
      );
    }
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <Counter />
      </CollapsibleSection>,
    );

    await user.click(toggleFor('Dishes'));
    await user.click(screen.getByRole('button', { name: 'count 0' }));
    await user.click(screen.getByRole('button', { name: 'count 1' }));
    expect(screen.getByRole('button', { name: 'count 2' })).toBeInTheDocument();

    await user.click(toggleFor('Dishes')); // fold
    expect(panelFor('Dishes')).toHaveAttribute('hidden');
    // Still mounted, just out of the accessibility tree -- getByText does
    // not filter on visibility, which is how this distinction is observable
    // at all in jsdom.
    expect(screen.getByText('count 2')).toBeInTheDocument();

    await user.click(toggleFor('Dishes')); // open again
    expect(screen.getByRole('button', { name: 'count 2' })).toBeInTheDocument();
  });
});

describe('CollapsibleSection: remembers what was open across a reload', () => {
  // Mutation this guards: deleting the `saveSectionOpen(id, next)` call from
  // `toggle` -- confirmed red.
  it('re-opens a section she had opened, on a fresh mount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsibleSection id="menus" heading="Menus">
        <button type="button">Replace the PDF</button>
      </CollapsibleSection>,
    );
    await user.click(toggleFor('Menus'));
    expect(window.localStorage.getItem(`${SECTION_OPEN_KEY_PREFIX}menus`)).toBe('1');
    unmount();

    render(
      <CollapsibleSection id="menus" heading="Menus">
        <button type="button">Replace the PDF</button>
      </CollapsibleSection>,
    );
    expect(toggleFor('Menus')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Replace the PDF' })).toBeInTheDocument();
  });

  // The other direction, and it is not symmetric with the above: folded is
  // also the DEFAULT, so a version that only ever wrote and never removed
  // would pass the test above and still leave a section she deliberately
  // folded open on her next visit.
  //
  // Mutation this guards: `saveSectionOpen` writing '1' unconditionally
  // instead of removing the key when `open` is false -- confirmed red.
  it('leaves a section she folded folded, on a fresh mount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsibleSection id="menus" heading="Menus">
        <button type="button">Replace the PDF</button>
      </CollapsibleSection>,
    );
    await user.click(toggleFor('Menus')); // open
    await user.click(toggleFor('Menus')); // fold again
    unmount();

    render(
      <CollapsibleSection id="menus" heading="Menus">
        <button type="button">Replace the PDF</button>
      </CollapsibleSection>,
    );
    expect(toggleFor('Menus')).toHaveAttribute('aria-expanded', 'false');
  });

  // Each section is remembered on its own, so opening Menus never re-opens
  // Dishes.
  it('remembers each section separately', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CollapsibleSection id="dishes" heading="Dishes">
          <p>dish content</p>
        </CollapsibleSection>
        <CollapsibleSection id="menus" heading="Menus">
          <p>menu content</p>
        </CollapsibleSection>
      </>,
    );
    await user.click(toggleFor('Menus'));
    expect(toggleFor('Menus')).toHaveAttribute('aria-expanded', 'true');
    expect(toggleFor('Dishes')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CollapsibleSection: the toggle cannot publish the site', () => {
  // On /edit/manage this renders inside the one <form> PublishBar's Publish
  // button submits (PublishBarProps' own `children` comment), and an
  // unlabelled <button> inside a form defaults to type="submit" -- so
  // without `type="button"` folding a section would open the publish
  // confirmation instead.
  //
  // Mutation this guards: removing `type="button"` from that toggle --
  // confirmed red.
  it('does not submit an enclosing form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <CollapsibleSection id="dishes" heading="Dishes">
          <p>dish content</p>
        </CollapsibleSection>
      </form>,
    );
    await user.click(toggleFor('Dishes'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(toggleFor('Dishes')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('CollapsibleSection: a folded section still says when something is wrong', () => {
  function Later() {
    const [failed, setFailed] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setFailed(true)}>
          break it
        </button>
        {failed && <p role="alert">Could not load dishes: bad content (status 401)</p>}
      </>
    );
  }

  // The cost of folding by default, and the answer to it. Without this a
  // content file that failed to load looks exactly like one she has not
  // opened yet.
  //
  // Mutation this guards: deleting the `hasProblem && !open` marker --
  // confirmed red.
  it('shows a marker in the header once its content raises an alert, even though the alert itself is hidden', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <Later />
      </CollapsibleSection>,
    );
    // Nothing wrong yet: no marker.
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();

    // Open, break it, fold again -- the alert is now inside a hidden panel.
    await user.click(toggleFor('Dishes'));
    await user.click(screen.getByRole('button', { name: 'break it' }));
    await user.click(toggleFor('Dishes'));
    expect(panelFor('Dishes')).toHaveAttribute('hidden');

    await waitFor(() => expect(screen.getByText(/needs attention/i)).toBeInTheDocument());
  });

  // The marker has to arrive without this component re-rendering for any
  // other reason: an alert appears when the SECTION's own state changes,
  // which React never tells its parent about. This drives that directly by
  // mutating the DOM, the way a child that re-rendered on its own would.
  //
  // Mutation this guards: replacing the MutationObserver with a plain
  // `useEffect(..., [])` one-shot read -- confirmed red.
  it('notices an alert that appears without this component re-rendering', async () => {
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <p>nothing wrong</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();

    const alert = document.createElement('p');
    alert.setAttribute('role', 'alert');
    alert.textContent = 'Could not load dishes';
    panelFor('Dishes').appendChild(alert);

    await waitFor(() => expect(screen.getByText(/needs attention/i)).toBeInTheDocument());
  });

  // Once it is open, the real message is right there -- repeating it in the
  // header would be saying the same thing twice.
  it('drops the marker once the section is open', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <Later />
      </CollapsibleSection>,
    );
    await user.click(toggleFor('Dishes'));
    await user.click(screen.getByRole('button', { name: 'break it' }));
    await user.click(toggleFor('Dishes'));
    await waitFor(() => expect(screen.getByText(/needs attention/i)).toBeInTheDocument());

    await user.click(toggleFor('Dishes'));
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();
    const section = screen.getByRole('heading', { name: 'Dishes' }).closest('section') as HTMLElement;
    expect(within(section).getByRole('alert')).toHaveTextContent(/could not load dishes/i);
  });

  // The heading's own accessible name must not move when something breaks:
  // it is how every other test, and every screen-reader user, finds the
  // section at all.
  //
  // Mutation this guards: rendering the marker INSIDE the <h2> (or inside
  // the toggle) -- confirmed red, the heading is then named "Dishes
  // Something in this section needs attention..." and `getByRole('heading',
  // { name: 'Dishes' })` no longer matches it.
  it('does not rename the heading when the marker appears', async () => {
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <p>nothing wrong</p>
      </CollapsibleSection>,
    );
    const alert = document.createElement('p');
    alert.setAttribute('role', 'alert');
    alert.textContent = 'Could not load dishes';
    panelFor('Dishes').appendChild(alert);
    await waitFor(() => expect(screen.getByText(/needs attention/i)).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Dishes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dishes' })).toBeInTheDocument();
  });
});

describe('CollapsibleSection: the chevron is decorative', () => {
  it('turns when open and is never announced', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <p>dish content</p>
      </CollapsibleSection>,
    );
    const chevron = container.querySelector('svg') as SVGElement;
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(chevron.getAttribute('class')).not.toMatch(/rotate-180/);

    await user.click(toggleFor('Dishes'));
    expect((container.querySelector('svg') as SVGElement).getAttribute('class')).toMatch(/rotate-180/);
  });
});

// A `fireEvent.click` rather than userEvent anywhere the point is the
// activation alone -- kept as one case so this file's own reliance on
// userEvent's fuller pointer sequence is not load-bearing for the basic
// toggle.
describe('CollapsibleSection: a bare click activates it', () => {
  it('opens on a plain click event', () => {
    render(
      <CollapsibleSection id="dishes" heading="Dishes">
        <p>dish content</p>
      </CollapsibleSection>,
    );
    fireEvent.click(toggleFor('Dishes'));
    expect(toggleFor('Dishes')).toHaveAttribute('aria-expanded', 'true');
  });
});
