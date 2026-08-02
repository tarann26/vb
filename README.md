# Via Bianca — Website

The website for Via Bianca, an Italian restaurant in Greater Kailash I, New Delhi. It deploys on Vercel, which builds and publishes automatically from this repository (see `vercel.json`).

## Setup

```
npm install
npm run dev      # local dev server, for previewing changes before they go live
npm run build    # production build — produces the files that get deployed
npm test         # the full test suite — run this after any content change
```

## Where the content lives

Every piece of text and every image path shown on the site comes from the JSON files in `src/content/`. That is the only place you should need to edit for a content change — you should never need to open a `.tsx` file to update a phone number, a dish, or a paragraph of the story.

| File | Controls |
|---|---|
| `src/content/site.json` | Restaurant name, tagline, address, phone numbers, WhatsApp, Instagram/LinkedIn links, opening hours, SEO title/description, copyright year |
| `src/content/dishes.json` | The dish cards shown on the homepage |
| `src/content/drinks.json` | Mocktails, cocktails and wines |
| `src/content/press.json` | The "In the Press" articles (homepage and `/blogs`) |
| `src/content/story.json` | The "Our Story" heading and paragraphs |
| `src/content/galleries.json` | Photo galleries — the Atmosfera scroller, the Our Story carousel, and the hero collage |
| `src/content/menus.json` | Labels and file paths for the two downloadable PDF menus |

These are plain JSON files — every entry needs matching quotes and a comma between items, with no comma after the last one. If a save breaks the JSON, `npm test` (or the site itself) will fail loudly rather than quietly showing a broken page, so when in doubt, save and run `npm test`.

After editing any content file, always run `npm test`. The suite (currently 445 tests) checks that every image path used in `src/content/` actually exists on disk, that required fields like a dish's name aren't left blank, and that no dish description contains an internal note left in by mistake (words like "TBD" or "verify"). If a test fails, its name tells you which file and field to look at.

## How to add or replace a photo

Photos on the site are generated, not stored directly. You add the original photo to `assets-source/`, then run a script that shrinks it and converts it to a web-friendly `.webp` file in `public/` — the `public/` copy is what the live site actually serves.

**Never add, edit, or delete files by hand inside `public/atmosphere`, `public/food`, `public/hero`, `public/mocktails`, `public/our_story`, `public/press`, or `public/team`.** Anything placed there by hand will be silently deleted the next time anyone runs `npm run images`, because the script also removes any file in those folders that no longer has a matching original in `assets-source/`.

**To replace an existing photo:**
1. Find the original file in `assets-source/<category>/` — the category folders are `atmosphere`, `food`, `hero`, `mocktails`, `our_story`, `press`, `team`.
2. Replace it with your new photo, saved under the **exact same name before the dot** — same capitalisation, same spaces (e.g. `margarita.jpg` can be replaced by a file named `margarita.jpg` or `margarita.png`, but not `Margarita.jpg` or any other name). The extension (`.jpg`/`.jpeg`/`.png`) doesn't need to match the old one, but the name before it must. Keeping that name identical means the page that already shows this photo keeps working with no further edits.
3. Run `npm run images`. Watch the output — it prints one line per photo it processed, ending in a size like `(45KB)`. If your file isn't listed, or its line says `FAILED`, the photo did not update; fix that before continuing.
4. Run `npm test`. Green means the new photo is correctly wired up and will go live on the next build/deploy.

**To add a brand-new photo** (one that doesn't replace an existing one — for a new dish, for example):
1. Save it into the right `assets-source/<category>/` folder, using a new filename ending in `.jpg`, `.jpeg` or `.png`.
2. Run `npm run images`. It prints the new `public/...webp` path it created for your photo — copy that path.
3. Open the relevant file in `src/content/` (e.g. `dishes.json` for a new dish) and paste that path into the `"image"` field, matching the format already used by the entries around it (a leading slash, e.g. `"/food/my-new-dish.webp"`).
4. Run `npm test` to confirm the path resolves.

## How to change the menu

The dishes and drinks shown on the site are two separate lists, plus two downloadable PDFs.

**Dishes** — edit `src/content/dishes.json`. Each entry needs an `id` (a short unique label, never shown to customers), `name`, `description`, and `image` (see "How to add or replace a photo" above). Add, remove, or edit an entry, then run `npm test`.

**Drinks** (mocktails, cocktails, wine) — edit `src/content/drinks.json` the same way. The `category` field must be exactly `"mocktail"`, `"cocktail"`, or `"wine"` — anything else is deliberately rejected by the test suite so a typo can't quietly break the drinks list. `image` can be `null` if there's no photo for that drink yet.

**The downloadable PDF menus** (the "Food Menu" / "Drinks Menu" buttons) are separate from the two lists above — they're the full printed menu as a PDF, not generated from `assets-source/`. To replace one, overwrite `public/menus/food-menu.pdf` or `public/menus/drinks-menu.pdf` with the new file under the same filename. (You can use a different filename instead, but then you must also update the matching `"file"` path in `src/content/menus.json`.)

## Other content changes

- **Opening hours** — `src/content/site.json`, the `hours` array. Each entry lists the days it covers (`"Mo"` through `"Su"`) plus 24-hour `opens`/`closes` times (e.g. `"12:00"`, `"23:30"`). This one value drives both the hours shown in the footer and the hours reported to Google, so it only ever needs to be correct in one place.
- **Press / news articles** — `src/content/press.json`.
- **The "Our Story" text** — `src/content/story.json`, the `paragraphs` array.

## What still needs a developer

Section headings and intro copy — "Atmosfera", "Visit Us", "Hand-crafted Pastas & Wood-Fired Classics", "In the Press", and similar — are hardcoded inside the component files under `src/components/`, not in `src/content/`. If you go looking for "Atmosfera" in a JSON file expecting to change it, you won't find it — that text has to be edited in the component file itself, which is developer work.

Each dish in `dishes.json` also carries a `tags` field (e.g. `"vegan"`, `"gluten free"`) that is recorded but not currently shown anywhere on the site — editing it won't change what a customer sees.

## Tests

- `npm test` runs everything, including a check that every committed photo in `public/` still matches a fresh re-encode of its `assets-source/` original.
- `npm run test:deploy` runs everything *except* that one check, and is what Vercel runs before every deploy (see `vercel.json`). It's excluded there because that check re-encodes every image and compares the result byte-for-byte — and byte-identical output isn't guaranteed across machines. Photos are normally generated on a Mac, but Vercel builds on Linux, which can produce a technically-different-but-visually-identical file and fail the check for no real reason. Locally, always use plain `npm test`.

## Components kept but not shown on the site

Six component files exist in `src/components/` but are not currently rendered anywhere on the site: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, and `SignatureMocktails.tsx`. They're kept on purpose, not leftover clutter — a test (`src/test/no-dead-backend.test.ts`) fails if any of them is deleted. Most carry a comment at the top of the file explaining what would need to happen to bring them back onto the site. (`NewsPress.tsx` doesn't have one, but it already reads live data from `press.json` — reviving it is a matter of importing it and adding it to the page in `src/App.tsx`.)

## `New Menu/`

You may find a `New Menu/` folder at the repository root, containing the designer's original Illustrator source files for the printed menus. It's excluded from git (see `.gitignore`) because those files are large, so it won't appear on a fresh checkout of this repository unless someone copies it back in — there's nothing to set up.
