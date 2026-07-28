// Build both bundles the extension ships: the Node extension host and the
// browser webview (canvas + React). Run: node esbuild.mjs [--watch]
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extension = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  entryPoints: ['webview/main.tsx'],
  outfile: 'dist/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.css': 'css' },
  // React Flow ships CSS imported by the canvas; esbuild bundles it to
  // dist/webview.css alongside the JS.
  sourcemap: true,
};

if (watch) {
  const [ec, wc] = await Promise.all([context(extension), context(webview)]);
  await Promise.all([ec.watch(), wc.watch()]);
  console.log('esbuild watching…');
} else {
  await Promise.all([build(extension), build(webview)]);
  console.log('esbuild: built dist/extension.js + dist/webview.js');
}
