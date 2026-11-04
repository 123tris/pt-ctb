// Bundles the new web client (web/src, TypeScript) with esbuild, for tools/build-site.mjs (into dist/assets/web/) and
// tools/serve.mjs (in memory, rebuilt as the sources change). One file per entry (web/src/entries), served at
// assets/web/<entry>.js next to the old site's assets/js, plus the chunks the entries share.
//
// The old site's modules aren't copied into the bundle: an import of anything under assets/js stays an import, of that
// same file (../js/core/ui.js from assets/web/), so the new code shares the very modules the old app has loaded: its
// settings (config.js, which build-site.mjs edits per branch), its language and strings, its sign-in. build-site.mjs
// then versions those addresses (?v=) with everything else.
//
//   node tools/web-build.mjs [outdir]    a one-off build (default dist/assets/web), with each file's size

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldSite = path.join(root, 'assets', 'js') + path.sep;
/** Where the bundle is served from: imports of the old site are written relative to it. */
const served = path.join(root, 'assets', 'web');

/** The pages the new client draws, every file in web/src/entries: assets/web/<name>.js, which assets/js/app.js loads. */
export const ENTRIES = Object.fromEntries(fs.readdirSync(path.join(root, 'web', 'src', 'entries'))
  .filter(f => f.endsWith('.ts')).sort().map(f => [f.slice(0, -3), `web/src/entries/${f}`]));

/** Keeps imports of the old site's modules (assets/js/…) as imports, at their address relative to assets/web/. */
const keepOldSite = {
  name: 'keep-old-site',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, args => {
      const file = path.resolve(args.resolveDir, args.path);
      if (!file.startsWith(oldSite)) return undefined;
      return { path: path.relative(served, file).split(path.sep).join('/'), external: true };
    });
  },
};

/** esbuild's options; `minify` off (with inline source maps) for local work. */
export function webOptions({ outdir, minify = true }) {
  return {
    absWorkingDir: root,
    entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([name, file]) => [name, path.join(root, file)])),
    bundle: true,
    format: 'esm',
    splitting: true,
    target: 'es2022',
    minify,
    sourcemap: minify ? false : 'inline',
    legalComments: 'none',
    outdir,
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    metafile: true,
    logLevel: 'warning',
    plugins: [keepOldSite],
  };
}

/** Builds into `outdir`; the result's metafile lists every output and its size. */
export const buildWeb = ({ outdir, minify }) => esbuild.build(webOptions({ outdir, minify }));

/** An incremental build kept in memory (tools/serve.mjs): rebuild() returns outputFiles. */
export const webContext = ({ outdir, minify = false }) => esbuild.context({ ...webOptions({ outdir, minify }), write: false });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'assets', 'web'));
  const result = await buildWeb({ outdir });
  for (const [file, { bytes }] of Object.entries(result.metafile.outputs)) console.log(`${file}  ${(bytes / 1024).toFixed(1)} KB`);
  if (!fs.existsSync(outdir)) process.exit(1);
}
