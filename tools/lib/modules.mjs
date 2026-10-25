// The static import graph of the site's ES modules, for tools/build-site.mjs's <link rel="modulepreload"> tags: without
// them the browser only learns of each level of imports after the one above has loaded (five levels from app.js).

import fs from 'node:fs';
import path from 'node:path';

// `import x from './a.js'`, `export { y } from './b.js'` and `import './c.js'`; not `import('./page.js')`, which is a
// lazy page load. A match inside a comment at worst preloads a module that exists anyway (missing files are skipped).
const STATIC = /\bfrom\s*(['"])(\.{1,2}\/[^'"?]+\.js)(?:\?[^'"]*)?\1|\bimport\s+(['"])(\.{1,2}\/[^'"?]+\.js)(?:\?[^'"]*)?\3/g;

/** Every module `entry` loads statically, directly or not, as absolute paths in a stable order (the entry left out). */
export function staticImports(entry) {
  const seen = new Set([path.resolve(entry)]);
  const order = [];
  const visit = file => {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(STATIC)) {
      const dep = path.resolve(path.dirname(file), m[2] ?? m[4]);
      if (seen.has(dep) || !fs.existsSync(dep)) continue;
      seen.add(dep);
      order.push(dep);
      visit(dep);
    }
  };
  visit(path.resolve(entry));
  return order;
}
