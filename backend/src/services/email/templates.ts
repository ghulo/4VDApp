/**
 * Account emails. Each has an HTML part (simple tables and inline styles, the
 * only thing every email app renders the same) and a plain-text part.
 * Anything a person typed is escaped before it goes into the HTML.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#1D5C45';
const INK = '#122019';
const MUTED = '#55665D';

const ROLE_NAMES: Record<string, string> = { admin: 'an admin', employee: 'an employee', family: 'a family member' };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Layout {
  subject: string;
  /** Short paragraphs, already escaped. */
  paragraphs: string[];
  button?: { label: string; link: string };
  /** Small print under the button, already escaped. */
  note?: string;
}

function render({ subject, paragraphs, button, note }: Layout): string {
  const body = paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${INK}">${paragraph}</p>`)
    .join('');
  const action = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${BRAND}">
        <a href="${escapeHtml(button.link)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${MUTED}">Or paste this link into your browser:<br><a href="${escapeHtml(button.link)}" style="color:${BRAND};word-break:break-all">${escapeHtml(button.link)}</a></p>`
    : '';
  const small = note ? `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">${note}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F5F2;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 0 16px"><span style="display:inline-block;padding:6px 12px;border-radius:8px;background:${BRAND};color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.5px">4VD</span></td></tr>
<tr><td style="background:#ffffff;border-radius:14px;padding:32px 28px;border:1px solid #D9E0DA">${body}${action}${small}</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${MUTED}">You're getting this because of your 4VD account.</td></tr>
</table></td></tr></table></body></html>`;
}

function plain(lines: Array<string | undefined>): string {
  return `${lines.filter((line) => line !== undefined).join('\n\n')}\n\n-- \n4VD`;
}

export const emailTemplates = {
  invite(input: { shopName: string; inviterName: string; role: string; link: string }): EmailContent {
    const subject = `${input.inviterName} invited you to ${input.shopName} on 4VD`;
    const role = ROLE_NAMES[input.role] ?? input.role;
    return {
      subject,
      html: render({
        subject,
        paragraphs: [
          `${escapeHtml(input.inviterName)} has invited you to join <strong>${escapeHtml(input.shopName)}</strong> on 4VD as ${escapeHtml(role)}.`,
          'Choose your password (or use Google) to set up your account.',
        ],
        button: { label: 'Accept the invite', link: input.link },
        note: 'This link works once and expires in 7 days. If you weren’t expecting it, you can ignore this email.',
      }),
      text: plain([
        `${input.inviterName} has invited you to join ${input.shopName} on 4VD as ${role}.`,
        `Accept the invite: ${input.link}`,
        'This link works once and expires in 7 days.',
      ]),
    };
  },

  verifyEmail(input: { name: string; link: string }): EmailContent {
    const subject = 'Confirm your email for 4VD';
    return {
      subject,
      html: render({
        subject,
        paragraphs: [`Hi ${escapeHtml(input.name)},`, 'Please confirm this is your email address.'],
        button: { label: 'Confirm my email', link: input.link },
        note: 'This link expires in 24 hours.',
      }),
      text: plain([`Hi ${input.name},`, `Confirm your email: ${input.link}`, 'This link expires in 24 hours.']),
    };
  },

  resetPassword(input: { name: string; link: string }): EmailContent {
    const subject = 'Reset your 4VD password';
    return {
      subject,
      html: render({
        subject,
        paragraphs: [`Hi ${escapeHtml(input.name)},`, 'Someone asked to reset the password for your 4VD account. If it was you, choose a new one here.'],
        button: { label: 'Choose a new password', link: input.link },
        note: 'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email; your password stays the same.',
      }),
      text: plain([
        `Hi ${input.name},`,
        `Choose a new password: ${input.link}`,
        'This link works once and expires in 1 hour. If you didn’t ask for this, ignore this email.',
      ]),
    };
  },

  confirmNewEmail(input: { name: string; link: string }): EmailContent {
    const subject = 'Confirm your new email for 4VD';
    return {
      subject,
      html: render({
        subject,
        paragraphs: [`Hi ${escapeHtml(input.name)},`, 'Confirm this address to start using it to log in to 4VD.'],
        button: { label: 'Use this email', link: input.link },
        note: 'This link expires in 24 hours. Until then you keep logging in with your old email.',
      }),
      text: plain([`Hi ${input.name},`, `Use this email for 4VD: ${input.link}`, 'This link expires in 24 hours.']),
    };
  },

  emailChanged(input: { name: string; newEmail: string }): EmailContent {
    const subject = 'Your 4VD email was changed';
    return {
      subject,
      html: render({
        subject,
        paragraphs: [
          `Hi ${escapeHtml(input.name)},`,
          `Your 4VD account now logs in with <strong>${escapeHtml(input.newEmail)}</strong>, and this address won't be used any more.`,
          'If you didn’t do this, tell the shop owner straight away.',
        ],
      }),
      text: plain([
        `Hi ${input.name},`,
        `Your 4VD account now logs in with ${input.newEmail}.`,
        'If you didn’t do this, tell the shop owner straight away.',
      ]),
    };
  },
};
