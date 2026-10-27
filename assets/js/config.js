// Site settings that aren't data. Edit these by hand; the ones marked "per branch" are filled in by
// tools/build-site.mjs for each Cloudflare Pages build (main → release, dev → development), see SETUP-HOSTING.md.
export const CONFIG = {
  /** The server's permanent Discord invite, for the "Join the Discord" buttons. Empty hides them. */
  discordInvite: 'https://discord.gg/RJVxHvNmUR',
  /** Where the site's source lives (footer link). */
  repository: 'https://github.com/123tris/pt-ctb',
  /** The release site (built from main) and the development one (built from dev). No trailing slash. */
  production: 'https://ptcatch.com',
  development: 'https://dev.ptcatch.com',
  /** Per branch: this copy's own address. Empty when served from anywhere else (npm run serve, GitHub Pages). */
  home: '',
  /**
   * Per branch: show "Sign in with osu!" in the top bar (the SIGN_IN build variable). Needs the /auth/* Functions and
   * an osu! app whose callback is on `home`, so it only shows there. "This is me" works either way.
   */
  signIn: false,
  /** Per branch: 'dev' on development builds, which shows a DEV marker in the top bar. Empty on the release site. */
  env: '',
  /**
   * Where the data files are: the R2 bucket publish.ps1 uploads to, for every copy of the site (both builds, GitHub
   * Pages, npm run serve). `npm run serve -- --local-data` uses the local data/ instead.
   */
  data: 'https://data.ptcatch.com/',
  /**
   * Send visitors of the old GitHub Pages address (https://123tris.github.io/pt-ctb/) to the same page on
   * `production` (assets/js/moved.js). Turn on once the release site works.
   */
  leaveGithub: true,
  /**
   * Ask before counting usage (core/consent.js, core/track.js; pages/privacy.js explains what's counted).
   * '' never asks: counting runs unless the browser opted out or sends Do Not Track / Global Privacy Control.
   * 'identity' counts, but links events to the visitor's osu! player only after they say yes.
   * 'all' counts nothing until they say yes.
   */
  analyticsConsent: '',
};
