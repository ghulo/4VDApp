# 4VD progress

Tasks we agree on in chat. Ticked when done. When everything is ticked, Claude asks whether to add new tasks.
Finished sections are kept in `docs/archive/progress-done.md`.

## Still open from earlier

- [ ] iPhone alerts confirmed working (dashboard alerts, added to the home screen)
- [ ] Link from a product to the supplier you usually buy it from (optional)
- [ ] Run the TREFIN import for real at launch (`npm run import:trefin`)

## Everything TREFIN does, the 4VD way (plan 2026-10-16, from the TREFIN survey)

The survey is in `C:\Users\labid\Downloads\program-survey\program-survey` (SURVEY.md, REPORT.md, screenshots).

**The bar for every step:** copying TREFIN isn't enough. Each feature has to work better than TREFIN's and be easy to understand and use without training:
- Plain words instead of codes. Say "Expense bill", not "FBS". Show an account's name next to its number. Explain each VAT box in one line.
- 4VD fills in what it can: accounts, VAT, due dates and entries. Nobody types an account number for a normal sale or bill.
- Before saving, show what will happen ("This bill adds €120 to stock and €21.60 of VAT you can claim back").
- Check mistakes as you type, and say how to fix them, not just "error".
- Never more than one way to do the same job, and no screen that's only reachable through a menu inside a menu.
- The accountant should find every figure they look for in TREFIN, and the owner should understand every screen.

Rules for every step: one screen with a "type" instead of a menu per case; works on a phone; reuses 4VD's components; every list has the period picker (day, month, quarter TM-1..4, year, custom) and Excel/PDF download; each document shows the accounting entries it made.

**A. Needed to switch TREFIN off** (in this order)
- [x] 0. Survey of TREFIN against 4VD
- [x] 1. Books underneath: TREFIN's 144-account chart brought in as is (editable), each product, supplier, customer, cash and bank linked to its accounts (stock 1340, revenue 4000, cost 5000, payables 2000, VAT 1260/2340), and every sale, return, bill, payment, expense, write-off and count writes its own entry. Manual journal (FK), account card, trial balance, general ledger, journal. Done 2026-10-16 (Books in the menu: Balances, Entries, Accounts, each account's card, entries on bills, invoices and counts). The links are shop-wide for now (one account per kind of movement, changeable in Settings → Books); accounts per product or partner come with step 10
- [x] 2. Every kind of supplier bill, with no type menu (agreed 2026-10-16, done 2026-10-17: Add a bill opens `/bills/new`, and "Return or credit" sits on each bill; ideas from Xero, Odoo, Dext and QuickBooks; TREFIN's codes never shown). One bill form, and 4VD works out the kind of bill:
  - Each line is a product (into stock), a cost with a plain category (rent, power, transport…) or equipment, and one bill can mix them.
  - The supplier remembers its usual category, VAT and tax held back.
  - A supplier marked "abroad" gets import VAT or self-charged VAT by itself.
  - Imports: customs VAT and duty typed once from the customs paper, with duty and transport spread onto product costs.
  - "Return or credit" starts from the bill and pre-fills its lines.
  - Tax held back: the 7 ATK types in plain words, suggested from the supplier, taken off what's owed, booked to 2370.
  - A sentence before saving says what will happen.
  - A bill is "pay later", an expense is "paid now", one record underneath; the Expenses page keeps working.
  - Supplier price alerts: when a bill raises a product's cost, show the margin drop and suggest a new shelf price.
  - Repeating bills (rent, internet, power) made each month by themselves.
  (TREFIN mapping for tests: FBM, FBS, FBI, IMM/IMS/IMI, NGK, NDI, return, WR on 2370.)
- [x] 3. ATK books and VAT: sales book and purchase book with the VAT-form box columns (till sales as one line per day), the monthly VAT return boxes 9-72 with carry-forward (68) and refunds, VAT 16% and exempt rates added, monthly withholding (WR) list, purchases over €500; an accountant login that can lock a finished month and leave questions on a document
  - Books → VAT (month picker, boxes 9-72 with their numbers and a line of words each, click a line for its documents, box 68 from last month, refunds typed in), Sales book and Purchase book (empty columns hidden, Excel, PDF, "For EDI upload"), checks before filing, "Mark as filed" locks the month on the server, late supplier bills count in the next open month, reopening needs a reason (in Activity).
  - The accountant role: reads the money side, files and reopens months, asks questions on bills, invoices and entries that land in To do. 16% and Exempt wherever a rate is chosen; tax held back per month; the year at a glance; "<Month> VAT is due by 20 <next month>" in To do.
- [x] 4. Cash and bank: cash till and bank accounts, deposits and withdrawals, paying several supplier bills at once ("spread the amount"), customer receipts against invoices, cash and bank card and day book; upload the bank's statement file and let 4VD match each line to its bill or invoice (Kosovo banks have no open connection yet)
  - Money (`/money`): every till, safe and bank account as a tile with its balance, each with its own account in the books; a place opens its book with a running balance, totals and Excel. "Move money" covers till to bank, bank to safe and the owner putting money in or taking it out, with a sentence saying what will happen; filed months stay locked.
  - "Pay bills" on a supplier spreads one amount over the oldest bills first; a customer's payment picks where the money went and which invoices it pays; any bill payment picks the place it came from.
  - Bank statement: upload Excel, CSV or PDF (PDF read by Claude), columns found by themselves or asked once per account, duplicates skipped; each line gets suggestions with reasons (bills, invoices, till deposits, moves); confirm one or all sure ones, or make it an expense, a move or the owner's, with an optional rule; leave out, take back; the bank's balance beside 4VD's. Still to check against a real Kosovo bank statement.
- [x] 5. Counter: barcode scanner selling, several receipts open at once, GEKOS fiscal printer (receipts, X and Z reports, sending the item list to the printer), receipt footer text; cashier patterns (voids, refunds and drawer opens without a sale, per person)
- [x] 7.5. One app: every team app feature works as well in the dashboard (employees get a phone-style 4VD: Home, Products, Sell, Account; camera scanning; return a sale, new product request, end shift, my sales, favourites; add to home screen as 4VD). Done 2026-10-19; the team app was switched off on 2026-10-20
- [x] 6. Moving over: opening balances, open bills and invoices and stock from TREFIN on the launch date; then run 4VD next to TREFIN for one VAT month and check the books and VAT return line by line
  - [x] Opening balances (Books → Opening balances): every line pre-filled from TREFIN, a count or the bank statement, its source shown, confirmed one by one, then posted; open supplier bills and customer balances brought over (`npm run opening:trefin`); launch checklist steps for both
  - [x] Run one VAT month next to TREFIN and compare the books and VAT return line by line (Books → Next to TREFIN + `npm run compare:trefin`; the real month is run with the accountant after the first month on 4VD)

**B. Used, or needed soon**
- [x] 7. Financial statements: balance sheet, income statement, changes in equity, cash flow; year close and carry-over; quarterly tax instalments (TM)
  - Books → Statements: the four statements for any period, read "For you" (plain words, big figures that open their accounts), "Official" (account numbers, another period beside) or "For the bank" (by group, printed with the business details and signature lines); Excel and PDF; a balanced check
  - Books → Year: profit tax (10%, 4VD sh.p.k.) by quarter with its deadline, Mark as paid from a till, the safe or a bank account, a To do while one is due; Close the year (profit tax 8900/2350, everything into 3400 on 31 Dec, the year locked), reopen with a reason. Each TM follows Law 06/L-105: a quarter of 110% of last year's profit tax (from the year closed in 4VD, or typed from the annual return); in a first year or after a loss, the tax on this year's profit so far minus what earlier quarters asked. Profit made in TREFIN before the books start is typed once and counts for the year's tax; the rest is paid with the annual return by 31 March; the year closes into 3400 (IFRS for SMEs); cash flow stays direct
- [ ] 8. Sales documents: invoice types (goods, services, export, fixed-asset sale), pro-forma and offer, delivery note, credit note, return; agent, carrier and payment terms on invoices; customer balances and late payments
- [ ] 9. Products and prices: wholesale and retail price each with its margin, price calculation from cost, price import from Excel, price lists, extra barcodes with pack size and pack price, units (kg and so on), stock in and out documents
- [ ] 10. Customers and suppliers as one "partner": fiscal and VAT number, several addresses, discount and bonus %, credit limit, bank account, look-up in the ATK register
- [ ] 11. Settings and safety: company details with logo, stamp and signature on invoices, numbering like FSM-26-000001, decimals, negative stock on/off; recycle bin for deleted documents; attachments on any document

**D. Better than anything in Kosovo** (from tills and accounting programs abroad, agreed 2026-10-16; there's no rush to switch TREFIN off, its subscription runs a couple more months)
- [ ] 18. Bills by email: forward a supplier's PDF to the shop's bill address and it's filled in by itself (right after step 2; bill photos are read already)
- [ ] 19. Short-dated stock: best-before dates, and automatic discounts a few days before expiry
- [ ] 20. Cash forecast: what the shop will have in 30 days, from bills due and normal takings
- [ ] 21. All four businesses in one view, each with its own books
- [ ] 22. Digital receipts by SMS or Viber, and loyalty by phone number (replaces the loyalty cards in step 15)

**C. In TREFIN but unused here (build after A and B)**
- [ ] 12. Fixed assets register and depreciation
- [ ] 13. Employees and payroll: contract fields, monthly payroll with pension contributions and wage tax, payslips, the EDI payroll declaration, annual leave
- [ ] 14. Several warehouses and transfers between them
- [ ] 15. Loyalty cards and bonus, B2B portal for business customers
- [ ] 16. Production (recipes, semi-finished goods), serial numbers, projects
- [ ] 17. Yearly declarations (CD / PD)
