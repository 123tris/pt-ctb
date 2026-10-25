// Where a data file lives on R2: its name with the hash of its content (meta.files) before the extension, e.g.
// players/1.json + YqdZgQh-qv → players/1.YqdZgQh-qv.json. A name never gets different content, so the files can be
// cached for a year and a new export can't be mixed up with an old one. Shared by core/data.js, tools/r2-sync.mjs and
// tools/serve.mjs.

/** players/1.json, 'YqdZgQh-qv' → players/1.YqdZgQh-qv.json */
export const hashedName = (path, hash) => path.replace(/(\.[^./]+)?$/, `.${hash}$1`);

/** The other way round: players/1.YqdZgQh-qv.json → players/1.json (anything else is returned as is). */
export const plainName = name => name.replace(/\.[A-Za-z0-9_-]{10}(\.[^./]+)$/, '$1');
