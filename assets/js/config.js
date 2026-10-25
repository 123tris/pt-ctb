// Site settings that aren't data. Edit these by hand.
export const CONFIG = {
  /** Discord invite link for the "Entrar no Discord" buttons. Empty hides them. */
  discordInvite: '',
  /** Where the site's source lives (footer link). */
  repository: 'https://github.com/123tris/pt-ctb',
  /** The site's own address, e.g. 'https://ptcatch.com' (no trailing slash). See SETUP-HOSTING.md. */
  home: '',
  /**
   * Show "Sign in with osu!" in the top bar. Needs the /auth/* Functions and their osu! secrets on Cloudflare Pages,
   * and only shows on `home`, the one address the osu! app knows. "This is me" works either way.
   */
  signIn: false,
  /**
   * Send visitors of the old GitHub Pages address (https://123tris.github.io/pt-ctb/) to the same page on `home`
   * (assets/js/moved.js). Turn on once the site works there.
   */
  leaveGithub: false,
};
