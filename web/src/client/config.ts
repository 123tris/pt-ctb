// The site's settings (assets/js/config.js). The bundle keeps it as an import of that file, not a copy
// (tools/web-build.mjs): tools/build-site.mjs fills in each branch's own settings there, and tools/serve.mjs the local
// ones, and its version stamp is what index.html checks a deploy's code against.

export { CONFIG } from '../../../assets/js/config.js';
