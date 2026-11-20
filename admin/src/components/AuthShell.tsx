import { type ReactNode, Suspense } from 'react';
import { lazyNamed } from '../utils/lazyNamed';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogoMark } from './LogoMark';
import { BrandMark } from './BrandMark';
import type { Brand } from '../services/types';
import { LoginReceipt } from './LoginReceipt';
import { useT } from '../i18n/useT';

/** The moving shop loads after the form, so the form is there at once. */
const ShopDrift = lazyNamed(() => import('./ShopDrift'), 'ShopDrift');

/**
 * The split screen used by login and every page reached from an email link.
 * Opened from a business's own link (the brand prop, not 4VD's own), the story side
 * shows that business's mark and name instead of 4VD's, with 4VD in small print.
 */
export function AuthShell({ title, subtitle, children, brand }: { title: string; subtitle?: ReactNode; children: ReactNode; brand?: Brand | null }) {
  const t = useT();
  if (brand && !brand.house) {
    return (
      <div className="login login--branded">
        <section className="login__story login__story--branded" aria-label={brand.name}>
          <BrandMark brand={brand} size={120} />
          <p className="login__brand-name">{brand.name}</p>
          <p className="login__small-print">{t.nav.runsOn}</p>
        </section>
        <div className="login__side">
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
  return (
    <div className="login">
      <section className="login__story" aria-label="4VD">
        <p className="login__mark">
          <LogoMark size={152} />
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
