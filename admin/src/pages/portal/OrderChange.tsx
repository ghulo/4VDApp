import { Badge } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { PortalOrderLine, PortalOrderSnapshot } from '../../services/portalApi';
import type { ProductUnit } from '../../services/types';
import { formatMoney, formatQuantity } from '../../utils/format';

/**
 * An order's lines next to what the customer had agreed before the shop's
 * change: other quantities say what they were, new lines say Added, lines
 * taken out stay listed, crossed out. Used on both sides (portal and shop).
 */
export function OrderChangeList({ lines, previous }: { lines: PortalOrderLine[]; previous: PortalOrderSnapshot | null }) {
  const t = useT();
  const before = new Map((previous?.lines ?? []).map((line) => [line.productId, line]));
  const now = new Set(lines.map((line) => line.productId));
  const removed = (previous?.lines ?? []).filter((line) => !now.has(line.productId));
  const quantity = (value: number, unit: string) => formatQuantity(value, unit as ProductUnit);

  return (
    <>
      <ul className="portal-basket__lines">
        {lines.map((line) => {
          const was = previous ? before.get(line.productId) : undefined;
          const added = previous !== null && was === undefined;
          const changed = was !== undefined && was.quantity !== line.quantity;
          return (
            <li key={line.productId} className={`portal-basket__line${added || changed ? ' portal-basket__line--changed' : ''}`}>
              <span className="portal-basket__name">
                {line.name}
                {added && <Badge tone="info">{t.portal.orders.added}</Badge>}
                {!line.inStock && <Badge tone="warn">{t.portal.order.outOfStock}</Badge>}
              </span>
              <span className="portal-muted">
                {quantity(line.quantity, line.unit)} × {formatMoney(line.unitPrice)}
                {changed && <span className="portal-was"> ({t.portal.orders.was(quantity(was.quantity, was.unit))})</span>}
              </span>
              <span className="portal-basket__total">{formatMoney(line.total)}</span>
            </li>
          );
        })}
        {removed.map((line) => (
          <li key={`removed-${line.productId}`} className="portal-basket__line portal-basket__line--removed">
            <span className="portal-basket__name">
              <del>{line.name}</del>
              <Badge tone="danger">{t.portal.orders.removed}</Badge>
            </span>
            <span className="portal-muted">
              <del>
                {quantity(line.quantity, line.unit)} × {formatMoney(line.unitPrice)}
              </del>
            </span>
            <span className="portal-basket__total">
              <del>{formatMoney(line.total)}</del>
            </span>
          </li>
        ))}
      </ul>
      {previous && (
        <dl className="portal-totals portal-totals--compare">
          <div>
            <dt>{t.portal.orders.before}</dt>
            <dd>
              <del>{formatMoney(previous.total)}</del>
            </dd>
          </div>
        </dl>
      )}
    </>
  );
}
