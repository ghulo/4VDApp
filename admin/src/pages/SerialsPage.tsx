import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SearchInput } from '../components/SearchInput';
import { DataTable, EmptyState, PageHeader, Section } from '../components/ui';
import { useT } from '../i18n/useT';
import { serialsApi } from '../services/api';
import { formatDateWith } from '../utils/format';
import { SerialOrigin, SerialStatus, SerialWarranty } from './ProductSerialsTab';

const formatSerialDay = (day: string) => formatDateWith(new Date(`${day.slice(0, 10)}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Look up a serial: where it came from, who bought it, and until when its warranty runs. */
export function SerialsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const term = q.trim();
  const found = useQuery({ queryKey: ['serials', 'search', term], queryFn: () => serialsApi.search(term), enabled: term.length >= 2, placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader title={t.serials.title} description={t.serials.description} />
      <div className="toolbar">
        <SearchInput value={q} onChange={(next) => setParams(next ? { q: next } : {}, { replace: true })} label={t.serials.searchPlaceholder} />
      </div>
      {term.length < 2 && <p className="field-hint">{t.serials.typeMore}</p>}
      {term.length >= 2 && found.isPending && <Loading />}
      {found.isError && <ErrorNotice error={found.error} onRetry={() => found.refetch()} />}
      {term.length >= 2 && found.data && (
        <Section title={t.serials.caption}>
          <DataTable
            caption={t.serials.caption}
            rows={found.data}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t.serials.none}>{t.serials.noneHint}</EmptyState>}
            columns={[
              { header: t.serials.serial, title: true, cell: (row) => <span className="serial-code">{row.serial}</span> },
              { header: t.serials.product, cell: (row) => <Link to={`/products/${row.productId}/serials`}>{row.productName}</Link> },
              { header: t.serials.status, cell: (row) => <SerialStatus serial={row} /> },
              { header: t.serials.came, cell: (row) => <SerialOrigin serial={row} />, className: 'table__phone-hide' },
              {
                header: t.serials.soldOn,
                cell: (row) =>
                  row.invoice ? (
                    <>
                      <Link to={`/documents/${row.invoice.id}`}>{row.invoice.number}</Link>
                      <span className="table__secondary">{[row.soldAt ? formatSerialDay(row.soldAt) : null, row.customer?.name].filter(Boolean).join(' · ')}</span>
                    </>
                  ) : (
                    '–'
                  ),
              },
              { header: t.serials.warranty, cell: (row) => <SerialWarranty serial={row} /> },
            ]}
          />
        </Section>
      )}
    </>
  );
}
