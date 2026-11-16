import { Printer } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ExportMenu } from '../components/ExportMenu';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge, Button, DataTable, EmptyState, PageHeader, Section, Sheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { businessApi, projectsApi } from '../services/api';
import type { ReportRange } from '../services/api';
import type { ProjectDocumentRow, ProjectProfitRow } from '../services/types';
import { formatDateWith, formatMoney } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';

const formatDay = (day: string) => formatDateWith(new Date(`${day.slice(0, 10)}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Figure = 'income' | 'goodsCost' | 'bills' | 'stockOut' | 'writeOffs' | 'profit';
const FIGURES: Figure[] = ['income', 'goodsCost', 'bills', 'stockOut', 'writeOffs', 'profit'];

const sumOf = (rows: ProjectProfitRow[], figure: Figure) => Math.round(rows.reduce((sum, row) => sum + row[figure], 0) * 100) / 100;

/** Where a document on a project opens. */
const linkOf = (row: ProjectDocumentRow): string | null => {
  if (row.kind === 'bill') return `/bills/${row.id}`;
  if (row.kind === 'invoice' || row.kind === 'credit_note') return `/documents/${row.id}`;
  if (row.kind === 'stock_document') return `/stock-documents/${row.id}`;
  return null;
};

/**
 * Profit by project: what each job or event brought in and cost, without VAT,
 * read from the documents put on it. Excel, CSV and Print like every list;
 * a project opens its documents.
 */
export function ProjectsReportPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-year');
  const rows = useQuery({ queryKey: ['projects', 'profit', rangeKey], queryFn: () => projectsApi.profit(rangeKey), placeholderData: keepPreviousData });
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const [open, setOpen] = useState<ProjectProfitRow | null>(null);
  const label = (figure: Figure) => t.projects[figure];
  const data = rows.data ?? [];

  const printed = (
    <article className="statement">
      <header className="statement__head">
        <div>
          <p className="statement__shop">{business.data?.name ?? ''}</p>
        </div>
        <div className="statement__title">
          <h2>{t.projects.printTitle}</h2>
          <p className="statement__muted">{range.label}</p>
        </div>
      </header>
      <table className="statement__table">
        <caption className="visually-hidden">{t.projects.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.projects.project}</th>
            {FIGURES.map((figure) => (
              <th key={figure} scope="col" className="statement__number">
                {label(figure)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.projectId}>
              <td>{row.name}</td>
              {FIGURES.map((figure) => (
                <td key={figure} className="statement__number">
                  {formatMoney(row[figure])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t.projects.total}</th>
            {FIGURES.map((figure) => (
              <td key={figure} className="statement__number">
                {formatMoney(sumOf(data, figure))}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </article>
  );

  return (
    <>
      <PageHeader title={t.projects.title} description={t.projects.description(range.label)} />
      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data && (
        <Section title={t.projects.title}>
          <DataTable
            caption={t.projects.caption}
            rows={data}
            rowKey={(row) => row.projectId}
            toolbar={
              <div className="toolbar">
                <div className="toolbar__end">
                  <Button icon={Printer} onClick={() => window.print()} disabled={data.length === 0}>
                    {t.projects.print}
                  </Button>
                  <ExportMenu kind="projects" range={rangeKey} />
                </div>
              </div>
            }
            empty={<EmptyState title={t.projects.empty}>{t.projects.emptyHint}</EmptyState>}
            totals={[t.projects.total, ...FIGURES.map((figure) => <strong key={figure}>{formatMoney(sumOf(data, figure))}</strong>)]}
            columns={[
              {
                header: t.projects.project,
                title: true,
                cell: (row) => (
                  <>
                    <button type="button" className="text-link" aria-label={t.projects.open(row.name)} onClick={() => setOpen(row)}>
                      {row.name}
                    </button>
                    {row.closed && (
                      <>
                        {' '}
                        <Badge tone="neutral">{t.projects.closed}</Badge>
                      </>
                    )}
                  </>
                ),
              },
              ...FIGURES.map((figure) => ({
                header: label(figure),
                align: 'end' as const,
                className: figure === 'income' || figure === 'profit' ? undefined : 'table__phone-hide',
                cell: (row: ProjectProfitRow) => (figure === 'profit' ? <strong>{formatMoney(row.profit)}</strong> : formatMoney(row[figure])),
              })),
            ]}
          />
        </Section>
      )}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? t.projects.documentsOf(open.name) : ''}>
        {open && <ProjectDocuments project={open} range={rangeKey} />}
      </Sheet>
      {data.length > 0 &&
        createPortal(
          <div className="print-root" aria-hidden="true">
            {printed}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The documents on one project in the period, each opening where it lives. */
function ProjectDocuments({ project, range }: { project: ProjectProfitRow; range: ReportRange }) {
  const t = useT();
  const docs = useQuery({ queryKey: ['projects', 'documents', project.projectId, range], queryFn: () => projectsApi.documents(project.projectId, range) });
  if (docs.isPending) return <Loading />;
  if (docs.isError) return <ErrorNotice error={docs.error} onRetry={() => docs.refetch()} />;
  return (
    <>
      <p className="field-hint">{t.projects.amountHint}</p>
      <DataTable
        caption={t.projects.documentsCaption(project.name)}
        rows={docs.data}
        rowKey={(row) => `${row.kind}-${row.id}`}
        empty={<EmptyState title={t.projects.noDocuments} />}
        columns={[
          {
            header: t.projects.number,
            title: true,
            cell: (row) => {
              const to = linkOf(row);
              const text = row.number ?? t.projects.kind[row.kind];
              return (
                <>
                  {to ? <Link to={to}>{text}</Link> : text}
                  <span className="table__secondary">{t.projects.kind[row.kind]}</span>
                </>
              );
            },
          },
          { header: t.projects.day, cell: (row) => formatDay(row.day) },
          { header: t.projects.who, cell: (row) => row.who ?? '–', className: 'table__phone-hide' },
          { header: t.projects.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
        ]}
      />
    </>
  );
}
