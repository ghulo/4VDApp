# 4VD

## Handoff between sessions
@handoff.md

- Every session starts from `handoff.md` (imported above). In a worktree it isn't there: read the main checkout's copy, `C:\Users\labid\Desktop\4VDApp\handoff.md`.
- Before you end a turn that finished, paused or stopped a task, update `handoff.md` in the main checkout (never a worktree copy). It is gitignored; never commit it.
- One `##` section per open piece of work, named after it. Touch only your own section, because other sessions may be writing theirs. Rewrite it to show where things are now; don't append a log.
- Each section has: **Goal**, **Current state** (done, not done, not verified), **Active files**, **Changes made** (commits or branches), **Failed attempts** (what was tried, and why it didn't work), **Next steps** (specific).
- The user switches between two Claude accounts when one runs out of its 5-hour usage. So keep your section current as you go, not only at the end: after every finished milestone (a commit, a merge, a decision in chat, a long command started), and right away whenever usage looks close to running out. It must say what's done, what's left, and exactly what to do next, so a session on the other account can carry on at once without asking.
- When a piece of work is fully done and merged, delete its section. Keep the whole file under about 150 lines.

## Layout
- `backend/`: Express 5 + TypeScript API on Postgres (Kysely, zod). Docker container `four-vd-app-postgres`; DB `four_vd_app`, tests use `four_vd_app_test`. How it fits together: `docs/ARCHITECTURE.md`.
- `admin/`: the dashboard (React + Vite, plain CSS on tokens). It is the only app in use: owners get the full dashboard, employees a phone-style layout (`StaffLayout`), the Counter is `/counter`.
- `desktop/`: the Electron Windows app (fiscal printer through F-Link, updates from GitHub Releases). The dashboard lives at 4vd.app (`admin/wrangler.jsonc`); app.4vd.app (old QR labels) redirects there by a Cloudflare rule. dashboard.4vd.app no longer exists.
- `mobile/`: the old Expo team app, retired since 2026-10-20. Don't change it unless the user asks.
- `progress.md`: the task list (tick items as they're done). `DESIGN.md`: the rulebook for logic, words and look. `PRODUCT.md`: who it's for.

## Commands
- backend: `npm run typecheck`, `npx vitest run tests/<file>.test.ts` (one file), `npm test` (full suite, about 10 min), `npm run migrate`, `npm run seed:demo` (demo logins `demo-*@4vd.local`).
- admin: `npm run lint` (oxlint), `npm test`, `npm run build` (`tsc -b`, stricter than plain `tsc`).
- While working, run only the tests that cover the change. Before pushing logic changes, run what CI runs: backend typecheck, full suite and build; admin lint, test and build. CSS-only changes need lint:ui, not the suite.
- Commits: `feat:` / `fix:` / `docs:` prefix, then plain English a non-developer understands. Work on main or a short branch in this checkout (no worktrees); merge, push and delete branches yourself.

## Gotchas
- Docker Desktop must be running, or migrations fail with a blank error.
- `python` isn't installed: use `node`. Run `tsx -e` with `< /dev/null` or it hangs.
- Backend test files share one test DB and wipe it, so two suites at once (another session) fail each other.
- `gh` lives at `C:/Program Files/GitHub CLI`; in bash add it to PATH.
- Pressing keys on the real dashboard records real sales in `four_vd_app`. Don't try a checkout there to test it.

## Local servers
- One local app only: API on http://localhost:3000, dashboard on http://localhost:5173, database `four_vd_app`. Start them with `preview_start` (`api`, `dashboard` in `.claude/launch.json`); if they already run, reuse them.
- Never start a second API or dashboard on other ports (3001, 5174, 5175…) or point one at a scratch database. If a test needs other data, ask the user first.

## UI/UX rules
- Design direction: follow frontend-design. Never use generic defaults (Inter + purple gradients).
- Before building any UI, read DESIGN.md. Use only its tokens (colors, spacing, radius, type scale). No hardcoded values.
- Use 4VD's own component kit (`admin/src/components/ui`) before writing custom ones. Screens are React with plain CSS on DESIGN.md tokens. Tailwind or shadcn/ui only as a deliberate, explained decision where they clearly pay off (e.g. accessible dialogs, menus, popovers), never by default.
- The user checks the look by eye: don't take screenshots to prove work (they use up usage). Take one only to debug something specific.
- After each big finished feature (not every small UI change): run web-design-guidelines + fixing-accessibility on it and fix every violation.
- Also run lintapple on it: with the dashboard dev server up, `npm run lint:ui` in `admin/` (rules in `admin/ui-policy.json`: 4VD fonts and type sizes, 375/1440px, light and dark). Fix the findings, or add a scoped exception with a reason. It can't sign in by itself: give it a plan with fill/click states.
- States are required: hover, focus, disabled, loading, empty, error.
