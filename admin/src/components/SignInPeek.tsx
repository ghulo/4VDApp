import {
  AddressBook,
  Bank,
  Books,
  CashRegister,
  ChartLine,
  ClipboardText,
  Coins,
  Gear,
  House,
  type Icon,
  MagnifyingGlass,
  Package,
  Plus,
  Receipt,
  Storefront,
  Truck,
  Tray,
  Users,
  WarningCircle,
} from '@phosphor-icons/react';
import { LogoMark } from './LogoMark';
import { BrandMark } from './BrandMark';
import type { Brand } from '../services/types';
import { useT } from '../i18n/useT';
import { formatMoney } from '../utils/format';

// A made-up shop day: takings for the last 30 days, the newest last.
const DAYS = [62, 70, 58, 81, 77, 90, 66, 72, 85, 79, 95, 88, 61, 74, 83, 92, 87, 69, 99, 94, 76, 89, 97, 84, 71, 93, 100, 86, 91, 78];

/**
 * The dashboard as a still picture beside the sign-in form (DESIGN.md 10.13):
 * the same top bar, sidebar, Overview title, keys and cards as the real one,
 * filled with a made-up shop day, tilted back in 3D and kept quiet (grey, one
 * muted amber bar) so the Log in key stays the brightest thing on the page.
 * AuthShell labels it "Example dashboard". Nothing real is loaded before
 * sign-in. It is inert and hidden from screen readers; under 960px it is not
 * shown at all. On a business's own link it wears that business's mark.
 */
export function SignInPeek({ brand }: { brand?: Brand | null }) {
  const t = useT();
  const nav = t.nav.items;
  const groups: [string, [Icon, string, boolean?][]][] = [
    [t.nav.groups.today, [[House, nav.overview, true], [Tray, nav.inbox]]],
    [t.nav.groups.sell, [[CashRegister, nav.counter], [Receipt, nav.sales], [AddressBook, nav.customers]]],
    [t.nav.groups.stock, [[Package, nav.stock], [ClipboardText, nav.counts]]],
    [t.nav.groups.buy, [[Storefront, nav.suppliers]]],
    [t.nav.groups.money, [[Coins, nav.day], [ChartLine, nav.reports], [Bank, nav.money], [Books, nav.books]]],
    [t.nav.groups.team, [[Users, nav.people], [Gear, nav.settings]]],
  ];
  const todo: [Icon, string, string, string][] = [
    [Package, t.auth.peek.todo1, t.auth.peek.todo1Body, t.todo.verbs.restock],
    [WarningCircle, t.auth.peek.todo2, t.auth.peek.todo2Body, t.todo.verbs.fileVat],
    [Truck, t.auth.peek.todo3, t.auth.peek.todo3Body, t.todo.verbs.look],
  ];
  return (
    <div className="peek" aria-hidden="true" inert>
      <div className="peek__frame">
        <div className="peek__bar">
          {brand ? <BrandMark brand={brand} size={26} /> : <LogoMark size={26} />}
          <span className="peek__search">
            <MagnifyingGlass size={14} />
            <span>{t.nav.search}</span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
          <span className="peek__avatar">AD</span>
        </div>
        <div className="peek__side">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="peek__group">{group}</p>
              {items.map(([ItemIcon, label, on]) => (
                <p key={label} className="peek__item" data-on={on || undefined}>
                  <ItemIcon size={16} />
                  {label}
                  {label === nav.inbox && <span className="peek__count">3</span>}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="peek__main">
          <div className="peek__head">
            <p className="peek__title">{nav.overview}</p>
            <span className="peek__key">
              <Plus size={14} weight="bold" />
              {t.overview.newMenu}
            </span>
            <span className="peek__key">
              <CashRegister size={14} weight="bold" />
              {t.overview.openCounter}
            </span>
          </div>
          <div className="peek__card peek__today">
            <span className="peek__label">{t.overview.todaySoFar}</span>
            <span className="peek__figure">{formatMoney(1284.5)}</span>
            <span className="peek__muted">{t.auth.peek.sales(86)}</span>
            <span className="peek__up">{t.auth.peek.compare}</span>
          </div>
          <div className="peek__desk">
            <div>
              <p className="peek__section">{t.todo.title}</p>
              <div className="peek__card peek__todo">
                {todo.map(([TaskIcon, title, body, verb]) => (
                  <div key={title} className="peek__task">
                    <span className="peek__task-icon">
                      <TaskIcon size={16} />
                    </span>
                    <span className="peek__task-text">
                      <b>{title}</b>
                      <small>{body}</small>
                    </span>
                    <span className="peek__key peek__key--small">{verb}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="peek__card peek__yesterday">
              <b>{t.overview.yesterday}</b>
              <span className="peek__figure">{formatMoney(1146.2)}</span>
              <span className="peek__muted">{t.auth.peek.sales(79)}</span>
              <span className="peek__label">{t.overview.closingTile}</span>
              <span className="peek__figure peek__figure--small">7 / 7</span>
            </div>
          </div>
          <div className="peek__card peek__chart">
            <b>{t.overview.takings30}</b>
            <div className="peek__bars">
              {DAYS.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} data-today={index === DAYS.length - 1 || undefined} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
