# 4VD

## Handoff between sessions
@handoff.md

- Every session starts from `handoff.md` (imported above). In a worktree it isn't there: read the main checkout's copy, `C:\Users\labid\Desktop\4VDApp\handoff.md`.
- Before you end a turn that finished, paused or stopped a task, update `handoff.md` in the main checkout (never a worktree copy). It is gitignored; never commit it.
- One `##` section per open piece of work, named after it. Touch only your own section, because other sessions may be writing theirs. Rewrite it to show where things are now; don't append a log.
- Each section has: **Goal**, **Current state** (done, not done, not verified), **Active files**, **Changes made** (commits or branches), **Failed attempts** (what was tried, and why it didn't work), **Next steps** (specific).
- The user switches between two Claude accounts when one runs out of its 5-hour usage. So keep your section current as you go, not only at the end: after every finished milestone (a commit, a merge, a decision in chat, a long command started), and right away whenever usage looks close to running out. It must say what's done, what's left, and exactly what to do next, so a session on the other account can carry on at once without asking.
- When a piece of work is fully done and merged, delete its section. Keep the whole file under about 150 lines.

## Local servers
- One local app only: API on http://localhost:3000, dashboard on http://localhost:5173, database `four_vd_app`. Start them with `preview_start` (`api`, `dashboard` in `.claude/launch.json`); if they already run, reuse them.
- Never start a second API or dashboard on other ports (3001, 5174, 5175…) or point one at a scratch database. If a test needs other data, ask the user first.

## UI/UX rules
- Design direction: follow frontend-design. Never use generic defaults (Inter + purple gradients).
- Before building any UI, read DESIGN.md. If missing, generate it with design-md first.
- Use only tokens from DESIGN.md (colors, spacing, radius, type scale). No hardcoded values.
- Use 4VD's own component kit (`admin/src/components/ui`) before writing custom ones. Screens are React with plain CSS on DESIGN.md tokens. Tailwind or shadcn/ui only as a deliberate, explained decision where they clearly pay off (e.g. accessible dialogs, menus, popovers), never by default.
- After each big finished feature (not every small UI change): open it with Playwright, screenshot at 375px and 1440px, fix visible issues.
- Then run web-design-guidelines + fixing-accessibility on that feature and fix every violation.
- Also run lintapple on it: with the dashboard dev server up, `npm run lint:ui` in `admin/` (rules in `admin/ui-policy.json`: 4VD fonts and type sizes, 375/1440px, light and dark). Fix the findings, or add a scoped exception with a reason.
- States are required: hover, focus, disabled, loading, empty, error.
