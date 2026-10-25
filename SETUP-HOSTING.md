# Hosting: ptcatch.com (release) and dev.ptcatch.com (development)

The site is on **Cloudflare Pages**, built from this repo on every push. Each of two long-lived branches has its own
address:

| Branch | Address | What it is |
|---|---|---|
| `main` | <https://ptcatch.com> | The release site. |
| `dev` | <https://dev.ptcatch.com> | The development site: the next version, with a gold **DEV** tag in the top bar and hidden from search engines. |

Both read the same live data from **<https://data.ptcatch.com>**, an R2 bucket that `publish.ps1` updates every 15
minutes without a git commit or a Pages build (see "Data on R2").

"Sign in with osu!" runs as two small **Pages Functions** on each site's own address (`/auth/login`,
`/auth/callback`). They exist because osu!'s OAuth needs a client secret, which a static page can't hold.

The old address keeps working. GitHub Pages stays on and, once `leaveGithub` is on, forwards
`https://123tris.github.io/pt-ctb/#/…` to `https://ptcatch.com/#/…`. It always forwards to the release site, never to
dev, and each visitor's "This is me" comes along. The bot's `/verify` page, `https://123tris.github.io/pt-ctb-verify/`,
is a different repo and **must stay exactly where it is**. Moving it would mean changing the bot's osu! app and config
too.

Everything here is on the free plan. Pages gives 500 builds a month, used only by code pushes now that the data lives on
R2. Static traffic is unlimited. Functions get 100,000 requests a day, and one sign-in uses two. R2's free tier and the
caps that keep publishing far inside it are in "Data on R2".

## How it fits together

| File | Role |
|---|---|
| `tools/build-site.mjs` | The Pages build command. See below. |
| `_headers` | Security headers (CSP, HSTS, no framing…; `connect-src` allows `https://data.ptcatch.com`) and caching: images for a week, JS/CSS revalidated. |
| `publish.ps1`, `tools/r2-sync.mjs`, `tools/lib/r2*.mjs` | Export and upload the data to R2, within hard free-tier caps. See "Data on R2". |
| `functions/auth/*.js`, `signin/oauth.js` | The sign-in endpoints. Both sites share one osu! app through the release site's callback, with a two-site allowlist. Stateless: no cookies, no database, no signing key. The osu! token is revoked straight away. |
| `assets/js/config.js` | `production` and `development` (the two addresses), `data` (`https://data.ptcatch.com/`) and `leaveGithub` are edited by hand. `home`, `signIn` and `env` are filled in by the build, per branch. |
| `assets/js/moved.js` | The forwarding from github.io to `production`. |
| `.node-version` | Pins Node 22 for the Pages build, so it doesn't depend on Cloudflare's default. |

`tools/build-site.mjs` copies only `index.html`, `404.html`, `_headers` and `assets/` into `dist/` (about 45 files), so
`tools/`, scripts and docs are never served, and the data isn't part of a build at all. Those are whole folders, so new pages, modules, images or fonts under
`assets/` come along by themselves. It also fills in the CSP hashes for inline scripts and checks Pages' limits (20,000
files, 25 MiB per file). It then reads Cloudflare's `CF_PAGES_BRANCH` and layers per-branch settings over `config.js`,
in `dist/` only:

| | `main` | `dev` (and any other preview branch) |
|---|---|---|
| `home` | `https://ptcatch.com` | `https://dev.ptcatch.com` (other branches: none, so no sign-in) |
| Data | `https://data.ptcatch.com` | the same |
| Headers | as `_headers` | adds `X-Robots-Tag: noindex` |
| Look | as is | `<html data-env="dev">`: gold line and **DEV** tag in the top bar |
| Sign-in | on if the Production `SIGN_IN` is `1` | on if the Preview `SIGN_IN` is `1`; it signs in through ptcatch.com, so it needs no keys of its own |

To try a branch's build locally:
- PowerShell: `$env:CF_PAGES_BRANCH='dev'; npm run build`
- Git Bash: `CF_PAGES_BRANCH=dev npm run build`

Without the variable, `npm run build` leaves `config.js` exactly as the repo has it.

## Branches and workflow

- **Feature work happens on `dev`**, or on short branches merged into `dev`. Push `dev` and dev.ptcatch.com updates
  about a minute later.
- **Release** means merging `dev` into `main` and pushing, for example from the main checkout described below:
  `git pull`, `git merge origin/dev`, `git push`. A GitHub pull request from `dev` to `main` works too. ptcatch.com
  updates a minute later.
- **Data isn't in git.** `publish.ps1` uploads it to R2 and runs only on `main`, so the data always comes from the
  released exporter. Both sites read it at runtime, so it's always current on both without any merging. Merge `main`
  back into `dev` whenever you want hotfixes made on main.
- **Exporter changes** (new fields in the data) can't be seen on dev.ptcatch.com before release, since both sites show
  the released exporter's data. Preview them locally: `.\publish.ps1 -NoUpload` (or `npm run export`), then
  `npm run serve -- --local-data`.

**Two checkouts.** You'll usually work on `dev`, but the scheduled publish needs `main`, so give it a folder of its own.
Wait until nobody has uncommitted work in `C:\Repos\pt-ctb`, then run these from that folder:

```powershell
git switch dev
git worktree add ..\pt-ctb-release main
..\pt-ctb-release\install-publish-task.ps1    # re-points the scheduled publish at the main checkout
```

`publish.ps1` pulls before it exports, so a release pushed from elsewhere is used from the next run. If the folders
already hold different branches, skip `git switch`.

## Data on R2

| | |
|---|---|
| Bucket `ptcatch-data` | Western Europe, Standard storage. Public only through the custom domain **data.ptcatch.com** (r2.dev off). CORS policy: GET/HEAD from ptcatch.com, www, dev, the two `pages.dev` addresses and localhost:8080/8788. |
| Bucket `ptcatch-state` | Private. The exporter's memory (`state.json`, the 15 MB map-title cache `beatmaps.json`) and publish's own ledger `r2.json`. |
| Cache Rule (zone ptcatch.com) | "Cache site data (data.ptcatch.com)": URI Full wildcard `https://data.ptcatch.com/*` → Eligible for cache, Edge TTL "use cache-control header if present, bypass cache if not", Browser TTL "Respect origin TTL". Without it Cloudflare doesn't cache `.json`, and every visitor's request would be an R2 read. |
| API token `ptcatch-publish` | Account API token, Object Read & Write, these two buckets only. Its keys are user environment variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, set with `tools/set-r2-keys.ps1` (hidden input, never in the repo). |

**How a file is stored.** Every data file goes up under a name with the hash of its content, e.g.
`players/1.<hash>.json` (`assets/js/core/data-name.js`). A name never gets different content, so files are cached for a
year (`public, max-age=31536000, immutable`) and a new export can never be mixed up with an old one. `meta.json` is
the one fixed name: browsers always revalidate it, and Cloudflare's edge keeps it for 60 s (`max-age=0, s-maxage=60`).
Cloudflare's cache key includes the visitor's `Origin` header, so each site gets its own CORS answer from the cache.

**A publish run** (`publish.ps1`, every 15 minutes from the scheduled task):
1. `node tools/r2-sync.mjs restore` fills in a missing `data/` or `state/` from R2 (a fresh checkout); otherwise it
   sends nothing.
2. The export runs.
3. `node tools/r2-sync.mjs upload` checks the export (every file `meta.json` names is there and matches its hash), then
   uploads the new files, then `meta.json` last, so the manifest never points at a missing file. Then it deletes files
   no manifest has named for 24 hours, keeping them that long for open tabs. Changed `state/` files go to the private
   bucket. If anything fails before `meta.json`, the site keeps the previous data.

An unchanged run costs 3 Class A operations: two lists and the ledger.

**Free-tier guards** (`tools/lib/r2-budget.mjs`). R2's free tier per month is 1,000,000 Class A operations (lists,
uploads), 10,000,000 Class B (reads) and 10 GB of storage; deletes are free. Every request publish sends is counted
first, in `state/r2.json`, which is also kept in the private bucket. A request that would pass a cap is never sent:

| Cap | Value | Share of the free tier |
|---|---|---|
| Class A per month | 500,000 | 50% |
| Class A per day (UTC) | 16,000 | 500,000 / 31, so one bad day can't use up the month |
| Uploads per run | 600 | a full upload is ~490 files |
| Class B per month (publish's own reads) | 1,000,000 | 10% |
| Storage | 2 GiB | 20% (today ~51 MiB) |

A run that would pass one sends nothing and fails with **R2 SAFETY CAP**, exit code 3. The site keeps its data, and
publishing resumes when the day or month (UTC) rolls over. Visitors' reads aren't counted by publish; the Cache Rule
keeps them off R2 except on cache misses. Expected use: about 8,600 Class A a month for unchanged runs, plus one per
changed file, so roughly 60,000–125,000 a month at 20–40 changed files per run (6–12% of the free tier). Class B stays
well under 1,000,000. Check where things stand with:

```powershell
node tools/r2-sync.mjs status
```

**Billing alert.** In the R2 overview, **Add Budget Alert** (e.g. $1) emails you if any billable usage ever appears.
Nothing configured here is a paid feature: Standard storage class, no event notifications, no data access logs, no
Local Uploads.

**Rolling back to data in git.**
1. On `dev`, revert the commit that moved the data to R2 and release it. The site then reads `data/` from Pages again.
2. Put a fresh `data/` and `state/` into the main checkout with `node tools/r2-sync.mjs restore`, run before the
   revert lands, or simply with the next export.
3. Run `.\install-publish-task.ps1 -EveryHours 4`. It's the old script's parameter, available again after the revert.

The buckets can stay: they cost nothing while unused.

## Status

Done:
- The Pages project `pt-ctb` (GitHub `123tris/pt-ctb`, production branch `main`, build command
  `node tools/build-site.mjs`, output `dist`).
- `ptcatch.com` and `www.ptcatch.com` as custom domains.
- The www → apex redirect rule and Always Use HTTPS.
- Step 1 below: branch control (production `main`, previews only `dev`) and `dev.ptcatch.com` on the `dev` branch.

Still to do: step 2 (the osu! app and variables) and step 3 (`leaveGithub`). The original production steps are kept
in the appendix at the end.

## 1. Set up dev.ptcatch.com

1. **Push the `dev` branch** (`git push -u origin dev`). If preview builds are still on "All non-Production
   branches", Cloudflare builds it straight away. If not, do step 2 first, then push.
2. **Build only `main` and `dev`.** In the `pt-ctb` project, open **Settings → Builds & deployments → Branch
   control**:
   - Production branch: `main`, with **automatic production branch deployments** on.
   - Preview branch: **Custom branches**, Include `dev`, Exclude empty. Branches that match neither are skipped,
     which saves build quota.
   - Save.
3. **Wait for a successful `dev` deployment**: it shows under *Deployments* with the branch `dev`. Then check that
   `https://dev.pt-ctb.pages.dev/` shows the site with the DEV tag.
4. **Add the domain.** Open **Custom domains → Set up a custom domain**, enter `dev.ptcatch.com`, then **Continue →
   Activate domain**.
5. **Point it at the dev branch.** Go to **ptcatch.com → DNS → Records** and edit the `CNAME` named `dev`. Change its
   target from `pt-ctb.pages.dev` to **`dev.pt-ctb.pages.dev`** and keep it **Proxied** (orange cloud). Cloudflare
   only routes a custom domain to a branch through a proxied record; otherwise it serves production.
6. **Let dev read the data.** The CORS header that lets dev.ptcatch.com read ptcatch.com's data comes with the next
   `main` build, after this repo change is on `main`. Until then dev.ptcatch.com shows "Couldn't load…". Any push to
   `main`, or the next publish, fixes it. You can also **Retry deployment** on the latest production deployment.

DNS records when everything is done:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `ptcatch.com` (`@`) | `pt-ctb.pages.dev` | Proxied |
| CNAME | `www` | `pt-ctb.pages.dev` | Proxied (redirected to the apex by the rule) |
| CNAME | `dev` | `dev.pt-ctb.pages.dev` | Proxied |

**Check:**
- `https://dev.ptcatch.com/` shows the gold DEV tag and real data.
- `curl -sI https://dev.ptcatch.com/ | grep -i x-robots` prints `x-robots-tag: noindex`.
- `https://ptcatch.com/` has no DEV tag and no noindex.

## 2. Sign-in: one osu! app for both sites

An osu! app has exactly one callback URL, and osu! only accepts a `redirect_uri` that matches it exactly. So both
sites use **one app, whose callback is the release site's**. A sign-in started on dev.ptcatch.com goes through
ptcatch.com and comes back:

```
dev.ptcatch.com/auth/login ─► ptcatch.com/auth/login?site=https://dev.ptcatch.com ─► osu! (state d.…)
─► ptcatch.com/auth/callback ─► https://dev.ptcatch.com/#signin?…
```

- **The allowlist (`signin/oauth.js`):** sign-ins can only return to `CONFIG.production` and `CONFIG.development`.
  Any other `site=` is refused before osu! is involved. A callback marked for an unknown site stays on ptcatch.com.
- **The state:** the visitor's one-time value carries a letter for its site. The site still accepts an answer only if
  that value matches the one it stored. Changing the letter could at most send an answer to the other of our two
  sites, which never stored that value and throws it away.
- **The keys live in Production only.** The dev site's `/auth/login` just hands over to ptcatch.com, so the Preview
  environment needs no osu! keys, only `SIGN_IN`.

Steps:

1. **Create a NEW osu! OAuth app** (not the bot's) at <https://osu.ppy.sh/home/account/edit#oauth> → **New OAuth
   Application**:
   - Name: `PT-CTB site sign-in`.
   - Callback URL: `https://ptcatch.com/auth/callback`, exactly.
   - Register it, then open **Edit** to see the Client ID and *Show client secret*.
2. In the `pt-ctb` project, open **Settings → Variables and Secrets**. For the **Production** environment add:
   - Type **Secret**, `OSU_CLIENT_ID`: the Client ID.
   - Type **Secret**, `OSU_CLIENT_SECRET`: the Client Secret.
   - Type **Text**, `SIGN_IN` = `1`. This is the build switch that shows the button, not a secret.
3. For the **Preview** environment add only:
   - Type **Text**, `SIGN_IN` = `1`.
   - No osu! keys.
4. Variables only reach new deployments. Open **Deployments** and use **⋯ → Retry deployment** on the latest
   production deployment and the latest `dev` deployment.
5. **Check:**
   - `https://ptcatch.com/auth/login?state=check0123456789abcdef` lands on osu!'s Authorise page for *PT-CTB site
     sign-in*.
   - `https://ptcatch.com/auth/login?site=https://evil.example&state=check0123456789abcdef` says "Sign-in only
     works on https://ptcatch.com and https://dev.ptcatch.com."
   - On `https://ptcatch.com` and on `https://dev.ptcatch.com` (hard refresh): **Sign in** → **Authorise** brings
     you back to the same page on the same site, signed in.

No signing key is needed. To switch sign-in off on one site, delete that environment's `SIGN_IN` and rebuild it.

## 3. Forward the old address

Once you're happy with `https://ptcatch.com`, set `leaveGithub: true` in `assets/js/config.js` on `main`, then commit
and push. **Keep GitHub Pages switched on** for this repo, because it now serves the forwarding. It always goes to
`production`, so dev settings can never send anyone to dev.

**Check:** `https://123tris.github.io/pt-ctb/#/dan` ends up at `https://ptcatch.com/#/dan`. If you had picked "This is
me" on the old site, it's still picked on the new one.

## 4. Usage counts and your dashboard (/stats)

The site counts page views and button presses anonymously (`assets/js/core/track.js` → `functions/api/hit.js`), and
`https://ptcatch.com/stats` shows them to you only. Until the steps below are done, the site sends the counts but they
are dropped (the endpoint answers "no-database"), and `/stats` says what's missing.

1. **Storage & Databases → D1 SQL Database → Create.** Name it `ptctb-usage`, with location hint Western Europe. There's
   no table to create: the site makes it on the first visit.
2. **Workers & Pages → pt-ctb → Settings → Bindings → Add → D1 database.** Variable name `USAGE`, database
   `ptctb-usage`. Do this for **Production**, then switch to **Preview** and do it again (dev.ptcatch.com is a preview
   build). Both use the same database; the dashboard keeps the sites apart.
3. **Settings → Variables and Secrets → Add → Secret.** Name `STATS_PASSWORD`, value a long password of your own (a
   password manager's generated one is ideal). Add it to Production (and to Preview if you want `dev.ptcatch.com/stats`
   too).
4. **Deployments → Retry deployment** on the latest `main` (and `dev`) build, so the bindings take effect.

**Check:** open `https://ptcatch.com/stats`. The browser asks for a user name and password: any user name, and the
`STATS_PASSWORD`. Then press **Don't count this browser** at the bottom, so your own visits stay out of the numbers. Do
that once on each browser and site (ptcatch.com and dev.ptcatch.com separately).

Free-plan limits: D1 allows 100,000 written rows and 5 million read rows a day. One visit writes about 5–15 rows, and a
30-day dashboard view reads every event in the range about 12 times, so there's plenty of room at this site's size.

## Day to day

**Local previews:**
- `npm run serve` serves the repo root at <http://localhost:8080/>, reading the live data from data.ptcatch.com. Add
  `-- --local-data` to read a local export in `data/` instead. Use it for everyday work; it has no sign-in and no
  `_headers`.
- `npm run build` writes `dist/`, exactly what Pages publishes. Set `CF_PAGES_BRANCH` to try a branch's build.
- `npx wrangler pages dev dist` runs `dist/` with the `/auth` Functions and the headers, as on Cloudflare.
- `npm test` runs the sign-in tests.

**Troubleshooting sign-in:**

| Symptom | Cause |
|---|---|
| osu! says the redirect URI is invalid | The app's Callback URL isn't exactly `<site>/auth/callback`. |
| "Sign-in is not configured yet" | A Production key is missing, or there was no new production deployment after adding it. |
| "osu! didn't confirm who you are" | Wrong client secret, or osu! is down. |
| "That sign-in had expired…" | More than 15 minutes on osu!'s page, or the browser's storage was cleared mid-way. |
| No Sign in button | `SIGN_IN` isn't `1` for that environment, or you're not on that build's `home` address (e.g. `*.pages.dev`). |

**Other tasks:**
- **Rotating an osu! secret:** on osu!, use *Edit → Reset client secret*. Update the variable, then **Retry
  deployment**.
- **Testing sign-in locally without real keys:** `npm test` covers the flow against a fake osu!. For a browser round
  trip, work in a scratch copy of the repo:
  1. Set `production: 'http://localhost:8788'` and `development: 'http://localhost:8789'` in its `config.js`.
  2. Build with `CF_PAGES_BRANCH=main SIGN_IN=1` into one folder and with `CF_PAGES_BRANCH=dev SIGN_IN=1` into
     another.
  3. Serve the main build on port 8788:
     `npx wrangler pages dev <main build> --port 8788 --binding OSU_CLIENT_ID=1 --binding OSU_CLIENT_SECRET=x --binding OSU_URL=<fake osu! URL>`.
  4. Serve the dev build on port 8789 with no bindings.

  `OSU_URL` exists only for tests.
- **The plain `pages.dev` addresses:** `pt-ctb.pages.dev` and `dev.pt-ctb.pages.dev` stay reachable as plain copies,
  without a sign-in button. Cloudflare's Pages docs describe a Bulk Redirect if you want them sent to the custom
  domains.

## Appendix: the production setup (already done)

1. **Workers & Pages → Create → Pages → Import an existing Git repository.** Install the Cloudflare GitHub app for
   `123tris/pt-ctb` only. Use these settings:
   - Project `pt-ctb`.
   - Production branch `main`.
   - Framework **None**.
   - Build command `node tools/build-site.mjs`.
   - Output `dist`.
   - Root directory empty.
2. **Custom domains:** add `ptcatch.com` and `www.ptcatch.com` with **Set up a custom domain → Activate domain**.
   Pages creates the proxied CNAMEs. Creating them by hand first gives error 522.
3. **Rules → Redirect Rules → Create rule:**
   - Hostname equals `www.ptcatch.com`.
   - Dynamic redirect to `concat("https://ptcatch.com", http.request.uri.path)`.
   - 301, with the query string preserved.
4. **SSL/TLS → Edge Certificates → Always Use HTTPS:** on.
