# Via Bianca — Website

The website for Via Bianca, an Italian restaurant in Greater Kailash I, New Delhi. It currently deploys on Vercel, which builds and publishes automatically from this repository. The site is being migrated to Cloudflare Pages — see `docs/cloudflare-cutover.md` for the cutover checklist and current status.

## Setup

```
npm install
npm run images   # generates public/ images from assets-source/ — a fresh clone has none until this runs
npm run dev      # local dev server, for previewing changes before they go live
npm run build    # production build — regenerates public/ images, then produces the files that get deployed
npm test         # the full test suite — run this after any content change
```

## Where the content lives

Nearly every piece of text and nearly every image path shown on the site comes from the JSON files in `src/content/` — that covers dishes, drinks, press, the story, hours, and almost every photo path. For all of those, you should never need to open a `.tsx` file. A couple of exceptions are called out in "What still needs a developer" below.

| File | Controls |
|---|---|
| `src/content/site.json` | Restaurant name, tagline, address, phone numbers, WhatsApp, Instagram/LinkedIn links, opening hours, SEO title/description/keywords (also duplicated in `index.html` — see below), copyright year |
| `src/content/dishes.json` | The dish cards shown on the homepage |
| `src/content/drinks.json` | Mocktails, cocktails and wines |
| `src/content/press.json` | The press/news articles shown on the homepage and the full list at `/blogs` |
| `src/content/story.json` | The "Our Story" heading and paragraphs |
| `src/content/galleries.json` | Photo galleries — the Atmosfera scroller, the Our Story carousel, and the hero collage |
| `src/content/menus.json` | Labels and file paths for the two downloadable PDF menus |

These are plain JSON files — every entry needs matching quotes and a comma between items, with no comma after the last one. If a save breaks the JSON, `npm test` (or the site itself) will fail loudly rather than quietly showing a broken page, so when in doubt, save and run `npm test`.

After editing any content file, always run `npm test`. The suite (currently 453 tests) checks that every image path used in `src/content/` — and every one hardcoded in a component, in the stylesheet, or in `index.html` — actually exists on disk, that required fields like a dish's name aren't left blank, and that no dish description contains an internal note left in by mistake (words like "TBD" or "verify"). If a test fails, its name tells you which file and field to look at.

## How to add or replace a photo

Photos on the site are generated, not stored directly. You add the original photo to `assets-source/`, then run a script that shrinks it and converts it to a web-friendly `.webp` file in `public/` — the `public/` copy is what the live site actually serves.

**Never add, edit, or delete files by hand inside `public/atmosphere`, `public/food`, `public/hero`, `public/mocktails`, `public/our_story`, `public/press`, or `public/team`.** Anything placed there by hand will be silently deleted the next time anyone runs `npm run images`, because the script also removes any file in those folders that no longer has a matching original in `assets-source/`.

**To replace an existing photo:**
1. Find the original file in `assets-source/<category>/` — the category folders are `atmosphere`, `food`, `hero`, `mocktails`, `our_story`, `press`, `team`.
2. Replace it with your new photo, saved under the **exact same name before the dot** — same capitalisation, same spaces (e.g. `margarita.jpg` can be replaced by a file named `margarita.jpg` or `margarita.png`, but not `Margarita.jpg` or any other name). The extension (`.jpg`/`.jpeg`/`.png`) doesn't need to match the old one, but the name before it must. **If your new photo uses a different extension than the old one, delete the old file** — don't just add the new one alongside it. Keeping only one file with that name is what makes the page that already shows this photo keep working with no further edits.
3. Run `npm run images`. Watch the output — it prints one line per photo it processed, ending in a size and the width it was shrunk to, like `(45KB @ 1000px)`. Photos in `assets-source/hero/` are shrunk further than the rest, because the site only ever shows them as small collage tiles or as a faint background. If it instead prints `COLLISION`, you left an old file in place (see step 2) — delete it and run this again; nothing is changed on a collision, so it's safe to just fix it and retry. If your file isn't listed at all, or its line says `FAILED`, the photo did not update; fix that before continuing.
4. Run `npm test`. Green means the new photo is correctly wired up and will go live on the next build/deploy.

**To add a brand-new photo** (one that doesn't replace an existing one — for a new dish, for example):
1. Save it into the right `assets-source/<category>/` folder, using a new filename ending in `.jpg`, `.jpeg` or `.png`.
2. Run `npm run images`. It prints the new `public/...webp` path it created for your photo — copy that path.
3. Open the relevant file in `src/content/` (e.g. `dishes.json` for a new dish) and paste that path into the field that holds photo paths there — usually called `"image"`, though `galleries.json` calls it `"src"`. Match the format already used by the entries around it (a leading slash, e.g. `"/food/my-new-dish.webp"`).
4. Run `npm test` to confirm the path resolves.

**The share preview.** When someone pastes a link to the site into WhatsApp or posts it on social media, the picture that appears in the preview is `public/og-image.jpg`. It is generated by `npm run images` too, from `assets-source/atmosphere/dining.jpg` — replace that photo and re-run the script and the preview changes with it. Don't edit `public/og-image.jpg` by hand: it isn't committed, and the next `npm run images` (or `npm run build`) silently overwrites it with a fresh copy made from that source photo.

## How to change the menu

The dishes and drinks shown on the site are two separate lists, plus two downloadable PDFs.

**Dishes** — edit `src/content/dishes.json`. Each entry needs an `id` (a short unique label, never shown to customers), `name`, `description`, and `image` (see "How to add or replace a photo" above). Add, remove, or edit an entry, then run `npm test`.

**Drinks** (mocktails, cocktails, wine) — edit `src/content/drinks.json` the same way. The `category` field must be exactly `"mocktail"`, `"cocktail"`, or `"wine"`. This isn't just a test rule: the site's own code checks it the instant the page loads, on every visit, not only when `npm test` runs. Get it wrong and the *entire* site fails to render — a blank page on every route, not just a broken drinks list — so `npm test` catching the typo first, before it ever reaches a real visitor, is doing you a favor. `image` can be `null` if there's no photo for that drink yet.

**The downloadable PDF menus** (the "Food Menu" / "Drinks Menu" buttons) are separate from the two lists above — they're the full printed menu as a PDF, not generated from `assets-source/`. To replace one, overwrite `public/menus/food-menu.pdf` or `public/menus/drinks-menu.pdf` with the new file under the same filename. (You can use a different filename instead, but then you must also update the matching `"file"` path in `src/content/menus.json`.)

## Other content changes

- **Opening hours** — `src/content/site.json`, the `hours` array. Each entry lists the days it covers (`"Mo"` through `"Su"`) plus 24-hour `opens`/`closes` times (e.g. `"12:00"`, `"23:30"`). This one value drives both the hours shown in the footer and the hours reported to Google, so it only ever needs to be correct in one place.
- **Press / news articles** — `src/content/press.json`.
- **The "Our Story" text** — `src/content/story.json`, the `paragraphs` array.

## What still needs a developer

Section headings and intro copy — "Atmosfera", "Visit Us", "Hand-crafted Pastas & Wood-Fired Classics", "Latest Stories", and similar — are hardcoded inside the component files under `src/components/`, not in `src/content/`. If you go looking for "Atmosfera" in a JSON file expecting to change it, you won't find it — that text has to be edited in the component file itself, which is developer work.

The page's SEO title and description are a second version of the same problem. `index.html` has its own hardcoded copies of the page `<title>`, meta description, meta keywords, canonical link, and the Open Graph/Twitter preview text — this site has no server that generates `index.html` from `site.json` at build time, so the two are independent files that happen to need to say the same thing. `src/test/head.test.ts` is what keeps them matched: if you edit `site.json`'s `name`, `tagline`, `strapline`, or any of the `seo.*` fields and then run `npm test` as instructed above, several assertions naming `index.html` can fail. **That is not a sign you broke something** — it's the test telling you `index.html` needs the matching edit too. Open `index.html`, update the `<title>`, the `description`/`keywords` meta tags, the `canonical` link, and the `og:*`/`twitter:*` tags to match, then run `npm test` again until it's green. This is developer-adjacent work — safe to do carefully by hand, but easy to get subtly wrong, so ask a developer if you're not sure.

A small number of photos are referenced directly in a component file instead of through `src/content/` — for example the textured background behind the hero section, which is `/hero/brick.webp` hardcoded in `src/components/Hero.tsx`. **Replacing** that photo (dropping a new file into `assets-source/hero/` under the exact filename `brick.jpg`/`brick.jpeg`/`brick.png` and running `npm run images`, per "How to add or replace a photo" above) works exactly as documented, with no code edit needed. **Swapping it for a photo saved under a different filename** does not — there is no JSON field to paste that new path into, because none exists for this image. That's a component edit, and needs a developer. If you try it anyway, `npm test` fails and names the missing path, so the site can't quietly lose its background while the tests stay green.

Each dish in `dishes.json` also carries a `tags` field (e.g. `"vegan"`, `"gluten free"`) that is recorded but not currently shown anywhere on the site — editing it won't change what a customer sees.

## Tests

- `npm test` runs the full test suite — checks that every image path used in `src/content/`, in a component, in the stylesheet, or in `index.html` resolves to a real file, that required fields aren't left blank, and more (see "Where the content lives" above).
- `npm run test:deploy` is what the hosting platform runs before every deploy, as part of the build command. It runs the same suite minus two files, and that difference is not cosmetic: dropping two files also changes how Vitest spreads the rest across workers, so a slow test can pass under `npm test` and time out here. One did, and it refused a deploy. Run both.
- `npm run gate` runs everything a push needs: images, typecheck, lint, `npm test`, `npm run test:deploy`, and the production build. `.githooks/pre-push` runs the same list, plus the browser suite when a push touches anything it can observe.

## Components kept but not shown on the site

Six component files exist in `src/components/` but are not currently rendered anywhere on the site: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, and `SignatureMocktails.tsx`. They're kept on purpose, not leftover clutter — a test (`src/test/no-dead-backend.test.ts`) fails if any of them is deleted. Most carry a comment at the top of the file explaining what would need to happen to bring them back onto the site. (`NewsPress.tsx` doesn't have one, but it already reads live data from `press.json` — reviving it is a matter of importing it and adding it to the page in `src/App.tsx`.)

## `New Menu/`

You may find a `New Menu/` folder at the repository root, containing the designer's original Illustrator source files for the printed menus. It's excluded from git (see `.gitignore`) because those files are large, so it won't appear on a fresh checkout of this repository unless someone copies it back in — there's nothing to set up.
