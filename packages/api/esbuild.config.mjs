import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(packageJson.dependencies)
  .filter((name) => !name.startsWith('@tra/'))
  .flatMap((name) => [name, `${name}/*`]);

await build({
  alias: {
    '@tra/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
    '@tra/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
  },
  bundle: true,
  entryPoints: ['src/index.ts'],
  external,
  format: 'cjs',
  logLevel: 'info',
  outfile: 'dist/index.cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
});
