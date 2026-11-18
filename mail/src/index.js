import PostalMime from 'postal-mime';
import { checkSender } from './auth.js';
import { billFiles } from './files.js';
import { rejectReason } from './reply.js';

/**
 * bills@4vd.app (and bills+<short>@4vd.app, one per business): a supplier bill
 * forwarded here is passed to the 4VD API, which picks the business from the
 * address, checks the sender works there or is on its list in Settings, and
 * reads it into a bill scan that waits in To do. Mail that fails SPF and DKIM for its From
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
        // The address it came to: the part after the + names the business.
        to: message.to,
        subject: parsed.subject?.slice(0, 500) ?? null,
        files,
      }),
    });
    console.log('passed on', { from, to: message.to, via: sender.why, files: files.length, status: response.status, auth });
    // The sender hears back only when 4VD couldn't take it, so they know to send it again (or fix the address).
    if (!response.ok) message.setReject(await rejectReason(response));
  },
};
