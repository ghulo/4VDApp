import { Bell, ClipboardText, Receipt, SealCheck, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogoMark } from './LogoMark';
import { ShopSunrise } from './ui';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';

type MomentKey = keyof Catalogue['shell']['moments'];

/** Moments from a shop day, floating around the drawing like Cloudflare's dashed cards. */
const MOMENTS: Array<{ icon: Icon; tone: 'accent' | 'warn' | 'ok'; key: MomentKey; at: string }> = [
  { icon: Receipt, tone: 'accent', key: 'sale', at: 'login__moment--a' },
  { icon: Bell, tone: 'warn', key: 'lowStock', at: 'login__moment--b' },
  { icon: SealCheck, tone: 'ok', key: 'returned', at: 'login__moment--c' },
  { icon: ClipboardText, tone: 'accent', key: 'counted', at: 'login__moment--d' },
];

/** The split screen used by login and every page reached from an email link. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="login">
      <section className="login__story" aria-label="4VD">
        <p className="login__mark">
          <LogoMark size={36} />
          4VD
        </p>
        <div className="login__scene" aria-hidden="true">
          <div className="login__art">
            <ShopSunrise />
          </div>
          {MOMENTS.map(({ icon: MomentIcon, tone, key, at }) => (
            <div key={at} className={`login__moment login__moment--${tone} ${at}`}>
              <MomentIcon size={16} weight="bold" />
              <span>
                <strong>{t.shell.moments[key].title}</strong>
                <span>{t.shell.moments[key].detail}</span>
              </span>
            </div>
          ))}
        </div>
        <div>
          <p className="login__headline">{t.shell.headline}</p>
          <p className="login__small-print">{t.shell.smallPrint}</p>
        </div>
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
