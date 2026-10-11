import type { DocumentParty } from '../../database/types.js';
import { amountInWords } from '../../i18n/amountInWords.js';
import { type Language, LOCALE, money } from '../../i18n/language.js';
import { messages } from '../../i18n/messages.js';
import type { Letterhead } from '../../repositories/DocumentRepository.js';
import type { DocumentDetailDto } from '../DocumentService.js';
import { code128Svg } from './code128.js';
import { SHOP_MARK_SVG } from './shopMark.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Text inside a CSS string, for the page footer printed in the margin; `<` is escaped so a name can't close the style tag. */
const cssString = (value: string) =>
  `"${value.replace(/[\\"]/g, (char) => `\\${char}`).replace(/</g, '\\3c ').replace(/[\r\n]+/g, ' ')}"`;

/** "10%" or "7,5%", the way the language writes a percent. */
const formatPercent = (percent: number, language: Language) =>
  `${new Intl.NumberFormat(language === 'en' ? 'en-GB' : LOCALE[language], { maximumFractionDigits: 2 }).format(percent)}%`;

/** "XK051212012345678906" as people read it: "XK05 1212 0123 4567 8906". */
const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * One A4 page for an invoice or credit note. The dashboard prints it (or saves
 * it as PDF) through the browser; the phone turns the same page into a PDF.
 * Colors and type follow DESIGN.md's printed finish, on white paper so it
 * prints cleanly: a masthead with the shop's logo over a double rule, the
 * buyer and the document's facts, the lines (with any rabat), then the totals
 * with the amount due in a clay-edged box and in words, the signatures around
 * the stamp, and the shop and page number in the bottom margin. The number
 * is also a barcode, so scanning the paper finds the document again.
 */
export function renderDocumentHtml(document: DocumentDetailDto, letterhead: Letterhead, language: Language, timeZone: string): string {
  const t = messages[language].document;
  const eur = (amount: number) => escape(money(amount, language));
  const issued = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], {
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(document.issuedAt));
  const isInvoice = document.kind === 'invoice';
  const title = isInvoice ? t.invoice : t.creditNote;
  const seller = document.seller;
  const dayFormat = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], { dateStyle: 'long', timeZone: 'UTC' });
  const onAccount = document.paymentMethod === 'account';
  const paidHow = isInvoice ? (onAccount ? t.onAccount : t.paidAtTill) : onAccount ? t.creditedToAccount : t.refundedAtTill;

  const logo = letterhead.logo
    ? `<img class="logo" src="data:${escape(letterhead.logo.mime)};base64,${letterhead.logo.bytes.toString('base64')}" alt="">`
    : `<span class="logo" aria-hidden="true">${SHOP_MARK_SVG}</span>`;

  const contact = (p: DocumentParty) =>
    [p.nui ? `${escape(t.nui)} ${escape(p.nui)}` : '', p.address ? escape(p.address) : '', p.phone ? `${escape(t.phone)} ${escape(p.phone)}` : '']
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join('');

  const buyer = document.buyer
    ? `<section class="buyer"><h2 class="spec">${escape(t.buyer)}</h2><p class="buyer__name">${escape(document.buyer.name)}</p>${contact(document.buyer)}</section>`
    : '';

  const facts = [
    [t.issued, issued],
    ...(document.issuedBy ? [[t.issuedBy, document.issuedBy]] : []),
    ...(document.fiscalReceiptNo ? [[t.fiscalReceipt, document.fiscalReceiptNo]] : []),
    [t.paymentMethod, paidHow],
    ...(document.dueDate ? [[t.dueDate, dayFormat.format(new Date(`${document.dueDate}T00:00:00Z`))]] : []),
  ]
    .map(([label, value]) => `<div><dt class="spec">${escape(label!)}</dt><dd>${escape(value!)}</dd></div>`)
    .join('');

  const rows = document.lines
    .map(
      (line, index) => `<tr>
        <td class="num muted">${index + 1}</td>
        <td class="product">${escape(line.productName)}${line.productCode ? `<span class="code">${escape(line.productCode)}</span>` : ''}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${eur(line.priceBeforeDiscount ?? line.unitPrice)}</td>
        <td class="num">${line.discountPercent ? `${formatPercent(line.discountPercent, language)}` : ''}</td>
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

  // How much the rabat took off, at the prices before it.
  const discountTotal = document.lines.reduce(
    (sum, line) => sum + (line.priceBeforeDiscount === null ? 0 : (line.priceBeforeDiscount - line.unitPrice) * line.quantity),
    0,
  );

  // Only an invoice on account still has to be paid; one paid at the till is settled, and a credit note's money goes the other way.
  const payment =
    isInvoice && onAccount && letterhead.iban
      ? `<section class="payment"><h2 class="spec">${escape(t.payment)}</h2><dl>
          ${letterhead.bankName ? `<div><dt>${escape(t.bank)}</dt><dd>${escape(letterhead.bankName)}</dd></div>` : ''}
          <div><dt>${escape(t.iban)}</dt><dd class="iban">${escape(groupIban(letterhead.iban))}</dd></div>
          <div><dt>${escape(t.payReference)}</dt><dd>${escape(document.number)}</dd></div>
        </dl></section>`
      : '';

  const footer = [seller.name, seller.nui ? `${t.nui} ${seller.nui}` : ''].filter(Boolean).join('  ·  ');

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title} ${document.number}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3;
    --clay: #d4704f; --clay-text: #a8482a; --sunk: #f0eee6; --warn: #86500c; --warn-soft: #f6ecd9;
    --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  }
  @page {
    size: A4;
    margin: 14mm 14mm 18mm;
    @bottom-left { content: ${cssString(footer)}; font: 400 8pt 'Hanken Grotesk', system-ui, sans-serif; color: #5e5d59; vertical-align: top; padding-top: 4mm; }
    @bottom-right {
      content: ${cssString(`${t.page} `)} counter(page) ${cssString(` ${t.pageOf} `)} counter(pages);
      font: 400 8pt 'Hanken Grotesk', system-ui, sans-serif; color: #5e5d59; vertical-align: top; padding-top: 4mm;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 400 10pt/1.45 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  p, h1, h2, dl, dd { margin: 0; }
  .page { max-width: 182mm; margin: 0 auto; padding: 10mm 0; }
  @media print { .page { padding: 0; } }
  /* Spec labels: DESIGN.md's only capitals. */
  .spec { font: 600 7.5pt/1.3 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-muted); }
  .muted { color: var(--ink-muted); }
  .strong { font-weight: 600; }

  .masthead { display: grid; grid-template-columns: auto 1fr auto; gap: 5mm; align-items: start; padding-bottom: 5mm; border-bottom: 3px double var(--ink); }
  .logo { display: block; width: 17mm; height: 17mm; object-fit: contain; }
  .logo svg { display: block; width: 100%; height: 100%; }
  .shop h1 { font: 500 19pt/1.15 'Source Serif 4', Georgia, serif; margin-bottom: 1.5mm; }
  .shop p { color: var(--ink-muted); font-size: 9pt; line-height: 1.4; }
  .doc { text-align: right; }
  .doc .spec { color: var(--clay-text); font-size: 9pt; }
  .doc__number { font-size: 17pt; font-weight: 600; line-height: 1.2; margin-top: 1mm; white-space: nowrap; }
  .doc__barcode { width: 46mm; height: 9mm; margin: 2mm 0 0 auto; }
  .doc__barcode svg { display: block; width: 100%; height: 100%; }

  .head { display: grid; grid-template-columns: 1fr auto; gap: 10mm; align-items: start; padding: 6mm 0; }
  .buyer { background: var(--sunk); border-radius: 2mm; padding: 3.5mm 4.5mm; max-width: 95mm; }
  .buyer .spec { margin-bottom: 1.5mm; }
  .buyer__name { font-size: 11.5pt; font-weight: 600; margin-bottom: .5mm; }
  .buyer p:not(.buyer__name) { font-size: 9pt; color: var(--ink-muted); }
  .facts { display: grid; gap: 2mm; grid-column: 2; }
  .facts div { display: grid; grid-template-columns: auto auto; justify-content: end; align-items: baseline; gap: 4mm; text-align: right; }
  .facts dd { font-weight: 600; }

  .note { background: var(--warn-soft); color: var(--warn); border-left: 2px solid var(--warn); border-radius: 0 1.5mm 1.5mm 0; padding: 3mm 4mm; margin: 0 0 6mm; }

  table { width: 100%; border-collapse: collapse; }
  .lines th { text-align: left; padding: 0 2mm 2mm; border-bottom: 1px solid var(--ink); }
  .lines td { padding: 2.4mm 2mm; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  .lines .product { width: 100%; }
  .code { display: block; font: 400 7.5pt/1.3 var(--mono); color: var(--ink-muted); letter-spacing: .02em; margin-top: .3mm; }
  .lines tr { break-inside: avoid; }
  .num { text-align: right !important; white-space: nowrap; }

  .bottom { display: grid; grid-template-columns: 1fr 80mm; gap: 10mm; align-items: start; margin-top: 7mm; break-inside: avoid; }
  .aside { display: grid; gap: 5mm; }
  .aside .spec { margin-bottom: 1.5mm; }
  .vat { width: auto; }
  .vat th, .vat td { padding: .8mm 0; font-size: 9pt; }
  .vat th { text-align: left; font-weight: 400; color: var(--ink-muted); }
  .vat td { text-align: right; padding-left: 8mm; }
  .vat thead th { text-align: right; }
  .vat thead th:first-child { text-align: left; }
  .payment dl { display: grid; gap: .8mm; font-size: 9pt; }
  .payment div { display: grid; grid-template-columns: 22mm 1fr; }
  .payment dt { color: var(--ink-muted); }
  .payment dd { font-weight: 600; }
  .iban { letter-spacing: .02em; }

  .totals th { text-align: left; font-weight: 400; color: var(--ink-muted); padding: 1mm 0; }
  .totals td { text-align: right; padding: 1mm 0; }
  .due { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; margin-top: 3mm; padding: 3.5mm 4mm; border: 1px solid var(--ink); border-left: 2mm solid var(--clay); border-radius: 1.5mm; }
  .due .spec { color: var(--ink); font-size: 8.5pt; }
  .due__amount { font-size: 18pt; font-weight: 600; line-height: 1.1; white-space: nowrap; }
  .words { margin-top: 2.5mm; font-size: 9pt; line-height: 1.4; }
  .words .spec { margin-right: 1.5mm; }
  .fine { color: var(--ink-muted); font-size: 8.5pt; margin-top: 2mm; text-align: right; }

  .signatures { display: grid; grid-template-columns: 1fr 26mm 1fr; gap: 10mm; align-items: end; margin-top: 16mm; break-inside: avoid; }
  .signature { border-top: 1px solid var(--hairline-strong); padding-top: 2mm; color: var(--ink-muted); font-size: 8.5pt; }
  /* Where the shop's stamp goes. */
  .stamp { width: 26mm; height: 26mm; border: 1px dashed var(--hairline-strong); border-radius: 50%; display: grid; place-items: center; color: var(--ink-muted); font: 600 7.5pt var(--mono); letter-spacing: .06em; }
  .note-shop { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--hairline); color: var(--ink-muted); font-size: 8.5pt; text-align: center; white-space: pre-line; break-inside: avoid; }
</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    ${logo}
    <div class="shop">
      <h1>${escape(seller.name)}</h1>
      ${contact(seller)}
    </div>
    <div class="doc">
      <p class="spec">${escape(title)}</p>
      <p class="doc__number">${escape(document.number)}</p>
      <div class="doc__barcode" aria-hidden="true">${code128Svg(document.number)}</div>
    </div>
  </header>
  <div class="head">
    ${buyer}
    <dl class="facts">${facts}</dl>
  </div>
  ${
    document.corrects || document.reason
      ? `<p class="note">${document.corrects ? `<strong>${escape(t.corrects(document.corrects.number))}</strong>` : ''}${
          document.reason ? `${document.corrects ? '. ' : ''}${escape(t.reason)}: ${escape(document.reason)}` : ''
        }</p>`
      : ''
  }
  <table class="lines">
    <thead><tr class="spec">
      <th class="num">#</th><th>${escape(t.product)}</th><th class="num">${escape(t.quantity)}</th>
      <th class="num">${escape(t.unitPrice)}</th><th class="num">${escape(t.discount)}</th><th class="num">${escape(t.vatRate)}</th>
      <th class="num">${escape(t.net)}</th><th class="num">${escape(t.vat)}</th><th class="num">${escape(t.total)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom">
    <div class="aside">
      <section>
        <h2 class="spec">${escape(t.vatSummary)}</h2>
        <table class="vat">
          <thead><tr><th></th><th>${escape(t.net)}</th><th>${escape(t.vat)}</th></tr></thead>
          <tbody>${vatRows}</tbody>
        </table>
      </section>
      ${payment}
    </div>
    <div>
      <table class="totals">
        ${discountTotal > 0.004 ? `<tr><th>${escape(t.discountTotal)}</th><td>−${eur(discountTotal)}</td></tr>` : ''}
        <tr><th>${escape(t.netTotal)}</th><td>${eur(document.netTotal)}</td></tr>
        <tr><th>${escape(t.vatTotal)}</th><td>${eur(document.vatTotal)}</td></tr>
      </table>
      <div class="due"><span class="spec">${escape(isInvoice ? t.grandTotal : t.refundTotal)}</span><span class="due__amount">${eur(document.total)}</span></div>
      <p class="words"><span class="spec">${escape(t.inWords)}</span> ${escape(amountInWords(document.total, language))}</p>
      <p class="fine">${escape(t.pricesIncludeVat)}</p>
    </div>
  </div>
  <div class="signatures">
    <div class="signature">${escape(t.signedSeller)}</div>
    <div class="stamp">${escape(t.stamp)}</div>
    <div class="signature">${escape(t.signedBuyer)}</div>
  </div>
  ${letterhead.note ? `<p class="note-shop">${escape(letterhead.note)}</p>` : ''}
</main>
</body>
</html>`;
}
