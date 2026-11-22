import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogoMark } from './LogoMark';
import { BrandMark } from './BrandMark';
import type { Brand } from '../services/types';
import { useT } from '../i18n/useT';

/**
 * Login and every page reached from an email link: a split screen
 * (DESIGN.md 10.13). Left, a brand panel: the mark, what 4VD is in one line
 * and three plain facts. Right, the form on the page itself, no card, with
 * language and theme at the top. Under 860px the panel goes and the mark sits
 * in the top row. Opened from a business's own link (the brand prop, not
 * 4VD's own), the panel carries that business's mark and name, and 4VD only
 * says "Runs on 4VD". `foot` adds a line under the form (the Windows app's
 * printer status on login).
 */
export function AuthShell({
  title,
  subtitle,
  children,
  brand,
  foot,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  brand?: Brand | null;
  foot?: ReactNode;
}) {
  const t = useT();
  const own = brand && !brand.house ? brand : null;
  const mark = own ? (
    <>
      <BrandMark brand={own} size={32} />
      <span>{own.name}</span>
    </>
  ) : (
    <>
      <LogoMark size={32} />
      <span>4VD</span>
    </>
  );
  return (
    <div className="auth">
      <aside className="auth__aside">
        <p className="auth__wordmark">{mark}</p>
        <div className="auth__pitch">
          {!own && (
            <>
              <p className="auth__pitch-line">{t.auth.tagline}</p>
              <ul className="auth__points">
                <li>{t.auth.points.till}</li>
                <li>{t.auth.points.books}</li>
                <li>{t.auth.points.offline}</li>
              </ul>
            </>
          )}
        </div>
        <p className="auth__aside-foot">{own ? t.nav.runsOn : '© 4VD'}</p>
      </aside>
      <div className="auth__side">
        <header className="auth__top">
          <p className="auth__wordmark auth__wordmark--phone">{mark}</p>
          <div className="auth__prefs">
            <LanguageSwitch />
            <ThemeSwitch compact />
          </div>
        </header>
        <main className="auth__main">
          <div className="auth__form">
            <h1 className="auth__title">{title}</h1>
            {subtitle && <p className="auth__subtitle">{subtitle}</p>}
            {children}
          </div>
          {own && <p className="auth__foot auth__foot--phone">{t.nav.runsOn}</p>}
          {foot}
        </main>
      </div>
    </div>
  );
}
