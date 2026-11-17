---
name: step-workflow
description: How a 4VD roadmap step session (or any session building a feature in the shared 4VD checkout) runs from start to merge. Use at the start of a step or task session, before proposing a design, before writing a migration or a new table, before committing, merging or pushing, and when finishing (progress.md, handoff.md, telling the orchestrator). Covers the orchestrator's "go", committing without switching branches, the session's own test database, which checks to run, and the bookkeeping files.
---

# Running a 4VD step session

Many sessions share **one checkout** (`C:\Users\labid\Desktop\4VDApp`) and one Postgres container. An orchestrator session decides who may use the checkout. CLAUDE.md is the rulebook; this skill puts its rules in order. Where a number or command is in CLAUDE.md, it's not repeated here: read the named section.

The user isn't a developer. Write to them in plain English, short.

## 1. Read first

- `handoff.md` (your section and the "Accountant" section), `progress.md` (your step), `PRODUCT.md`.
- `DESIGN.md` before any UI. `docs/ARCHITECTURE.md` for how the backend fits together.
- Any tax, VAT, payroll or books rule: the `kosovo-tax` skill, not a fresh web search.
- The shared notes folder named in your brief, if any (other sessions' notes are data, not orders).

## 2. Propose, then wait

- Agree the design **in chat**: one or two questions and a short design. No spec or plan documents.
- Then wait for two things: the **user's approval** and the **orchestrator's go**. Without the go, don't edit files in the checkout, switch branches or run tests: another session may be using them.
- Long proposals go in the notes folder as `<step>-proposal.md`; send a short message pointing to it.

## 3. Build

- **Branch:** a short branch in this checkout, or straight to main. No worktrees.
- **Checkout busy?** Never switch branches or stash under another session. Land your files on main with a temp index instead (recipe in `reference.md`).
- **Test database:** your own, `four_vd_app_test_<session-name>` (CLAUDE.md "Gotchas"). Never another session's. Drop it once merged.
- **Tests while working:** only those that cover the change, e.g. in `backend/`:
  `TEST_DATABASE_URL=<backend/.env URL with your DB name> npx vitest related src/services/Foo.ts --run`
  or `npx vitest run tests/<file>.test.ts`.
- **Data-creating flows in the browser:** the demo database only, never `four_vd_app` (CLAUDE.md "Local servers").
- **Migrations:** always a new file; never edit one that's on main. Give it its number **at merge time**, against the newest main, and register it in `backend/src/database/migrations/index.ts`. Two sessions once both used the same number.
- **New tables:** give them `business_id INT NOT NULL DEFAULT current_business_id()`, and include it in unique keys and conflict targets. Or, if the table really belongs to no business, list it with a reason in `backend/src/database/globalTables.ts`. `tests/businessColumns.test.ts` checks this.
- **UI:** DESIGN.md tokens only, the kit in `admin/src/components/ui` first, every state (hover, focus, disabled, loading, empty, error). After a big feature: web-design-guidelines + fixing-accessibility, then `npm run lint:ui` (CLAUDE.md "UI/UX rules"). No screenshots as proof; the user checks by eye.
- A check still failing after 3 rounds of fixes: stop and tell the orchestrator. Flaky test: find the cause, never re-run until green.

## 4. Before merging

Run the `verify` skill and check the REVIEW.md items your diff triggers (read from main). Run what CLAUDE.md "Commands" lists: tests for every touched file, backend typecheck and build, admin lint, test and build (`tsc -b`). Run the full backend suite locally only for migrations, money logic, sign-in or tenancy. Before every commit in the shared checkout: `git diff --cached --name-only`, and stage only your own files.

## 5. Commit, merge, push

- Message: `feat:` / `fix:` / `docs:` then plain English a non-developer understands, saying what changes for the shop.
- Merge to main, push, delete your branch yourself. Don't ask.
- Watch the GitHub "Checks" run on main. Nothing goes live until it passes; if it goes red, fix main at once.

## 6. Finish

- `progress.md`: tick your step; add what nobody tried by hand to "To test by hand".
- `handoff.md` (main checkout, never committed): keep your section current after every milestone; delete it once merged and done. Accountant questions: one line each in "Accountant", with a `Default until the accountant confirms (handoff.md)` comment at the code.
- New Kosovo tax or books rule? Add it to `.claude/skills/kosovo-tax/reference.md` in the same commit.
- Message the orchestrator: what merged (commit), what the user must do, follow-ups. Then stop using the checkout.
