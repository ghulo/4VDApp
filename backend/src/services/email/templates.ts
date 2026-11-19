/**
 * Account emails and the report. Each has an HTML part (simple tables and
 * inline styles, the only thing every email app renders the same) and a
 * plain-text part. Anything a person typed is escaped before it goes into the
 * HTML. Each is written in the reader's language: pass their catalogue as `t`.
 *
 * They wear the dashboard's look: cool paper canvas, raised cards, the serif
 * headline over a hairline, plain labels, tabular figures, tinted badges and the
 * amber key. Mail apps that follow dark mode (Apple Mail, iOS, Outlook.com) get the
 * graphite theme through the classes in `DARK`.
 */

import { en, type ServerMessages } from '../../i18n/messages.js';
import { blocksText, type ReportBlock, type ReportRow, type Tone } from '../reports/reportText.js';
import type { BrandDto } from '../brand.js';
import { brandColours } from '../../utils/brandColours.js';

/**
 * A customer's business in its own emails (team invites, portal): its logo or
 * initials key at the top, its colour on the key and links, its name in the
 * small print with 4VD after it. Account and security emails stay 4VD's.
 */
export interface EmailBrand {
  name: string;
  initials: string;
  /** An absolute PNG address (mail apps can't show WebP or relative links), or null for the initials key. */
  logoSrc: string | null;
  /** to: the accent the key runs to when the gradient is on and its words read along it. */
  key: { face: string; top: string; edge: string; ink: string; to: string | null };
  /** The accent the logo key runs to, when the gradient is on. */
  markTo: string | null;
  link: string;
  linkDark: string;
}

/** Where /api/media pictures are served from, for logos in emails (set once at start-up). */
let mediaBase: string | null = null;
export function setEmailMediaBase(base: string | undefined): void {
  mediaBase = base ? base.replace(/\/$/, '') : null;
}

/** 4VD's own business: undefined (the house look). Others: their look, ready for an email. */
export function emailBrandOf(brand: BrandDto): EmailBrand | undefined {
  if (brand.house) return undefined;
  const colours = brandColours(brand.colour, brand.greys, { accent: brand.accent, gradient: brand.gradient });
  return {
    name: brand.name,
    initials: brand.initials,
    logoSrc: brand.logoUrl && mediaBase ? `${mediaBase}${brand.logoUrl}?format=png` : null,
    key: { face: colours.key.face, top: colours.key.top, edge: colours.key.edge, ink: colours.key.ink, to: colours.gradient.key ? brand.accent : null },
    markTo: colours.gradient.mark ? brand.accent : null,
    link: colours.words.light,
    linkDark: colours.words.dark,
  };
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** The dashboard's tokens (admin/src/styles/tokens.css), written out: email apps can't read its CSS. */
const C = {
  canvas: '#eef2f5',
  paper: '#f5f9fc',
  sunk: '#e3e7ea',
  tint: '#fbebc5',
  rim: '#f7dda2',
  ink: '#191a1a',
  muted: '#595d5f',
  line: '#e3e7ea',
  accent: '#a66f02',
  bar: '#f7dda2',
  ok: '#016732',
  warn: '#953f00',
  danger: '#a71f25',
  info: '#115e9f',
  okSoft: '#e4f8e8',
  warnSoft: '#ffeee6',
  dangerSoft: '#ffedeb',
  infoSoft: '#e9f3ff',
};
const NIGHT: typeof C = {
  canvas: '#0f1010',
  paper: '#191a1a',
  sunk: '#060707',
  tint: '#30200c',
  rim: '#51330a',
  ink: '#f5f9fc',
  muted: '#b7bbbe',
  line: '#2d2e2f',
  accent: '#f5b71a',
  bar: '#653e00',
  ok: '#49b46e',
  warn: '#ec7531',
  danger: '#f76560',
  info: '#55a0ea',
  okSoft: '#1b3422',
  warnSoft: '#432516',
  dangerSoft: '#46211f',
  infoSoft: '#1d2f42',
};
/** The amber key: brand amber with a lit top and a deeper foot, like the dashboard's main button. */
const AMBER = '#f5b71a';
const AMBER_TOP = '#f5c662';
const AMBER_EDGE = '#a66f02';
/** Text on amber: white fails contrast. */
const AMBER_INK = '#0f1010';
const SANS = "'Hanken Grotesk',Helvetica,Arial,sans-serif";
const SERIF = "'Source Serif 4',Georgia,'Times New Roman',serif";
/** The family home on its amber tile, drawn by brand/make_icons.mjs and served by the dashboard. Same in light and dark. */
const LOGO_URL = 'https://4vd.app/email-logo.png?v=5';
/** Apple Mail and iOS load the real fonts; the rest fall back to Helvetica and Georgia. */
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500&display=swap';
/** Raise: cards rest just above the canvas. */
const RAISE = 'box-shadow:0 1px 2px rgba(22,25,27,0.06),0 4px 14px rgba(22,25,27,0.06)';

const TONES = ['ok', 'warn', 'danger', 'info'] as const;
const toneColor = (tone: Tone) => (tone === 'neutral' ? C.muted : C[tone]);

/** Every colour has a class so dark mode can swap it: for the system setting and Outlook.com's `[data-ogsc]` hook. */
function darkRules(scope: string): string {
  const rule = (selector: string, body: string) => `${scope}${selector}{${body}}`;
  return [
    rule('.bg-canvas', `background:${NIGHT.canvas}!important`),
    rule('.bg-paper', `background:${NIGHT.paper}!important;border-color:${NIGHT.line}!important`),
    rule('.bg-sunk', `background:${NIGHT.sunk}!important;border-color:${NIGHT.line}!important`),
    rule('.bg-tint', `background:${NIGHT.tint}!important;border-color:${NIGHT.rim}!important`),
    rule('.ink', `color:${NIGHT.ink}!important`),
    rule('.muted', `color:${NIGHT.muted}!important`),
    rule('.line', `border-color:${NIGHT.line}!important`),
    rule('.link', `color:${NIGHT.accent}!important`),
    rule('.bar', `background:${NIGHT.bar}!important`),
    ...TONES.map((tone) => rule(`.t-${tone}`, `color:${NIGHT[tone]}!important`)),
    ...TONES.map((tone) => rule(`.s-${tone}`, `color:${NIGHT[tone]}!important;background:${NIGHT[`${tone}Soft`]}!important`)),
  ].join('');
}
const DARK = `@media (prefers-color-scheme:dark){${darkRules('')}}${darkRules('[data-ogsc] ')}`;
const NARROW =
  '@media (max-width:480px){.pad{padding-left:20px!important;padding-right:20px!important}.headline{font-size:28px!important;line-height:34px!important}.col{display:block!important;width:100%!important;padding:0 0 12px!important}.cell{padding-left:12px!important;padding-right:12px!important}}';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const GAP = (px: number) => `<div style="height:${px}px;font-size:0;line-height:0">&nbsp;</div>`;
const paragraph = (html: string) => `<p class="ink" style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.ink}">${html}</p>`;

/** A plain label over a figure or above a headline: small, muted, as written. */
const specLabel = (text: string, margin = '0') =>
  `<div class="muted" style="margin:${margin};font-family:${SANS};font-size:13px;line-height:18px;font-weight:500;color:${C.muted}">${escapeHtml(text)}</div>`;

/** A badge: the status word on its faint tint, like the dashboard's. */
const stamp = (text: string, tone: Tone) =>
  `<span class="s-${tone}" style="display:inline-block;padding:2px 8px;border-radius:999px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;vertical-align:1px;color:${toneColor(tone)};background:${tone === 'neutral' ? C.sunk : C[`${tone}Soft`]}">${escapeHtml(text)}</span>`;

/** The amber key standing on its edge, like the dashboard's main button. Outlook gets the flat amber face. A business's own email: its colour. */
function renderButton(t: ServerMessages, button: { label: string; link: string }, brand?: EmailBrand): string {
  const link = escapeHtml(button.link);
  const key = brand ? brand.key : { face: AMBER, top: AMBER_TOP, edge: AMBER_EDGE, ink: AMBER_INK, to: null };
  const face = key.to ? `linear-gradient(100deg,${key.face},${key.to})` : `linear-gradient(${key.top},${key.face} 60%)`;
  const linkColour = brand ? brand.link : C.accent;
  return `<table ${TABLE} style="margin:4px 0 16px"><tr>
<td style="border-radius:10px;background-color:${key.face};background-image:${face};border-bottom:2px solid ${key.edge};box-shadow:inset 0 1px 0 rgba(255,255,255,0.3),0 2px 6px rgba(22,25,27,0.1)">
<a href="${link}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${key.ink};text-decoration:none;border-radius:10px">${escapeHtml(button.label)}</a>
</td></tr></table>
<p class="muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${escapeHtml(t.email.pasteLink)}<br><a class="link" href="${link}" style="color:${linkColour};word-break:break-all">${link}</a></p>`;
}

/** The serif page title over a hairline, with an optional spec-label kicker above it. */
const headline = (title: string, kicker?: string) =>
  `${kicker ? specLabel(kicker, '0 0 8px') : ''}<h1 class="headline ink" style="margin:0;font-family:${SERIF};font-size:32px;line-height:38px;font-weight:500;letter-spacing:-0.3px;font-variant-numeric:lining-nums;color:${C.ink}">${escapeHtml(title)}</h1>
<div class="line" style="height:0;margin:16px 0 20px;border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</div>`;

/** A raised paper card; `strip` is its sunk footer strip (already escaped). */
const card = (inner: string, strip?: string) =>
  `<table ${TABLE} width="100%" class="bg-paper" style="background:${C.paper};border:1px solid ${C.line};border-radius:16px;border-collapse:separate;${RAISE}">
<tr><td class="pad" style="padding:28px 32px 24px">${inner}</td></tr>${
    strip
      ? `<tr><td class="pad bg-sunk muted" style="padding:14px 32px;background:${C.sunk};border-top:1px solid ${C.line};border-radius:0 0 15px 15px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${strip}</td></tr>`
      : ''
  }
</table>`;

/** A business's own mark and name on the canvas: its logo, or its initials on a key in its colour (a cell, not an image). */
function brandHeader(brand: EmailBrand): string {
  const mark = brand.logoSrc
    ? `<img src="${escapeHtml(brand.logoSrc)}" width="56" height="56" alt="${escapeHtml(brand.name)}" style="display:block;border:0;width:56px;height:56px;border-radius:14px">`
    : `<table ${TABLE}><tr><td width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;border-radius:15px;background-color:${brand.key.face};background-image:${brand.markTo ? `linear-gradient(100deg,${brand.key.face},${brand.markTo})` : `linear-gradient(${brand.key.top},${brand.key.face} 55%)`};border-bottom:2px solid ${brand.key.edge};font-family:${SERIF};font-size:23px;line-height:56px;font-weight:600;color:${brand.key.ink};text-align:center">${escapeHtml(brand.initials)}</td></tr></table>`;
  return `<td style="vertical-align:middle">${mark}</td><td class="ink" style="vertical-align:middle;padding-left:14px;font-family:${SERIF};font-size:20px;line-height:26px;font-weight:600;color:${C.ink}">${escapeHtml(brand.name)}</td>`;
}

/** The page every email shares: the logo on the canvas, the content, the small print. */
function shell({ t, subject, preview, content, brand }: { t: ServerMessages; subject: string; preview: string; content: string; brand?: EmailBrand }): string {
  const brandDark = brand ? `@media (prefers-color-scheme:dark){.link{color:${brand.linkDark}!important}}[data-ogsc] .link{color:${brand.linkDark}!important}` : '';
  return `<!doctype html><html lang="${t.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>:root{color-scheme:light dark}${NARROW}${DARK}${brandDark}</style></head>
<body class="bg-canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preview)}</div>
<table ${TABLE} width="100%" class="bg-canvas" style="background:${C.canvas}"><tr><td align="center" style="padding:32px 12px 40px">
<table ${TABLE} width="100%" style="max-width:600px">
<tr><td style="padding:0 4px 24px"><table ${TABLE}><tr>
${brand ? brandHeader(brand) : `<td style="vertical-align:middle"><img src="${LOGO_URL}" width="64" height="64" alt="4VD" style="display:block;border:0;width:64px;height:64px"></td>`}
</tr></table></td></tr>
<tr><td>${content}</td></tr>
<tr><td class="muted" style="padding:24px 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted}">${brand ? `${escapeHtml(brand.name)}<br>${escapeHtml(t.email.runsOn)} · ` : `${escapeHtml(t.email.footer)}<br>`}<a class="muted" href="https://4vd.app" style="color:${C.muted}">4vd.app</a></td></tr>
</table></td></tr></table></body></html>`;
}

interface Letter {
  t: ServerMessages;
  /** Also the headline at the top of the card. */
  subject: string;
  /** Short paragraphs, already escaped. The first one is also the inbox preview. */
  paragraphs: string[];
  button?: { label: string; link: string };
  /** Small print in the card's footer strip, already escaped. */
  note?: string;
  /** A customer business's own email: its look instead of 4VD's. */
  brand?: EmailBrand;
}

const unescape = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** An account email: one raised card with the headline, a few lines, the amber key and the small print. */
function letter({ t, subject, paragraphs, button, note, brand }: Letter): string {
  return shell({
    t,
    subject,
    preview: unescape(paragraphs[0] ?? ''),
    content: card(`${headline(subject)}${paragraphs.map(paragraph).join('')}${button ? renderButton(t, button, brand) : ''}`, note),
    brand,
  });
}

/** Metric cards two to a row (stacked on phones), each with the same parts. */
function renderFigures(figures: NonNullable<ReportBlock['figures']>): string {
  const tile = (f: (typeof figures)[number]) =>
    `<table ${TABLE} width="100%" class="bg-paper" style="background:${C.paper};border:1px solid ${C.line};border-radius:16px;border-collapse:separate;${RAISE}"><tr><td style="padding:16px 18px 18px">
${specLabel(f.label)}
<div class="ink" style="margin:8px 0 6px;font-family:${SANS};font-size:28px;line-height:34px;font-weight:600;font-variant-numeric:tabular-nums;color:${C.ink}">${escapeHtml(f.value)}</div>
${f.change ? `<div class="t-${f.change.tone}" style="font-family:${SANS};font-size:13px;line-height:18px;font-weight:600;color:${toneColor(f.change.tone)}">${escapeHtml(f.change.text)}</div>` : ''}
${f.hint ? `<div class="muted" style="font-family:${SANS};font-size:13px;line-height:18px;color:${C.muted}">${escapeHtml(f.hint)}</div>` : ''}
</td></tr></table>`;
  const rows: string[] = [];
  for (let i = 0; i < figures.length; i += 2) {
    const [a, b] = [figures[i]!, figures[i + 1]];
    rows.push(
      `<tr><td class="col" width="50%" valign="top" style="padding:0 6px 12px 0">${tile(a)}</td><td class="col" width="50%" valign="top" style="padding:0 0 12px 6px">${b ? tile(b) : ''}</td></tr>`,
    );
  }
  return `<table ${TABLE} width="100%">${rows.join('')}</table>`;
}

/** A framed table surface: hairline rows, the name on the left, numbers right-aligned and tabular, a sunk total strip. */
function renderRows(rows: ReportRow[]): string {
  const line = (row: ReportRow, i: number) => {
    const classes = `cell line${row.total ? ' bg-sunk' : ''}`;
    const base = `padding:12px 16px;font-family:${SANS};font-size:15px;line-height:22px;${i === 0 ? '' : `border-top:1px solid ${C.line};`}${row.total ? `background:${C.sunk};` : ''}`;
    const label = `${row.stamp ? `${stamp(row.stamp.text, row.stamp.tone)}&nbsp; ` : ''}<span class="ink" style="color:${C.ink};font-weight:${row.total ? 600 : 400}">${escapeHtml(row.label)}</span>${
      row.detail ? `<br><span class="muted" style="font-size:13px;line-height:18px;color:${C.muted}">${escapeHtml(row.detail)}</span>` : ''
    }`;
    const value = row.value
      ? `<td class="${classes} ${row.tone ? `t-${row.tone}` : 'ink'}" style="${base}text-align:right;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:${row.total || row.tone ? 600 : 500};color:${row.tone ? toneColor(row.tone) : C.ink}">${escapeHtml(row.value)}</td>`
      : `<td class="${classes}" style="${base}"></td>`;
    return `<tr><td class="${classes}" style="${base}vertical-align:top">${label}</td>${value}</tr>`;
  };
  return surface(rows.map(line).join(''));
}

/** Weekly sales per day: amber bars on a sunk track, the best day in full brand amber (like the dashboard's charts). */
function renderBars(bars: NonNullable<ReportBlock['bars']>, heading: string): string {
  const body = bars
    .map((bar, i) => {
      const width = Math.max(2, Math.round(bar.amount * 100));
      const top = bar.amount === 1;
      const pad = `${i === 0 ? 16 : 6}px`;
      const text = `font-family:${SANS};font-size:13px;line-height:18px;white-space:nowrap`;
      return `<tr><td class="cell muted" style="padding:${pad} 8px 0 16px;width:56px;${text};color:${C.muted}">${escapeHtml(bar.label)}</td>
<td width="100%" style="padding:${pad} 0 0"><table ${TABLE} width="100%" class="bg-sunk" style="background:${C.sunk};border-radius:4px"><tr><td width="${width}%" class="${top ? '' : 'bar'}" style="height:10px;font-size:0;line-height:0;border-radius:4px;background:${top ? AMBER : C.bar}">&nbsp;</td>${width < 100 ? '<td style="font-size:0;line-height:0">&nbsp;</td>' : ''}</tr></table></td>
<td class="cell ${top ? 'ink' : 'muted'}" style="padding:${pad} 16px 0 12px;text-align:right;${text};font-variant-numeric:tabular-nums;font-weight:${top ? 600 : 400};color:${top ? C.ink : C.muted}">${escapeHtml(bar.value)}</td></tr>`;
    })
    .join('');
  return surface(`<tr><td colspan="3" style="padding:14px 16px 0">${specLabel(heading)}</td></tr>${body}<tr><td colspan="3" style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>`);
}

const surface = (body: string) =>
  `<table ${TABLE} width="100%" class="bg-paper" style="background:${C.paper};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden;${RAISE}">${body}</table>`;

/** A section heading on the canvas (Title type), then its figures, bars and table. Never a box in a box. */
const renderBlock = (block: ReportBlock, byDay: string) =>
  `<tr><td style="padding:0 0 28px">
<h2 class="ink" style="margin:0 4px 12px;font-family:${SANS};font-size:17px;line-height:24px;font-weight:600;color:${C.ink}">${escapeHtml(block.heading)}</h2>
${[block.figures ? renderFigures(block.figures) : '', block.bars ? renderBars(block.bars, byDay) : '', block.rows.length > 0 ? renderRows(block.rows) : '']
  .filter(Boolean)
  .join(GAP(12))}
</td></tr>`;

function plain(lines: Array<string | undefined>, brand?: EmailBrand): string {
  return `${lines.filter((line) => line !== undefined).join('\n\n')}\n\n-- \n${brand ? `${brand.name} (4VD)` : '4VD'}`;
}

export const emailTemplates = {
  portalInvite(input: { shopName: string; customerName: string; link: string; brand?: EmailBrand }, t: ServerMessages = en): EmailContent {
    const subject = t.email.portalInviteSubject(input.shopName);
    const body = (shop: string, customer: string) => t.email.portalInviteBody({ shop, customer });
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [body(`<strong>${escapeHtml(input.shopName)}</strong>`, escapeHtml(input.customerName))],
        button: { label: t.email.portalInviteButton, link: input.link },
        note: escapeHtml(t.email.portalInviteNote),
        brand: input.brand,
      }),
      text: plain([body(input.shopName, input.customerName), `${t.email.portalInviteButton}: ${input.link}`, t.email.portalInviteNote], input.brand),
    };
  },

  portalSignIn(input: { shopName: string; link: string; brand?: EmailBrand }, t: ServerMessages = en): EmailContent {
    const subject = t.email.portalSignInSubject(input.shopName);
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.portalSignInBody(input.shopName))],
        button: { label: t.email.portalSignInButton, link: input.link },
        note: escapeHtml(t.email.portalSignInNote),
        brand: input.brand,
      }),
      text: plain([t.email.portalSignInBody(input.shopName), `${t.email.portalSignInButton}: ${input.link}`, t.email.portalSignInNote], input.brand),
    };
  },

  portalOrderChanged(input: { shopName: string; orderId: number; reason: string; total: string; link: string; brand?: EmailBrand }, t: ServerMessages = en): EmailContent {
    const subject = t.email.portalChangedSubject({ shop: input.shopName, id: input.orderId });
    const lines = [t.email.portalChangedBody({ shop: input.shopName, id: input.orderId }), t.email.portalChangedReason(input.reason), t.email.portalChangedTotal(input.total)];
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: lines.map(escapeHtml),
        button: { label: t.email.portalChangedButton, link: input.link },
        note: escapeHtml(t.email.portalChangedNote),
        brand: input.brand,
      }),
      text: plain([...lines, `${t.email.portalChangedButton}: ${input.link}`, t.email.portalChangedNote], input.brand),
    };
  },

  invite(input: { shopName: string; inviterName: string; role: string; link: string; brand?: EmailBrand }, t: ServerMessages = en): EmailContent {
    const subject = t.email.inviteSubject({ inviter: input.inviterName, shop: input.shopName });
    const role = t.roleName[input.role] ?? input.role;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [
          t.email.inviteBody({
            inviter: escapeHtml(input.inviterName),
            shop: `<strong>${escapeHtml(input.shopName)}</strong>`,
            role: escapeHtml(role),
          }),
          escapeHtml(t.email.inviteChoosePassword),
        ],
        button: { label: t.email.inviteButton, link: input.link },
        note: escapeHtml(t.email.inviteNote),
        brand: input.brand,
      }),
      text: plain(
        [t.email.inviteBody({ inviter: input.inviterName, shop: input.shopName, role }), `${t.email.inviteButton}: ${input.link}`, t.email.inviteNoteShort],
        input.brand,
      ),
    };
  },

  verifyEmail(input: { name: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.verifySubject;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.verifyBody)],
        button: { label: t.email.verifyButton, link: input.link },
        note: escapeHtml(t.email.expires24h),
      }),
      text: plain([t.email.greeting(input.name), `${t.email.verifyButton}: ${input.link}`, t.email.expires24h]),
    };
  },

  passkeyAdded(input: { name: string; device: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.passkeySubject;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.passkeyBody(input.device))],
        button: { label: t.email.passkeyButton, link: input.link },
        note: escapeHtml(t.email.passkeyNote),
      }),
      text: plain([t.email.greeting(input.name), t.email.passkeyBody(input.device), `${t.email.passkeyButton}: ${input.link}`, t.email.passkeyNote]),
    };
  },

  resetPassword(input: { name: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.resetSubject;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.resetBody)],
        button: { label: t.email.resetButton, link: input.link },
        note: escapeHtml(t.email.resetNote),
      }),
      text: plain([t.email.greeting(input.name), `${t.email.resetButton}: ${input.link}`, t.email.resetNoteShort]),
    };
  },

  confirmNewEmail(input: { name: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.confirmSubject;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.confirmBody)],
        button: { label: t.email.confirmButton, link: input.link },
        note: escapeHtml(t.email.confirmNote),
      }),
      text: plain([t.email.greeting(input.name), `${t.email.confirmButton}: ${input.link}`, t.email.expires24h]),
    };
  },

  /**
   * The daily or weekly report, laid out like its page in the dashboard: the
   * headline, the gist on an amber tint, metric cards, then each chosen section
   * as a heading and a table, and the amber key to the full report.
   */
  report(
    input: { subject: string; headline: string; period: string; intro: string; summary: string; blocks: ReportBlock[]; link: string },
    t: ServerMessages = en,
  ): EmailContent {
    const top = `<tr><td style="padding:0 4px 24px">${headline(input.headline, input.period)}${paragraph(escapeHtml(input.intro))}
<table ${TABLE} width="100%" class="bg-tint" style="background:${C.tint};border:1px solid ${C.rim};border-radius:12px;border-collapse:separate"><tr><td class="ink" style="padding:14px 16px;font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:${C.ink}">${escapeHtml(input.summary)}</td></tr></table>
</td></tr>`;
    const end = `<tr><td style="padding:0">${card(renderButton(t, { label: t.report.emailButton, link: input.link }), escapeHtml(t.report.emailNote))}</td></tr>`;
    return {
      subject: input.subject,
      html: shell({
        t,
        subject: input.subject,
        preview: input.summary,
        content: `<table ${TABLE} width="100%">${top}${input.blocks.map((block) => renderBlock(block, t.report.lines.byDay)).join('')}${end}</table>`,
      }),
      text: plain([input.intro, input.summary, ...blocksText(input.blocks), `${t.report.emailButton}: ${input.link}`, t.report.emailNote]),
    };
  },

  errorAlert(input: { name: string; count: number; items: Array<{ what: string; count: number }> }, t: ServerMessages = en): EmailContent {
    const subject = t.email.errorSubject(input.count);
    const intro = t.email.errorIntro({ name: input.name, count: input.count });
    const items = input.items.map((item) => t.email.errorItem(item));
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [escapeHtml(intro), items.map(escapeHtml).join('<br>')],
        note: escapeHtml(t.email.errorNote),
      }),
      text: plain([intro, items.join('\n'), t.email.errorNote]),
    };
  },

  emailChanged(input: { name: string; newEmail: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.changedSubject;
    return {
      subject,
      html: letter({
        t,
        subject,
        paragraphs: [
          escapeHtml(t.email.greeting(input.name)),
          t.email.changedBody(`<strong>${escapeHtml(input.newEmail)}</strong>`),
          escapeHtml(t.email.changedWarning),
        ],
      }),
      text: plain([t.email.greeting(input.name), t.email.changedBody(input.newEmail), t.email.changedWarning]),
    };
  },
};
