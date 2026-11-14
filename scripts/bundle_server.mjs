import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT_DIR = process.cwd();
const OUT_FILE = path.join(ROOT_DIR, 'dist-electron', 'server.cjs');

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

await build({
  entryPoints: [path.join(ROOT_DIR, 'server', 'index.ts')],
  outfile: OUT_FILE,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['node:sqlite', 'sqlite', 'electron'],
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

const stat = fs.statSync(OUT_FILE);
console.log(
  `[BUNDLE] Server bundled cleanly -> ${OUT_FILE} (${Math.round(stat.size / 1024)} KB)`
);
