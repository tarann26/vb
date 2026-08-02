import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

// Every file under public/, as the leading-slash URL path the site serves it
// at (e.g. "/hero/brick.webp").
//
// Built from readdir rather than answered with existsSync, because macOS's
// filesystem is case-insensitive and Vercel's is not: existsSync('/Hero/
// Brick.webp') is true on the machine the check runs on and a 404 in front
// of a customer. Shared by every test that has to decide whether an asset
// path resolves, so all of them agree on what "exists" means.
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join('/', prefix, entry.name)],
  );
}

export const publicFiles: ReadonlySet<string> = new Set(
  listFiles(join(process.cwd(), 'public')),
);
