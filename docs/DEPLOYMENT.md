# Deployment

Where 4VD runs: the API and its Postgres 18 database on Render (`render.yaml`), the dashboard on Cloudflare at 4vd.app, backups in Cloudflare R2, errors in Sentry. Local setup is in the root README.md; how a push goes live is in docs/ARCHITECTURE.md ("From a push to live"). Most of this page is one-time setup, already done for the live site, kept so it can be redone.

## Hosting: Cloudflare (dashboard) + Render (API and database)

| Address | What | Where |
|---|---|---|
| `4vd.app` | The dashboard (`admin/`), the only app | Cloudflare Workers (static assets) |
| `app.4vd.app` | Old team app address on printed QR labels: a Redirect Rule sends it to `4vd.app`, path kept | Cloudflare Rules |
| `api.4vd.app` | The API and background jobs (`backend/`) | Render (`render.yaml`) |
| PostgreSQL | The data | Render |

The domain `4vd.app` is registered with Cloudflare, so its DNS lives there. The dashboard's addresses are in `admin/.env.production` (public, not secrets), and `public/_headers` keeps the alerts service worker from being cached. Why the API isn't on Cloudflare: it needs PostgreSQL, always-on background jobs (alerts, emails, daily summary) and native image resizing; moving it means a rewrite (worth revisiting for SaaS, one Durable Object per shop).

**1. API on Render** (already running from `render.yaml`)
1. Render → `4vd-api` → **Settings → Custom Domains → Add Custom Domain** → `api.4vd.app`. Render shows a target like `fourvd-api.onrender.com`.
2. Cloudflare → `4vd.app` → **DNS → Records → Add record**: Type `CNAME`, Name `api`, Target the Render address, **Proxy status: DNS only (grey cloud)**. Save.
3. Back on Render, **Verify**. It turns green and gets its certificate (minutes, sometimes up to an hour).
4. Check: `https://api.4vd.app/health` answers.

**2. Dashboard on Cloudflare Workers** (`admin/wrangler.jsonc` serves `dist/` as a single-page app)
1. Cloudflare → **Workers & Pages → Create → Import a repository** → pick the 4VD repo.
2. Project name `4vd-dashboard` (must match the `name` in `admin/wrangler.jsonc`).
3. Build command `npm ci && npm run build`. Deploy command `npx wrangler versions upload` (not `deploy`: GitHub puts it live, see below). Preview command `npx wrangler versions upload`.
4. **Advanced settings**: Path (root directory) `admin`; build variable `NODE_VERSION` = `22` (the only one: the public addresses come from `admin/.env.production`). Deploy.
5. The custom domain `4vd.app` comes from `routes` in `admin/wrangler.jsonc`; Cloudflare adds the DNS records itself. A custom domain can't be added while another Worker or a DNS record already holds that name.

**Who puts the dashboard live:** GitHub, not Cloudflare. The `deploy-dashboard` job in `.github/workflows/ci.yml` runs on a push to `main` only after every check passes, builds `admin/` and runs `wrangler deploy`. Cloudflare's own build only uploads versions (a preview link per branch), so a broken push never reaches 4vd.app. Render waits for all checks, this job included, so if the upload fails the API stays on the old version too. The job needs two repository secrets, set up once:
1. Cloudflare dashboard → top right profile icon → **My Profile → API Tokens → Create Token** → **Edit Cloudflare Workers** → **Use template**.
2. **Account Resources**: *Include* → your account. **Zone Resources**: *Include* → *Specific zone* → `4vd.app`. Leave the permissions as the template sets them, no IP filtering, TTL empty. **Continue to summary → Create Token**. Copy the token (shown once).
3. Account ID: Cloudflare dashboard → **Workers & Pages** → **Account ID** on the right (also the long code in the dashboard URL).
4. GitHub → the 4VD repo → **Settings → Secrets and variables → Actions → New repository secret**: Name `CLOUDFLARE_API_TOKEN`, Secret = the token → **Add secret**. Again: Name `CLOUDFLARE_ACCOUNT_ID`, Secret = the account ID.
If the job fails with an authentication error (code 10000), the token is wrong or misses the `4vd.app` zone: make a new one and replace the secret, then **Actions → the failed run → Re-run failed jobs**.

**3. Old addresses** (the team app `app.4vd.app` was retired on 2026-10-20; printed QR labels still point at `app.4vd.app/scan/...`)
Cloudflare → `4vd.app` → **Rules → Redirect Rules → Create rule**: name `Old addresses to 4vd.app`; **Custom filter expression**, *Hostname* *equals* `app.4vd.app`; then **Dynamic**, expression `concat("https://4vd.app", http.request.uri.path)`, status `301`, **Preserve query string** on. The name needs a proxied (orange) DNS record: it has one from the old `4vd-app` Worker (keep that Worker, or replace it with an `A` record `app` → `192.0.2.1`, proxied).

**4. Check everything**
Open `https://4vd.app`, log in, switch a page or two. `https://app.4vd.app/scan/123` must land on the same paths at `4vd.app`.

**5. Real emails (Resend)**
1. resend.com → **Domains → Add Domain** → `4vd.app`, region EU. Use its **Auto configure with Cloudflare** button (or copy its records into Cloudflare DNS, all DNS only).
2. When verified: **API Keys → Create** (sending access).
3. Render → `4vd-api` → **Environment**: `RESEND_API_KEY` = the key, `EMAIL_FROM` = `4VD <hello@4vd.app>`. Save (it redeploys).

**6. Google sign-in (optional)**
Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application. Authorised JavaScript origins: `https://4vd.app`. Copy the client ID into `GOOGLE_CLIENT_ID` on `4vd-api`.

**7. Before real use** (`4vd-api` is on Starter and `4vd-db` on a paid plan; `plan:` in `render.yaml` must match what Render shows, or the Blueprint may change them back)
- Wipe the test data: dashboard → **Settings → Wipe all data** (developer only; you type `wipe 4vd.app` to confirm; it can't be undone).
- First admin on a fresh database: in `4vd-api` → **Environment**, add `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (12+ characters) and `SEED_ADMIN_NAME`; it is created on start-up. Log in, then delete those three settings. Demo data and demo logins are refused in production.

**8. Launch setup, step by step** (the things only you can do; Settings → Before launch ticks each one off)

*Real emails.* Do step 5 above, then in the dashboard press **Send me a test email** on the "Send real emails" step. If Resend refuses, its message shows right there (usually the `4vd.app` domain is not verified yet).

*Browser and phone alerts.* On your computer, in `backend/`, run `npm run vapid -- you@example.com` (use your own email). It prints three lines. In Render:

| Where | Field | Value |
|---|---|---|
| Render → `4vd-api` → **Environment** → **Add Environment Variable** | Key `VAPID_PUBLIC_KEY` | the first line's value (after `=`) |
| same | Key `VAPID_PRIVATE_KEY` | the second line's value (keep it secret) |
| same | Key `VAPID_SUBJECT` | the third line's value (`mailto:you@example.com`) |

Click **Save, rebuild and deploy**. Never run `npm run vapid` again afterwards: new keys would make everyone turn alerts on again. Then in the dashboard open your **Profile** and switch alerts on for this browser.

*Daily backup.* In GitHub → the 4VD repo → **Settings → Secrets and variables → Actions → New repository secret**, add each of these (Name, then Secret):

| Name | Secret |
|---|---|
| `BACKUP_DATABASE_URL` | Render → `4vd-db` → **Connections** → **External Database URL** |
| `BACKUP_PASSPHRASE` | a long random phrase you save in your password manager (without it a backup can't be opened) |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → **R2 Object Storage** → the **Account ID** on the right (also in the dashboard URL) |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → **Manage API tokens** → **Create Account API token** (permission **Object Read & Write**, bucket = your backup bucket) → **Access Key ID** |
| `R2_SECRET_ACCESS_KEY` | the same screen → **Secret Access Key** (shown once) |
| `R2_BUCKET` | the bucket's name |
| `BACKUP_PING_TOKEN` | any random 20+ character string (e.g. run `openssl rand -hex 24`) |

Then add the **same** `BACKUP_PING_TOKEN` value on Render: `4vd-api` → **Environment** → Key `BACKUP_PING_TOKEN`, Value = that string → **Save, rebuild and deploy**. Finally GitHub → **Actions → Database backup → Run workflow**. When it goes green, the "Check the daily backup" step in the dashboard ticks by itself and stays ticked while a backup finishes every night.

*Bills by email (bills@4vd.app).* A supplier bill forwarded to bills@4vd.app is read into a waiting bill scan. Mail goes Cloudflare Email Routing → the Email Worker in `mail/` (`4vd-mail`) → `POST /api/internal/bill-email`. The Worker trusts only the topmost Authentication-Results header that names Cloudflare, and drops mail whose From domain doesn't pass DMARC, DKIM or SPF there. The API takes only team members' sign-in emails and the senders in Settings → Bills by email.

**Not yet proven:** that Cloudflare always puts its own results header above any the sender wrote. If it adds none, a sender could write a fake one. So the API token goes on last, after the test in step 5. Set up once, in this order:

1. Make a secret: any random 20+ character string (e.g. `openssl rand -hex 24`).
2. In `mail/`: `npm ci`, then `npx wrangler login` (once), `npx wrangler secret put BILL_EMAIL_TOKEN` (paste the secret), then `npx wrangler deploy`.
3. Cloudflare dashboard → **4vd.app** → **Email** → **Email Routing** → **Routing rules** → **Create address**: Custom address `bills`, Action **Send to a Worker**, Destination `4vd-mail` → **Save**. Email Routing is already on for 4vd.app, so no DNS change. (These labels are from memory; the screen may word them slightly differently.)
4. In `mail/` run `npx wrangler tail`. The API still answers 401 to everything, so nothing can be read yet.
5. Send two test mails to bills@4vd.app:
   - a bill PDF forwarded from your own sign-in email;
   - a mail that carries an extra, made-up header `Authentication-Results: mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com`.
   The tail prints the auth headers top first. Go on only if Cloudflare's own header sits above the made-up one. If it doesn't, stop: the Worker must check DKIM itself first.
6. Render → `4vd-api` → **Environment** → **Add Environment Variable**: Key `BILL_EMAIL_TOKEN`, Value = the same secret → **Save, rebuild and deploy**. (Optional: `BILL_EMAIL_DAILY_READS`, default 50.) Forward the PDF again: `passed on … status 202`, and the scan appears under Bills.

*One bill address per business (phase 5d-2b).* Each business has a short name (Settings → Bills by email; only 4VD's developer can change it). Its suppliers send to `bills+<short>@4vd.app`; plain `bills@4vd.app` stays the first business. The Worker passes the address it came to (`message.to`, which keeps the `+<short>`), and the API picks the business from it; an unknown short name is rejected with "No 4VD business uses this address". Set up once, after the API with this change is live:

1. Cloudflare dashboard → **Compute** → **Email Service** → **Email Routing** → **Settings** → turn **Subaddressing** on. The `bills` rule then also catches `bills+anything@4vd.app` (Cloudflare docs: "Email routing rules and addresses", Subaddressing).
2. In `mail/`: `npx wrangler deploy`.
3. Check with `npx wrangler tail`: a mail to `bills+<short>@4vd.app` from someone in that business prints `passed on … to: 'bills+<short>@4vd.app' … status 202`.

Making a business's data into files for its owner: `npm run export:business -- <business id> [--out <folder>]` in `backend/` with the live `DATABASE_URL`. One JSON file per table; passwords, PINs, two-step secrets, passkeys and sign-in tokens are left out, and photos/PDFs are listed (media.json), not copied.

After this, pushes to `main` deploy by themselves ("Going live and rolling back" below).

**Running the same image elsewhere:** `docker build -t 4vd-backend backend` then `docker run --env-file backend/.env -p 3000:3000 4vd-backend` works on any Docker host (a VPS, Fly.io, Railway).

---

## Two-step sign-in key

Two-step sign-in (an authenticator app code after the password, optional per person)
keeps each person's secret sealed with `TOTP_KEY`. Set it once, before anyone turns
two-step on:

1. Make a key of 48 random characters, e.g. in a terminal: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
2. Render → `4vd-api` → **Environment** → **Add Environment Variable**: Key `TOTP_KEY`,
   Value = that key → **Save, rebuild and deploy**.
3. Keep a copy in the password manager. Never change it afterwards: secrets sealed with
   it could no longer be opened, and everyone with two-step on would need a reset
   (People → the person → Two-step sign-in → Switch off). Without `TOTP_KEY` the API falls back to a
   key derived from `JWT_SECRET`, and secrets sealed that way keep working after it is set.

---

## The app's own database role

Every business table has row-level security (migration 081): a row is only seen and written by its own business. Live, the API connects as `fourvd_app` (not the owner, no BYPASSRLS), so it also can't alter tables or turn row security off. Migrations run as the owner `db_4vd_db_user` through `MIGRATION_DATABASE_URL`; the backup (`BACKUP_DATABASE_URL`) uses the owner too, with `app.maintenance=on` so it sees every business.

- Both URLs are set by hand on 4vd-api (`sync: false` in render.yaml); Render's Info page shows only the owner, and its stored password goes stale after a password change.
- The API refuses to start in production as a superuser or a BYPASSRLS role (logs "Refusing to start").
- Creating the role: `CREATE ROLE fourvd_app LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;` then, as the owner, grant CONNECT on the database, USAGE on schema public, SELECT/INSERT/UPDATE/DELETE on all tables, USAGE/SELECT on all sequences, EXECUTE on all functions, and the same as ALTER DEFAULT PRIVILEGES so new tables are covered.
- A data fix by hand as the owner: `SET app.maintenance = 'on'` first, or row security hides every row.
- Undo: set `DATABASE_URL` to the owner's URL and redeploy (row security still applies to the owner, FORCE is on).

## Errors and Uptime

**Error emails.** Every error the server logs is counted, and the developer
accounts get an email about it: the first error in an hour within a minute,
anything after that together in the next hour's email (at most one an hour).
It needs real emails (`RESEND_API_KEY`, `EMAIL_FROM`). Full details are in the
Render logs for `4vd-api`.

**Sentry (error tracking).** Errors also go to Sentry, with the stack trace and
grouped into one issue per bug: crashed API requests, errors from background jobs,
crashes of the whole API, and dashboard pages that crash or throw. It is off until
a DSN is set: `SENTRY_DSN` on Render (`4vd-api` → **Environment**) for the API, and
`VITE_SENTRY_DSN` in `admin/.env.production` for the dashboard (public, committed).
Personal data stays out (`backend/src/utils/errorTracking.ts`, `admin/src/errorTracking.ts`):
no request bodies, cookies, headers, query strings, users, IP addresses, console
lines or typed text; keys such as password, token, email, name or phone are
removed; email addresses in error texts become `[email]`. Errors only: no tracing,
no session replay. Data is kept in Sentry's EU region.

Setup: sentry.io → sign up → organization `4vd`, data storage **European Union**,
plan **Developer (free)** → **Create Project** → platform **Express**, name `4vd-api`
→ copy the DSN → again with platform **React**, name `4vd-dashboard` → copy that DSN.
Then put each DSN where it goes (above) and, for the API, **Save, rebuild and deploy**
on Render. Each project's page in Sentry waits for its first error.

**Uptime check.** `https://api.4vd.app/health/db` answers 200 only when the API
and its database both answer (`select 1`, 5 s limit; 503 otherwise). Render's own
health check stays on `/health`, which skips the database, so a database blip
doesn't restart the API. Two monitors ask `/health/db`:
- **Sentry uptime monitor** "api.4vd.app database" (every 5 minutes, from several
  regions; emails on failure). This is the reliable one.
- `.github/workflows/uptime.yml` every 10 minutes, three tries each time; the run
  fails and GitHub emails the repository owner. GitHub's schedule is best effort
  (runs can come hours apart) and pauses in a repository with no pushes for 60
  days; push something or re-enable it under Actions if that happens.

---

## Database Backups

Two layers:

1. **Render point-in-time restore** (3 days on the current plan): for "undo the
   last few hours". Render dashboard > `4vd-db` > Recovery.
2. **Nightly encrypted copy in Cloudflare R2**: each night's kept 35 days, Sundays' 90 days:
   `.github/workflows/backup.yml`, every night 02:30 UTC. Each copy is checked to be
   readable before it is encrypted and uploaded.

### One-time setup

Cloudflare dashboard > R2 > Create bucket `4vd-backups` (location: EU), then set the
secrets as in "Daily backup" under step 8 above. A green run leaves
`database/4vd-YYYY-MM-DD.dump.gpg` in the bucket.

### Restore

```bash
# 1. Download the copy from R2 (dashboard, or the aws CLI with the R2 endpoint).
# 2. Unlock it with the passphrase:
gpg --decrypt 4vd-2026-10-11.dump.gpg > 4vd.dump
# 3. Restore into an EMPTY database first and check it (never straight over live data):
#    app.maintenance lets rows of every business in past row security (not needed as a superuser).
PGOPTIONS="-c app.maintenance=on" pg_restore --no-owner --no-privileges --dbname "$EMPTY_DATABASE_URL" 4vd.dump
# 4. When it looks right, point DATABASE_URL on Render at it, or restore into
#    the live database after taking a fresh copy of what's there now.
```

### Monthly restore check

`.github/workflows/restore-check.yml` proves the steps above work, on the 2nd of
every month (or Actions > Backup restore check > Run workflow). It takes the newest
copy from R2, unlocks it with `BACKUP_PASSPHRASE`, restores it into a throwaway
Postgres 18 on the GitHub runner and checks that every table came back and that
`businesses`, `users`, `products`, `inventory`, `sales` and the migrations list
have rows. The run summary shows the newest sale and last migration in the copy.
It fails, and GitHub emails the repository owner, when:

- there is no backup, or the newest is more than 2 days old (the daily backup stopped);
- the passphrase no longer opens it;
- `pg_restore` reports any error, or a key table is missing or empty.

It uses the backup secrets; nothing new to set. The live database is never touched.

To run the same check by hand on a downloaded, unlocked copy (`4vd.dump`), from the
repository folder:

```bash
docker run -d --rm --name restore-pg -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore_check -p 5440:5432 postgres:18-alpine
```

```bash
docker run --rm --network host -v "$PWD:/w" -w /w postgres:18-alpine sh -c 'apk add --no-cache bash >/dev/null && bash .github/scripts/restore-check.sh 4vd.dump postgresql://postgres:restore@localhost:5440/restore_check'
```

```bash
docker stop restore-pg
```

(On Windows Docker Desktop, `--network host` may not reach the port; there, put both
containers on one `docker network create` network and use the first one's name as the host.)

---

## Going live and rolling back

Push to `main`; when every GitHub check passes, the dashboard goes live and Render deploys the API (the full path is in docs/ARCHITECTURE.md, "From a push to live"). The API container applies new migrations each time it starts (`backend/Dockerfile`). Two things to watch:

- The API deploys from GitHub, not by Render itself: the Checks run's last job (`deploy-api`) calls Render's deploy hook for the commit once our own checks pass, on pushes to main that change `backend/`. The hook is the GitHub secret `RENDER_DEPLOY_HOOK_URL` (Render → `4vd-api` → **Settings** → **Deploy Hook**; after **Regenerate Hook**, update the secret). Render's **Auto-Deploy** stays **Off**. Before (until 2026-11-19) Render waited for every check on the commit, other apps' too, and a red Cloudflare build of the retired team app held every API deploy back without a word. After the hook, the job waits (up to 20 minutes) until `GET /health` names the pushed commit (`data.commit`, Render's `RENDER_GIT_COMMIT`), so it is green only once Render really runs that commit; a deploy that fails on Render's side (build, migration, start) turns the run red. Which parts changed is worked out against the last *green* run on main, not the previous push, so the next push to main after a red one, whatever it touches, deploys the backend again. You only deploy by hand when you don't want to wait for a push: **Manual Deploy → Deploy latest commit**, or re-run the Checks run. Try the wait by hand: `bash .github/scripts/wait-for-api.sh <commit> https://api.4vd.app/health 30`.
- The mail worker (`mail/`, `npx wrangler deploy`) and the Windows app (`desktop/README.md`) are released by hand.

**Rolling back** (labels from memory; the screens may word them slightly differently). The API: Render → `4vd-api` → **Events** → a previous good deploy → **Rollback**; Render may turn auto-deploy off after a rollback, so check **Settings → Auto-Deploy** before fixing forward. The dashboard: Cloudflare → **Workers & Pages** → `4vd-dashboard` → **Deployments** → an earlier version → **Rollback**. Then fix forward with a new push (`git revert` the bad commit). A rollback doesn't undo a migration that has already run, so the older code must still work with the newer tables.
