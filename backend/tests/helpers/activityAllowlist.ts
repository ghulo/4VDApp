/**
 * Endpoints that write to the database but on purpose write no Activity entry (so they are not in History or Undo).
 * tests/activityCoverage.test.ts fails on any other endpoint that writes business rows without activity_log, and on an
 * entry here that no longer needs to be here. Add one only with a reason a reviewer agrees with; a change a person would
 * want to see or undo belongs in History instead (repos.activityLog.create).
 */

const SIGN_IN = 'Sign-in and sessions: about a person, not the business; security events that matter are logged elsewhere (auth.*).';
const OWN_ACCOUNT = 'A person’s own account (password, email, profile, picture, two-step, passkeys, Google link): theirs, not the business’s history.';
const PERSONAL = 'A personal preference or inbox state (alerts, favourites, report emails, the assistant’s chats): not a business change.';
const BOOKS_CATCH_UP = 'A read: the map sees it write because reading the books first posts any waiting entries (BooksPoster.sync), and each posted document was logged when it was made.';
const DRAFT = 'A draft that changes nothing until it is confirmed; the step that applies it is logged (import.done, books.opening_posted, count.submitted / count.line_approved).';
const SEEN = 'A read that marks something as seen.';

export const ACTIVITY_ALLOWLIST: Record<string, string> = {
  'POST /api/auth/two-step/setup/start': SIGN_IN,
  'POST /api/auth/refresh': SIGN_IN,
  'POST /api/auth/logout': SIGN_IN,
  'POST /api/auth/switch': SIGN_IN,
  'POST /api/auth/google': SIGN_IN,
  'POST /api/auth/signup': 'Makes a new business: it has no history yet, and the business row records when and by whom.',
  'POST /api/auth/forgot-password': SIGN_IN,
  'POST /api/auth/reset-password': SIGN_IN,
  'POST /api/auth/resend-verification': SIGN_IN,
  'POST /api/auth/verify-email': SIGN_IN,
  'POST /api/auth/confirm-email-change': SIGN_IN,
  'POST /api/sales/basket/:key/stop': 'Closes a sale key that never recorded a sale; the closure row keeps who closed it and why (sale_key_closures).',
  'PUT /api/notifications/push/preferences': PERSONAL,
  'POST /api/notifications/push/devices': PERSONAL,
  'POST /api/notifications/push/test': PERSONAL,
  'DELETE /api/notifications/push/devices': PERSONAL,
  'POST /api/notifications/read-all': PERSONAL,
  'PATCH /api/notifications/:id/read': PERSONAL,
  'PUT /api/favorites/:productId': PERSONAL,
  'DELETE /api/favorites/:productId': PERSONAL,
  'PUT /api/reports/settings': PERSONAL,
  'POST /api/reports/send-test': PERSONAL,
  'PUT /api/locations/products/:productId': 'A shelf minimum: a reorder hint for one place, like a favourite; it moves no stock and no money.',
  'GET /api/imports': 'A read that marks an import stuck mid-way as failed, so it can be tried again; nothing in the shop changes.',
  'POST /api/imports': DRAFT,
  'GET /api/imports/:id': 'A read that marks an import stuck mid-way as failed, so it can be tried again; nothing in the shop changes.',
  'PUT /api/imports/:id/choices': DRAFT,
  'DELETE /api/imports/:id': DRAFT,
  'GET /api/attention': BOOKS_CATCH_UP,
  'GET /api/books/accounts': BOOKS_CATCH_UP,
  'GET /api/books/accounts/:id/card': BOOKS_CATCH_UP,
  'GET /api/books/trial-balance': BOOKS_CATCH_UP,
  'GET /api/books/journal': BOOKS_CATCH_UP,
  'GET /api/books/entries': BOOKS_CATCH_UP,
  'GET /api/books/entries/:id': BOOKS_CATCH_UP,
  'GET /api/books/trial-balance.xlsx': BOOKS_CATCH_UP,
  'GET /api/books/journal.xlsx': BOOKS_CATCH_UP,
  'GET /api/books/ledger.xlsx': BOOKS_CATCH_UP,
  'GET /api/books/accounts/:id/card.xlsx': BOOKS_CATCH_UP,
  'GET /api/books/year/:year': BOOKS_CATCH_UP,
  'GET /api/books/declaration/:year': BOOKS_CATCH_UP,
  'GET /api/books/declaration/:year/download': BOOKS_CATCH_UP,
  'POST /api/books/opening/lines': DRAFT,
  'PATCH /api/books/opening/lines/:id': DRAFT,
  'DELETE /api/books/opening/lines/:id': DRAFT,
  'POST /api/books/opening/confirm': DRAFT,
  'POST /api/vat/:month/trefin/explain': 'A note on the TREFIN comparison; the note itself keeps who wrote it and when.',
  'POST /api/internal/backup-ok': 'The nightly backup reporting in (no person, no business data).',
  'PUT /api/stock-counts/:id/lines/:productId': DRAFT,
  'POST /api/assistant/chats/messages': PERSONAL,
  'DELETE /api/assistant/chats/:id': PERSONAL,
  'POST /api/invites/:id/resend': 'Sends the same invite again with a new link; the invite was logged when made and is logged if cancelled.',
  'GET /api/portal-admin/orders/:id': SEEN,
  'POST /api/me/password': OWN_ACCOUNT,
  'POST /api/me/email': OWN_ACCOUNT,
  'PUT /api/me/profile': OWN_ACCOUNT,
  'PUT /api/me/avatar': OWN_ACCOUNT,
  'DELETE /api/me/avatar': OWN_ACCOUNT,
  'POST /api/me/two-step/start': OWN_ACCOUNT,
  'PATCH /api/me/passkeys/:id': OWN_ACCOUNT,
  'DELETE /api/me/google': OWN_ACCOUNT,
  'POST /api/me/sessions/log-out-others': SIGN_IN,
  'DELETE /api/me/sessions/:sessionId': SIGN_IN,
  'POST /api/portal/links': 'A customer asking for a sign-in link to the portal.',
  'POST /api/portal/sign-out': SIGN_IN,
  'PUT /api/portal/me/language': 'A portal customer’s own language.',
  'GET /api/portal/orders/:id': SEEN,
};
