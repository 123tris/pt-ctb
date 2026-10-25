// Cloudflare Pages' _headers file: a path line, then its indented "Name: value" lines. Used by tools/build-site.mjs.
// Two blocks for the same path don't simply add up on ptcatch.com: with a second /data/* block (CORS for the
// development site) the first block's Cache-Control was lost and data came back max-age=0. So a header for a path
// that already has a block goes inside that block.

/** The blocks in a _headers file, in order: [{ path, headers: [[name, value]] }]. Comments and blank lines are skipped. */
export function parseHeaders(text) {
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const [, name, value] = line.trim().match(/^([^:]+):\s*(.*)$/) ?? [];
      if (name && blocks.length) blocks[blocks.length - 1].headers.push([name, value]);
    } else blocks.push({ path: line.trim(), headers: [] });
  }
  return blocks;
}

/** Adds `name: value` at the end of the block for `path`, which must be there exactly once. */
export function addHeader(text, path, name, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, i) => (line.trim() === path && !/^\s/.test(line) ? [i] : []));
  if (starts.length !== 1) throw new Error(`_headers: expected one ${path} block, found ${starts.length}.`);
  let end = starts[0] + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end]) && !lines[end].trimStart().startsWith('#')) end++;
  lines.splice(end, 0, `  ${name}: ${value}`);
  return lines.join(eol);
}

/** Throws unless `path` has exactly one block and it sets every header in `names`. */
export function assertOneBlock(text, path, names) {
  const blocks = parseHeaders(text).filter(b => b.path === path);
  if (blocks.length !== 1) throw new Error(`_headers: expected one ${path} block, found ${blocks.length}.`);
  const missing = names.filter(n => !blocks[0].headers.some(([name]) => name.toLowerCase() === n.toLowerCase()));
  if (missing.length) throw new Error(`_headers: the ${path} block is missing ${missing.join(', ')}.`);
}
