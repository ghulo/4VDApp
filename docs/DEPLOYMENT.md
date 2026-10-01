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

### Steps to Deploy on Render (Recommended)

1. **Create Render Account**
   - Go to https://render.com
   - Sign up with GitHub

2. **Prepare Repo**
   ```bash
   # Make sure .env.example exists
   # backend/.env.example should have all variables
   
   # Add to backend/package.json:
   "scripts": {
     "start": "node src/server.js",
     "dev": "nodemon src/server.js"
   }
   ```

3. **Create Web Service on Render**
   - Dashboard → New Web Service
   - Connect GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment:
     - NODE_ENV: production
     - DATABASE_URL: (from Postgres service)
     - JWT_SECRET: (your secret key)

4. **Create PostgreSQL Database**
   - New PostgreSQL database
   - Copy CONNECTION_STRING
   - Use as DATABASE_URL in web service

5. **Deploy**
   - Render auto-deploys on git push to main
   - View logs in Render dashboard

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