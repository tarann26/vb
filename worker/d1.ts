// Task 4 fills this class in for real (read/write against the `content` and
// `revisions` tables from worker/migrations/0001_content.sql). It exists
// here, one task early, only so worker/store.ts's `storeFor` has a concrete
// class to construct -- see that file's own comment on why the stub lands
// in Task 3 rather than leaving `storeFor` unable to typecheck until Task 4.
//
// `import type` on ./store, not a value import: the two files reference each
// other (store.ts constructs `D1Store`; this file implements store.ts's
// `ContentStore`), and keeping this half type-only means the pair has no
// runtime circular dependency, only a type-level one that TypeScript erases
// before either file's JS ever runs.
import type { ContentStore, StoredContent, StoreWriteFile } from './store';

export class D1Store implements ContentStore {
  readonly name = 'd1' as const;

  // A parameter property Task 4 will query for real. `noUnusedLocals`
  // (tsconfig.worker.json) flags a private field that is never READ, not
  // just never assigned -- a bare `private readonly db` here is not enough
  // on its own, so `read` below touches it once to keep this stub
  // typechecking until Task 4 gives it a real body.
  constructor(private readonly db: D1Database) {}

  async read(path: string): Promise<StoredContent | null> {
    void this.db;
    throw new Error(`D1Store.read("${path}") is not implemented until Task 4`);
  }

  async write(files: StoreWriteFile[], message: string, publishId: string): Promise<{ sha: string | null }> {
    throw new Error(
      `D1Store.write(${files.length} file(s), "${message}", publish ${publishId}) is not implemented until Task 4`,
    );
  }
}
