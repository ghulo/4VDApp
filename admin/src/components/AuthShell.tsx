import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogoMark } from './LogoMark';
import { BrandMark } from './BrandMark';
import type { Brand } from '../services/types';
import { useT } from '../i18n/useT';

/**
 * Login and every page reached from an email link: one centred card on the
 * page, 4VD's mark top left, language and theme top right, one quiet line
 * under the card (DESIGN.md "Sign-in"). Opened from a business's own link
 * (the brand prop, not 4VD's own), the card carries that business's mark and
 * name above the title, and 4VD only says "Runs on 4VD" under it.
 * `foot` adds a line under that (the Windows app's printer status on login).
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
  return (
    <div className="auth">
      <header className="auth__top">
        {own ? (
          <span />
        ) : (
          <p className="auth__wordmark">
            <LogoMark size={32} />
            <span>4VD</span>
          </p>
        )}
        <div className="auth__prefs">
          <LanguageSwitch />
          <ThemeSwitch compact />
        </div>
      </header>
      <main className="auth__main">
        <div className="auth__card">
          {own && (
            <div className="auth__brand">
              <BrandMark brand={own} size={48} />
              <p className="auth__brand-name">{own.name}</p>
            </div>
          )}
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
        </div>
        <p className="auth__foot">{own ? t.nav.runsOn : t.auth.tagline}</p>
        {foot}
      </main>
    </div>
  );
}
