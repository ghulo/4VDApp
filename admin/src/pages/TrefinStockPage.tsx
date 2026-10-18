import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { TrefinTag } from '../components/TrefinParts';
import { Card, DataTable, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { stockCountsApi } from '../services/api';
import type { TrefinStockDocumentDetail } from '../services/types';
import { formatDate, formatMoney, formatSignedQuantity } from '../utils/format';

type Line = TrefinStockDocumentDetail['lines'][number];

/** One of TREFIN's starting stocks, corrections or counts, to look at: what each product had or changed by. */
export function TrefinStockPage() {
  const t = useT();
  const id = Number(useParams().id);
  const document = useQuery({ queryKey: ['stock-counts', 'trefin', id], queryFn: () => stockCountsApi.trefinGet(id) });

  if (document.isPending) return <Loading />;
  if (document.isError) return <ErrorNotice error={document.error} onRetry={() => document.refetch()} />;
  const doc = document.data;
  const opening = doc.kind === 'opening';

  return (
    <>
      <PageHeader
        title={doc.number ? `${t.fromTrefin.stockKinds[doc.kind]} ${doc.number}` : t.fromTrefin.stockKinds[doc.kind]}
        crumbs={[{ label: t.counts.title, to: '/counts' }]}
        meta={<TrefinTag />}
        description={`${formatDate(`${doc.dated}T12:00:00`)} · ${t.fromTrefin.databases[doc.source] ?? doc.source}`}
      />
      <p className="callout document-note">{t.fromTrefin.stockNote}</p>
      <StatGrid>
        <StatTile label={t.fromTrefin.productsLabel} value={doc.lineCount} />
        <StatTile label={t.fromTrefin.value} value={formatMoney(doc.value)} />
      </StatGrid>
      <Card title={t.fromTrefin.stockKinds[doc.kind]} flush>
        <DataTable<Line>
          caption={t.fromTrefin.stockKinds[doc.kind]}
          rows={doc.lines}
          rowKey={(line) => `${line.productId ?? line.productName}-${line.quantity}-${line.counted ?? ''}`}
          columns={[
            {
              header: t.sales.product,
              title: true,
              cell: (line) =>
                line.productId ? (
                  <Link to={`/products/${line.productId}`} className="table__primary-link">
                    {line.productName}
                    {line.sku && <span className="table__secondary">{line.sku}</span>}
                  </Link>
                ) : (
                  <>
                    {line.productName}
                    <span className="table__secondary">{t.fromTrefin.noProduct}</span>
                  </>
                ),
            },
            ...(doc.kind === 'count' ? [{ header: t.fromTrefin.countedHeader, align: 'end' as const, cell: (line: Line) => line.counted ?? '–' }] : []),
            {
              header: opening ? t.fromTrefin.startedWith : t.fromTrefin.change,
              align: 'end',
              cell: (line) => (opening ? line.quantity : formatSignedQuantity(line.quantity)),
            },
            { header: t.fromTrefin.unitCost, align: 'end', cell: (line) => (line.unitCost === null ? '–' : formatMoney(line.unitCost)) },
            { header: t.fromTrefin.value, align: 'end', cell: (line) => (line.unitCost === null ? '–' : formatMoney(line.quantity * line.unitCost)) },
          ]}
        />
      </Card>
    </>
  );
}
