# 4VD

## UI/UX rules
- Design direction: follow frontend-design. Never use generic defaults (Inter + purple gradients).
- Before building any UI, read DESIGN.md. If missing, generate it with design-md first.
- Use only tokens from DESIGN.md (colors, spacing, radius, type scale). No hardcoded values.
- Use 4VD's own component kit (`admin/src/components/ui`) before writing custom ones. Screens are React with plain CSS on DESIGN.md tokens. Tailwind or shadcn/ui only as a deliberate, explained decision where they clearly pay off (e.g. accessible dialogs, menus, popovers), never by default.
- After each big finished feature (not every small UI change): open it with Playwright, screenshot at 375px and 1440px, fix visible issues.
- Then run web-design-guidelines + fixing-accessibility on that feature and fix every violation.
- Also run lintapple on it: with the dashboard dev server up, `npm run lint:ui` in `admin/` (rules in `admin/ui-policy.json`: 4VD fonts and type sizes, 375/1440px, light and dark). Fix the findings, or add a scoped exception with a reason.
- States are required: hover, focus, disabled, loading, empty, error.
