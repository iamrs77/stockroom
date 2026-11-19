import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Finds the server package folder by walking up from this file. This works both when running
 * from src/ in development and from the bundled dist/main.js in production.
 */
function findServerRoot(): string {
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(path.join(dir, 'drizzle', 'meta', '_journal.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find the server folder (looked for drizzle/meta/_journal.json)');
    }
    dir = parent;
  }
}

export function migrationsDir(): string {
  return path.join(findServerRoot(), 'drizzle');
}

/** The built web app, which the server hosts in production. */
export function webDistDir(): string {
  return path.resolve(findServerRoot(), '../web/dist');
}
