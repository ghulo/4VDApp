import { Bell, ClipboardText, Receipt, SealCheck, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { NoiseField } from './NoiseField';
import { ShopDrift } from './ShopDrift';
import { Wordmark } from './LogoMark';
import { ShopSunrise } from './ui';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';

type MomentKey = keyof Catalogue['shell']['moments'];

/** A morning at the shop, as the Inbox would show it: what 4VD keeps track of for you. */
const MOMENTS: Array<{ icon: Icon; tone: 'accent' | 'warn' | 'ok'; key: MomentKey; time: string }> = [
  { icon: Receipt, tone: 'accent', key: 'sale', time: '09:14' },
  { icon: Bell, tone: 'warn', key: 'lowStock', time: '10:02' },
  { icon: SealCheck, tone: 'ok', key: 'returned', time: '11:30' },
  { icon: ClipboardText, tone: 'accent', key: 'counted', time: '12:45' },
];

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
        {/* Top to bottom: who we are, what it is, and a morning of it. */}
        <div className="login__hero">
          <div className="login__art" aria-hidden="true">
            <ShopSunrise />
          </div>
          <p className="login__headline">{t.shell.headline}</p>
          <p className="login__small-print">{t.shell.smallPrint}</p>
        </div>
        <div className="login__today" aria-hidden="true">
          <p className="login__today-title">{t.shell.today}</p>
          <ol className="login__feed">
            {MOMENTS.map(({ icon: MomentIcon, tone, key, time }) => (
              <li key={key} className={`login__moment login__moment--${tone}`}>
                <time className="login__moment-time">{time}</time>
                <MomentIcon size={16} weight="bold" />
                <span>
                  <strong>{t.shell.moments[key].title}</strong>
                  <span>{t.shell.moments[key].detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <div className="login__side">
        <NoiseField />
        <ShopDrift />
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
