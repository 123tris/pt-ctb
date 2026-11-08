// Bundles the new web client (web/src, TypeScript) with esbuild, for tools/build-site.mjs (into dist/assets/web/) and
// tools/serve.mjs (in memory, rebuilt as the sources change). The app (web/src/app.ts, assets/web/app.js, which
// index.html loads) and one file per page (web/src/entries, assets/web/<entry>.js, which the app loads as each page is
// opened), served next to the old site's assets/js, plus the chunks they share. Every page reaches the app's shell
// (web/src/client/page.ts), so the shell and what the pages share with it come as one chunk.
//
// Of the old site's modules, two stay imports of that same file (../js/config.js from assets/web/), never copies: the
// settings, which build-site.mjs fills in per branch (and serve.mjs locally), and the Portuguese strings, which only
// Portuguese visitors load. build-site.mjs then versions those addresses (?v=) with everything else. The old modules
// with no browser code (the data's shapes, the page addresses, the maps index's decoders) are bundled in like the
// client's own. Anything else there is the old app's browser code, which would run a second time: the build refuses it.
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

/**
 * The bundle's entry points: the app (assets/web/app.js) and the pages the new client draws, every file in
 * web/src/entries (assets/web/<name>.js, which the app loads, and the old router where the app can't load).
 */
export const entries = () => ({
  app: 'web/src/app.ts',
  ...Object.fromEntries(fs.readdirSync(path.join(root, 'web', 'src', 'entries'))
    .filter(f => f.endsWith('.ts')).sort().map(f => [f.slice(0, -3), `web/src/entries/${f}`])),
});

/** The old site's modules kept as imports of the file itself: the settings, and the Portuguese strings. */
const SHARED = new Set(['config.js', 'core/pt.js']);
/** The old site's modules without browser code or state, bundled in. */
const PURE = new Set(['core/routes.js', 'core/maps-search.js', 'core/model.js', 'core/data-name.js', 'core/legends.js', 'core/presets.js']);

/**
 * Keeps imports of the shared old modules (SHARED) as imports, at their address relative to assets/web/; lets the pure
 * ones (PURE) be bundled; refuses the rest.
 */
const keepOldSite = {
  name: 'keep-old-site',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, args => {
      const file = path.resolve(args.resolveDir, args.path);
      if (!file.startsWith(oldSite)) return undefined;
      const name = path.relative(oldSite, file).split(path.sep).join('/');
      if (SHARED.has(name)) return { path: path.relative(served, file).split(path.sep).join('/'), external: true };
      if (PURE.has(name)) return undefined;
      return {
        errors: [{ text: `assets/js/${name} is the old app's browser code, which would run twice: port what's needed to web/src, or list it in PURE (tools/web-build.mjs) if it has no browser code or state.` }],
      };
    });
  },
};

/** esbuild's options; `minify` off (with inline source maps) for local work. */
export function webOptions({ outdir, minify = true }) {
  return {
    absWorkingDir: root,
    entryPoints: Object.fromEntries(Object.entries(entries()).map(([name, file]) => [name, path.join(root, file)])),
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

/**
 * A pure module of web/src (no browser code), for the build's own use: build-site.mjs reads the page table
 * (web/src/pages.ts) with it. Bundled first, so it doesn't depend on the Node version running TypeScript itself (Pages
 * builds with Node 22, which may not).
 */
export async function importPure(file) {
  const { outputFiles } = await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, file)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'warning' });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'assets', 'web'));
  const result = await buildWeb({ outdir });
  for (const [file, { bytes }] of Object.entries(result.metafile.outputs)) console.log(`${file}  ${(bytes / 1024).toFixed(1)} KB`);
  if (!fs.existsSync(outdir)) process.exit(1);
}
