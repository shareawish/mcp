// Bundle both MCP servers into dependency-free Node ESM files.
import { build } from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });
for (const name of ['creator', 'wishlist']) {
  await build({
    entryPoints: [resolve(root, `src/${name}/index.ts`)],
    outfile: resolve(root, `dist/${name}.js`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node18'],
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    logLevel: 'info',
  });
  chmodSync(resolve(root, `dist/${name}.js`), 0o755);
}
console.log('built @shareawish/mcp -> dist/creator.js, dist/wishlist.js');
