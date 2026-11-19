# 4VD

## Handoff between sessions
@handoff.md

- Every session starts from `handoff.md` (imported above). In a worktree it isn't there: read the main checkout's copy, `C:\Users\labid\Desktop\4VDApp\handoff.md`.
- Before you end a turn that finished, paused or stopped a task, update `handoff.md` in the main checkout (never a worktree copy). It is gitignored; never commit it.
- One `##` section per open piece of work, named after it. Touch only your own section, because other sessions may be writing theirs. Rewrite it to show where things are now; don't append a log.
- Each section has: **Goal**, **Current state** (done, not done, not verified), **Active files**, **Changes made** (commits or branches), **Failed attempts** (what was tried, and why it didn't work), **Next steps** (specific).
- The user switches between two Claude accounts when one runs out of its 5-hour usage. So keep your section current as you go, not only at the end: after every finished milestone (a commit, a merge, a decision in chat, a long command started), and right away whenever usage looks close to running out. It must say what's done, what's left, and exactly what to do next, so a session on the other account can carry on at once without asking.
- When a piece of work is fully done and merged, delete its section. Keep the whole file under about 150 lines.
- What nobody tried by hand goes in progress.md "To test by hand", not handoff.md. Questions for the accountant go in handoff.md's "Accountant" section, one line each.

## Layout
- `backend/`: Express 5 + TypeScript API on Postgres (Kysely, zod). Docker container `four-vd-app-postgres`; DB `four_vd_app`, tests use `four_vd_app_test`. How it fits together: `docs/ARCHITECTURE.md`.
- `admin/`: the dashboard (React + Vite, plain CSS on tokens). It is the only app in use: owners get the full dashboard, employees a phone-style layout (`StaffLayout`), the Counter is `/counter`.
- `desktop/`: the Electron Windows app (fiscal printer through F-Link, updates from GitHub Releases). The dashboard lives at 4vd.app (`admin/wrangler.jsonc`); app.4vd.app (old QR labels) redirects there by a Cloudflare rule.
- `mail/`: the Cloudflare Email Worker for bills@4vd.app (own `wrangler.jsonc`, deployed by hand; `npm test`). Setup in `docs/DEPLOYMENT.md`.
- The old Expo team app (`mobile/`) was retired on 2026-10-20 and removed on 2026-11-19; it is only in git history (last in commit 3cbaf85b).
- `progress.md`: the task list (tick items as they're done). `DESIGN.md`: the rulebook for logic, words and look. `PRODUCT.md`: who it's for.
- Project skills: `verify` (run the app and prove a change before committing), `step-workflow` (how a step session runs, start to merge: read it when starting a task) and `kosovo-tax` (every VAT, payroll, profit tax and books rule 4VD follows and where it lives; read it before touching money logic, add new rules to it).

## Commands
- backend: `npm run typecheck`, `npx vitest run tests/<file>.test.ts` (one file), `npm run test:related -- src/<changed files>` (every test that imports them: narrow for utils and routes, but a service is imported by the container, so it pulls in nearly the whole suite; then name the test files instead), `npm test` (full suite, files in parallel on 4 workers, about 10 min locally), `npm run migrate`, `npm run seed:demo` (demo logins `demo-*@4vd.local`).
- admin: `npm run lint` (oxlint), `npm test`, `npm run build` (`tsc -b`, stricter than plain `tsc`).
- While working, run only the tests that cover the change (`test:related` or named files). Before merging logic changes, run the tests for every file you touched plus backend typecheck and build, admin lint, test and build. GitHub runs the full suite on main, and nothing goes live (Render or 4vd.app) until it passes, so it is the real gate: watch that run and fix main at once if it goes red. Run the full suite locally first only for migrations, money logic (posting, VAT, payroll, stock cost), sign-in, or tenancy. CSS-only changes need lint:ui, not the suite.
- Before committing a change to `admin/` or `backend/src`: run the `verify` skill (loads the touched screens signed in as demo logins, text evidence; data-creating flows on the demo database), then check the `REVIEW.md` items your diff triggers, read from main (`git show origin/main:REVIEW.md`). End the commit message with a `Verified:` line saying what was checked, or `Verified: none (why)`.
- A check still failing after 3 rounds of fixes: stop and tell the user (or the orchestrator) what fails and what you tried; don't keep grinding.
- A flaky test: never re-run it until it passes, add sleeps or raise timeouts. Find the cause; if you can't, delete the test and write down why in the commit.
- Commits: `feat:` / `fix:` / `docs:` prefix, then plain English a non-developer understands. Work on main or a short branch in this checkout (no worktrees); merge, push and delete branches yourself.
- Speed of going live: a push that touches only `admin/` (or docs) is live on 4vd.app in about 3 min; any `backend/` change runs the full backend suite (~8 min on GitHub) plus Render's deploy. So when a change has a screen part that works on its own, push it as its own commit first, then the backend part.
- The checkout is shared by several sessions, and an orchestrator session says who may use it. Without its go, don't switch branches, stash, run tests or migrate here; land files on main through a temporary index instead (`step-workflow` skill). Stage only your own files (`git diff --cached --name-only` before every commit). Number a new migration at merge time, against the newest main.

## Gotchas
- Docker Desktop must be running, or migrations fail with a blank error.
- `python` isn't installed: use `node`. Run `tsx -e` with `< /dev/null` or it hangs.
- Backend tests wipe their test DB, so each session uses its own: `docker exec four-vd-app-postgres createdb -U postgres four_vd_app_test_<session-name>` once, then run tests with `TEST_DATABASE_URL` pointing at it (same URL as in `backend/.env`, other database name; the name must contain "test"). A run also makes `<name>_tpl` and one `<name>_w<n>` per worker next to it. Never run tests against another session's test DB. Drop yours and its `_tpl`/`_w*` copies when your work is merged.
- `gh` lives at `C:/Program Files/GitHub CLI`; in bash add it to PATH.
- Pressing keys on the real dashboard records real sales in `four_vd_app`. Don't try a checkout there to test it: use the demo database (Local servers).

## Local servers
- One local app only: API on http://localhost:3000, dashboard on http://localhost:5173, database `four_vd_app`. Start them with `preview_start` (`api`, `dashboard` in `.claude/launch.json`); if they already run, reuse them.
- To click through flows that create data (checkouts, bills, payroll), point the API at the demo database `four_vd_app_demo` (migrated, filled by `npm run seed:demo`), never at `four_vd_app`. Switch back to `four_vd_app` when done, and say so in handoff.md while it's switched. The browser tests (`e2e/`) may run their own API and dashboard on 3100/5180 with `four_vd_app_e2e`.
- Otherwise never start a second API or dashboard on other ports or point one at a scratch database. If a test needs other data, ask the user first.

## UI/UX rules
- Design direction: follow frontend-design. Never use generic defaults (Inter + purple gradients).
- Before building any UI, read DESIGN.md. Use only its tokens (colors, spacing, radius, type scale). No hardcoded values.
- Use 4VD's own component kit (`admin/src/components/ui`) before writing custom ones. Screens are React with plain CSS on DESIGN.md tokens. Tailwind or shadcn/ui only as a deliberate, explained decision where they clearly pay off (e.g. accessible dialogs, menus, popovers), never by default.
- The user checks the look by eye: don't take screenshots to prove work (they use up usage). Take one only to debug something specific.
- After each big finished feature (not every small UI change): run web-design-guidelines + fixing-accessibility on it and fix every violation.
- Also run lintapple on it: with the dashboard dev server up, `npm run lint:ui` in `admin/` (rules in `admin/ui-policy.json`: 4VD fonts and type sizes, 375/1440px, light and dark). Fix the findings, or add a scoped exception with a reason. It can't sign in by itself: give it a plan with fill/click states.
- States are required: hover, focus, disabled, loading, empty, error.
