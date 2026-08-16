// Where a content file lives. One function answers that for the whole
// Worker, so "nothing that exists today migrates" (the spec's own Phase 2
// instruction) is enforced by code rather than by discipline -- there is no
// path through publish, undo or GET /api/content that can send an existing
// file to D1 without this function saying so.
//
// Two implementations rather than write-to-both or a straight migration.
// Write-to-both doubles the failure surface of every publish and leaves the
// two stores disagreeing with no reconciliation story; a straight migration
// has no rollback. This is the only option where the switch is one config
// change and the rollback is the same change backwards.
import {
  commitFiles,
  getFileContent,
  type GitHubEnv,
} from './github';
import { D1Store } from './d1';

export interface StoredContent {
  // The exact text of the document. On GitHub this is the decoded blob; on
  // D1 it is the `body` column verbatim.
  content: string;
  // An opaque token that changes when the content changes and never
  // otherwise. GitHub supplies a blob sha; D1 supplies a SHA-256 of the body.
  // The dashboard round-trips it as `baseSha` and never inspects it, which is
  // what lets the two stores use different things here.
  sha: string;
}

export interface StoreWriteFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  // Present only from a caller that tracks one -- see handlePublish's step 3.
  // The GitHub store ignores it (handlePublish does that comparison itself,
  // before this module is reached); the D1 store re-checks it INSIDE `write`,
  // before any mutation, which is its whole concurrency guard.
  baseSha?: string;
}

export interface ContentStore {
  readonly name: 'github' | 'd1';
  read(path: string): Promise<StoredContent | null>;
  // Returns the commit sha for GitHub and `null` for D1, because a D1 write
  // creates no commit and there is nothing honest to put there. Callers must
  // handle `null` rather than inventing a value: worker/index.ts's publish
  // response and the dashboard's build-status polling both branch on it
  // (Task 10).
  write(files: StoreWriteFile[], message: string, publishId: string): Promise<{ sha: string | null }>;
}

export interface StoreEnv extends GitHubEnv {
  DB: D1Database;
  CONTENT_STORE?: string;
}

// Paths that live in D1 regardless of CONTENT_STORE, because they exist
// nowhere else. src/content/awards.json has never been a file in this
// repository and never will be: Awards is built on D1 from the start rather
// than as a JSON file that would need migrating two months later (the spec's
// own words, Phase 4).
export const D1_ONLY_PATHS: ReadonlySet<string> = new Set(['src/content/awards.json']);

// The GitHub store is exactly today's behaviour behind the interface. It
// deliberately adds nothing: no retry, no caching, no extra validation. If
// this wrapper ever grows a behaviour of its own, the "the GitHub path is
// left fully working" property of this phase stops being checkable by
// reading one small file.
class GitHubStore implements ContentStore {
  readonly name = 'github' as const;
  constructor(private readonly env: GitHubEnv) {}

  async read(path: string): Promise<StoredContent | null> {
    return getFileContent(this.env, path);
  }

  async write(files: StoreWriteFile[], message: string): Promise<{ sha: string }> {
    // `baseSha` is stripped rather than passed through: commitFiles' own
    // CommitFile type has no such field, and handlePublish has already done
    // the comparison this store's conflict detection relies on (its step 3,
    // plus updateBranchHead's own 422). Passing an unknown key through would
    // be harmless today and a silent contract change the first time
    // commitFiles started reading its input more strictly.
    return commitFiles(
      this.env,
      files.map(({ path, content, encoding }) => ({ path, content, encoding })),
      message,
    );
  }
}

export function storeFor(env: StoreEnv, path: string): ContentStore {
  if (D1_ONLY_PATHS.has(path)) return new D1Store(env.DB);
  return env.CONTENT_STORE === 'd1' ? new D1Store(env.DB) : new GitHubStore(env);
}

// Splits one publish request into its two legs, preserving the caller's
// order within each. Order BETWEEN the legs is decided by the caller
// (worker/index.ts writes D1 first -- see its own comment for why), not here.
export function partitionByStore(
  env: StoreEnv,
  files: StoreWriteFile[],
): { d1: StoreWriteFile[]; github: StoreWriteFile[] } {
  const d1: StoreWriteFile[] = [];
  const github: StoreWriteFile[] = [];
  for (const file of files) {
    (storeFor(env, file.path).name === 'd1' ? d1 : github).push(file);
  }
  return { d1, github };
}
