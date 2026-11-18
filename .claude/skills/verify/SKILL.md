---
name: verify
description: Run the 4VD app and prove a change works before committing. Loads the screens the diff touches in a headless browser signed in as demo logins, reads console errors, failed API calls, error notices and the API log, and reports in text (no screenshots). Read-only on the real database four_vd_app (writes are blocked and the block is proven every run); flows that create data run against the demo database four_vd_app_demo. Use before every commit that touches admin/ or backend/src, when asked to "verify", "try it in the app", or "check it works".
---

# Verify a change in the running app

The evidence is text: the user doesn't want proof screenshots. Paste the summary lines into your report and into the commit's `Verified:` line. Then check the REVIEW.md items your diff triggers: read them from main with `git show origin/main:REVIEW.md`.

Scripts live in `.claude/skills/verify/scripts/` and run with plain `node`. They borrow `pg` from `backend/` and Playwright from `e2e/`, so there's nothing to install. Run them from the repo root.

## 1. Read-only check (most changes)

1. Start the servers, or reuse them if they're running: `preview_start` `api`, then `preview_start` `dashboard`.
2. Run
   `node .claude/skills/verify/scripts/screens.mjs --db real`
   - **Screens:** it picks them from the diff (`main...HEAD`, uncommitted and untracked files) through `screens.json`. Add `--paths /a,/b` or `--role accountant|employee|family` to choose them yourself, or `--base <ref>` for another base.
   - **Database:** `--db real` is checked against what port 3000 really serves. On a mismatch it stops before loading anything.
   - **What it does:** signs in through the real login form as `demo-admin` (or the role the map names), loads each screen, and prints `ok` / `WARN` / `FAIL` per screen and one summary line.
   - **Write block:** on four_vd_app every API call that isn't a GET or a sign-in is answered "blocked" inside the browser (service workers are off, so none can slip past). Each run proves the block first with a test POST, and stops if the POST gets through. `WARN` = a screen tried to write on load (blocked, but worth a look).
   - **Not strictly read-only:** each run signs a demo login in and out on four_vd_app, which the API records (a session row, and the sign-in in the activity log). No shop data is written.
3. Call `preview_logs` for the `api` server with `level: "error"`. Any error logged during the run is a finding.
   - Known baseline (2026-11-17, not from your change): two lines at startup, `A query on skip ran without a business` (EmailOutboxRepository.claim) and `A query on settings ran without a business` (SettingsRepository.claim). They come from timers outside a business; reported to the tenancy work.
4. If a screen has no line in `screens.json`, add one in the same commit.

A run takes about 6 s to sign in, then about 2 s per screen. 4 screens take about 13 s, all 44 mapped screens about 90 s.

## 2. Flows that create data (bills, sales, payroll, settings…)

Never on four_vd_app (CLAUDE.md). Switch port 3000 to the demo database, and always switch back:

1. `node .claude/skills/verify/scripts/demo-db.mjs`
   - Creates `four_vd_app_demo` if it's missing, migrates it, and seeds it (`seed:demo`) when the demo logins or sales are missing.
   - Plants the marker category `VERIFY demo database`, and adds the `api-demo` entry to `.claude/launch.json` (that file is local).
   - It refuses any other database name. Takes 3 s warm, 9 s from scratch; `--reseed` rebuilds it.
2. Write in handoff.md (your section) that the API is on the demo database.
3. Switch:
   - `preview_stop` the `api` server.
   - `node .claude/skills/verify/scripts/probe.mjs --expect down --wait 30`. The old server must really be gone, or the new one dies on "port in use" while 3000 still serves the real data.
   - `preview_start` `api-demo`.
   - `node .claude/skills/verify/scripts/probe.mjs --expect demo --wait 60`.
4. Do the flow:
   - Scripted: `screens.mjs --db demo --paths ...` (no write block on demo).
   - By hand in the built-in browser (`navigate` to `http://localhost:5173/login`, sign in as a demo login, click through). In the login form, type with `computer` click + type: `form_input` doesn't reach React's state there.
   - Run `probe.mjs --expect demo --wait 5` again right before each Save, since another session may have switched 3000 back.
   - Name what you create `VERIFY-…` and delete it afterwards where the app allows.
   - Read the outcome with `read_network_requests` (the POST and its status) and `read_console_messages` (`onlyErrors`), and check the rows in four_vd_app_demo with `psql` if needed.
5. **Switch back, even after a failure:**
   - `preview_stop` `api-demo`.
   - `probe.mjs --expect down`.
   - `preview_start` `api`.
   - `probe.mjs --expect real --wait 60`.
   - Remove the handoff.md line.
   - End your report with the probe's line (`port 3000 serves four_vd_app`).

**What api-demo changes:**
- **Outside world:** email (Resend), push, AI, Sentry and the bill-mail token are blank, so demo sales never email or alert anyone.
- **Sign-in secret:** its sign-in secret is its own, so a session signed in on demo is worthless against the real database after the switch back. The built-in browser shows the sign-in page again; two 401s in the console right after a switch are expected.
- **Database role:** it acts as `four_vd_app_demo_app` (made and granted by `demo-db.mjs`): not a superuser, not the owner, no BYPASSRLS, like `fourvd_app` live. So row security applies, and adding a business, the support visit log and keeping one business's rows from another can be checked on demo. The real `api` (four_vd_app) still connects as the postgres superuser, which skips row security: don't read business isolation off it. The API log's `Connected to the database` line names the role.
- **Process:** it runs `tsx` without watch: one process, so `preview_stop` leaves nothing on the port.

## 3. Reading the results

- `screens: ok 8/8 screens, roles admin, four_vd_app (writes blocked), 0 blocked writes, 112 API calls, 21.0s` is a pass.
- Each `FAIL` line lists what was seen: `console:` (browser console error), `crash:` (uncaught exception), `HTTP 4xx/5xx METHOD /api/...`, `failed:` (network), `error notice:` (the page's red notice), `sent back to sign-in`, `no page heading (h1) rendered`.
- A 403 means that role may not open the screen. Set the right `role` in `screens.json` (payroll needs accountant or owner); it isn't a bug.
- After about 1000 API calls by one login in 15 minutes, the screens fail with `HTTP 429` and the summary says the rate limit was hit (`probe` says `unknown (API rate limit hit…)`). A 4-screen run makes about 56 calls and the full 44-screen run about 430, so that's about 18 small runs, or one full run plus 10.
  - Every session on port 3000 shares demo-admin's budget, so check only the screens your diff needs.
  - The probe signs in as demo-family, so it never uses up the quota of the logins the screens sign in as.
  - On the demo API, restarting it resets the counter. On the real API, wait.
  - Never loop verify to make a flaky result pass (CLAUDE.md flaky-test rule).
- Exit codes: 0 pass, 1 fail, 2 bad arguments.

## 4. Commit line

Put one line in the commit message body, for example:

- `Verified: verify (8 screens, real; 2 flows on demo), REVIEW 3,4`
- `Verified: none (docs only)`

## What it doesn't cover (say so in your report)

- **Pixels:** the look (the user checks by eye) and phone layouts; `npm run lint:ui` covers 375 px.
- **Shop PC hardware:** the fiscal printer, the cash drawer, the Windows app.
- **Sign-in methods:** passkeys and two-step need a real device or code.
- **Writes on real data:** never done; anything that only shows up after saving must be tried on demo.

## Stress test (2026-11-17)

- **Timing:** 30 runs of 4 screens (10 on demo, 20 on real), at 11–18 s each. Three runs of all 44 mapped screens gave 0 false failures once payroll used the accountant login. Every failure in the loops (5 on demo, 7 on real) was the rate limit (HTTP 429), reproduced on purpose: one full run plus about 10 small ones. No other flake.
- **Failure cases:** each one ended with one line and the right exit code, with nothing hanging:
  - API down;
  - dashboard down;
  - a wrong `--db`;
  - no `--db`;
  - an unknown role;
  - real 404 screens (`/books/accounts/999999`, an unknown address);
  - the rate limit (found by the stress loop itself; probe now says "rate limit" instead of guessing).
- **Demo DB:** dropped and rebuilt with `--reseed` in 9 s.
- **Switch cycle:** real → demo → real twice. The port was free within 0.1 s of `preview_stop`. A category created in the built-in browser landed only in four_vd_app_demo (0 rows in four_vd_app).
- **Speed fix:** Playwright's default headless shell took 13 s to open a page on this PC. The full Chromium (`channel: 'chromium'`) takes 1 s, which the script uses.
- **Not tried:** Docker stopped (it would stop other sessions' databases). By reasoning, the probe then gets a failed demo login and says `unknown`, so nothing loads.
