# Phase A: Via Bianca site repair

**Date:** 2026-07-31
**Status:** Approved, pending implementation plan
**Branch:** `repair/phase-a`

## Context

The site is live on Vercel and has not been committed to since 2025-07-14. In that year it accumulated broken images, placeholder copy, and a dead Supabase backend. Separately, the founder has new content coming (B2B, a B2C bread and dip line, catering, cheeseboards, a membership booklet, and Sunday kids' classes) and a new food and drinks menu.

The owner is not a full-time maintainer and wants to stop being the bottleneck for content changes.

## Scope decomposition

This spec covers **A** only.

| Phase | Scope |
|---|---|
| **A** | Repair the live site. This document. |
| **B** | Content dashboard so non-technical staff can edit without a developer. |
| **C** | New sections: B2B, B2C breads and dips, catering, cheeseboards, membership, kids' classes. |
| **D** | New food and drinks menus, authored through B. |

Order matters. Doing C and D before B means authoring the same content twice.

## Goals

1. Every image loads.
2. The site loads in seconds, not minutes, on Delhi mobile data.
3. Nothing on the site is false or placeholder.
4. Content is structured data, so B edits JSON rather than JSX.
5. Usable on a phone.

## Non-goals

- No visual redesign. The current look stays. (Decided 2026-07-31.)
- No CMS. A makes the site correct, not editable by non-developers.
- No new services, accounts, or anything with a quota. Supabase lapsing is the failure mode this project is designed around.

## Decisions

### D1. Content moves out of components into `src/content/`

```
src/content/
  site.json        hours, phones, address, socials, SEO copy
  story.json       Our Story text
  dishes.json      name, description, image, tags
  drinks.json      mocktails, cocktails, wine
  press.json       articles
  galleries.json   atmosphere images, captions, order
  menus.json       current PDF files
```

Components read from these files and own no strings.

**Why:** every viable design for B edits structured data. Leaving content in components makes B either a JSX-rewriting exercise or a full rebuild. This costs roughly a third of A's effort and changes nothing visible today.

**Consequence:** the content model is the durable asset and the editor is disposable. If the git-backed dashboard in B is ever outgrown, this JSON imports into any backend.

### D2. Components are preserved; only broken or false things are removed

No component file is deleted. Dead components stay on disk for future use. `ChefGallery.tsx` (parked unrendered until team photos exist), `NewsPress.tsx`, `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, and the `/blogs` route all remain.

Only these are removed, because they are actively broken or false:
- The Supabase client and its two route registrations (`/admin`, `/reservation`). The project no longer exists, so both routes currently render errors to anyone who finds them. Component files stay.
- `lovable-tagger` from `package.json` and `vite.config.ts`.
- Content that is wrong.

### D3. One merged, removable Drinks section

Mocktails, cocktails and wine in a single section, so it can be pulled by deleting one component and one line if licensing or positioning changes. The same removability principle applies to every section added in C.

The current copy sells the restaurant on "zero-proof cocktails" while the new drinks menu is a full bar including a Barolo DOCG at Rs 11,750. The SEO description is rewritten accordingly.

### D4. Images: originals to `assets-source/`, derivatives to `public/`

The repo is the only copy of these photos, so originals are preserved, never overwritten, and never purged from history.

- Originals move from `public/` to `assets-source/`. Vite only copies `public/` into the build, so they stay tracked and backed up but never deploy.
- `npm run images` reads `assets-source/`, writes web-sized WebP with JPEG fallback into `public/`, two widths for retina, wired up with `srcset`.
- Expected: 199MB becomes roughly 2MB.

Rejected: a CDN or image service (another account that can lapse), Git LFS (adds a step that breaks silent clones), and history purging with `filter-repo` (only improves clone time, requires force-push on a live project, and history is currently the only photo backup).

Side effect: Vercel currently ships and hosts all 199MB because everything in `public/` lands in `dist/`. Moving originals out speeds up builds.

### D5. `vercel.json` with an explicit SPA rewrite

Vercel's Vite preset probably handles this, but it could not be tested from the development environment and the file costs ten lines. It is the only host-specific artifact in A; replacing it on another host is a one-file change.

## Repair list

### Correctness

- Rewrite 60 asset paths from `/public/x` to `/x`. In Vite, `public/` is served at the root, so the `/public/` prefix 404s in a production build. This affects the atmosphere gallery, food gallery, mocktails, press cards, the chef photo, and the menu PDF download.
- Fix the `Aglio e Pepperoncini.jpg` case mismatch, which works on macOS and 404s on Linux.
- Fix the two press cards pointing at `food/aglio.jpg` and `food/assassina.jpg`, neither of which exists in the repo. Resolved the same way as the other three linked entries: a publication logo in `press/`. Falls back to an existing food photo if no logo is available.
- Remove the two empty `src=""` entries in the hero collage, which make the browser refetch the page HTML as an image.
- Un-stack the two hero images both placed at `col-start-3 row-start-2`.
- Add a mobile nav. The current bar puts a wordmark, five uppercase links and an icon in one flex row at every breakpoint.
- Add a catch-all 404 route and an error boundary.
- Replace `window.location.href = '/'` in `ReservationPage.tsx` with `navigate('/')`.
- Add `tsc -b` to the build script. `strict`, `noUnusedLocals` and `noUnusedParameters` are already configured but never run, which is why `Hero.tsx` ships an unused `useNavigate()`.

### Performance

- The image pipeline in D4.
- Move the Google Fonts `@import` from `index.css` to a `<link>` in `index.html`, so the existing `preconnect` hints have an effect.
- Fix the NavBar scroll listener, which detaches and reattaches on every scroll frame because the effect depends on `lastScrollY`.
- Scope `scroll-behavior: smooth` to `html` instead of `*`, which currently forces the smooth-scroll path onto all four horizontal carousels.
- Remove the fixed `mix-blend-mode: multiply` brick overlay on `body::before`. It repaints the full viewport on every scroll and duplicates the texture the hero already paints.
- Consolidate the four duplicated `<style>` blocks injecting `.scrollbar-hide` and `.animation-delay-*` into `index.css`.

### Motion

- Scale an inner wrapper on carousel cards rather than the card itself, so hovering the last card cannot push it past the container edge.
- Stop the Our Story carousel advancing under `prefers-reduced-motion`. The existing media query kills the transition but the `setInterval` still hard-cuts every 3.2 seconds.
- Add scroll affordances to the carousels. They currently hide their scrollbars with no arrows, dots, edge fade, or keyboard access.

### Content

- Real dish names and descriptions. The current code derives titles from filenames, producing "Idk1", "Idk2", "Pizza1", "Pizza2", "PistaAffo" and "Margarita" on the live homepage.
- Our Story replaced with the chef's own copy from page 2 of the new food menu. The current text is three paragraphs of placeholder ending in literal ellipses.
- Mocktail copy rewritten. It currently describes a basil-lime spritz, a rosemary-grapefruit fizz and an espresso-orange tonic, none of which are among the five drinks listed below it.
- Press: thirteen entries, all with working URLs. Ten currently have `url: "#"`, which with `target="_blank"` opens a second copy of the Stories page in a new tab.
- One authoritative set of opening hours, consumed by both the footer and the structured data. Currently the JSON-LD, the footer and the new menu disagree three ways, and the footer reads "Sat-Sun 12:00 PM - 11:30 AM".
- Copyright year.
- The downloadable menu becomes the with-prices version of the new food menu, plus the new drinks menu.

### Metadata

- A real favicon. `index.html` points at `/vite.svg`, which does not exist.
- `og:image` and `twitter:image`. `twitter:card` is set to `summary_large_image` with no image, so every WhatsApp share previews blank.
- Canonical URL, `og:site_name`, `og:locale`, `robots.txt`, `sitemap.xml`.
- Fix the duplicate hero `<h1>`/`<h2>` both reading "Via Bianca".
- Replace "Place 1", "Place 2" alt text.

### Provenance

- Rename the package from `vite-react-typescript-starter`.
- Rename `public/team/alice.jpg`, which is labelled as Chef Kamalika Anand.
- Add a README.

## Open items requiring a human

Not blocking. Mechanical work proceeds first with existing content left in place; real copy drops into the content layer when it arrives.

**From the chef**
- Confirm dish identifications derived from the photos and cross-referenced against the new menu.
- Dish descriptions, mostly copyable from the new menu.

**From the founder**
- The thirteen press URLs.
- Which award the tiramisu won, or the line is removed.
- Whether the Michelin training claim is accurate. Her own menu bio says "iconic kitchens across India and Italy" with no Michelin mention.
- One authoritative set of opening hours, including whether breakfast service from 9am is current.
- Whether `linkedin.com/company/viabiancadelhi` exists.
- A wide photo for the social share image.

## Flagged separately

The new food menu's Illustrator package includes `Burgundia_PERSONAL_USE_ONLY.otf`, used for every section heading. A personal-use licence does not cover a commercial restaurant's menu, printed or web. Satoshi, the body face, is free for commercial use. This affects the menu itself, not the website, and needs raising with the designer.

## Verification

- `npm run build` passes with `tsc -b` enabled.
- No reference to `/public/` remains in `src/`.
- Every path in the content layer resolves to a file in `public/`, checked case-sensitively by script.
- Total `dist/` size under 5MB.
- Site renders correctly at 375px, 768px and 1440px.
- No console errors on any route.
- Lighthouse performance score checked before and after.
