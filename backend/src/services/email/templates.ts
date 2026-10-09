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

const BRAND = '#C2410C';
const INK = '#1F1B19';
const MUTED = '#6B635F';

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
  subject: string;
  /** Short paragraphs, already escaped. */
  paragraphs: string[];
  button?: { label: string; link: string };
  /** Small print under the button, already escaped. */
  note?: string;
}

function render({ t, subject, paragraphs, button, note }: Layout): string {
  const body = paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${INK}">${paragraph}</p>`)
    .join('');
  const action = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${BRAND}">
        <a href="${escapeHtml(button.link)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(t.email.pasteLink)}<br><a href="${escapeHtml(button.link)}" style="color:${BRAND};word-break:break-all">${escapeHtml(button.link)}</a></p>`
    : '';
  const small = note ? `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">${note}</p>` : '';
  return `<!doctype html><html lang="${t.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#FAF9F7;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF9F7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 0 16px"><span style="display:inline-block;padding:6px 12px;border-radius:8px;background:${BRAND};color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.5px">4VD</span></td></tr>
<tr><td style="background:#ffffff;border-radius:14px;padding:32px 28px;border:1px solid #EBE7E3">${body}${action}${small}</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${MUTED}">${escapeHtml(t.email.footer)}</td></tr>
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
    input: { name: string; subject: string; intro: string; sections: Array<{ heading: string; lines: string[] }>; link: string },
    t: ServerMessages = en,
  ): EmailContent {
    return {
      subject: input.subject,
      html: render({
        t,
        subject: input.subject,
        paragraphs: [
          escapeHtml(input.intro),
          ...input.sections.map((section) => `<strong>${escapeHtml(section.heading)}</strong><br>${section.lines.map(escapeHtml).join('<br>')}`),
        ],
        button: { label: t.report.emailButton, link: input.link },
        note: escapeHtml(t.report.emailNote),
      }),
      text: plain([
        input.intro,
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
