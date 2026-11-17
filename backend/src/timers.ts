import type { Container } from './container.js';
import { defaultBusinessId, forEachBusiness } from './database/business.js';
import { runAsBusiness } from './database/businessContext.js';
import type { DatabaseClient } from './database/connection.js';
import { logger } from './utils/logger.js';

/**
 * What the server runs once a minute. Every piece works inside a business:
 * row security shows work outside one no rows and refuses its writes.
 */
export async function minuteJobs(db: DatabaseClient, container: Container): Promise<void> {
  // Alerts go to whoever holds a power in each business's own roles grid.
  await container.permissionService.ensureLoaded().catch((error) => logger.error('Reading the roles grids failed', { error: String(error) }));
  // The error alert goes to 4VD's own developers, and remembers its last hour in the 4VD shop's settings.
  const alert = defaultBusinessId(db)
    .then((shop) => runAsBusiness(shop, () => container.errorAlertService.sendIfDue()))
    // Logged as a warning on purpose: as an error it would be counted again and retried forever.
    .catch((error) => logger.warn('Sending the error alert failed', { error: String(error) }));
  // Everything else runs once per business, inside that business.
  const perBusiness = forEachBusiness(db, async () => {
    const report = container.reportDeliveryService
      .sendDue()
      .catch((error) => logger.error('Sending the reports failed', { error: String(error) }));
    const expenses = container.expenseService
      .fillDue()
      .catch((error) => logger.error('Adding the monthly expenses failed', { error: String(error) }));
    const dayClosed = container.dayClosedAlert
      .sendIfClosed()
      .catch((error) => logger.error('Sending the day closed alert failed', { error: String(error) }));
    // The books post on every read too; this keeps them current when nobody is looking.
    const books = container.booksService.poster
      .sync()
      .catch((error) => logger.error('Posting to the books failed', { error: String(error) }));
    // Emailed bills left waiting (the day's reads used up, or a restart) are read when there's room.
    container.billEmailService.kick();
    const bin = container.attachmentService.purge().catch((error) => logger.error('Emptying the recycle bin failed', { error: String(error) }));
    await Promise.all([report, expenses, dayClosed, books, bin]);
  }).catch((error) => logger.error('Running the business timers failed', { error: String(error) }));
  await Promise.all([alert, perBusiness]);
}

/** What the server runs every few seconds: push alerts per business, then the shared email outbox (it belongs to no business). */
export async function pushJobs(db: DatabaseClient, container: Container): Promise<void> {
  await container.permissionService.ensureLoaded().catch((error) => logger.error('Reading the roles grids failed', { error: String(error) }));
  await Promise.all([
    forEachBusiness(db, () => container.pushService.sendPending()).catch((error) => logger.error('Sending push alerts failed', { error: String(error) })),
    container.emailService.sendPending().catch((error) => logger.error('Sending emails failed', { error: String(error) })),
  ]);
}
