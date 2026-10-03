# Deployment Guide

## Environments

### Development
- Local laptop/PC setup
- See "Local Setup" in the root README.md

### Staging
- Optional testing environment before production

### Production
- Live environment for users

---

## Backend Deployment

### Prerequisites
- Node.js v22 LTS+
- PostgreSQL database set up
- Environment variables configured
- Git for version control

### Hosting Options (Free Tier Start)
- **Render** - Easy PostgreSQL + Node.js hosting (free tier available)
- **Railway** - Modern alternative with free trial
- **Heroku** - Classic option (free tier limited now)
- **DigitalOcean** - $5/month VPS starting point
- **Self-hosted** - Your own server

### Database Hosting (Free Tier)
- **Render PostgreSQL** - Free tier available
- **Railway PostgreSQL** - Free tier with credits
- **Neon** - Free tier with generous limits
- **Supabase** - PostgreSQL with free tier

### Deploy: Cloudflare (front ends) + Render (API and database)

| Address | What | Where |
|---|---|---|
| `dashboard.4vd.app` | The owner's dashboard (`admin/`) | Cloudflare Pages |
| `app.4vd.app` | The team app, built for browsers (`mobile/`) | Cloudflare Pages |
| `api.4vd.app` | The API and background jobs (`backend/`) | Render (`render.yaml`) |
| PostgreSQL | The data | Render |

The domain `4vd.app` is registered with Cloudflare, so its DNS lives there. The front ends' addresses are in `admin/.env.production` and `mobile/.env.production` (public, not secrets), and `public/_headers` keeps the alerts service worker from being cached. Why the API isn't on Cloudflare: it needs PostgreSQL, always-on background jobs (alerts, emails, daily summary) and native image resizing; moving it means a rewrite (worth revisiting for SaaS, one Durable Object per shop).

**1. API on Render** (already running from `render.yaml`)
1. Render → `4vd-api` → **Settings → Custom Domains → Add Custom Domain** → `api.4vd.app`. Render shows a target like `fourvd-api.onrender.com`.
2. Cloudflare → `4vd.app` → **DNS → Records → Add record**: Type `CNAME`, Name `api`, Target the Render address, **Proxy status: DNS only (grey cloud)**. Save.
3. Back on Render, **Verify**. It turns green and gets its certificate (minutes, sometimes up to an hour).
4. Check: `https://api.4vd.app/health` answers.

**2. Dashboard on Cloudflare Pages**
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → pick the 4VD repo.
2. Project name `4vd-dashboard`, production branch `main`, framework preset **None**.
3. Build command `npm ci && npm run build`, build output `dist`, **Root directory `admin`**.
4. Environment variable: `NODE_VERSION` = `22`. Save and deploy.
5. Project → **Custom domains → Set up a custom domain** → `dashboard.4vd.app`. Cloudflare adds the DNS record itself.

**3. Team app on Cloudflare Pages**
Same as the dashboard, with: project name `4vd-app`, **root directory `mobile`**, build command `npm ci && npx expo export --platform web --output-dir dist`, output `dist`, `NODE_VERSION` = `22`, custom domain `app.4vd.app`.

**4. Check everything**
Open `https://dashboard.4vd.app`, log in, switch a page or two. Open `https://app.4vd.app` on a phone and log in. Then:
- Render → delete the old services `4vd-dashboard` and `4vd-app` (Settings → Delete Service). Cloudflare serves them now.
- Remove the two `onrender.com` addresses from `CORS_ORIGINS` in `render.yaml` (ask Claude).

**5. Optional: `4vd.app` itself** redirects to the team app for now: Cloudflare → **DNS → Add record** `A`, Name `@`, IPv4 `192.0.2.1`, **Proxied (orange)**; then **Rules → Redirect Rules → Create**: when hostname equals `4vd.app`, redirect to `https://app.4vd.app` (301, keep path off).

**6. Real emails (Resend)**
1. resend.com → **Domains → Add Domain** → `4vd.app`, region EU. Use its **Auto configure with Cloudflare** button (or copy its records into Cloudflare DNS, all DNS only).
2. When verified: **API Keys → Create** (sending access).
3. Render → `4vd-api` → **Environment**: `RESEND_API_KEY` = the key, `EMAIL_FROM` = `4VD <hello@4vd.app>`. Save (it redeploys).

**7. Google sign-in (optional)**
Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application. Authorised JavaScript origins: `https://dashboard.4vd.app` and `https://app.4vd.app`. Copy the client ID into `GOOGLE_CLIENT_ID` on `4vd-api`.

**8. Before real use**
- Render → `4vd-api` → **Upgrade** to Starter (always on, so alerts and the daily summary go out), and upgrade `4vd-db` to a paid plan. Then change `plan:` in `render.yaml` to match (ask Claude), or the Blueprint may put them back.
- Wipe the test data (ask Claude; it is deliberate and can't be undone).
- First admin on a fresh database: in `4vd-api` → **Environment**, add `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (12+ characters) and `SEED_ADMIN_NAME`; it is created on start-up. Log in, then delete those three settings. Demo data and demo logins are refused in production.

After this, pushes to `main` deploy by themselves: Render redeploys the API once the GitHub checks pass (`autoDeployTrigger: checksPass`); Cloudflare rebuilds the front ends on every push.

**Free plan caveats** (check current pricing): a free Render web service sleeps when idle, and while asleep push alerts and the daily summary don't go out; a free Render database has limited storage and may expire.

**Running the same image elsewhere:** `docker build -t 4vd-backend backend` then `docker run --env-file backend/.env -p 3000:3000 4vd-backend` works on any Docker host (a VPS, Fly.io, Railway).

---

## Mobile Deployment

### iOS

1. **Build for App Store**
   ```bash
   cd mobile
   npm run build:ios
   # or with Expo:
   eas build --platform ios
   ```

2. **App Store Connect Setup**
   - Create Apple Developer account ($99/year)
   - Create app in App Store Connect
   - Configure provisioning profiles

3. **TestFlight (Beta Testing)**
   - Upload build to TestFlight
   - Invite testers via email
   - Gather feedback before release

4. **Submit to App Store**
   - Complete app information
   - Screenshots, description, keywords
   - Submit for review (1-3 days)

### Android

0. **Phone alerts need an Expo project ID.** Run `eas init` in `mobile` once (free Expo account). It adds `extra.eas.projectId` to `app.json`, which the app needs to get a push token. Until then the Account screen says phone alerts only work in the installed app. Expo Go can't receive them.

1. **Build for Play Store**
   ```bash
   cd mobile
   npm run build:android
   # or with Expo:
   eas build --platform android
   ```

2. **Google Play Console Setup**
   - Create Google Play Developer account ($25 one-time)
   - Create app in Play Console
   - Configure signing certificate

3. **Google Play Beta Testing**
   - Upload to internal testing
   - Invite testers via Play Store link
   - Gather feedback

4. **Submit to Play Store**
   - Complete store listing
   - Screenshots, description, category
   - Submit for review (few hours to 1 day)

---

## SSL/TLS

**Method:** Let's Encrypt (Free)

**On Render:**
- Automatically provisions free SSL certificate
- Auto-renews
- HTTPS enabled by default

**Custom Domain:**
- Add domain in Render settings
- Point DNS to Render
- SSL auto-provisioned

---

## Error Tracking & Logging

**Service:** Sentry (Free Tier)

**Setup:**
```bash
# Install Sentry in backend
npm install @sentry/node

# Initialize in server.js
const Sentry = require('@sentry/node');
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

**Benefits:**
- Real-time error alerts
- Error source tracking
- Release tracking
- Free plan: 5,000 events/month

---

## Database Backups

**Method:** Managed Backups (Render/Railway/AWS)

**Render PostgreSQL:**
- Daily automated backups
- 7-day retention
- Point-in-time recovery

**Manual Backup (Optional):**
```bash
# Export database
pg_dump $DATABASE_URL > backup-$(date +%Y-%m-%d).sql

# Restore
psql $DATABASE_URL < backup-2026-10-01.sql
```

---

## Monitoring & Health

**Health Check Endpoint:**
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
```

**Monitor with:**
- Render: Built-in health checks
- Uptime monitoring: UptimeRobot (free)
- Sentry: Error tracking

---

## Rate Limiting

**Enabled:** Yes (see API.md for limits)

**Implementation:**
```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

---

## DNS Setup

**Domain:** Not decided yet

**When you choose:**
1. Update DNS records:
   - CNAME to Render (or your host)
   - Point to your production API

2. Configure in app:
   - Update `EXPO_PUBLIC_API_URL` (mobile) and `VITE_API_URL` (admin) to your domain
   - Rebuild mobile apps

---

## Costs (Free Tier for Now)

| Service | Tier | Cost | Notes |
|---------|------|------|-------|
| Render Web Service | Free/Hobby | $0-7 | Auto-sleep on free, $7 for always-on |
| Render PostgreSQL | Free | $0 | 256MB storage |
| Sentry | Free | $0 | 5k events/month |
| Domain | .com/.dev | ~$10-15/year | When ready |
| SSL | Let's Encrypt | $0 | Free, auto-renewing |

**Total: $0/month (free tier)**

---

## Production Checklist

- [ ] Environment variables configured correctly
- [ ] Database migrations run successfully
- [ ] SSL certificate installed (auto with Render)
- [ ] API health check endpoint working
- [ ] Sentry error tracking configured
- [ ] Rate limiting enabled
- [ ] Database backups enabled
- [ ] Admin user created
- [ ] Initial products loaded
- [ ] Mobile API URL points to production domain
- [ ] Authentication working (JWT)
- [ ] Load testing completed (optional)
- [ ] Team access configured

---

## Deployment Process

**Automatic (Recommended):**
```bash
# Just push to main branch
git add .
git commit -m "Deploy: feature xyz"
git push origin main
# Render auto-deploys in 2-5 minutes
```

**Manual:**
- Render Dashboard → Web Service → Manual Deploy

---

## Rollback Plan

If deployment fails:

1. **Render Dashboard** → View logs
2. **Identify issue** → Check error message
3. **Rollback** → Select previous successful deploy
4. **Fix** → Push corrected code
5. **Re-deploy** → Push to main again

---

## Support & Contact

**Issues?** Contact: labidaqaj@gmail.com

**Render Support:** https://render.com/docs
**Sentry Support:** https://sentry.io/support

---

## Scaling (Future)

When you outgrow free tier:

1. **Render Paid Tiers**
   - Standard tier: ~$7-50/month
   - Includes 0.5 CPU, 512MB RAM

2. **Database Scaling**
   - Upgrade PostgreSQL tier
   - Add read replicas for analytics

3. **Caching**
   - Add Redis for hot data (products, pricing)
   - Cache frequently accessed data

4. **CDN**
   - Cloudflare free tier for image delivery
   - Faster product images globally

5. **Load Balancing**
   - Multiple Node.js instances
   - Render handles automatically on paid tiers

---

## Continuous Deployment (CI/CD)

**Current:** Manual git push → Auto-deploys

**Future Enhancements:**
- GitHub Actions for testing before deploy
- Automated database migrations
- Deployment notifications
- Staged rollouts

---

## Key Commands

| Action | Command |
|--------|---------|
| Deploy | `git push origin main` |
| View logs | Render dashboard |
| Check health | `curl https://your-api.render.com/health` |
| Backup DB | `pg_dump $DATABASE_URL > backup.sql` |
| View errors | Sentry dashboard |