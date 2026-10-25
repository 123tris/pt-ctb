// node --test tools/lib/modules.test.mjs
// The modulepreload list is app.js's static imports: every core module it needs up front, and no lazily loaded page.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticImports } from './modules.mjs';

const js = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'js');
const rel = files => files.map(f => path.relative(js, f).split(path.sep).join('/'));

test("app.js's static graph has the core modules and no pages", () => {
  const graph = rel(staticImports(path.join(js, 'app.js')));
  for (const m of ['config.js', 'core/data.js', 'core/ui.js', 'core/model.js', 'core/maps-search.js']) assert.ok(graph.includes(m), m);
  assert.ok(!graph.some(m => m.startsWith('pages/')), graph.join(', '));
  assert.ok(!graph.includes('app.js'));
  assert.equal(new Set(graph).size, graph.length);
});
