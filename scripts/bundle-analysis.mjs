import * as esbuild from 'esbuild';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const entry = join(root, 'netlify/functions/analysis-src.js');
const outfile = join(root, 'netlify/functions/analysis.js');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  target: 'node18',
});

console.log('[bundle-analysis] Wrote', outfile);
