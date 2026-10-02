import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LogoMark } from './LogoMark';

/** The split screen used by login and every page reached from an email link. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="login">
      <section className="login__story" aria-label="4VD">
        <p className="login__mark">
          <LogoMark size={48} />
          4VD
        </p>
        <p className="login__headline">Your shop, your stock and your team in one place.</p>
        <p className="login__small-print">4VD is named for the four Dacaj brothers.</p>
      </section>
      <div className="login__side">
        <div className="login__card">
          <h1 className="login__title">{title}</h1>
          {subtitle && <p className="login__subtitle">{subtitle}</p>}
          {children}
          <ThemeSwitch className="login__theme" />
        </div>
      </div>
    </div>
  );
}
