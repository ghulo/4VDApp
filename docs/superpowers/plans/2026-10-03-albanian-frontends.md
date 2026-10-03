# Albanian in the Dashboard and the Team App: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everyone can use the dashboard and the team app in English or Albanian (Shqip), switchable per person, and the choice follows them across devices.

**Architecture:** The server side is done (branch `feature/albanian`, commit f71e9b6): each account has `language: 'en' | 'sq'`, `PUT /api/me/profile` accepts `{ language }`, and alerts and emails are written in it. Each frontend gets the same shape as the server: one typed English catalogue (`en`), an Albanian one typed against it (`sq: Catalogue`), so a missing Albanian text is a compile error. A small provider exposes `useT()` and `useLanguage()`. There are no i18n libraries. Number and date formatting follow the language. The account's saved language wins after sign-in, just like the theme does today.

**Tech Stack:** React 19 + Vite 8 + Vitest 5 (dashboard, `admin/`); Expo 57 / React Native 0.86 (team app, `mobile/`); Express + Kysely (backend, `backend/`).

**Spec:** the roadmap row "Albanian" in `docs/ROADMAP.md`, and the "Left" list from the 2026-10-02 session: (1) a language setting on each account, with a switch on the Profile page and the sign-in screens; (2) alerts and emails in each person's language (done); (3) translate the dashboard (~600 texts) and the phone app (~200); (4) tests, a visual check in both languages, then merge.

## Global Constraints

- Languages: exactly `en` and `sq`. Labels in the switch: `English` and `Shqip`. These two words are never translated.
- Brand words that stay as-is in both languages: `4VD`, product names, people's names, shop names.
- Number/date locales: `en` uses `en-IE` for money and `en-GB` for dates; `sq` uses `sq-AL` for both (matches `backend/src/i18n/language.ts`).
- Storage key on both apps: `4vd.language` (sibling of the existing `4vd.theme`).
- Copy rules (from memory and PRODUCT.md): plain words, short sentences, no jargon. Albanian uses the informal "ti" form, like the server catalogue.
- Glossary (use these exact terms; they match `backend/src/i18n/messages.ts`):
  | English | Shqip |
  |---|---|
  | Sale / Sales | Shitje |
  | Product(s) | Produkt / Produkte |
  | Stock | Stok |
  | Inventory | Inventari |
  | Stock count | Numërim i stokut |
  | Write-off | Heqje nga stoku |
  | Return / Refund | Kthim / Rimbursim |
  | Approvals | Miratime |
  | Approve / Reject | Mirato / Refuzo |
  | Overview | Përmbledhja |
  | Reports | Raporte |
  | Profit | Fitim |
  | Promotions | Oferta |
  | Categories | Kategori |
  | Team / People | Ekipi / Njerëzit |
  | Settings | Cilësimet |
  | Profile | Profili |
  | Alerts | Njoftime |
  | Reorder level | Niveli i porosisë |
  | Log in / Log out | Hyr / Dil |
  | Save / Cancel | Ruaj / Anulo |
  | Developer / Admin / Owner / Employee / Family | Zhvillues / Administrator / Pronar / Punonjës / Familje |
- Server error messages and the Activity log stay in English in this piece; they're listed as a follow-up in ROADMAP.

## Review Focus

1. **Signing in with an account whose language differs from the sign-in screen's.** The saved account language should take over right after sign-in, with no stale-English flash on the next page. Test: Task 2's `AuthContext` test.
2. **Albanian text is longer (~20–30%).** Buttons, table headers, the sidebar and stat tiles must wrap or truncate cleanly at 360px and 1280px, never overflow. Check: Task 9 visual pass at both widths.
3. **Formatting after a switch.** Money and dates already on screen must re-render in the new locale ("1204,50 € (12 045,50 € from five digits)"), not only new renders. Test: Task 2 `format.test.ts` and the keyed remount.
4. **Untranslated leftovers.** A forgotten JSX string shows up as English in an Albanian screen. Guard: the hard-coded-text scanner tests (Tasks 3 and 7) over every migrated file.
5. **Storage blocked or empty.** In a private window or with storage disabled, the app must still work, defaulting to the browser or phone language, then English. Test: Task 2 `readLanguage` cases.

---

## File Structure

**Backend**
- Modify `backend/src/services/InviteService.ts` (`InvitePreviewDto` and `preview()`): add `language`.

**Dashboard (`admin/src/i18n/`)**
- `language.ts`: `Language` type, `readLanguage()`, `LANGUAGE_STORAGE_KEY`.
- `en.ts`: the English catalogue (`export const en = {...}; export type Catalogue = typeof en;`), grouped by area: `common`, `nav`, `auth`, `profile`, `overview`, `sales`, `reports`, `products`, `inventory`, `counts`, `approvals`, `promotions`, `people`, `settings`, `alerts`, `activity`, `ask`.
- `sq.ts`: `export const sq: Catalogue = {...}`.
- `I18nProvider.tsx`: context, `useT()`, `useLanguage()`.
- `LanguageSwitch.tsx`: English / Shqip segmented control (same look as `ThemeSwitch`).
- Tests: `language.test.ts`, `catalogue.test.ts`, `hardcodedText.test.ts`.
- Modify `admin/src/utils/format.ts`: locale-aware formatters.

**Team app (`mobile/src/i18n/`)**: the same files, minus the DOM bits; storage via `secureStorage`.

---

### Task 1: Invite page opens in the invite's language (backend)

**Files:**
- Modify: `backend/src/services/InviteService.ts` (`InvitePreviewDto`, `preview()`)
- Modify: `admin/src/services/types.ts:298` (`InvitePreview`)
- Test: `backend/tests/language.test.ts`

**Interfaces:**
- Produces: `GET /api/auth/invites/:token` → `{ email, role, shopName, invitedBy, language }`.

- [ ] **Step 1: Write the failing test** (append to the `emails in each person's language` describe)

```ts
  it('should tell the invite page which language the invite was sent in', async () => {
    await api().post('/api/invites').set(auth(adminToken)).send({ email: 'ana@example.com', role: 'employee', language: 'sq' });
    const email = await newestEmailTo('ana@example.com');
    const token = /https?:\/\/\S+/.exec(email.text)![0].split('/').at(-1)!;

    const preview = await api().get(`/api/auth/invites/${token}`);

    expect(preview.body.data.language).toBe('sq');
  });
```

- [ ] **Step 2: Run it.** `cd backend && npx vitest run tests/language.test.ts`. Expected: FAIL, `expected undefined to be 'sq'`.
- [ ] **Step 3: Implement.** In `InvitePreviewDto` add `language: Language;` and in `preview()` return `language: invite.language`. In `admin/src/services/types.ts` add `language: 'en' | 'sq';` to `InvitePreview` and to `User`.
- [ ] **Step 4: Run it.** Expected: PASS. Then `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git commit -m "feat: The invite page knows which language the invite was sent in"`

### Task 2: Dashboard language foundation

**Files:**
- Create: `admin/src/i18n/language.ts`, `en.ts`, `sq.ts`, `I18nProvider.tsx`, `LanguageSwitch.tsx`
- Create: `admin/src/i18n/language.test.ts`, `admin/src/i18n/catalogue.test.ts`, `admin/src/utils/format.test.ts`
- Modify: `admin/src/utils/format.ts`, `admin/src/App.tsx`, `admin/src/auth/AuthContext.tsx`, `admin/src/services/api.ts:122` (`updateProfile` accepts `language`)

**Interfaces:**
- Produces: `type Language = 'en' | 'sq'`; `readLanguage(storage: Pick<Storage,'getItem'> | null, browserLanguages: readonly string[]): Language`; `useT(): Catalogue`; `useLanguage(): { language: Language; setLanguage(next: Language): void }`; `setFormatLanguage(language: Language): void`; `<LanguageSwitch persist? />`.

- [ ] **Step 1: Write failing tests**

`admin/src/i18n/language.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readLanguage } from './language';

const storage = (value: string | null) => ({ getItem: () => value });

describe('readLanguage', () => {
  it('should use the saved choice', () => expect(readLanguage(storage('sq'), ['en-GB'])).toBe('sq'));
  it('should fall back to an Albanian browser', () => expect(readLanguage(storage(null), ['sq-AL', 'en'])).toBe('sq'));
  it('should fall back to English otherwise', () => expect(readLanguage(storage('de'), ['de-DE'])).toBe('en'));
  it('should survive blocked storage', () =>
    expect(readLanguage({ getItem: () => { throw new Error('blocked'); } }, ['sq'])).toBe('sq'));
});
```

`admin/src/i18n/catalogue.test.ts` catches Albanian texts that were copy-pasted from English:
```ts
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { sq } from './sq';

/** Same in both languages on purpose. */
const SAME_IN_BOTH = new Set(['4VD', 'English', 'Shqip', 'Email', 'OK']);

function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  return [];
}

describe('catalogue', () => {
  it('should translate every English text', () => {
    const albanian = new Map(strings(sq));
    const untranslated = strings(en).filter(([path, text]) => albanian.get(path) === text && !SAME_IN_BOTH.has(text));
    expect(untranslated).toEqual([]);
  });
});
```

`admin/src/utils/format.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, setFormatLanguage } from './format';

afterEach(() => setFormatLanguage('en'));

describe('formatMoney', () => {
  it('should write euros the English way', () => expect(formatMoney(1204.5)).toBe('€1,204.50'));
  it('should write euros the Albanian way after switching', () => {
    setFormatLanguage('sq');
    expect(formatMoney(1204.5)).toMatch(/^1\.204,50\s€$/);
  });
});
```

- [ ] **Step 2: Run them.** `cd admin && npx vitest run src/i18n src/utils/format.test.ts`. Expected: FAIL, modules not found or `setFormatLanguage` not exported.

- [ ] **Step 3: Implement**

`admin/src/i18n/language.ts`:
```ts
export type Language = 'en' | 'sq';
export const LANGUAGES: Language[] = ['en', 'sq'];
export const LANGUAGE_STORAGE_KEY = '4vd.language';

const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'sq';

/** The saved choice; else the browser's language if it's Albanian; else English. */
export function readLanguage(storage: Pick<Storage, 'getItem'> | null, browserLanguages: readonly string[]): Language {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Blocked storage: decide from the browser.
  }
  return browserLanguages.some((tag) => tag.toLowerCase().startsWith('sq')) ? 'sq' : 'en';
}
```

`admin/src/utils/format.ts`: replace the module-level formatters with per-language ones and keep every exported function's signature:
```ts
import type { Language } from '../i18n/language';

const LOCALES: Record<Language, { money: string; date: string }> = {
  en: { money: 'en-IE', date: 'en-GB' },
  sq: { money: 'sq-AL', date: 'sq-AL' },
};
let current: Language = 'en';
/** Called by the language provider; formatting below follows it. */
export function setFormatLanguage(language: Language): void {
  current = language;
}
const money = () => new Intl.NumberFormat(LOCALES[current].money, { style: 'currency', currency: 'EUR' });
const date = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALES[current].date, options);

export const formatMoney = (amount: number) => money().format(amount);
export const formatDate = (iso: string) => date({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
export const formatPromotionDay = (iso: string, isEnd = false) =>
  date({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(new Date(iso).getTime() - (isEnd ? 1 : 0)));
export const formatDateTime = (iso: string) =>
  date({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
```
`ROLE_LABEL` moves into the catalogue as `t.common.roles`; update its importers (`grep -rn ROLE_LABEL admin/src`) to `useT().common.roles`.

`admin/src/i18n/en.ts` starts with the texts this task needs; later tasks add their areas:
```ts
export const en = {
  language: { label: 'Language', english: 'English', albanian: 'Shqip' },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    roles: { developer: 'Developer', admin: 'Admin', owner: 'Owner', employee: 'Employee', family: 'Family' },
  },
};
export type Catalogue = typeof en;
```
`admin/src/i18n/sq.ts`:
```ts
import type { Catalogue } from './en';

export const sq: Catalogue = {
  language: { label: 'Gjuha', english: 'English', albanian: 'Shqip' },
  common: {
    save: 'Ruaj',
    cancel: 'Anulo',
    roles: { developer: 'Zhvillues', admin: 'Administrator', owner: 'Pronar', employee: 'Punonjës', family: 'Familje' },
  },
};
```

`admin/src/i18n/I18nProvider.tsx`:
```tsx
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { setFormatLanguage } from '../utils/format';
import { type Catalogue, en } from './en';
import { type Language, LANGUAGE_STORAGE_KEY, readLanguage } from './language';
import { sq } from './sq';

const CATALOGUES: Record<Language, Catalogue> = { en, sq };

interface I18nValue {
  language: Language;
  t: Catalogue;
  setLanguage: (next: Language) => void;
}
const I18nContext = createContext<I18nValue | null>(null);

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function apply(language: Language): void {
  setFormatLanguage(language);
  document.documentElement.lang = language;
  try {
    safeStorage()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Blocked storage: the language still applies for this visit.
  }
}

/** Remounts the app when the language changes, so formatted numbers and dates redraw too. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = readLanguage(safeStorage(), navigator.languages ?? [navigator.language]);
    apply(initial);
    return initial;
  });
  const setLanguage = useCallback((next: Language) => {
    apply(next);
    setLanguageState(next);
  }, []);
  const value = useMemo(() => ({ language, t: CATALOGUES[language], setLanguage }), [language, setLanguage]);
  return (
    <I18nContext.Provider value={value}>
      <div key={language} style={{ display: 'contents' }}>{children}</div>
    </I18nContext.Provider>
  );
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useT must be used inside <I18nProvider>');
  return value;
}
export const useT = () => useI18n().t;
export const useLanguage = () => {
  const { language, setLanguage } = useI18n();
  return { language, setLanguage };
};
```
Note: the keyed `div` remounts the app on a switch. React Query keeps its cache (the client lives above it in `App.tsx`), so nothing refetches.

`admin/src/i18n/LanguageSwitch.tsx` copies `ThemeSwitch` (`admin/src/theme/ThemeSwitch.tsx`): two options, `English` and `Shqip`, `role="radiogroup"`, `aria-label={t.language.label}`. With `persist` it calls `meApi.updateProfile({ language: next }).then(updateUser).catch(() => undefined)`.

`admin/src/App.tsx`: wrap the existing tree so `I18nProvider` sits **outside** `AuthProvider`.
`admin/src/auth/AuthContext.tsx`: call `const { setLanguage } = useLanguage();` and, everywhere `applyTheme(user.theme)` is called and in the `authApi.me().then(...)` restore, also call `setLanguage(user.language)`. Add `setLanguage` to the `useCallback` dependency lists.
Place the switch on: the Profile page as a setting row under Theme (`<LanguageSwitch persist />`), and in `AuthShell` next to the existing `ThemeSwitch` (no `persist`).
On the invite page (`AccountPages.tsx`, the component that reads `invite.data`), on first load call `setLanguage(invite.data.language)` unless storage already holds a saved choice.

- [ ] **Step 4: Run.** `cd admin && npx vitest run && npm run lint && npm run build`. Expected: all PASS, build succeeds.
- [ ] **Step 5: Commit.** `git commit -m "feat: The dashboard can switch between English and Shqip"`

### Task 3: Guard against hard-coded English in the dashboard

**Files:**
- Create: `admin/src/i18n/hardcodedText.test.ts`

**Interfaces:**
- Produces: a `TRANSLATED` list of file paths; every later dashboard task appends its files.

- [ ] **Step 1: Write the test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Files that must take every visible word from the catalogue. Each translation task adds its files. */
const TRANSLATED = ['src/i18n/LanguageSwitch.tsx'];

/** Brand and symbols that are fine to write directly. */
const ALLOWED = /^(4VD|English|Shqip|[^A-Za-zËëÇç]*)$/;

const PATTERNS = [
  />\s*([A-Za-zËëÇç][^<>{}]*?)\s*</g, // JSX text: <p>Save changes</p>
  /\b(?:placeholder|title|aria-label|alt|label)="([^"]+)"/g, // attributes: placeholder="Search"
];

function hardCoded(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', '..', file), 'utf8');
  return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!.trim()))
    .filter((text) => text && !ALLOWED.test(text));
}

describe('no hard-coded English', () => {
  it.each(TRANSLATED)('%s takes its words from the catalogue', (file) => {
    expect(hardCoded(file)).toEqual([]);
  });
});
```

- [ ] **Step 2: Prove it bites.** Temporarily add `'src/theme/ThemeSwitch.tsx'` to `TRANSLATED` and run `npx vitest run src/i18n/hardcodedText.test.ts`. Expected: FAIL listing `Theme`. Then remove it again; the test passes.
- [ ] **Step 3: Commit.** `git commit -m "test: Catch English text written straight into dashboard screens"`

### Tasks 4–6: Translate the dashboard, one area per task

Every translation task follows the same five steps on its own file list:

1. **RED.** Append the task's files to `TRANSLATED` in `hardcodedText.test.ts`, then run `npx vitest run src/i18n`. Expected: FAIL, listing each English string per file. That list is the work list.
2. **Move the words.** For each string, add an entry under the area's key in `en.ts` and replace it in the component with `t.area.key` (`const t = useT();` at the top of the component). Texts with numbers or names become functions, e.g. `count: (n: number) => \`${n} ${n === 1 ? 'sale' : 'sales'}\``. Also move label constants such as the `OPTIONS` arrays inside the component, or make them functions of `t`. Things the scanner can't see: `toast(...)`, `confirm(...)` text, `document.title`, `aria-label={...}` built from strings, `label: '...'` in arrays, and chart axis text. Grep the files for `'[A-Z][a-z]` and move those too.
3. **Albanian.** Add the same keys to `sq.ts` using the Glossary. The compiler (`npx tsc -b`) reports any key you missed.
4. **GREEN.** `npx vitest run && npm run lint && npm run build`. Expected: all PASS. `catalogue.test.ts` fails if an Albanian text was left in English; fix it, or add it to `SAME_IN_BOTH` only if it really is the same word (e.g. "Email").
5. **Commit** with the message given in the task.

Example of step 2 (from `ThemeSwitch.tsx`):
```tsx
// before
const OPTIONS = [{ value: 'light', label: 'Light', icon: Sun }, ...];
// after
const t = useT();
const options = [{ value: 'light', label: t.theme.light, icon: Sun }, ...];
```

#### Task 4: Shell, shared components, sign-in and account pages
Files: `src/components/Layout.tsx`, `src/components/AuthShell.tsx`, `src/components/*.tsx` (all), `src/components/ui/*.tsx`, `src/theme/ThemeSwitch.tsx`, `src/command/CommandPalette.tsx`, `src/pages/LoginPage.tsx`, `src/pages/AccountPages.tsx`, `src/pages/ProfilePage.tsx`, `src/setup/SetupGuide.tsx`, `src/setup/steps.ts`, `src/push/*.tsx`, `src/utils/errors.ts`.
Areas: `nav`, `theme`, `auth`, `profile`, `setup`, `common`.
Commit: `feat: The dashboard's menus, sign-in and profile pages in Shqip`

#### Task 5: Selling and reporting pages
Files: `src/pages/OverviewPage.tsx`, `SalesPage.tsx`, `ReportsPage.tsx`, `AskPage.tsx`, `AlertsPage.tsx`, `ActivityPage.tsx`, `src/components/RevenueChart.tsx`, `src/components/PeriodPicker.tsx`, `src/utils/periods.ts`.
Areas: `overview`, `sales`, `reports`, `ask`, `alerts`, `activity`, `periods`. (Activity entries come from the server in English; translate only the page's own labels.)
Commit: `feat: The dashboard's overview, sales and reports in Shqip`

#### Task 6: Stock, approvals, people and settings pages
Files: `src/pages/ProductsPage.tsx`, `ProductFormPage.tsx`, `InventoryPage.tsx`, `InventoryDetailPage.tsx`, `CategoriesPage.tsx`, `StockCountsPage.tsx`, `StockCountDetailPage.tsx`, `ApprovalsPage.tsx`, `PromotionsPage.tsx`, `UsersPage.tsx`, `SettingsPage.tsx`, `src/components/ReturnForm.tsx`, `WriteOffForm.tsx`, `Decision.tsx`, `StockTag.tsx`, `BusinessPanel.tsx`.
Areas: `products`, `inventory`, `counts`, `approvals`, `promotions`, `people`, `settings`.
The invite form in `UsersPage.tsx` gets a language picker (English / Shqip), defaulting to the inviter's language and sent as `language` on `POST /api/invites`.
Commit: `feat: The dashboard's stock, approvals, team and settings pages in Shqip`

### Task 7: Team app language foundation

**Files:**
- Modify: `mobile/package.json` (add `"vitest": "^5.0.3"` to devDependencies and `"test": "vitest run"` to scripts)
- Create: `mobile/src/i18n/language.ts`, `en.ts`, `sq.ts`, `I18nProvider.tsx`, `LanguageSwitch.tsx`, `language.test.ts`, `catalogue.test.ts`, `hardcodedText.test.ts`
- Modify: `mobile/src/utils/format.ts`, `mobile/src/App.tsx`, `mobile/src/state/AuthProvider.tsx`, `mobile/src/services/types.ts` (`language` on `User`), `mobile/src/services/api.ts:47` (`updateProfile` accepts `language`)

**Interfaces:**
- Produces: the same names as Task 2 (`Language`, `useT`, `useLanguage`, `setFormatLanguage`, `LanguageSwitch`), except `readLanguage(saved: string | null, deviceLanguages: readonly string[]): Language`.

- [ ] **Step 1: Failing tests.** `language.test.ts` has the same four cases as Task 2, adapted to the signature (saved value instead of storage; the "blocked" case becomes `readLanguage(null, ['sq'])`). `catalogue.test.ts` is identical to Task 2. `hardcodedText.test.ts` is identical to Task 3, with `TRANSLATED = ['src/i18n/LanguageSwitch.tsx']` and the JSX pattern also catching `<Text>Words</Text>` (same regex). Add a `promotionLabel` test to a new `mobile/src/utils/format.test.ts`:
```ts
import { afterEach, expect, it } from 'vitest';
import { promotionLabel, setFormatLanguage } from './format';
afterEach(() => setFormatLanguage('en'));
it('should label a promotion in Albanian', () => {
  setFormatLanguage('sq');
  expect(promotionLabel({ percentOff: 15, endsAt: '2026-10-08T00:00:00Z' })).toMatch(/^−15% deri më 7 tet/);
});
```
- [ ] **Step 2: Run.** `cd mobile && npm install && npx vitest run`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Same as Task 2 with these differences. Device languages come from `Intl.DateTimeFormat().resolvedOptions().locale` (one tag, wrapped in an array); no new package. Storage uses `secureStorage.getItem/setItem('4vd.language')`, loaded in a `useEffect` like `ThemeProvider` does. Remount with a keyed `<View style={{ flex: 1 }} key={language}>`. There's no `document.lang`. `promotionLabel` gets its "until" word from a small map: `{ en: 'until', sq: 'deri më' }`. `AuthProvider` calls `setLanguage(user.language)` next to every `setPreference(user.theme)`. `LanguageSwitch` follows the app's existing segmented control in `AccountScreen.tsx` (the theme picker). Put it on `AccountScreen` (persisted) and `LoginScreen` (not persisted).
- [ ] **Step 4: Run.** `npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: The team app can switch between English and Shqip"`

### Task 8: Translate the team app

Use the five translation steps from Tasks 4–6, in `mobile/`, with `npm run typecheck` in place of lint and build.
Files: every `mobile/src/screens/*.tsx`, every `mobile/src/components/*.tsx`, `mobile/src/navigation/RootNavigator.tsx` (tab and header titles), `mobile/src/utils/format.ts` (`errorMessage` fallback), `mobile/src/push/*.ts` (permission prompts, if any text).
Commit: `feat: The team app in Shqip`

### Task 9: Check both languages by eye, update docs, merge

- [ ] **Step 1: Visual pass.** Use the `impeccable` skill's harden/i18n checks. Run backend + dashboard + web build of the team app (`run` skill). In Shqip, at 360px and 1280px, open every page and screen and fix any overflow, clipped button, or wrapped table header (Review Focus 2). Switch languages on Profile and confirm money and dates redraw (Review Focus 3). Sign in on a Shqip sign-in screen with an English account and confirm it switches to English (Review Focus 1).
- [ ] **Step 2: Copy pass.** Run the `humanizer` skill over `en.ts` for stiff or AI-sounding English, and re-read `sq.ts` for consistency with the Glossary.
- [ ] **Step 3: Docs.** `docs/API.md`: document `language` on the user, on `PUT /api/me/profile`, on `POST /api/invites` and in the invite preview. `docs/ROADMAP.md`: mark Albanian "Done" and add a row "Albanian, part 2: server error messages and the Activity log, Next".
- [ ] **Step 4: Verify.** Use `superpowers:verification-before-completion`: backend `npm test`; admin `npx vitest run && npm run lint && npm run build`; mobile `npx vitest run && npm run typecheck`. All must pass, and the output gets quoted in the summary.
- [ ] **Step 5: Review and merge.** Use `superpowers:requesting-code-review` on the branch, fix findings, then `superpowers:finishing-a-development-branch`: merge `feature/albanian` into `main` with `--no-ff`, push, and delete the branch (user's standing rule).
