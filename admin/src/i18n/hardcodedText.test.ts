import { describe, expect, it } from 'vitest';

/** Every source file's text, keyed like '/src/pages/LoginPage.tsx'. */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** Files that must take every visible word from the catalogue. Each translation task adds its files. */
const TRANSLATED = [
  'src/i18n/LanguageSwitch.tsx',
  'src/components/AuthShell.tsx',
  'src/components/Avatar.tsx',
  'src/components/Feedback.tsx',
  'src/components/GoogleButton.tsx',
  'src/components/Layout.tsx',
  'src/components/LogoMark.tsx',
  'src/components/ManagersOnly.tsx',
  'src/components/OpenTheApp.tsx',
  'src/components/Pagination.tsx',
  'src/components/PushSettingsPanel.tsx',
  'src/components/RequireAuth.tsx',
  'src/components/SearchInput.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/Button.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/DataTable.tsx',
  'src/components/ui/EmptyState.tsx',
  'src/components/ui/Field.tsx',
  'src/components/ui/Halftone.tsx',
  'src/components/ui/PageHeader.tsx',
  'src/components/ui/MetricCard.tsx',
  'src/components/AnalyticsBoard.tsx',
  'src/components/ui/Stat.tsx',
  'src/theme/ThemeSwitch.tsx',
  'src/command/CommandPalette.tsx',
  'src/pages/LoginPage.tsx',
  'src/pages/AccountPages.tsx',
  'src/pages/ProfilePage.tsx',
  'src/setup/SetupGuide.tsx',
  'src/setup/steps.ts',
  'src/utils/errors.ts',
  'src/command/matching.ts',
  'src/command/useShortcuts.ts',
  'src/pages/OverviewPage.tsx',
  'src/pages/SalesPage.tsx',
  'src/pages/ReportsPage.tsx',
  'src/pages/AskPage.tsx',
  'src/pages/AlertsPage.tsx',
  'src/pages/ActivityPage.tsx',
  'src/components/activity/UndoConfirm.tsx',
  'src/components/activity/activityText.ts',
  'src/components/RevenueChart.tsx',
  'src/components/PeriodPicker.tsx',
  'src/utils/periods.ts',
  'src/pages/ProductsPage.tsx',
  'src/pages/ProductFormPage.tsx',
  'src/pages/InventoryPage.tsx',
  'src/pages/InventoryDetailPage.tsx',
  'src/pages/CategoriesPage.tsx',
  'src/pages/StockCountsPage.tsx',
  'src/pages/StockCountDetailPage.tsx',
  'src/pages/ApprovalsPage.tsx',
  'src/pages/PromotionsPage.tsx',
  'src/pages/UsersPage.tsx',
  'src/pages/SettingsPage.tsx',
  'src/components/ReturnForm.tsx',
  'src/components/WriteOffForm.tsx',
  'src/components/Decision.tsx',
  'src/components/StockTag.tsx',
  'src/components/BusinessPanel.tsx',
  'src/components/ManagersOnly.tsx',
  'src/App.tsx',
];

/** Brand and symbols that are fine to write directly. */
const ALLOWED = /^(4VD|Google|English|Shqip|Enter|Esc|Ctrl|Tab|[^A-Za-zËëÇç]*)$/;

/** JSX text matches can catch code between tags (`a < b ? (`); real words don't contain these. */
const CODE = /[=(){};?&|$]|\.\w/;

/** `} else {` and friends sit between braces too. */
const KEYWORD = /^(else|catch|finally|while|try|do|as const|from)\b/;

const PATTERNS = [
  /(?<![=-])>\s*([A-Za-zËëÇç][^<>{}]*?)\s*</g, // JSX text: <p>Save changes</p>, not `=> Promise<T>`
  /\b(?:placeholder|title|aria-label|alt|label|description|subtitle|hint)="([A-ZËÇ][^"]*|[^"]* [^"]*)"/g, // attributes: placeholder="Search", not settings like "signin_with"
  /\b(?:label|title|description|subtitle|hint|placeholder|message|group):\s*'([A-ZËÇ][^']*|[^']* [^']*)'/g, // fields: { label: 'Light' }, not keys like 'actions'
  /\}[ \t]*([A-Za-zËëÇç][^{}<>\n]*?)[ \t]*\{/g, // words between expressions: {price} each from {n}
];

function hardCoded(file: string): string[] {
  const source = SOURCES[`/${file}`];
  if (source === undefined) throw new Error(`${file} does not exist`);
  return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!.trim())).filter(
    (text) => text && !ALLOWED.test(text) && !CODE.test(text) && !KEYWORD.test(text),
  );
}

describe('no hard-coded English', () => {
  it.each(TRANSLATED)('%s takes its words from the catalogue', (file) => {
    expect(hardCoded(file)).toEqual([]);
  });
});
