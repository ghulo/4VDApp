import { lazy, type ReactNode, Suspense } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { Wordmark } from './LogoMark';
import { LoginReceipt } from './LoginReceipt';
import { useT } from '../i18n/useT';

/** The moving shop loads after the form, so the form is there at once. */
const ShopDrift = lazy(async () => ({ default: (await import('./ShopDrift')).ShopDrift }));

/** The split screen used by login and every page reached from an email link. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="login">
      <section className="login__story" aria-label="4VD">
        <p className="login__mark">
          <Wordmark height={34} />
          <span className="visually-hidden">4VD</span>
        </p>
        {/* Top to bottom: who we are, what it is, and the till printing a sale. */}
        <div className="login__hero">
          <p className="login__headline">{t.shell.headline}</p>
          <p className="login__small-print">{t.shell.smallPrint}</p>
        </div>
        <LoginReceipt />
      </section>
      <div className="login__side">
        <Suspense fallback={null}>
          <ShopDrift />
        </Suspense>
        <div className="login__card">
          <h1 className="login__title">{title}</h1>
          {subtitle && <p className="login__subtitle">{subtitle}</p>}
          {children}
          <div className="login__prefs">
            <ThemeSwitch />
            <LanguageSwitch />
          </div>
        </div>
      </div>
    </div>
  );
}
