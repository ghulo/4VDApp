import { Plus, Truck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SupplierForm } from '../components/SupplierForm';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, ordersApi, suppliersApi } from '../services/api';
import { formatMoney } from '../utils/format';

/** Everyone the shop buys from, with what is owed and what is on the way. */
export function SuppliersPage() {
  const t = useT();
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const [adding, setAdding] = useState(false);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const summary = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary });
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });

  const owedBy = new Map(summary.data?.bySupplier.map((row) => [row.supplierId, row]));
  const openOrders = (supplierId: number) => orders.data?.filter((order) => order.status === 'open' && order.supplier.id === supplierId).length ?? 0;

  return (
    <>
      <PageHeader
        title={t.suppliers.title}
        description={t.suppliers.description}
        actions={
          canManage(role) && (
            <Button variant="primary" icon={Plus} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
              {t.suppliers.add}
            </Button>
          )
        }
      />

      {adding && (
        <Card title={t.suppliers.add}>
          <SupplierForm
            supplier={null}
            onDone={(saved) => {
              setAdding(false);
              if (saved) navigate(`/suppliers/${saved.id}`);
            }}
          />
        </Card>
      )}

      {suppliers.isPending && <Loading />}
      {suppliers.isError && <ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />}
      {suppliers.data && (
        <DataTable
          caption={t.suppliers.title}
          rows={suppliers.data}
          rowKey={(row) => row.id}
          empty={
            <EmptyState icon={Truck} title={t.orders.noSuppliers}>
              {t.orders.noSuppliersHint}
            </EmptyState>
          }
          columns={[
            {
              header: t.orders.supplierName,
              title: true,
              cell: (row) => (
                <Link to={`/suppliers/${row.id}`} className="table__primary-link">
                  {row.name}
                  <span className="table__secondary">{[row.phone, row.email].filter(Boolean).join(' · ') || (row.nui ? t.nui.short(row.nui) : '')}</span>
                </Link>
              ),
            },
            { header: t.suppliers.openOrders, align: 'end', cell: (row) => openOrders(row.id) || '–' },
            {
              header: t.bills.overdue,
              align: 'end',
              cell: (row) => {
                const overdue = owedBy.get(row.id)?.overdue ?? 0;
                return overdue > 0 ? <Badge tone="danger">{formatMoney(overdue)}</Badge> : '–';
              },
            },
            {
              header: t.bills.owed,
              align: 'end',
              cell: (row) => {
                const owed = owedBy.get(row.id)?.owed ?? 0;
                return owed > 0 ? <strong>{formatMoney(owed)}</strong> : '–';
              },
            },
          ]}
        />
      )}
    </>
  );
}
