import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PrintDocumentButton } from '../components/PrintDocumentButton';
import { Badge, Button, Card, DataTable, Field, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { documentsApi } from '../services/api';
import type { DocumentParty, SalesDocumentDetail } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';

/** One invoice or credit note: who, what, VAT, and the link to the fiscal receipt. */
export function DocumentDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const document = useQuery({ queryKey: ['documents', id], queryFn: () => documentsApi.get(id) });

  if (document.isPending) return <Loading />;
  if (document.isError) return <ErrorNotice error={document.error} onRetry={() => document.refetch()} />;
  const doc = document.data;

  return (
    <>
      <PageHeader
        title={doc.number}
        crumbs={[{ label: t.nav.items.sales, to: '/documents' }]}
        meta={<Badge tone={doc.kind === 'invoice' ? 'neutral' : 'warn'}>{t.documents.kinds[doc.kind]}</Badge>}
        description={t.documents.issuedOn({ when: formatDateTime(doc.issuedAt), by: doc.issuedBy ?? t.sales.unknown })}
        actions={<PrintDocumentButton document={doc} variant="primary" />}
      />

      {doc.corrects && (
        <p className="callout document-note">
          {t.documents.reverses}{' '}
          <Link to={`/documents/${doc.corrects.id}`}>{doc.corrects.number}</Link>
          {doc.reason && <> · {t.documents.reason}: {doc.reason}</>}
        </p>
      )}
      {!doc.corrects && doc.reason && (
        <p className="callout document-note">
          {t.documents.reason}: {doc.reason}
        </p>
      )}

      <div className="document-parties">
        <Party title={t.documents.seller} party={doc.seller} />
        <Party title={t.documents.buyer} party={doc.buyer} customerId={doc.customerId} />
      </div>

      <Card title={t.documents.lines} flush>
        <DataTable<SalesDocumentDetail['lines'][number]>
          caption={t.documents.lines}
          rows={doc.lines}
          rowKey={(line) => `${line.saleId}-${line.returnId ?? ''}`}
          columns={[
            { header: t.sales.product, title: true, cell: (line) => line.productName },
            { header: t.sales.qty, align: 'end', cell: (line) => line.quantity },
            { header: t.sales.each, align: 'end', cell: (line) => formatMoney(line.unitPrice) },
            { header: t.documents.vat, align: 'end', cell: (line) => `${line.vatRate}%` },
            { header: t.documents.net, align: 'end', cell: (line) => formatMoney(line.netAmount) },
            { header: t.documents.vatAmount, align: 'end', cell: (line) => formatMoney(line.vatAmount) },
            { header: t.sales.total, align: 'end', cell: (line) => formatMoney(line.total) },
          ]}
        />
        <dl className="document-totals">
          {doc.vatByRate.map((row) => (
            <div key={row.rate}>
              <dt>{t.documents.vatAt(row.rate)}</dt>
              <dd>{t.documents.netAndVat({ net: formatMoney(row.net), vat: formatMoney(row.vat) })}</dd>
            </div>
          ))}
          <div>
            <dt>{t.documents.netTotal}</dt>
            <dd>{formatMoney(doc.netTotal)}</dd>
          </div>
          <div>
            <dt>{t.documents.vatTotal}</dt>
            <dd>{formatMoney(doc.vatTotal)}</dd>
          </div>
          <div className="document-totals__grand">
            <dt>{doc.kind === 'invoice' ? t.documents.toPay : t.documents.toRefund}</dt>
            <dd>{formatMoney(doc.total)}</dd>
          </div>
        </dl>
      </Card>

      <FiscalReceiptCard document={doc} />
    </>
  );
}

function Party({ title, party, customerId }: { title: string; party: DocumentParty | null; customerId?: number | null }) {
  const t = useT();
  return (
    <Card title={title} actions={customerId ? <Link to={"/customers/" + customerId}>{t.customers.see}</Link> : undefined}>
      {party ? (
        <address className="document-party">
          <strong>{party.name}</strong>
          {party.nui && <span>{t.documents.nui}: {party.nui}</span>}
          {party.address && <span>{party.address}</span>}
          {party.phone && <span>{party.phone}</span>}
        </address>
      ) : (
        <p className="field-hint">{t.documents.walkInHint}</p>
      )}
    </Card>
  );
}

/** The one thing that can change on an issued document: which fiscal receipt it belongs to. */
function FiscalReceiptCard({ document }: { document: SalesDocumentDetail }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(document.fiscalReceiptNo ?? '');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => documentsApi.setFiscalReceipt(document.id, value.trim() || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(['documents', document.id], updated);
      queryClient.invalidateQueries({ queryKey: ['documents'], exact: false });
      setSaved(true);
    },
  });
  const unchanged = value.trim() === (document.fiscalReceiptNo ?? '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <Card title={t.documents.fiscalTitle} description={t.documents.fiscalHint}>
      <form className="inline-form document-fiscal-form" onSubmit={handleSubmit}>
        <Field label={t.documents.fiscal} narrow>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            value={value}
            onChange={(event) => {
              setSaved(false);
              setValue(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" disabled={unchanged || save.isPending}>
          {save.isPending ? t.documents.saving : t.documents.save}
        </Button>
      </form>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {saved && (
        <p className="form-success" role="status">
          {document.fiscalReceiptNo ? t.documents.fiscalSaved(document.fiscalReceiptNo) : t.documents.fiscalCleared}
        </p>
      )}
    </Card>
  );
}
