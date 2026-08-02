// Two-letter schema.org day codes, in week order. A plain `string` here would
// let a typo (e.g. "Xx") through both the type checker and the JSON import
// widening; see the runtime guard around `assertHours` in src/content/index.ts
// for why a plain type annotation alone cannot catch that.
export type DayCode = 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';

export interface Hours {
  days: DayCode[]; // in week order, e.g. ['Mo', 'Tu', 'We']
  opens: string; // 24-hour "HH:MM"
  closes: string; // 24-hour "HH:MM"
}

export interface SiteContent {
  name: string;
  tagline: string;
  strapline: string;
  address: { street: string; locality: string; postalCode: string; country: string };
  phones: string[];
  whatsapp: { number: string; prefilledMessage: string };
  socials: { instagram: string; linkedin: string | null };
  hours: Hours[];
  seo: { title: string; description: string; keywords: string; ogImage: string; url: string };
  copyrightYear: number;
}

export interface Dish {
  id: string;
  name: string;
  description: string;
  image: string;
  // Transcribed from the menu's dietary legend (e.g. "nuts", "dairy", "gluten
  // free", "seafood"). Authored on every dish but deliberately not yet
  // rendered by any component -- whether/how to surface dietary tags on the
  // page is a design decision the owner has not made. Do not start rendering
  // this field, and do not assume it is live: any editing tool built against
  // this type must not treat `tags` as visible to a diner today.
  tags: string[];
}

export interface Drink {
  id: string;
  name: string;
  description: string;
  category: 'mocktail' | 'cocktail' | 'wine';
  image: string | null;
}

export interface Article {
  id: string;
  title: string;
  publication: string;
  date: string;
  excerpt: string;
  url: string | null;
  image: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface Galleries {
  atmosphere: GalleryImage[];
  ourStory: GalleryImage[];
  heroCollage: { src: string; className: string }[];
}

export interface StoryContent {
  heading: string;
  paragraphs: string[];
}

export interface MenuFile {
  id: string;
  label: string;
  file: string;
}
