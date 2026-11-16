# 4VD progress

Tasks we agree on in chat. Ticked when done. When everything is ticked, Claude asks whether to add new tasks.
Finished sections are kept in `docs/archive/progress-done.md`.

## Still open from earlier

- [ ] iPhone alerts confirmed working (dashboard alerts, added to the home screen)
- [ ] Link from a product to the supplier you usually buy it from (optional)
- [ ] Run the TREFIN import for real at launch (`npm run import:trefin`)

## To test by hand

The user tests these later, by eye or on the shop PC. Every finished step adds what nobody tried by hand. Tick an item once it's checked.

**Smoothness** (on your own screen, after the next deploy)
- [ ] The sign-in page's moving dots look the same as before but run smoothly (no longer 30 frames a second), and typing in the form stays quick
- [ ] Scrolling a long dashboard page feels smooth under the glass top bar

**Small transitions** (try them all on /kit first, then in place)
- [ ] /kit → Small transitions: the total's changed digits roll (up when it grows, down when it shrinks), Wrong PIN shakes the box, Start/Finish turns the spinner into a check, the words swap with a blur, the reading words shimmer, the Download menu opens and closes from its corner
- [ ] /kit → Messages: press Saved three times: the toasts stack, pointing at them fans them out, the green check turns in, closing one fades it away
- [ ] Counter: the basket total rolls as you scan, a wrong PIN shakes, the Paid screen's check pops in with a spreading ring and the change rolls up from zero (try it first on /kit with "Paid again"; at the till only on the shop PC or the demo shop, never a real sale)
- [ ] Bills → Scan a bill: "Reading the bill…" shimmers, then swaps to "Ready to check" before the check opens; confirming it shows a "Bill confirmed" toast
- [ ] VAT credit and the bank-statement rules: Save shows "Saving… → Saved"; a bank statement upload shimmers while it reads; a form that fails to save shakes its error line
- [ ] With Windows "Show animations" off, none of the above moves and everything still shows
- [ ] On a wide screen: charts side by side fill their cards with no empty band, four charts sit two by two, and form fields stop at a comfortable width (check a few real forms too: product, bill, settings); checkboxes are amber when ticked

**Step 15: portal for business customers** (sign in as the owner; use a test firm, never a real customer)
- [ ] A business customer's page → Online portal: switch it on, set a smallest order and only some categories, Save; Invite someone with a mobile → Send by WhatsApp opens a chat with the link
- [ ] Open the link on a phone: WhatsApp's preview doesn't use it up; "Open my account" signs in; opening the same link again says it no longer works
- [ ] Order tab: prices show with and without VAT (wholesale for a wholesale customer), out-of-stock products can still be added, the basket splits without VAT / VAT / total, below the smallest order Send stays off
- [ ] Send an order: it appears in To do and as an alert; Sales → Online orders opens it (the customer now sees "Seen by the shop"); Accept makes an offer at the order's prices; sell it at the Counter with Deliver it on the demo shop only, and the customer follows Being prepared → On the way → Delivered
- [ ] Orders → an old order → Order again fills the basket at today's prices; Cancel works only while it says Sent
- [ ] Invoices: invoices and credit notes show; PDF opens the invoice with stamp and signature
- [ ] Account: balance, due dates and late items match the customer page; the statement prints cleanly and the CSV opens in Excel
- [ ] Switching the portal off, or removing a person, signs them out at once; the language switch (Shqip/English) sticks
- [ ] Email sign-in: only after the Resend setup (handoff.md); asking for a link with an unknown email says the same as with a known one

**Step 14: stock locations** (sign in as the owner; nothing shows until a second location exists)
- [ ] Settings → Stock locations: add "Depo", rename it, make it "Goods come in here"; Stock now has a Move stock tab and stock screens ask which location
- [ ] Move stock: move a few products from Shop floor to Depo by scanning, print the LV note (two signature lines), find it in the list with the period, Excel and PDF, then void it
- [ ] On the shelf: the location filter, a shelf minimum on a product page, then Refill from storage and its Bring button opening Move stock filled in
- [ ] A bill and an order received land in Depo; a product's page shows how much each location holds
- [ ] A sale bigger than the floor holds takes the rest from Depo and its stock history says "(from Depo)"
- [ ] Count only Depo, and only the shop floor; the staff phone count always counts the shop floor
- [ ] Removing Depo is refused while it holds stock or is where goods come in, and the last location can never go

**Step 13: payroll** (sign in as the owner or the accountant)
- [ ] Team → Payroll: add a person with a gross pay, one with a net pay, one second job and one at the carwash; check each line of a month on the Months tab against the tax bands (0% to €250, 8% to €450, 10% above) and 5% + 5% pension
- [ ] A gross under €350 for a full-time main job warns, and a person who left with leave not taken warns "add them to the last pay"
- [ ] Change one person's gross for a month with a reason, confirm the month, then check Books: wages 6500, employer pension 6520, owed 2100/2200/2210/2310 (carwash staff left out)
- [ ] Pay wages from the bank, then Pay ATK: two payments (tax and pension); on a bank statement each matches its own line
- [ ] Download the declaration (Excel and CSV) and print a payslip; take a payment back, then take the month back
- [ ] Record leave taken and a correction; the balance changes; link a person to their 4VD account and, signed in as them, see Account → Pay and leave with only their own payslips

**Step 19: short-dated stock**
- [ ] Mark a food product "Has a best-before date"; a bill line, a bill scan line and a stock-in for it show a Best before field, and the date appears under Stock → Expiring
- [ ] Two days before the date: at the Counter the line shows "Short-dated −30%"; tap it once per stickered unit (tapping past the last undoes it); the receipt and the sale charge the lower price for those units only
- [ ] Same on the employee Sell screen
- [ ] Settings → Shop rules: change the days and the discount steps; a category or product with its own days
- [ ] The day after the date: To do opens Stock → Expiring; "Remove as expired" takes it off the shelf (an employee's waits for the owner) and it shows in the books as a write-off
- [ ] A count: the Soonest best before field replaces the old dates
- [ ] On the shop PC: what the fiscal receipt prints for a short-dated unit (same article, lower price; no separate discount line)

**Step 18: bills by email** (after the setup in docs/DEPLOYMENT.md)
- [x] Forward a supplier PDF from your sign-in email to bills@4vd.app: a waiting scan "By email from …" appears under Bills and in To do, with supplier, lines, VAT and due date filled in
- [ ] Send a clear phone photo of a bill (no PDF): it is read too; an email with only a logo gives a "no PDF or bill photo" update
- [ ] Forward the same PDF again in a new email: an update says it was already received, and no second scan appears
- [ ] Settings → Bills by email: add a supplier's address or @domain; mail from them is read, mail from anyone else never shows up
- [ ] A mail with a faked From, and one carrying a made-up "Authentication-Results: mx.cloudflare.net; dkim=pass…" header, are both dropped (`npx wrangler tail` in mail/; see docs/DEPLOYMENT.md step 5)
- [ ] Under Bills, "Emailed, not read yet": Read now opens the scan; Remove clears it from To do

**Step 12: fixed assets**
- [ ] Books → Fixed assets: add something owned before 4VD, with its wear before the books
- [ ] A supplier bill with an equipment line: the asset appears, and its first month posts after the month ends
- [ ] Sell one (paid into the till and on a customer's tab), throw one away, then Undo
- [ ] Split a bill line of several pieces; a credit that gives one back
- [ ] The year's depreciation and the register in Excel; Next to the books
- [ ] An asset sale on the VAT return and the sales book

**Step 9: products and prices**
- [ ] Prices page: wholesale prices, mark-up, Excel download and upload
- [ ] Pack barcodes and the new units on a product
- [ ] Stock → In and out: a stock-in and a stock-out document, then Void

**Step 10: partners**
- [ ] Reading a partner from a photo or pasted text (needs a working ANTHROPIC_API_KEY)
- [ ] Paying out a customer bonus
- [ ] Deliver it: the address chips
- [ ] The delivery line on an invoice

**Step 11: settings and safety**
- [ ] Print an invoice with the stamp and signature
- [ ] Ring up a Counter sale after changing the number format
- [ ] Settings → Recycle bin: bring back a product, supplier, customer, expense and file

**Step 8: sales documents**
- [ ] Offers, deliveries and pay-later as a whole

**Counter (shop PC, real printer)**
- [ ] A sale, X report and Z report on the Datecs printer
- [ ] Paid screen after a sale
- [ ] Scale label, opening cash and count, PIN switch and Ask the owner
- [ ] Pull the network cable, sell, plug it back in
- [ ] Line layout and the Till menu (F1 Invoices, F7 Refund)

**Windows app**
- [ ] Install 0.4.x on the shop PC: the installer, the welcome, the printer check, Start with Windows

**Look (light and dark, phone and desktop)**
- [ ] Employee layout (demo-employee@4vd.local)
- [ ] Sign-in page with the till receipt
- [ ] New logo and the glass tick
- [ ] Amber colours and status colours
- [ ] Overview, the sidebar's More and the phone bottom bar
- [ ] Skeleton loading shapes
- [ ] Polish pass: stat tiles, tables, filter chips, inset panels, charts in amber, toasts
- [ ] Phones: the bigger small buttons don't crowd the toolbars
- [ ] Counter: the F3 product finder and the Invoices list (F1)

**Needs real files**
- [ ] Bank statement reader with a real Kosovo bank statement (Excel, CSV, PDF)

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
- [x] 8. Sales documents, the 4VD way: pay later (owner lets a customer and sets a limit, promised day, owner PIN at the till, late payers in To do, WhatsApp reminder), offers (made fast, WhatsApp/print/pro-forma, sold at the Counter at their prices), deliveries (Deliver it at the Counter, rest at the door, To deliver page). Not built on purpose: invoice kinds (goods/services/export), the owner's yes from a phone
- [x] 9. Products and prices: wholesale and retail price each with its margin, price calculation from cost, price import from Excel, price lists, extra barcodes with pack size and pack price, units (kg and so on), stock in and out documents. Done 2026-11-15 (wholesale per customer and per sale, Stock → Prices with mark-up, Set from cost and the Excel price file, price lists, pack barcodes, units kg/l/m/m², Stock → In and out)
- [x] 10. Customers and suppliers as one "partner": fiscal and VAT number, several addresses, discount and bonus %, credit limit, bank account, look-up in the ATK register. Done 2026-11-15: a new firm fills itself in from what 4VD has (duplicate warning by NUI), a photo of a certificate, invoice or card, or text pasted from ARBK (read by Claude), plus an Open in ARBK link (ARBK sits behind a robot check, so no automatic query). A customer and a supplier with the same NUI show both balances and an Offset (kompensim, books 2000/1230, no cash). Other addresses per partner, picked in Deliver it; invoices print the delivery address. Yearly bonus % paid as a tab credit (books 4200/1230; VAT on it to confirm with the accountant). Books keep one account per kind with the partner on each line, which already gives a card per partner
- [x] 11. Settings and safety: company details with logo, stamp and signature on invoices, numbering like FSM-26-000001, decimals, negative stock on/off; recycle bin for deleted documents; attachments on any document. Done 2026-11-15: stamp and signature pictures print on invoices; Settings → Numbers and stock sets letters, year (26 or 2026) and digits for invoices, credit notes and offers (from the next number) and whether the till sells past stock (owners and admins always can); Settings → Recycle bin puts back removed products, suppliers, customers, expenses and files for 90 days (issued invoices are never deleted); a Files card on bills, orders, suppliers, customers, invoices, offers and book entries. Decimals left out: prices are kept to the cent everywhere and kg already goes to the gram.

**D. Better than anything in Kosovo** (from tills and accounting programs abroad, agreed 2026-10-16; there's no rush to switch TREFIN off, its subscription runs a couple more months)
- [x] 18. Bills by email: forward a supplier's PDF to the shop's bill address and it's filled in by itself. Done 2026-11-15: bills@4vd.app → Email Worker (`mail/`; drops mail failing SPF/DKIM, not yet tried live) → a waiting bill scan in To do, checked on the scan page; senders are the team plus Settings → Bills by email; 50 reads a day, the same file twice is read once. Goes live after the setup in docs/DEPLOYMENT.md
- [x] 19. Short-dated stock: best-before dates, and automatic discounts a few days before expiry. Done 2026-11-15: products marked "Has a best-before date" ask for it on bills, bill scans, stock-ins and counts; near the date the cashier taps "Short-dated −30%" once per stickered unit (Counter and Sell), the % grows as the date nears (Settings, per category or product), never below cost unless allowed; Stock → Expiring lists what expires in 14 days at cost, with one tap to remove expired stock as a write-off. The invoice line says "(afat i shkurtër −N%)"; the fiscal receipt shows only the lower price
- [ ] 20. Cash forecast: what the shop will have in 30 days, from bills due and normal takings
- [ ] 21. All four businesses in one view, each with its own books
- [ ] 22. Digital receipts by SMS or Viber, and loyalty by phone number (replaces the loyalty cards in step 15)
- [ ] 23. 4VD as a full Windows program: the Counter keeps selling with no internet (a local copy of products and prices, sales sent on when it's back), opens full screen and starts with Windows, and talks straight to the printer, drawer, scanner and scale. Same account and data as 4vd.app; phones keep using 4vd.app from the home screen (agreed 2026-11-12)

**C. In TREFIN but unused here (build after A and B)**
- [x] 12. Fixed assets register and depreciation (2026-11-15): Books → Fixed assets. Equipment on a bill becomes an asset by itself, older things are typed in; each finished month posts its straight-line depreciation; selling or throwing one away posts the gain or loss and the sale VAT; a credit gives it back; the year's schedule, a check against the books and Excel. Rates and rules to confirm with the accountant (handoff.md)
- [x] 13. Employees and payroll (2026-11-15): Team → Payroll. Each person with their contract (gross or net, second job, extra pension, shop or carwash); a month is worked out with Kosovo wage tax and Trust pension, confirmed into the books, then wages and ATK (tax and pension as two payments) are paid and matched on bank statements; payslips to print, the declaration file, annual leave, and staff see their own under Account. Defaults to confirm with the accountant (handoff.md)
- [x] 14. Several stock locations and moves between them (2026-11-15): add a storeroom in Settings → Stock locations; each product keeps a total plus how much each location holds. Stock → Move stock moves goods in one step (LV-, printable note, Excel/PDF, void) and never touches the books; a sale short on the floor takes the rest from storage and says so; bills, orders, scans, in and out, write-offs and counts ask which location; On the shelf filters by location and offers Refill from storage below a shelf minimum. All of it stays hidden while the shop has one location
- [x] 15. B2B portal for business customers (loyalty moved to step 22: loyalty by phone number replaces the cards). Done: 4vd.app/portal, firms invited by WhatsApp link see their own prices with and without VAT, order (Order again too), and read invoices, credit notes, balance and statement; orders land in To do and Sales → Online orders
- [ ] 16. Production (recipes, semi-finished goods), serial numbers, projects
- [ ] 17. Yearly declarations (CD / PD)
