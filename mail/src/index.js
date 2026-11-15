import PostalMime from 'postal-mime';
import { checkSender } from './auth.js';
import { billFiles } from './files.js';

/**
 * bills@4vd.app: a supplier bill forwarded here is passed to the 4VD API, which
 * checks the sender is on the team or on the list in Settings and reads it into
 * a bill scan that waits in To do. Mail that fails SPF and DKIM for its From
 * domain is dropped here without a word, so nobody can pose as a team member.
 */
export default {
  async email(message, env) {
    const header = (name) => message.headers.get(name);
    const parsed = await PostalMime.parse(message.raw, { attachmentEncoding: 'arraybuffer' });
    const from = parsed.from?.address?.toLowerCase() ?? '';

    const headers = parsed.headers ?? [];
    const sender = checkSender(headers, from, message.from);
    // Shown in `npx wrangler tail`, top first: whether Cloudflare's own results sit above any the sender wrote.
    const auth = headers.filter((h) => /authentication-results|received-spf/i.test(h.key)).map((h) => `${h.key}: ${h.value}`);
    if (!sender.ok) {
      console.log('dropped', { from, envelope: message.from, why: sender.why, auth });
      return;
    }

    const files = billFiles(parsed.attachments ?? []);
    const response = await fetch(`${env.API_URL}/api/internal/bill-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bill-email-token': env.BILL_EMAIL_TOKEN },
      body: JSON.stringify({
        messageId: parsed.messageId ?? header('message-id') ?? `${from}:${parsed.date ?? Date.now()}`,
        from,
        subject: parsed.subject?.slice(0, 500) ?? null,
        files,
      }),
    });
    console.log('passed on', { from, via: sender.why, files: files.length, status: response.status, auth });
    // The sender hears back only when 4VD couldn't take it, so they know to send it again.
    if (!response.ok) message.setReject('4VD could not take this bill just now. Please send it again in a few minutes.');
  },
};
