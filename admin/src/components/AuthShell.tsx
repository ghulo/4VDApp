import { Bell, ClipboardText, Receipt, SealCheck, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LogoMark } from './LogoMark';
import { Halftone } from './ui';

/** Moments from a shop day, floating around the drawing like Cloudflare's dashed cards. */
const MOMENTS: Array<{ icon: Icon; tone: 'accent' | 'warn' | 'ok'; title: string; detail: string; at: string }> = [
  { icon: Receipt, tone: 'accent', title: 'Sale recorded', detail: '2 × Ceramic Vase, €70.00', at: 'login__moment--a' },
  { icon: Bell, tone: 'warn', title: 'Low stock', detail: 'Brass Floor Lamp, 2 left', at: 'login__moment--b' },
  { icon: SealCheck, tone: 'ok', title: 'Return approved', detail: 'Oak Dining Chair', at: 'login__moment--c' },
  { icon: ClipboardText, tone: 'accent', title: 'Count finished', detail: 'Lighting, 1 difference', at: 'login__moment--d' },
];

/** The split screen used by login and every page reached from an email link. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="login">
      <section className="login__story halftone-field" aria-label="4VD">
        <p className="login__mark">
          <LogoMark size={36} />
          4VD
        </p>
        <div className="login__scene" aria-hidden="true">
          <div className="login__art">
            <Halftone />
          </div>
          {MOMENTS.map(({ icon: MomentIcon, tone, title: momentTitle, detail, at }) => (
            <div key={at} className={`login__moment login__moment--${tone} ${at}`}>
              <MomentIcon size={16} weight="bold" />
              <span>
                <strong>{momentTitle}</strong>
                <span>{detail}</span>
              </span>
            </div>
          ))}
        </div>
        <div>
          <p className="login__headline">Your shop, your stock and your team in one place.</p>
          <p className="login__small-print">4VD is named for the four Dacaj brothers.</p>
        </div>
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
