# 4VD

## UI/UX rules
- Design direction: follow frontend-design. Never use generic defaults (Inter + purple gradients).
- Before building any UI, read DESIGN.md. If missing, generate it with design-md first.
- Use only tokens from DESIGN.md (colors, spacing, radius, type scale). No hardcoded values.
- Use shadcn/ui components before writing custom ones.
- After every UI change: open it with Playwright, screenshot at 375px and 1440px, fix visible issues.
- Then run web-design-guidelines + fixing-accessibility and fix every violation.
- States are required: hover, focus, disabled, loading, empty, error.
