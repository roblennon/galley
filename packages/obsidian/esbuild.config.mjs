import esbuild from 'esbuild';
import process from 'node:process';

const watch = process.argv[2] === 'watch';

/** Obsidian provides these at runtime; bundling them would shadow the app's
 * own instances (CodeMirror state would split into two universes). */
const externals = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
];

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: externals,
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  outfile: 'dist/main.js',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
