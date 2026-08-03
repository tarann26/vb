import React, { useEffect, useState } from 'react';
import { useSession } from './session';
import Login from './Login';
import { fetchContent } from './content';
import type { ContentFileName, ContentTypeMap, LoadedContent } from './content';
import RecordList from './RecordList';
import { ARTICLE_FIELDS, DISH_FIELDS, DRINK_FIELDS } from './fields';
import type { FieldsOf } from './fields';
import { replaceAt, useValidation } from './useValidation';
import type { Article, Dish, Drink } from '../content/types';

// Default export, deliberately: React.lazy (src/App.tsx) requires one --
// there is no lazy() form that takes a named export.
//
// The route, the bundle guard that keeps everything under src/admin/ out of
// the main chunk (see src/test/bundle.test.ts and
// src/test/bundle.post-build.test.ts), and the login gate in front of it are
// Task 1's. Task 6 is what turns the logged-in placeholder into a working
// screen for the three content files whose forms Tasks 4/5 already built in
// full (dishes.json, drinks.json, press.json -- each a flat array of
// records with an `id`, so RecordList's own machinery already covers them
// with no new component). Hours/sections/scheduling (site.json's own
// fields, sections.json), the menu PDFs, and story/galleries/copy.json are
// later tasks' screens, not this one's.
const AdminApp: React.FC = () => {
  const { status, logIn } = useSession();

  if (status === 'checking') {
    // src/App.tsx's <Suspense fallback={null}> already covers the moment
    // this chunk itself is still downloading; this covers the moment right
    // after it has loaded but before GET /api/wa (the session probe) has
    // answered. Rendering nothing here too avoids a login-form flash for
    // someone who is, in fact, already logged in.
    return null;
  }

  if (status === 'out') {
    return <Login onLogin={logIn} />;
  }

  // status === 'in'.
  return (
    <div className="min-h-screen bg-[#f7f5f0] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 font-['Parisienne'] text-3xl text-[#222]">Via Bianca</h1>
        {/* Publish (Task 10) doesn't exist yet -- nothing typed below this
            line leaves the browser. Said plainly, not left to be discovered
            the hard way by an owner who assumes a form that validates as
            she types must also be one that saves. */}
        <p className="mb-8 font-['Montserrat'] text-sm text-gray-500">
          Publishing isn't built yet — nothing you change below is saved anywhere.
        </p>
        <ArraySection<Dish>
          file="dishes.json"
          load={() => fetchContent('dishes.json')}
          heading="Dishes"
          noun="dish"
          fields={DISH_FIELDS}
          itemLabel={(dish) => dish.name || 'Untitled dish'}
          makeBlank={blankDish}
        />
        <ArraySection<Drink>
          file="drinks.json"
          load={() => fetchContent('drinks.json')}
          heading="Drinks"
          noun="drink"
          fields={DRINK_FIELDS}
          itemLabel={(drink) => drink.name || 'Untitled drink'}
          makeBlank={blankDrink}
        />
        <ArraySection<Article>
          file="press.json"
          load={() => fetchContent('press.json')}
          heading="Press"
          noun="article"
          fields={ARTICLE_FIELDS}
          itemLabel={(article) => article.title || 'Untitled article'}
          makeBlank={blankArticle}
        />
      </div>
    </div>
  );
};

type LoadState<Item> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Item[]; sha: string };

interface ArraySectionProps<Item extends { id: string }> {
  // Which real content file this section edits -- passed to useValidation
  // (so the debounced pass runs validateContent's rules for THIS file, not
  // a generic one) and shown in error text. Typed as the whole
  // ContentFileName union rather than a literal `K` tied to `Item`: doing
  // that properly needs `Item` derived from `ContentTypeMap[K]` through a
  // conditional type, which the compiler cannot carry through a component
  // generic over `Item` alone (confirmed while writing this). Every actual
  // call site below supplies `file` and `load` TOGETHER as a matched pair
  // (e.g. `file="dishes.json"` with `load={() => fetchContent('dishes.json')}`),
  // which is what keeps this honest in practice -- `load`'s own return type
  // is checked against `Item[]` fully, with no cast, at each call site.
  file: ContentFileName;
  load: () => Promise<LoadedContent<Item[]>>;
  heading: string;
  noun: string;
  fields: FieldsOf<Item>;
  itemLabel: (item: Item) => string;
  makeBlank: () => Item;
}

// The one generic screen every array-shaped, id-keyed content file needs:
// fetch it from GET /api/content (never src/content/index.ts -- see
// src/admin/content.ts's own header comment for why a build-time snapshot
// would silently reintroduce the vanishing-edit bug Task 3 exists to
// close), hold the whole file in memory, validate the whole file on a
// debounce tick (useValidation), and hand RecordList the full, unfiltered
// problem list -- exactly the contract Task 4/5 already built RecordForm
// and RecordList's own banners against.
function ArraySection<Item extends { id: string }>({
  file,
  load,
  heading,
  noun,
  fields,
  itemLabel,
  makeBlank,
}: ArraySectionProps<Item>) {
  const [state, setState] = useState<LoadState<Item>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) setState({ status: 'loaded', data: loaded.data, sha: loaded.sha });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render (each call site passes an
    // inline arrow) -- keying on `file` instead, which is stable for the
    // lifetime of one section, is what keeps this effect from re-fetching
    // on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const data = state.status === 'loaded' ? state.data : undefined;
  // `Item[]` and `ContentTypeMap[file]` are the same real array type for
  // every call site below (see ArraySectionProps.file's own comment) --
  // this cast documents that equality where the compiler cannot verify it
  // through Item, an unrelated type parameter from useValidation's own `K`.
  // Nothing downstream of `useValidation` reads `data` as anything other
  // than what it already is; the cast changes no runtime behaviour.
  const problems = useValidation(file, data as ContentTypeMap[ContentFileName] | undefined);

  if (state.status === 'loading') {
    return (
      <p className="mb-10 font-['Montserrat'] text-sm text-gray-500">
        Loading {heading.toLowerCase()}…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="mb-10 font-['Montserrat'] text-sm text-red-600">
        {`Could not load ${heading.toLowerCase()}: ${state.message}`}
      </p>
    );
  }

  const items = state.data;

  function commit(next: Item[]) {
    setState({ status: 'loaded', data: next, sha: (state as { status: 'loaded'; sha: string }).sha });
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-['Montserrat'] text-lg uppercase tracking-wide text-[#222]">{heading}</h2>
      <RecordList<Item>
        fields={fields}
        items={items}
        // replaceAt, not a hand-rolled reconstruction: `next` already
        // carries everything RecordForm's own onChange preserved (unknown
        // keys included), and replaceAt's whole job is to not undo that.
        // See src/admin/useValidation.ts's own comment and
        // useValidation.test.ts's round-trip tests for exactly the failure
        // this guards against.
        onChange={(index, next) => commit(replaceAt(items, index, next))}
        onReorder={(ids) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          commit(ids.map((id) => byId.get(id) as Item));
        }}
        onAdd={() => commit([...items, makeBlank()])}
        onRemove={(index) => commit(items.filter((_, i) => i !== index))}
        noun={noun}
        itemLabel={itemLabel}
        problems={problems}
      />
    </section>
  );
}

// Blank starting points for "Add a dish/drink/article" -- every required
// field present and empty/neutral, so the freshly-added record renders
// (RecordForm has no notion of a field that doesn't exist yet) and
// immediately shows her, via the same debounced validation as everything
// else, exactly what it still needs.
function blankDish(): Dish {
  return { id: crypto.randomUUID(), name: '', description: '', image: '', tags: [] };
}

function blankDrink(): Drink {
  return { id: crypto.randomUUID(), name: '', description: '', category: 'mocktail', image: null };
}

function blankArticle(): Article {
  return { id: crypto.randomUUID(), title: '', publication: '', date: '', excerpt: '', url: null, image: '' };
}

export default AdminApp;
