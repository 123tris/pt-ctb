// Review aids on localhost. Only tools/serve.mjs adds this to index.html, as a plain script in <head> so it runs before
// the site's modules, and tools/ is never deployed.
// - "Design: new / old": "old" sets the ptcatch-design cookie, and the server then answers every file this branch
//   changed with dev's version of it. A reload keeps the #/… route; the cookie remembers the choice.

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
    button.textContent = `Design: ${old ? 'old' : 'new'}`;
    button.title = old ? 'Showing dev, before the design pass. Switch to the design pass.' : 'Showing the design pass. Switch to dev, before it.';
    button.addEventListener('click', () => {
      document.cookie = `ptcatch-design=${old ? 'new' : 'old'}; path=/; max-age=31536000; SameSite=Lax`;
      location.reload();
    });
    document.head.append(style);
    document.body.append(button);
  });
}
