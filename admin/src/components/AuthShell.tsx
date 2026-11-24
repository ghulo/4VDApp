import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogoMark } from './LogoMark';
import { BrandMark } from './BrandMark';
import { SignInPeek } from './SignInPeek';
import type { Brand } from '../services/types';
import { useT } from '../i18n/useT';
import { useTabTitle } from '../theme/useTabTitle';

/**
 * Login and every page reached from an email link (DESIGN.md 10.13): the form
 * on a raised card. With `showcase` (the login form itself) a quiet sample
 * picture of the dashboard (SignInPeek), labelled "Example dashboard", sits
 * tilted back on the right from 960px up, so the first screen already looks
 * like the program it opens; the other steps (code, setup, reset) keep the
 * card alone so their instructions get the room. Mark top left, language and
 * theme top right, and a quiet line under the card saying what 4VD is.
 * Opened from a business's own link (the brand prop, not 4VD's own), the mark
 * is that business's (in the picture too) and the line only says "Runs on 4VD". `foot` adds a line under the card (the Windows app's printer
 * status on login).
 */
export function AuthShell({
  title,
  subtitle,
  children,
  brand,
  foot,
  showcase,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  brand?: Brand | null;
  foot?: ReactNode;
  showcase?: boolean;
}) {
  const t = useT();
  const own = brand && !brand.house ? brand : null;
  useTabTitle(own?.name);
  return (
    <div className={showcase ? 'auth auth--showcase' : 'auth'}>
      <header className="auth__top">
        <p className="auth__wordmark">
          {own ? <BrandMark brand={own} size={28} /> : <LogoMark size={28} />}
          <span>{own ? own.name : '4VD'}</span>
        </p>
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
        {foot}
        <p className="auth__family">{own ? t.nav.runsOn : `4 Vëllezërit Dacaj · ${t.auth.tagline}`}</p>
      </main>
      {showcase && (
        <div className="auth__stage">
          <p className="auth__sample">{t.auth.peek.sample}</p>
          <SignInPeek brand={own} />
        </div>
      )}
    </div>
  );
}
