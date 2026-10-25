# Hosting on Cloudflare Pages at ptcatch.com, with "Sign in with osu!"

The site moves from GitHub Pages to **Cloudflare Pages** at **https://ptcatch.com**. Cloudflare builds it from this
repo on every push, so `publish.ps1` keeps working as it is: export → commit → push → live a minute later.
Sign-in runs as two small **Pages Functions** on the same address (`/auth/login`, `/auth/callback`). They exist
because osu!'s OAuth needs a client secret, which a static page can't hold.

The old address keeps working. GitHub Pages stays on and forwards `https://123tris.github.io/pt-ctb/#/…` to
`https://ptcatch.com/#/…`, and each visitor's "This is me" comes along. The bot's `/verify` page,
`https://123tris.github.io/pt-ctb-verify/`, is a different repo and **must stay exactly where it is**. Moving it would
mean changing the bot's osu! app and config too.

Nothing below needs a paid plan. On the free plan Pages gives 500 builds a month (a push every 4 hours is about 180)
and unlimited static traffic. Functions get 100,000 requests a day, and one sign-in uses two.

## What's in the repo

| File | Role |
|---|---|
| `tools/build-site.mjs` | The Pages build command. It copies only `index.html`, `404.html`, `_headers`, `assets/` and `data/` into `dist/`, so `tools/`, `state/`, scripts and docs are never served. Those are whole folders, so new pages, modules, images or fonts under `assets/` come along by themselves. Only a new top-level folder the site loads would need adding to its list. It also fills in the CSP hashes and checks Pages' limits: 20,000 files and 25 MiB per file. Today the site is 279 files, 37 MiB, and the largest file is 4.4 MiB. |
| `_headers` | Security headers (CSP, HSTS, no framing…) and caching: `data/*` for a week, since every export gets new `?v=` URLs; images for a week; JS/CSS revalidated. |
| `functions/auth/*.js`, `signin/oauth.js` | The sign-in endpoints. Stateless: no cookies, no database, no signing key. The osu! token is revoked straight away. |
| `assets/js/config.js` | `home`, `signIn` and `leaveGithub`, switched on in steps 5 and 6. |
| `assets/js/moved.js` | The forwarding from github.io to `home`. |

`.node-version` pins Node 22 for the Pages build, so it doesn't depend on Cloudflare's default.

**Local previews:**
- `npm run serve` still serves the repo root at <http://localhost:8080/>, as before. Use it for everyday work; it has
  no sign-in and no `_headers`.
- `npm run build` writes `dist/`, exactly what Pages publishes.
- `npx wrangler pages dev dist` runs `dist/` with the `/auth` Functions and the headers, as on Cloudflare.
- `npm test` runs the sign-in tests.

## 0. Push the code first

Commit and push these files as they are, with `home: ''`, `signIn: false` and `leaveGithub: false`. Nothing changes
for visitors yet. GitHub Pages ignores the new files, and the button and the redirect stay off.

## 1. Create the Pages project from GitHub

1. Go to <https://dash.cloudflare.com>, then **Workers & Pages**, then **Create**. Choose the **Pages** tab, or the
   *"Looking to deploy Pages? Get started"* link, then **Import an existing Git repository**.
2. **Connect GitHub.** Install the Cloudflare app for **Only select repositories → `123tris/pt-ctb`**.
3. Select `pt-ctb`, then **Begin setup**:
   - Project name: `pt-ctb`. This gives `pt-ctb.pages.dev`.
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `node tools/build-site.mjs`
   - Build output directory: `dist`
   - Root directory: leave empty
   - The Node version comes from the repo's `.node-version` (22), so there's no need to set `NODE_VERSION`.
4. Click **Save and Deploy** and wait for the build to finish. Its log ends with `dist/: … files`.

**Check:**
- `https://pt-ctb.pages.dev/` shows the site.
- `https://pt-ctb.pages.dev/tools/export.mjs` gives the site's not-found redirect, not the file.
- `https://pt-ctb.pages.dev/auth/login` says "Sign-in is not configured yet."

## 2. Connect ptcatch.com and www

The domain is on Cloudflare Registrar, so its DNS is already on Cloudflare and Pages can create the records itself.
Don't add them by hand first: a CNAME created before the domain is attached gives error 522.

1. In the `pt-ctb` project, open **Custom domains → Set up a custom domain**. Enter `ptcatch.com`, then
   **Continue → Activate domain**.
2. Repeat with `www.ptcatch.com`.
3. Wait until both show **Active**. The HTTPS certificate takes a few minutes.

You should end up with these DNS records (under *ptcatch.com → DNS → Records*):

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `ptcatch.com` (`@`) | `pt-ctb.pages.dev` | Proxied (orange cloud) |
| CNAME | `www` | `pt-ctb.pages.dev` | Proxied (orange cloud) |

Make `www` redirect to the bare domain, so there's one canonical address:

4. Go to **ptcatch.com → Rules → Redirect Rules → Create rule**:
   - Rule name: `www to apex`
   - If incoming requests match: **Custom filter expression**, *Hostname* *equals* `www.ptcatch.com`
   - Then: URL redirect, Type **Dynamic**, Expression `concat("https://ptcatch.com", http.request.uri.path)`,
     Status code **301**, **Preserve query string** ticked.
   - Click **Deploy**.
5. Go to **ptcatch.com → SSL/TLS → Edge Certificates** and turn **Always Use HTTPS** on.

**Check:** `https://ptcatch.com/` shows the site. `https://www.ptcatch.com/#/dan` ends up at `https://ptcatch.com/#/dan`.
Browsers keep the `#/…` part across redirects.

## 3. Create a NEW osu! OAuth application

Do this only once `https://ptcatch.com` works. Don't reuse the bot's app. A separate one keeps the bot's secret out
of this, and either can be revoked alone.

1. Open <https://osu.ppy.sh/home/account/edit#oauth> and click **New OAuth Application**.
2. **Application Name:** `PT-CTB site sign-in`. osu! shows it on its "Authorise" page.
3. **Application Callback URL:** `https://ptcatch.com/auth/callback`, exactly as written.
4. Click **Register application**, then **Edit** on the new app. Keep the **Client ID** and the **Client Secret**
   (*Show client secret*) at hand for the next step. Don't paste them anywhere else.

## 4. Store the keys as encrypted secrets

1. In the `pt-ctb` Pages project, open **Settings → Variables and Secrets → Add**, for the **Production**
   environment:
   - Type **Secret**, Name `OSU_CLIENT_ID`, Value: the Client ID
   - Type **Secret**, Name `OSU_CLIENT_SECRET`, Value: the Client Secret
2. **Save.** Secrets only reach a new deployment, so go to **Deployments**, open the latest production deployment's
   **⋯** menu and choose **Retry deployment**.

No signing key is needed. The sign-in answer is tied to a one-time random value kept in the visitor's browser, so a
forged link can't sign anyone in.

**Check:** open `https://ptcatch.com/auth/login?state=check0123456789abcdef`. You should land on osu!'s Authorise
page for *PT-CTB site sign-in*. Close the tab there.

## 5. Switch sign-in on

In `assets/js/config.js`:

```js
home: 'https://ptcatch.com',
signIn: true,
```

Commit and push. On `https://ptcatch.com`, hard-refresh (Ctrl+F5), click **Sign in** in the top bar, then
**Authorise**. You land back on the same page, with your avatar in the top bar and a "Signed in as …" message. The
avatar's menu says "Signed in with osu!" and has **Sign out**. The old github.io site isn't affected yet: the button
only shows on `home`.

| Symptom | Cause |
|---|---|
| osu! says the redirect URI is invalid | The app's Callback URL isn't exactly `https://ptcatch.com/auth/callback`. |
| "Sign-in is not configured yet" | A secret is missing, or there was no new deployment after adding it (step 4.2). |
| "osu! didn't confirm who you are" | Wrong client secret, or osu! is down. |
| "That sign-in had expired…" | More than 15 minutes on osu!'s page, or the browser's storage was cleared mid-way. |
| "…not on the Portuguese leaderboards" | Working as intended. Only tracked players can be "me". |

## 6. Forward the old address

Once you're happy with `https://ptcatch.com`, set this in `assets/js/config.js`:

```js
leaveGithub: true,
```

Then commit and push. **Keep GitHub Pages switched on** for this repo, because it now serves the forwarding.

**Check:** `https://123tris.github.io/pt-ctb/#/dan` should end up at `https://ptcatch.com/#/dan`. If you had picked
"This is me" on the old site, it's still picked on the new one.

## Day to day

- **Data and site updates:** run `publish.ps1` as before. Each push builds once on Cloudflare (watch them under
  *Deployments*) and once on GitHub Pages, which only serves the forwarding.
- **Rotating the osu! secret:** on osu! use *Edit → Reset client secret*, update `OSU_CLIENT_SECRET` (step 4), then
  **Retry deployment**.
- **Switching sign-in off:** set `signIn: false` and push.
- **Testing locally without real keys:** run `npm run build`, then
  `npx wrangler pages dev dist --binding OSU_CLIENT_ID=1 --binding OSU_CLIENT_SECRET=x --binding OSU_URL=<fake osu! URL>`.
  `OSU_URL` exists only for tests. In `dist/assets/js/config.js`, set `home` to `http://localhost:8788` and
  `signIn: true`.
- `pt-ctb.pages.dev` stays reachable as a plain copy, without a sign-in button. To send it to ptcatch.com as well,
  Cloudflare's Pages docs describe a Bulk Redirect for the `*.pages.dev` address.
