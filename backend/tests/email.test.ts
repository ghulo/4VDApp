import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailService } from '../src/services/email/EmailService.js';
import type { EmailSender, OutgoingEmail } from '../src/services/email/senders.js';
import { emailBrandOf, emailTemplates, setEmailMediaBase } from '../src/services/email/templates.js';
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
  it("should show a customer business's own name, initials key and colour, with 4VD only in the small print", () => {
    const brand = emailBrandOf({ house: false, name: 'Kafe <D>', colour: '#0f766e', greys: 'tinted', logoUrl: null, initials: 'KD', accent: null, gradient: false });
    const email = emailTemplates.invite({ shopName: 'Kafe <D>', inviterName: 'Arta', role: 'employee', link: 'https://app.test/invite/abc', brand });

    expect(email.html).toContain('Kafe &lt;D&gt;');
    expect(email.html).toContain('>KD</td>');
    expect(email.html).toContain('background-color:#0f766e');
    expect(email.html).toContain('Runs on 4VD');
    expect(email.html).not.toContain('email-logo.png');
    expect(email.text).toContain('Kafe <D> (4VD)');
  });

  it('should ask for a PNG logo by its full address, and keep the initials when the API has no outside address', () => {
    const look = { house: false, name: 'Kafe D', colour: '#0f766e', greys: 'plain', logoUrl: '/api/media/abc', initials: 'KD', accent: null, gradient: false } as const;
    setEmailMediaBase('https://api.test/');
    expect(emailBrandOf(look)?.logoSrc).toBe('https://api.test/api/media/abc?format=png');
    setEmailMediaBase(undefined);
    expect(emailBrandOf(look)?.logoSrc).toBeNull();
  });

  it("should keep 4VD's own look for 4VD's own business", () => {
    expect(emailBrandOf({ house: true, name: '4VD', colour: '#f5b71a', greys: 'plain', logoUrl: null, initials: '4V', accent: null, gradient: false })).toBeUndefined();
  });

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

  it('should lay the report out as rows with stamps, escaping names, with the same rows in the text part', () => {
    const email = emailTemplates.report({
      subject: 'Daily report',
      headline: 'Daily report',
      period: '11 Oct',
      intro: 'Hi',
      summary: '1 bill overdue',
      blocks: [{ heading: 'Supplier bills', rows: [{ label: '<b>Elkos</b>', value: '€600.00', stamp: { text: 'Overdue', tone: 'danger' } }] }],
      link: 'https://app.test/report',
    });

    expect(email.html).not.toContain('<b>Elkos</b>');
    expect(email.html).toContain('&lt;b&gt;Elkos&lt;/b&gt;');
    expect(email.html).toContain('s-danger');
    expect(email.html).toContain('prefers-color-scheme:dark');
    expect(email.text).toContain('[Overdue] <b>Elkos</b>: €600.00');
  });
});
