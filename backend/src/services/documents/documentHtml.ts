import type { DocumentParty } from '../../database/types.js';
import { type Language, LOCALE, money } from '../../i18n/language.js';
import { messages } from '../../i18n/messages.js';
import type { DocumentDetailDto } from '../DocumentService.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * One A4 page for an invoice or credit note. The dashboard prints it (or saves
 * it as PDF) through the browser; the phone turns the same page into a PDF.
 * Colors and type follow DESIGN.md, on white paper so it prints cleanly.
 */
export function renderDocumentHtml(document: DocumentDetailDto, language: Language, timeZone: string): string {
  const t = messages[language].document;
  const eur = (amount: number) => escape(money(amount, language));
  const issued = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], {
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(document.issuedAt));
  const title = document.kind === 'invoice' ? t.invoice : t.creditNote;

  const party = (label: string, p: DocumentParty | null) =>
    p
      ? `<section class="party"><h2>${escape(label)}</h2><p class="name">${escape(p.name)}</p>
        ${p.nui ? `<p>${escape(t.nui)}: ${escape(p.nui)}</p>` : ''}
        ${p.address ? `<p>${escape(p.address)}</p>` : ''}
        ${p.phone ? `<p>${escape(t.phone)}: ${escape(p.phone)}</p>` : ''}</section>`
      : '<section class="party"></section>';

  const rows = document.lines
    .map(
      (line, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escape(line.productName)}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${eur(line.unitPrice)}</td>
        <td class="num">${line.vatRate}%</td>
        <td class="num">${eur(line.netAmount)}</td>
        <td class="num">${eur(line.vatAmount)}</td>
        <td class="num strong">${eur(line.total)}</td>
      </tr>`,
    )
    .join('');

  const vatRows = document.vatByRate
    .map((row) => `<tr><th>${escape(t.vatAt(row.rate))}</th><td>${eur(row.net)}</td><td>${eur(row.vat)}</td></tr>`)
    .join('');

  const meta = [
    [t.number, document.number],
    [t.issued, issued],
    ...(document.issuedBy ? [[t.issuedBy, document.issuedBy]] : []),
    ...(document.fiscalReceiptNo ? [[t.fiscalReceipt, document.fiscalReceiptNo]] : []),
  ]
    .map(([label, value]) => `<div><dt>${escape(label!)}</dt><dd>${escape(value!)}</dd></div>`)
    .join('');

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title} ${document.number}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root { --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3; --clay-text: #a8482a; --sunk: #f0eee6; }
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); }
  body { font: 400 10.5pt/1.45 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .page { max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
  @media print { .page { padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; padding-bottom: 6mm; border-bottom: 2px solid var(--ink); }
  h1 { font: 500 24pt/1.1 'Source Serif 4', Georgia, serif; margin: 0; }
  .kind { color: var(--clay-text); font-weight: 600; text-transform: uppercase; letter-spacing: .08em; font-size: 8.5pt; margin: 0 0 2mm; }
  dl { margin: 0; display: grid; gap: 1mm; text-align: right; }
  dl div { display: flex; gap: 4mm; justify-content: flex-end; }
  dt { color: var(--ink-muted); }
  dd { margin: 0; font-weight: 600; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; padding: 6mm 0; }
  .party h2 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-muted); margin: 0 0 1.5mm; font-weight: 600; }
  .party p { margin: 0; }
  .party .name { font-weight: 600; font-size: 12pt; }
  .note { background: var(--sunk); border-radius: 2mm; padding: 3mm 4mm; margin: 0 0 6mm; }
  table { width: 100%; border-collapse: collapse; }
  .lines th { text-align: left; font-size: 8.5pt; font-weight: 600; color: var(--ink-muted); text-transform: uppercase; letter-spacing: .04em; padding: 2mm 1.5mm; border-bottom: 1px solid var(--hairline-strong); }
  .lines td { padding: 2.5mm 1.5mm; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  .lines tr { break-inside: avoid; }
  .num { text-align: right !important; white-space: nowrap; }
  .strong { font-weight: 600; }
  .summary { display: flex; justify-content: flex-end; margin-top: 6mm; }
  .totals { width: 90mm; }
  .totals th { text-align: left; font-weight: 400; color: var(--ink-muted); padding: 1mm 0; }
  .totals td { text-align: right; padding: 1mm 0 1mm 4mm; }
  .totals .grand th, .totals .grand td { border-top: 2px solid var(--ink); padding-top: 2.5mm; font-size: 13pt; font-weight: 600; color: var(--ink); }
  .vat-head th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
  .fine { color: var(--ink-muted); font-size: 9pt; margin-top: 3mm; text-align: right; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 22mm; break-inside: avoid; }
  .signatures div { border-top: 1px solid var(--hairline-strong); padding-top: 2mm; color: var(--ink-muted); font-size: 9pt; }
</style>
</head>
<body>
<main class="page">
  <header>
    <div>
      <p class="kind">${escape(title)}</p>
      <h1>${escape(document.seller.name)}</h1>
    </div>
    <dl>${meta}</dl>
  </header>
  <div class="parties">
    ${party(t.seller, document.seller)}
    ${party(t.buyer, document.buyer)}
  </div>
  ${
    document.corrects || document.reason
      ? `<p class="note">${document.corrects ? `<strong>${escape(t.corrects(document.corrects.number))}</strong>` : ''}${
          document.reason ? `${document.corrects ? '. ' : ''}${escape(t.reason)}: ${escape(document.reason)}` : ''
        }</p>`
      : ''
  }
  <table class="lines">
    <thead><tr>
      <th class="num">#</th><th>${escape(t.product)}</th><th class="num">${escape(t.quantity)}</th>
      <th class="num">${escape(t.unitPrice)}</th><th class="num">${escape(t.vatRate)}</th>
      <th class="num">${escape(t.net)}</th><th class="num">${escape(t.vat)}</th><th class="num">${escape(t.total)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="summary">
    <table class="totals">
      <tr class="vat-head"><th></th><td>${escape(t.net)}</td><td>${escape(t.vat)}</td></tr>
      ${vatRows}
      <tr><th>${escape(t.netTotal)}</th><td colspan="2">${eur(document.netTotal)}</td></tr>
      <tr><th>${escape(t.vatTotal)}</th><td colspan="2">${eur(document.vatTotal)}</td></tr>
      <tr class="grand"><th>${escape(t.grandTotal)}</th><td colspan="2">${eur(document.total)}</td></tr>
    </table>
  </div>
  <p class="fine">${escape(t.pricesIncludeVat)}</p>
  <div class="signatures"><div>${escape(t.signedSeller)}</div><div>${escape(t.signedBuyer)}</div></div>
</main>
</body>
</html>`;
}
