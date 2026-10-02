# 4VD rebrand, accounts and "real product" round

Agreed with the owner on 2026-10-02. The owner delegated all visual and technical
choices ("do whatever fits best"), so the decisions below are final unless they
prove wrong in use.

## Goal

Make 4VD feel like a finished product instead of a side project: a new identity,
light and dark themes, proper accounts (invites, email verification, Google
sign-in, password reset), profiles for everyone, a setup guide, quick search and
branded emails. Built for the family shop now, structured so it can become a
product other shops sign up for (SaaS) without a rewrite.

## Fixed decisions

- Name stays **4VD** ("4 Vëllezërit Dacaj", the four Dacaj brothers, named by
  their father). The story shapes the logo; it is never spelled out in the UI
  except on the login screen's small print.
- Order: **1. design system → 2. accounts and profiles → 3. every screen, setup
  guide, search, emails → 4. launch**. Nothing gets built twice.
- SaaS: **foundation only**. A `businesses` table; users, invites, settings-to-come
  and the business profile belong to a business. Products, stock, sales and the
  rest stay single-business until SaaS is real; the plan for that is at the end.
- Accounts: **invites only for now**. A public "create your shop" sign-up exists
  behind `ALLOW_SIGNUP=false`.
- Sign-in: email + password, and **Google**. Apple is prepared (same identity
  table and flow) and switched on later; it needs a paid Apple Developer account.
- Email: **Resend**, sending from the owner's own domain (bought before launch).
- Test data: **untouched until launch**. At launch the laptop and Render
  databases are wiped and the owner starts clean on the new domain.

## 1. Identity and design system

### Brand

- **Mark:** four upright bars of equal width under one flat roof line, inside a
  rounded square: a shop front held up by four pillars, i.e. the four brothers
  holding up the family business. Equal bars on purpose: no brother is bigger.
  The mark works at 16 px (favicon) and as the app icon.
- **Wordmark:** "4VD" set in the brand typeface at weight 800, tight tracking.
- **Voice:** plain, warm, brief. Sentence case everywhere, no all-caps labels.

### Colour tokens

Chosen for a home-goods shop (wood, linen, brass, plants) without the generic
cream-and-terracotta look: a deep pine green with a brass accent on cool,
slightly green-tinted neutrals.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F3F5F2` | `#0D1411` | page |
| `surface` | `#FFFFFF` | `#151F1A` | cards, panels |
| `surface-sunk` | `#E9EDE8` | `#0A100D` | table heads, wells |
| `ink` | `#122019` | `#E6EEE9` | text |
| `ink-muted` | `#55665D` | `#97A89F` | secondary text |
| `line` | `#D9E0DA` | `#26332C` | borders |
| `brand` | `#1D5C45` | `#5BBF92` | primary buttons, links, active nav |
| `brand-ink` | `#FFFFFF` | `#08130E` | text on brand |
| `brass` | `#B8862B` | `#D9A945` | highlights, focus of attention, the logo roof |
| `warn` | `#B36B00` | `#F0A73A` | low stock, waiting |
| `danger` | `#B83A2B` | `#F07563` | sold out, urgent, destructive |
| `ok` | `#2F7D55` | `#6CC795` | in stock, approved |

All text/background pairs meet WCAG AA (4.5:1 body, 3:1 large text and UI).

### Type

**Hanken Grotesk** for everything (400 body, 600 UI, 800 headings and big
figures), tabular figures for every number. One family keeps it calm; size and
weight do the work. Scale (px): 13, 15, 17 (body), 20, 24, 32, 44, 64, 88.

### Shape, space, motion

- Radius: 8 (controls), 14 (cards), 20 (hero boards); pills for tags.
- Spacing on a 4 px grid. Content max width 1200 px (dashboard).
- Borders over shadows; one soft shadow only for floating things (menus, dialogs,
  the command palette).
- Motion only in answer to an action (menus open, toasts arrive, the palette
  opens). `prefers-reduced-motion` turns it off.

### Themes

`light`, `dark` and `system` (default). Stored per person in their profile and
mirrored in local storage so the right theme shows before login. The dashboard
sets `data-theme` on `<html>`; the app reads it from a theme context instead of
the device setting directly.

### Shared components (both apps, same names and behaviour)

Button (primary / secondary / quiet / danger, sizes), Field (label, hint, error),
Card, Board (the big-figure hero), Tag, StockTag, Avatar (photo or initials on a
colour picked from the name), Tabs, Menu, Dialog, Toast, EmptyState (always with
the next action), Skeleton loading, Command palette (dashboard).

## 2. Accounts and profiles

### Data (new migration)

- `businesses`: name, address, phone, currency (EUR), time zone, logo, created_at.
  One row now; every user gets `business_id`.
- `users` gains: `email_verified_at`, `phone`, `avatar_media_id`,
  `theme` (`light|dark|system`), `last_login_at`. Existing users are marked
  verified.
- `media`: id (UUID), business_id, mime, bytes, created_at. Avatars and the shop
  logo, resized on upload to 512 px (logo) / 256 px (avatar), WebP, under 300 KB.
  Served at `/api/media/:uuid` with long caching. Move to object storage (e.g.
  Cloudflare R2) only when SaaS needs it.
- `invites`: business_id, email, role, token hash, invited_by, expires_at (7 days),
  accepted_at, revoked_at.
- `account_tokens`: user_id, purpose (`verify_email`, `reset_password`,
  `change_email`), token hash, new_email, expires_at (24 h; 1 h for resets),
  used_at. Tokens are random, 32 bytes, stored only as SHA-256 hashes, single use.
- `user_identities`: user_id, provider (`google`, later `apple`), subject, email;
  unique (provider, subject).
- `refresh_tokens` gains `user_agent`, `ip`, `last_used_at` so people can see and
  end their sessions.

### Flows

- **Invite:** owner enters email and role on People → email with a link →
  `/invite/:token` shows the shop's name and logo → the person chooses a name and
  password, or "Continue with Google" (only if the Google email matches the
  invite) → account created, already verified (the link proved the email) →
  logged in. Owner can resend or cancel pending invites.
- **Login:** email + password, or Google. Google signs in an existing account
  linked to that Google identity, or links on first use when the Google email is
  verified and matches an account. Never creates an account on its own.
- **Forgot password:** email → link → new password → every session ends.
  The response never reveals whether an email has an account.
- **Change email:** confirm with password → link to the new address → switches
  when clicked; a notice goes to the old address.
- **Sign-up (off):** with `ALLOW_SIGNUP=true`, "Create your shop" makes a business
  and its owner, then sends a verification email; the owner can't log in until
  verified.
- **Rate limits:** the existing login limit, plus per-email limits on invites,
  resets and verification emails.

### Profiles

- **My profile** (everyone): photo, name, phone; theme; alert settings (moved
  here); security: change email, change password, linked Google account, list of
  devices with "log out" per device and "log out everywhere else".
- **Business profile** (owner): shop name, logo, address, phone, currency,
  time zone (replaces `SHOP_TIME_ZONE` as the source of truth once set).
- **People** (owner): avatars, invite, pending invites, roles, targets/commission
  (as now).

### Email

`EmailService` with one sending interface; `ResendSender` in production,
`LogSender` (prints the email and its link) when no key is set, so local work
needs no account. Branded HTML templates with a plain-text part: invite, verify
email, reset password, email changed, daily summary (optional per person),
weekly report (optional, Monday morning). Sending is queued in an `email_outbox`
table and sent by the same background loop as push alerts, so a slow email
service never slows a request.

## 3. Every screen, setup guide, search

- Every dashboard page and every app screen rebuilt on the new components, both
  themes checked with screenshots, phone widths checked.
- **Setup guide (owner):** a checklist card on Overview until done: business
  profile, logo, first product, invite someone, turn on alerts. Each step links
  to the place that does it and ticks itself off.
- **Welcome (staff):** first login shows a three-step tour of the app (sell,
  products, requests); can be skipped.
- **Empty states** everywhere name the next action.
- **Command palette (Ctrl/Cmd+K):** jump to any page, product or person; run
  common actions ("Add product", "Invite someone", "Record a sale"). Also `/` to
  focus page search.

## 4. Launch

1. Owner buys the domain; dashboard at `app.<domain>` style addresses (final
   names chosen then), employee app at `team.<domain>`, API at `api.<domain>`.
2. Resend domain verification (DNS records), Google sign-in client with the new
   addresses, fresh VAPID keys.
3. Paid Render plans for the API and database (sleeping breaks alerts and the
   daily summary).
4. Wipe the laptop and Render databases; the owner gets the first account via the
   existing first-admin settings, then invites the brothers and staff.

## Later: becoming SaaS

Add `business_id` to products, categories, inventory, sales, returns, write-offs,
counts, promotions, notifications, activity, settings and push subscriptions;
backfill with the one business; add it to every repository query (a single
`scoped(businessId)` helper on each repository); turn `ALLOW_SIGNUP` on; add
billing. The token already carries the business, so routes need no changes.

## Testing

Backend: integration tests for every flow above (invites, tokens expire and are
single use, Google token checks with a fake verifier, email outbox, media size
limits, sessions). Frontend: build, lint, unit tests for the theme and the
command palette's matching; screenshots of key screens in both themes before each
merge.
