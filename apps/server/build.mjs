// Bundles the server into dist/main.js. Workspace packages (@stockroom/*) are written in TypeScript,
// so they are bundled in; every other dependency stays in node_modules.
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@stockroom/'));

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});
