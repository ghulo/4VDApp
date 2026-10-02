# Price control and team (roadmap piece 2)

Agreed on 2026-10-01 as the "lean version". Finer permissions are left out.

## Promotions

- A promotion is a percentage off (1–90%) for **one product or one whole category**,
  from a start day to an end day (both included, UTC days like every other date filter).
- The owner can end one early. Ended or finished promotions stay listed for the record.
- When a sale is recorded, the unit price is the **lower** of the bulk-tier price and
  the base price minus the biggest running promotion for that product. Discounts never
  stack. The sale remembers which promotion it used (`sales.promotion_id`).
- Every product the API returns carries `promotion: { id, name, percentOff, endsAt, price } | null`
  so both apps can show "−15% until 7 Oct".

## Minimum margin

- New setting `minimumMarginPercent` (default 0 = never below cost).
- Creating a promotion is refused when the discounted price of any product it covers
  would be below `cost × (1 + minimum margin)`. The error names those products.
  Products without a cost price are not checked.

## Price history

- `GET /api/products/:id/price-history` (admin) lists price and cost changes from the
  activity log: when, who, from, to. Product creation counts as the first entry.

## Team

- Users get two optional fields the owner sets: `monthlyTarget` (euros) and
  `commissionPercent`.
- The team report and its CSV add `monthlyTarget`, `commissionPercent` and `commission`
  (revenue after refunds × percentage) for the chosen period.
- `GET /reports/my-sales` adds `monthlyTarget`, so the mobile Home screen can show a
  progress bar for the current month.
