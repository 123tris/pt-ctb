// Review aids on localhost. Only tools/serve.mjs adds this to index.html, as a plain script in <head> so it runs before
// the site's modules, and tools/ is never deployed.
// - "Design: after / before": "before" sets the ptcatch-design cookie (to "old"), and the server then answers with
//   the site as it was before this branch's changes: every file the branch changed as dev had it, and the web client
//   built from those sources. A reload keeps the route; the cookie remembers the choice.

if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  document.addEventListener('DOMContentLoaded', () => {
    const old = /(?:^|;\s*)ptcatch-design=old(?:;|$)/.test(document.cookie);
    const style = document.createElement('style');
    style.textContent = `.design-switch { position: fixed; left: 16px; bottom: 16px; z-index: 90; min-height: 44px; padding: 0 14px;
      border: 1px solid var(--border-strong); border-radius: var(--r); background: var(--surface-2); color: var(--text);
      font: 600 var(--fs-sm)/1 var(--font); cursor: pointer; }
      .design-switch:hover { background: var(--surface-3); }`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'design-switch';
    button.textContent = `Design: ${old ? 'before' : 'after'}`;
    button.title = old ? 'Showing the site before this branch’s changes. Switch to after them.' : 'Showing the site after this branch’s changes. Switch to before them.';
    button.addEventListener('click', () => {
      document.cookie = `ptcatch-design=${old ? 'new' : 'old'}; path=/; max-age=31536000; SameSite=Lax`;
      location.reload();
    });
    document.head.append(style);
    document.body.append(button);
  });
}
