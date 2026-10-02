# Accounts and Profiles (part 2 of the rebrand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real accounts: invites by email, email verification, password reset, change email/password, Google sign-in, devices you can log out, profiles with photos, and the owner's business profile.

**Architecture:** One migration adds the SaaS foundation (`businesses`) and account tables. Emails go into an `email_outbox` table that the existing 5-second background loop sends, through `LogSender` (prints to the server log) until `RESEND_API_KEY` is set. Account links (invite, verify, reset) open public pages in the dashboard site, which work for every role; after accepting, staff are pointed to the employee app. Google sign-in verifies Google's ID token on the server and only ever signs in or links an existing (or invited) account.

**Tech Stack:** Express 5, Kysely + PostgreSQL, Zod, Vitest + Supertest; `sharp` (image resizing), `google-auth-library` (ID token checks), `resend` (email); React (dashboard), Expo (employee app).

**Spec:** `docs/superpowers/specs/2026-10-02-rebrand-accounts-design.md` (section 2)

## Global Constraints

- Tokens: 32 random bytes, stored only as SHA-256 hashes, single use. Invite 7 days; verify / change email 24 h; reset 1 h.
- Forgot-password and resend-verification answers never reveal whether an email has an account.
- Google sign-in never creates an account by itself; it signs in a linked identity, links on first use when the Google email is verified and matches an account, or accepts a matching invite.
- Images: avatars 256 px, logo 512 px, WebP, max upload 5 MB, stored ≤ 300 KB; served at `/api/media/:uuid` with one-year caching.
- A password reset or email change ends every other session.
- `ALLOW_SIGNUP` defaults to `false`.
- Every account email has an HTML and a plain-text part, sent via the outbox.
- Existing users: business 1, marked verified.

## Review Focus

- An invite link used twice, or after the person already has an account → clear "already used" message, no second account (test in Task 3).
- Accepting an invite whose email now belongs to an existing user (e.g. invited twice) → refused with a message, not a crash (Task 3).
- A reset link used after the password was changed another way → refused (token single use + expiry) (Task 4).
- Uploading a non-image or a huge file as an avatar → 400 with a readable message (Task 5).
- Google ID token for a different app (wrong audience) or unverified email → refused (Task 7).

---

### Task 1: Migration and types
**Files:** `backend/src/database/migrations/007_accounts.ts`, `.../index.ts`, `backend/src/database/types.ts`, `backend/tests/helpers/testApp.ts` (truncate list)
- [ ] Create tables `businesses`, `media`, `invites`, `account_tokens`, `user_identities`, `email_outbox`; add `users.business_id/email_verified_at/phone/avatar_media_id/theme/last_login_at`, `refresh_tokens.session_id/user_agent/ip/last_used_at`; backfill one business named "4VD", verified users, a session id per refresh token.
- [ ] Run the full backend suite (all green) and commit: `feat: Add businesses, invites, account links, photos and sign-in identities to the database`.

### Task 2: Email outbox and templates
**Files:** `backend/src/services/email/{senders.ts,templates.ts,EmailService.ts}`, `backend/src/repositories/EmailOutboxRepository.ts`, config (`RESEND_API_KEY`, `EMAIL_FROM`, `DASHBOARD_URL`, `TEAM_APP_URL`), `server.ts` loop
**Produces:** `EmailService.queue(message: { to: string; template: EmailTemplate }): Promise<void>`, `EmailService.sendPending(): Promise<number>`; templates `invite`, `verifyEmail`, `resetPassword`, `emailChanged`.
- [ ] Tests: queued email sends once through a fake sender; failures retry up to 5 times then stop; templates include the link and escape names.
- [ ] Commit: `feat: Queue and send account emails, printed to the log until an email service is set up`.

### Task 3: Invites
**Files:** `backend/src/services/AccountService.ts` (invites part), `backend/src/repositories/InviteRepository.ts`, routes `/api/invites` (owner) and `/api/auth/invites/:token` (public)
- [ ] Tests: owner invites → email queued with link; pending list; resend; cancel; public preview shows shop name and role; accept with name + password creates a verified user and logs in; link reused → 410; expired → 410; email already has an account → 409; employee can't invite.
- [ ] Commit: `feat: Let the owner invite people by email`.

### Task 4: Verification, password reset, change email and password
- [ ] Tests: forgot → same answer for unknown email, reset email queued for known; reset sets password and ends sessions; reused/expired link refused; change password needs the current one; change email queues a link to the new address and a notice to the old; clicking switches and verifies.
- [ ] Commit: `feat: Add password reset, email verification and changing your email or password`.

### Task 5: Profiles, photos and the business profile
- [ ] Tests: update name/phone/theme; avatar upload resizes to WebP and serves from `/api/media/:id`; non-image → 400; >5 MB → 413; business profile read by everyone, edited by admin only; logo upload.
- [ ] Commit: `feat: Add profiles with photos, and the shop's business profile`.

### Task 6: Devices
- [ ] Tests: sessions listed with device and last use; "log out this device" revokes only that session; "log out everywhere else" keeps the current one; refresh keeps the session id.
- [ ] Commit: `feat: Let people see the devices they're logged in on and log them out`.

### Task 7: Google sign-in
- [ ] `GoogleVerifier` interface (real: `google-auth-library` with `GOOGLE_CLIENT_ID`; tests: fake). Tests: linked identity signs in; first use links by verified matching email; unverified email or unknown account → 401; accept invite with Google when emails match; wrong audience rejected by the real verifier config.
- [ ] Commit: `feat: Sign in with Google`.

### Task 8: Sign-up (switched off)
- [ ] Tests: 404 while `ALLOW_SIGNUP=false`; when on, creates business + owner, sends verification, login refused until verified.
- [ ] Commit: `feat: Add shop sign-up behind a switch, off for now`.

### Task 9: Dashboard screens
- [ ] Public pages: accept invite, forgot password, reset password, verify email (with Google button when configured). Profile page (photo, name, phone, theme, alerts, security, devices). Business profile in Settings. People: invite form, pending invites, avatars. Google button on login.
- [ ] Screens checked in both themes; build, lint, tests green. Commit: `feat: Add account, profile and invite screens to the dashboard`.

### Task 10: Employee app
- [ ] Account screen: photo, name, phone (editable), "Forgot password?" on login opening the dashboard's reset page, avatar on Home.
- [ ] Commit: `feat: Add profiles to the employee app`.

### Task 11: Ship
- [ ] Branch, checks green, merge, push; note the new Render settings in DEPLOYMENT.md.
