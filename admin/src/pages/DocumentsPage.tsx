import { FileText } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { PrintDocumentButton } from '../components/PrintDocumentButton';
import { SearchInput } from '../components/SearchInput';
import { Badge, DataTable, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { documentsApi } from '../services/api';
import type { DocumentKind, SalesDocument } from '../services/types';
import { formatDateTime, formatMoney } from '../utils/format';

/** Every invoice and credit note, newest first, to find, open and print. */
export function DocumentsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const kind = (params.get('kind') ?? '') as DocumentKind | '';
  const search = params.get('q') ?? '';
  const startDate = params.get('from') ?? '';
  const endDate = params.get('to') ?? '';

  const documents = useQuery({
    queryKey: ['documents', { page, kind, search, startDate, endDate }],
    queryFn: () =>
      documentsApi.list({
        page,
        kind: kind || undefined,
        search: search || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const updateParams = useCallback(
    (changes: Record<string, string>) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      });
    },
    [setParams],
  );
  const onSearch = useCallback((value: string) => updateParams({ q: value }), [updateParams]);
  const filtered = Boolean(kind || search || startDate || endDate);

  return (
    <>
      <PageHeader title={t.nav.items.sales} description={t.documents.description} />
      {documents.isPending && <Loading />}
      {documents.isError && <ErrorNotice error={documents.error} onRetry={() => documents.refetch()} />}
      {documents.data && (
        <DataTable<SalesDocument>
          caption={t.documents.title}
          rows={documents.data.items}
          rowKey={(document) => document.id}
          toolbar={
            <div className="toolbar">
              <SearchInput value={search} onChange={onSearch} label={t.documents.search} />
              <select aria-label={t.documents.kind} value={kind} onChange={(event) => updateParams({ kind: event.target.value })}>
                <option value="">{t.documents.anyKind}</option>
                <option value="invoice">{t.documents.kinds.invoice}</option>
                <option value="credit_note">{t.documents.kinds.credit_note}</option>
              </select>
              <label className="inline-field">
                {t.sales.from}
                <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => updateParams({ from: event.target.value })} />
              </label>
              <label className="inline-field">
                {t.sales.to}
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => updateParams({ to: event.target.value })} />
              </label>
            </div>
          }
          columns={[
            {
              header: t.documents.number,
              title: true,
              cell: (document) => (
                <Link to={`/documents/${document.id}`} className="table__primary-link">
                  {document.number}
                </Link>
              ),
            },
            {
              header: t.documents.kind,
              cell: (document) => (
                <Badge tone={document.kind === 'invoice' ? 'neutral' : 'warn'}>{t.documents.kinds[document.kind]}</Badge>
              ),
            },
            { header: t.documents.issued, cell: (document) => formatDateTime(document.issuedAt) },
            { header: t.documents.buyer, cell: (document) => document.buyer?.name ?? t.documents.walkIn },
            {
              header: t.documents.fiscal,
              cell: (document) => document.fiscalReceiptNo ?? <span className="table__secondary">{t.documents.notLinked}</span>,
            },
            {
              header: t.documents.total,
              align: 'end',
              cell: (document) => (document.kind === 'credit_note' ? `−${formatMoney(document.total)}` : formatMoney(document.total)),
            },
            {
              header: <span className="visually-hidden">{t.documents.print}</span>,
              cell: (document) => <PrintDocumentButton document={document} variant="ghost" size="sm" iconOnly />,
            },
          ]}
          empty={
            <EmptyState icon={FileText} title={filtered ? t.documents.noneMatch : t.documents.none}>
              {filtered ? undefined : t.documents.noneHint}
            </EmptyState>
          }
          footer={
            <Pagination meta={documents.data.meta} itemLabel={t.documents.items} onPageChange={(next) => updateParams({ page: String(next) })} />
          }
        />
      )}
    </>
  );
}
