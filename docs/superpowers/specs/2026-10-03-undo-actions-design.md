# Undo People's Actions: Design

**Date:** 2026-10-03 · **Status:** for review

## Why

Employees make mistakes: a sale typed as 5 instead of 3, a damage report on the wrong product. The person running the shop needs to open that employee's log, see what they did, and undo the wrong entry so stock and money are right again, without losing the history of what happened.

## What the user asked for (agreed in conversation)

- For **each person**, a log of what they did, where a mistaken action can be **undone**.
- Undo works by **adding a correcting entry** (approach A): nothing is deleted, the original stays visible but crossed out, and an undo can itself be **restored**.
- **Hierarchy:** the Developer can undo anyone's actions (employees, admins, the owner, and their own). The Owner and Admins can undo **employees'** actions and **their own**. Employees and Family can't undo anything.
- **A confirmation before every Undo and Restore**, showing exactly what will change.
- It must look good, in the dashboard's existing Cloudflare-style look.

## What can be undone

| Logged action | Undo | Restore |
|---|---|---|
| Sale recorded | Units go back into stock. The sale drops out of every money total **for the day it was made** (a wrong sale never happened). | The sale counts again and the units leave stock (needs enough stock). |
| Return approved | The refund leaves the totals. A resellable return's units are taken back out of stock; a damaged return's write-off is undone with it. | Applies the return again. |
| Damage or loss approved (write-off) | Units go back into stock and the loss leaves the reports. | Removes the units again (needs enough stock). |
| Count correction approved (one line) | The stock correction is reversed. | Applies the correction again. |
| Stock added or removed by hand | The opposite change is applied. | Applies the change again. |

**Not undoable:** requests still waiting (reject them, as today); product, price, category, promotion and settings edits (edit them back; the log shows the old value); sign-ins, profile changes, invites.

## Rules

- **Who may undo what** is decided by the roles of the person undoing and the person who did the action (see the hierarchy above). The server enforces it; the dashboard only shows Undo where it's allowed.
- **Linked entries:** a sale with an approved or pending return can't be undone; the message says "Undo the return first". A damaged return's write-off is undone and restored together with its return, never on its own.
- **Stock can't go negative:** an undo or restore that would take stock below zero is refused with "Only N left in stock".
- **Twice is harmless:** undoing something already undone (double click, two people at once) is refused with "This was already undone by …", and the same goes for restore.
- **Optional reason:** a short note ("typed 5 instead of 3"), shown on the crossed-out entry and sent to the person.
- **The person is told:** an alert (and push) in their own language, "Your sale of 5 × Lamp was undone: typed 5 instead of 3". It also appears under "Your requests" on the team app's Home.
- **Everything is logged:** every undo and restore is an activity entry ("Undone by Labi").

## Where it lives and how it looks

**People page:** each person gets an **Activity** link that opens `People › <name>` (`/people/:id`):

- **Header:** avatar, name, role. A summary strip shows today's sales total and count for this person, and how many of their entries are undone.
- **Timeline grouped by day** (Today, Yesterday, then dates), newest first. Each entry shows a small coloured marker by kind (sales orange, stock steel, damage amber, returns teal, sign-ins dimmed), the time, a plain sentence ("Sale · 2 × Oak Chair"), the amount, and an action on the right.
- **Undo** is a quiet button, shown only when allowed. Clicking it opens an **inline confirmation**, not a browser pop-up. It states the effect ("+2 Oak Chair back in stock · −€178.00 from 3 October"), offers an optional reason, and has a clear **Undo sale** button and **Cancel**. **Restore** works the same way.
- **Undone entries** stay in place, struck through, with an "Undone by Labi · 14:32" stamp, the reason, and **Restore**.
- **Filters:** kind of action (Everything, Sales, Stock, Damage, Returns, Counts) and period (Today, 7 days, 30 days).
- **States:** loading, empty ("Nothing yet"), error with retry, a busy state while undoing, and the inline error when the server refuses.
- The main **Activity** page uses the same timeline and the same Undo/Restore controls.
- In English and Albanian, like the rest of the dashboard.

## How it works (technical)

**Data.** Migration 010 adds to `sales`, `returns`, `write_offs`, `stock_count_lines` and `stock_adjustments` (manual ones): `undone_at TIMESTAMPTZ NULL`, `undone_by INT NULL REFERENCES users(id)`, `undo_note TEXT NULL`. Restore clears them and records a new activity entry. The `sales_ledger` view leaves out undone sales and undone returns, so every money report (overview, reports, team, daily summary, weekly email, exports, the AI's numbers) agrees automatically. Loss totals leave out undone write-offs.

**Stock.** Undo and restore change stock through the existing `applyStockChange`, with new system reasons `Undo` and `Restore` and a note pointing at the original entry ("Undo of sale #12"). The stock history therefore explains every change, and low-stock alerts keep working.

**Server.** An `UndoService` with one function per kind (`undoSale`, `undoReturn`, `undoWriteOff`, `undoCountLine`, `undoStockAdjustment`, and matching restores). Each runs in one transaction, locks the row, checks permission, linked entries and stock, applies the change, logs it and notifies the person. Endpoints (overseers only):
- `POST /api/undo/:kind/:id` with `{ note? }`
- `POST /api/undo/:kind/:id/restore`
- Activity entries returned by `GET /api/activity?userId=` gain `undo: { kind, id, state: 'undoable' | 'undone' | 'locked', undoneBy?, undoneAt?, note?, effect }`. `effect` is the plain-language preview for the confirmation; `locked` comes with the reason ("Undo the return first").

**Permission rule** (one function, unit-tested): `canUndo(actor, owner)`. The Developer may undo anyone. The Owner and Admins may undo employees and themselves. Nobody else may undo anything.

**Dashboard.** A new `PersonActivityPage` at `/people/:id`, plus a shared `ActivityTimeline` and `UndoConfirm`, built from the existing component kit and tokens and used on the main Activity page too. All text goes into the en/sq catalogues.

**Team app.** "Your requests" on Home lists undone sales and write-offs with the reason. Alert texts come from the server catalogue (en/sq).

## Testing

- Backend: for each kind, undo then restore. Check stock, the sales ledger totals and the activity log, plus the refusals: permissions by role pair, linked return, not enough stock, already undone (repeat request), and wrong kind or id.
- Reports agree after an undo: the overview totals, team report and daily summary drop the undone sale on its original day.
- Dashboard: unit tests for the permission helper and the effect wording. The hard-coded-text guard covers the new screens. Then a visual check at 375px and 1440px, plus the accessibility audit (CLAUDE.md), once the feature is finished.

## Out of scope (for now)

- Undoing product, price, promotion or settings edits.
- Bulk "undo everything this person did".
- Emails about undos (emails come later with the 4vd.app address).
