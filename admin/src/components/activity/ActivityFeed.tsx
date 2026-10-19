import {
  AddressBook,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  CaretRight,
  Drop,
  FileText,
  Gear,
  type Icon,
  Money,
  Package,
  Percent,
  Receipt,
  SignIn,
  Tag,
  Truck,
  User,
  Wallet,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useT } from '../../i18n/useT';
import type { ActivityEntry, TeamMember } from '../../services/types';
import { dayHeading, formatDateTime, formatTime, groupByDay } from '../../utils/format';
import { Avatar } from '../Avatar';
import { TrefinTag } from '../TrefinParts';
import { Button } from '../ui';
import { UndoConfirm } from './UndoConfirm';

/** What a change was about, by the first word of its action ("sale.recorded" → sale). */
const ICONS: Record<string, Icon> = {
  sale: Receipt,
  return: ArrowUUpLeft,
  promotion: Percent,
  document: FileText,
  product: Tag,
  pricing: Tag,
  category: Tag,
  stock: Package,
  count: Package,
  expiry: Package,
  write_off: Package,
  order: Truck,
  bill: Truck,
  supplier: Truck,
  cash: Money,
  expense: Wallet,
  carwash: Drop,
  customer: AddressBook,
  tab: AddressBook,
  user: User,
  auth: SignIn,
  settings: Gear,
  business: Gear,
  undo: ArrowCounterClockwise,
};

/** The page about the record a change touched, when it has one. */
function linkFor(entry: ActivityEntry): string | null {
  const id = entry.entityId;
  switch (entry.entityType) {
    case 'product':
      return id ? `/products/${id}` : null;
    case 'customer':
      return id ? `/customers/${id}` : null;
    case 'supplier':
      return id ? `/suppliers/${id}` : null;
    case 'bill':
      return id ? `/bills/${id}` : null;
    case 'bill_scan':
      return id ? `/bills/scans/${id}` : null;
    case 'order':
      return id ? `/orders/${id}` : null;
    case 'document':
      return id ? `/documents/${id}` : null;
    case 'promotion':
      return id ? `/promotions/${id}` : null;
    case 'stock_count':
      return id ? `/counts/${id}` : null;
    case 'user':
      return id ? `/people/${id}` : null;
    case 'sale':
    case 'return':
      return '/sales';
    case 'expense':
      return '/expenses';
    case 'carwash':
      return '/carwash';
    case 'cash_count':
      return '/cash';
    case 'settings':
      return '/settings/approvals';
    default:
      return null;
  }
}

interface ActivityFeedProps {
  entries: ActivityEntry[];
  /** Everyone on the team, for their photos. */
  people?: TeamMember[];
  /** Leave out who did it, on a page that is already about one person. */
  hidePerson?: boolean;
  /** h3 when the feed sits inside a card that has its own h2. */
  headingLevel?: 'h2' | 'h3';
}

/**
 * Changes gathered under their day, newest first: an icon for what kind of
 * change, the sentence (a link to the record it touched), who and when, and
 * Undo or Restore where that's allowed. The confirmation opens under the row.
 */
export function ActivityFeed({ entries, people, hidePerson, headingLevel: Heading = 'h2' }: ActivityFeedProps) {
  const t = useT();
  const [open, setOpen] = useState<{ id: number; mode: 'undo' | 'restore' } | null>(null);
  const avatars = new Map(people?.map((person) => [person.id, person.avatarUrl]));

  function closeConfirm() {
    const id = open?.id;
    setOpen(null);
    // Back to the row's button, which now says Undo or Restore.
    requestAnimationFrame(() => document.getElementById(`undo-button-${id}`)?.focus());
  }

  function undoControl(entry: ActivityEntry) {
    const undo = entry.undo;
    if (!undo) return null;
    const mode = undo.state === 'undoable' ? 'undo' : undo.state === 'undone' && undo.allowed && undo.lockedReason === null ? 'restore' : null;
    if (mode) {
      const isOpen = open?.id === entry.id;
      return (
        <Button
          id={`undo-button-${entry.id}`}
          size="sm"
          variant={mode === 'undo' ? 'secondary' : 'ghost'}
          aria-expanded={isOpen}
          aria-controls={isOpen ? `undo-confirm-${entry.id}` : undefined}
          aria-label={mode === 'undo' ? t.undo.undoLabel(entry.summary) : t.undo.restoreLabel(entry.summary)}
          onClick={() => (isOpen ? setOpen(null) : setOpen({ id: entry.id, mode }))}
        >
          {mode === 'undo' ? t.undo.undo : t.undo.restore}
        </Button>
      );
    }
    if (undo.state === 'locked' || (undo.state === 'undone' && undo.lockedReason)) {
      return <span className="activity-undo__locked">{t.undo.locked[undo.lockedReason!]}</span>;
    }
    return null;
  }

  return (
    <>
      {groupByDay(entries, (entry) => entry.createdAt).map((group) => (
        <section key={group.day} className="day-group" aria-labelledby={`activity-${group.day}`}>
          <Heading id={`activity-${group.day}`} className="day-group__heading">
            {dayHeading(group.day, t.periods.options)}
          </Heading>
          <ul className="activity-feed">
            {group.rows.map((entry) => {
              const KindIcon = ICONS[entry.action.split('.')[0] ?? ''] ?? Gear;
              const link = linkFor(entry);
              const undone = entry.undo?.state === 'undone';
              const text = entry.trefin ? t.fromTrefin.activity(entry.trefin.verb, entry.trefin.what, entry.trefin.subject) : entry.summary;
              const summary = undone ? <s className="activity-undo__struck">{text}</s> : text;
              return (
                <li key={entry.id} className={`activity-feed__row${undone ? ' activity-feed__row--undone' : ''}`}>
                  <span className="activity-feed__icon" aria-hidden="true">
                    <KindIcon size={18} />
                  </span>
                  <span className="activity-feed__text">
                    {link ? (
                      <Link to={link} className="activity-feed__summary activity-feed__link">
                        {summary}
                        <CaretRight size={12} weight="bold" aria-hidden="true" className="activity-feed__caret" />
                      </Link>
                    ) : (
                      <span className="activity-feed__summary">{summary}</span>
                    )}
                    <span className="activity-feed__meta">
                      {!hidePerson && (
                        <>
                          {entry.trefin ? (
                            <span className="activity-feed__person">
                              {entry.trefin.person ?? t.fromTrefin.someone} <TrefinTag />
                            </span>
                          ) : entry.user ? (
                            <Link to={`/people/${entry.user.id}`} className="activity-feed__person">
                              <Avatar name={entry.user.name} url={avatars.get(entry.user.id) ?? null} size={24} />
                              {entry.user.name}
                            </Link>
                          ) : (
                            <span>{t.activity.system}</span>
                          )}
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
                    </span>
                    {undone && entry.undo && (
                      <span className="activity-undo__stamp">
                        {entry.undo.undoneBy
                          ? t.undo.undoneBy(entry.undo.undoneBy.name, entry.undo.undoneAt ? formatDateTime(entry.undo.undoneAt) : '')
                          : t.undo.undoneAt(entry.undo.undoneAt ? formatDateTime(entry.undo.undoneAt) : '')}
                        {entry.undo.note && <q className="activity-undo__note">{entry.undo.note}</q>}
                      </span>
                    )}
                  </span>
                  <span className="activity-feed__actions">{undoControl(entry)}</span>
                  {open?.id === entry.id && entry.undo && (
                    <div className="activity-feed__confirm">
                      <UndoConfirm id={`undo-confirm-${entry.id}`} entry={{ ...entry, undo: entry.undo }} mode={open.mode} onClose={closeConfirm} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
