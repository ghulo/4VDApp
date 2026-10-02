import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailService } from '../src/services/email/EmailService.js';
import type { EmailSender, OutgoingEmail } from '../src/services/email/senders.js';
import { emailTemplates } from '../src/services/email/templates.js';
import { EmailOutboxRepository } from '../src/repositories/EmailOutboxRepository.js';
import { resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Records sends; throws while `failing` is set. */
function fakeSender() {
  const sender = {
    sent: [] as OutgoingEmail[],
    failing: false,
    async send(email: OutgoingEmail) {
      if (sender.failing) throw new Error('mail server down');
      sender.sent.push(email);
    },
  };
  return sender satisfies EmailSender & Record<string, unknown>;
}

let context: TestContext;
const sender = fakeSender();
let emails: EmailService;

beforeAll(async () => {
  context = await setupTestApp();
  emails = new EmailService(new EmailOutboxRepository(context.db), sender);
});
beforeEach(async () => {
  await resetData(context.db);
  sender.sent.length = 0;
  sender.failing = false;
});
afterAll(() => context.db.destroy());

const invite = () =>
  emailTemplates.invite({ shopName: '4VD', inviterName: 'Labi', role: 'employee', link: 'https://app.test/invite/abc' });

describe('email outbox', () => {
  it('should send a queued email once', async () => {
    await emails.queue('ana@example.com', invite());

    const first = await emails.sendPending();
    const second = await emails.sendPending();

    expect([first, second]).toEqual([1, 0]);
    expect(sender.sent).toEqual([expect.objectContaining({ to: 'ana@example.com', subject: expect.stringContaining('4VD') })]);
  });

  it('should keep trying a failing email, then give up after five tries', async () => {
    await emails.queue('ana@example.com', invite());
    sender.failing = true;

    for (let attempt = 0; attempt < 6; attempt++) await emails.sendPending();
    const row = await context.db.selectFrom('email_outbox').selectAll().executeTakeFirstOrThrow();
    sender.failing = false;
    await emails.sendPending();

    expect(row.attempts).toBe(5);
    expect(row.last_error).toContain('mail server down');
    expect(sender.sent).toHaveLength(0);
  });
});

describe('email templates', () => {
  it('should carry the link in both the HTML and the plain text', () => {
    const email = invite();

    expect(email.html).toContain('https://app.test/invite/abc');
    expect(email.text).toContain('https://app.test/invite/abc');
  });

  it('should escape names so they cannot inject HTML', () => {
    const email = emailTemplates.invite({
      shopName: '<b>Shop</b>',
      inviterName: '<script>x</script>',
      role: 'employee',
      link: 'https://app.test/invite/abc',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
