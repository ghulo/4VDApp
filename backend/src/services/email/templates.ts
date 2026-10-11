/**
 * Account emails. Each has an HTML part (simple tables and inline styles, the
 * only thing every email app renders the same) and a plain-text part.
 * Anything a person typed is escaped before it goes into the HTML. Each is
 * written in the reader's language: pass their catalogue as `t`.
 */

import { en, type ServerMessages } from '../../i18n/messages.js';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** DESIGN.md colours, written out: email apps can't read the dashboard's CSS. */
const CANVAS = '#f0eee6';
const PAPER = '#faf9f5';
const SUNK = '#e8e4da';
const OAT = '#e3dacc';
const INK = '#141413';
const MUTED = '#5e5d59';
const HAIRLINE = '#e0dbcf';
const CLAY = '#d4704f';
const CLAY_HOVER = '#df8667';
const CLAY_EDGE = '#a8482a';
const CLAY_TEXT = '#a8482a';
/** Text on clay: white fails contrast. */
const PILLAR_INK = '#1c0f08';
const SANS = "'Hanken Grotesk',Helvetica,Arial,sans-serif";
const SERIF = "'Source Serif 4',Georgia,'Times New Roman',serif";
/** The mark on its ivory tile, drawn by brand/make_icons.mjs and served by the dashboard. */
const LOGO_URL = 'https://dashboard.4vd.app/email-logo.png';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Layout {
  t: ServerMessages;
  /** Also the headline at the top of the card. */
  subject: string;
  /** Short paragraphs, already escaped. The first one is also the inbox preview. */
  paragraphs: string[];
  /** The gist in one line on an Oat panel, already escaped. */
  summary?: string;
  /** Headed lists with one row per line (the report). Escaped here. */
  sections?: Array<{ heading: string; lines: string[] }>;
  button?: { label: string; link: string };
  /** Small print in the card's footer strip, already escaped. */
  note?: string;
}

const paragraph = (html: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${html}</p>`;

function renderSections(sections: NonNullable<Layout['sections']>): string {
  const row = (line: string) =>
    `<tr><td style="padding:8px 0;border-top:1px solid ${HAIRLINE};font-family:${SANS};font-size:15px;line-height:22px;color:${INK};font-variant-numeric:tabular-nums">${escapeHtml(line)}</td></tr>`;
  return sections
    .map(
      (section) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
<tr><td style="padding:0 0 6px;font-family:${SANS};font-size:17px;line-height:24px;font-weight:600;color:${INK}">${escapeHtml(section.heading)}</td></tr>
${section.lines.map(row).join('')}
</table>`,
    )
    .join('');
}

/** A clay key standing on its edge, like the dashboard's buttons. Outlook gets the flat clay face. */
function renderButton(t: ServerMessages, button: NonNullable<Layout['button']>): string {
  const link = escapeHtml(button.link);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>
<td style="border-radius:10px;background-color:${CLAY};background-image:linear-gradient(${CLAY_HOVER},${CLAY} 60%);border-bottom:2px solid ${CLAY_EDGE};box-shadow:0 2px 6px rgba(20,20,19,0.1)">
<a href="${link}" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:600;color:${PILLAR_INK};text-decoration:none;border-radius:10px">${escapeHtml(button.label)}</a>
</td></tr></table>
<p style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(t.email.pasteLink)}<br><a href="${link}" style="color:${CLAY_TEXT};word-break:break-all">${link}</a></p>`;
}

/**
 * The 4VD letter: logo and name on the ivory canvas, a raised paper card with
 * a serif headline, the clay key, and the small print in a sunk strip.
 */
function render({ t, subject, paragraphs, summary, sections, button, note }: Layout): string {
  const preview = (paragraphs[0] ?? '').replace(/<[^>]+>/g, '');
  const panel = summary
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="padding:14px 16px;border-radius:12px;background:${OAT};font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:${INK}">${summary}</td></tr></table>`
    : '';
  const strip = note
    ? `<tr><td class="pad" style="padding:16px 32px;background:${SUNK};border-top:1px solid ${HAIRLINE};border-radius:0 0 15px 15px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${note}</td></tr>`
    : '';
  return `<!doctype html><html lang="${t.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(subject)}</title>
<style>@media (max-width:480px){.pad{padding-left:20px!important;padding-right:20px!important}.headline{font-size:24px!important;line-height:30px!important}}</style></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS}"><tr><td align="center" style="padding:32px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="${LOGO_URL}" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px"></td>
<td style="vertical-align:middle;padding-left:12px;font-family:${SANS};font-size:24px;line-height:28px;font-weight:700;letter-spacing:-0.8px;color:${INK}">4VD</td>
</tr></table></td></tr>
<tr><td style="background:${PAPER};border:1px solid ${HAIRLINE};border-bottom:2px solid ${OAT};border-radius:16px;box-shadow:0 1px 2px rgba(20,20,19,0.06),0 4px 14px rgba(20,20,19,0.06)">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="pad" style="padding:32px 32px 28px">
<h1 class="headline" style="margin:0 0 20px;font-family:${SERIF};font-size:28px;line-height:34px;font-weight:500;letter-spacing:-0.3px;font-variant-numeric:lining-nums;color:${INK}">${escapeHtml(subject)}</h1>
${paragraphs.map(paragraph).join('')}${panel}${sections ? renderSections(sections) : ''}${button ? renderButton(t, button) : ''}
</td></tr>${strip}
</table></td></tr>
<tr><td style="padding:20px 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED}">${escapeHtml(t.email.footer)}<br><a href="https://4vd.app" style="color:${MUTED}">4vd.app</a></td></tr>
</table></td></tr></table></body></html>`;
}

function plain(lines: Array<string | undefined>): string {
  return `${lines.filter((line) => line !== undefined).join('\n\n')}\n\n-- \n4VD`;
}

export const emailTemplates = {
  invite(input: { shopName: string; inviterName: string; role: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.inviteSubject({ inviter: input.inviterName, shop: input.shopName });
    const role = t.roleName[input.role] ?? input.role;
    return {
      subject,
      html: render({
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
      }),
      text: plain([
        t.email.inviteBody({ inviter: input.inviterName, shop: input.shopName, role }),
        `${t.email.inviteButton}: ${input.link}`,
        t.email.inviteNoteShort,
      ]),
    };
  },

  verifyEmail(input: { name: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.verifySubject;
    return {
      subject,
      html: render({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.verifyBody)],
        button: { label: t.email.verifyButton, link: input.link },
        note: escapeHtml(t.email.expires24h),
      }),
      text: plain([t.email.greeting(input.name), `${t.email.verifyButton}: ${input.link}`, t.email.expires24h]),
    };
  },

  resetPassword(input: { name: string; link: string }, t: ServerMessages = en): EmailContent {
    const subject = t.email.resetSubject;
    return {
      subject,
      html: render({
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
      html: render({
        t,
        subject,
        paragraphs: [escapeHtml(t.email.greeting(input.name)), escapeHtml(t.email.confirmBody)],
        button: { label: t.email.confirmButton, link: input.link },
        note: escapeHtml(t.email.confirmNote),
      }),
      text: plain([t.email.greeting(input.name), `${t.email.confirmButton}: ${input.link}`, t.email.expires24h]),
    };
  },

  /** The daily or weekly report: every chosen section as a short list, and a link to the full page. */
  report(
    input: { name: string; subject: string; intro: string; summary: string; sections: Array<{ heading: string; lines: string[] }>; link: string },
    t: ServerMessages = en,
  ): EmailContent {
    return {
      subject: input.subject,
      html: render({
        t,
        subject: input.subject,
        paragraphs: [escapeHtml(input.intro)],
        summary: escapeHtml(input.summary),
        sections: input.sections,
        button: { label: t.report.emailButton, link: input.link },
        note: escapeHtml(t.report.emailNote),
      }),
      text: plain([
        input.intro,
        input.summary,
        ...input.sections.map((section) => `${section.heading}\n${section.lines.join('\n')}`),
        `${t.report.emailButton}: ${input.link}`,
        t.report.emailNote,
      ]),
    };
  },

  errorAlert(input: { name: string; count: number; items: Array<{ what: string; count: number }> }, t: ServerMessages = en): EmailContent {
    const subject = t.email.errorSubject(input.count);
    const intro = t.email.errorIntro({ name: input.name, count: input.count });
    const items = input.items.map((item) => t.email.errorItem(item));
    return {
      subject,
      html: render({
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
      html: render({
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
