# Kosovo tax and accounting rules in 4VD

Paths are under `backend/src/`. Each rule names the file and symbol that holds it; change it there and nowhere else.
**Default, unconfirmed** = a guess waiting on the accountant (handoff.md, "Accountant"). Legal sources are the ones the code comments cite; read the comment before you change a figure.

## 1. VAT (TVSH)

- **Rates:** 18% standard, 8% reduced, 0%, exempt. 16% is the old standard rate, still on some bills; it goes in the 18% boxes. Bill rates: `BILL_VAT_RATES` (`constants/bills.ts`). VAT split from a gross price: `vatOf` (`services/books/entryBuilder.ts`).
- **The return (ATK form "TV", boxes 9 to 72):** `services/vat/vatReturn.ts`. Each document becomes one `VatItem` with its boxes. The sales book, purchase book, return totals and "documents behind a box" all read those same items. Box map: `CHARGED_ROWS`, `CLAIM_ROWS`. Helpers: `saleBoxes`, `localPurchaseBoxes`, `importBoxes`, `asSupplierCredit`. Totals: `vatResult`.
  - Sales: exempt → 9, 0% → 10, 18%/16% → 12/13, 8% → 14/15. Box 11 (exports) unused.
  - Customer returns (credit notes the shop issues): 18% → 53/54, 8% → 55/56. **Default, unconfirmed.**
  - Kosovo supplier bills: 18%/16% → 43/44, 8% → 45/46, equipment 47/48 and 49/50, no VAT → 31 (equipment 32).
  - Imports: customs VAT spread over the goods by value and rate → 35/36, 37/38, equipment 39/40, 41/42.
  - Customs papers (`customs_papers`, `services/bills/customsPapers.ts`): an import's goods and their customs VAT count in the month of the **customs paper's date**, not the supplier bill's (`billItems`/`billBoxes` part 'goods' in `VatService.ts`); a paper dated in a filed month counts in the next open one (`vat_month`, like a late bill). Without a paper the goods sit in 31/32 in the bill's month. **Default, unconfirmed** (normal Kosovo rule: import VAT is claimed on the customs declaration). If the bill's month was filed before the paper came, the goods are in 31 there and in 35/37 again in the paper's month.
  - Service from abroad (reverse charge): 28/29 and 65/66.
  - Supplier returns/credits: 18% → 16/17, 8% → 18/19.
  - Fixed asset sold: like a sale, in the normal sales boxes. **Default, unconfirmed.**
  - Not used yet (stay 0): bad debt, other adjustments, non-deductible (33/34), farmers (51/52).
  - Result: 30 = VAT charged, 67 = VAT claimable, 68 = credit carried in, 69 credit, 70 refund asked (capped at 69), 71 carried to next month, 72 to pay.
- **Left off the return:** wages and taxes (`NOT_PURCHASES` in `services/vat/VatService.ts`); carwash takings and wages. **Default, unconfirmed.**
- **Due:** by the 20th of the next month (`DUE_DAY`, `VatService.ts`).
- **Checks before filing** (`VatService.ts`, `CheckKind`):
  - Cash purchases over €500 are listed, because such a cost may not be deductible unless paid by bank (`CASH_LIMIT`). **Default, unconfirmed.**
  - Missing NUI: only domestic bills that claim VAT (`no_nui`). **Default, unconfirmed.**
  - A month can be filed only once it is over. **Default, unconfirmed.**
  - Box 68 is typed by hand only in the first books month; later months carry it from the month before (`carriedInto`). **Default, unconfirmed.**
- **Locks:** `services/vat/periodLock.ts`. A filed month or closed year refuses changes (`PERIOD_FILED`, `YEAR_CLOSED`); the accountant or owner can reopen with a reason. A bill dated in a filed month counts in the next open month (`vatMonthForBill`). **Default, unconfirmed.** Re-posting after a Books Settings change may touch filed months. **Default, unconfirmed.**
- **ATK EDI books upload ("Ngarko Librin"):** `EDI_FORMAT` in `services/vat/vatExport.ts`. The column map is a best guess: dates dd.mm.yyyy, plain decimal numbers, one `[box]` column per box. **Default, unconfirmed:** waiting on ATK's sample file. Change only `EDI_FORMAT` when it comes.
- **Compare with TREFIN:** `services/vat/TrefinCompareService.ts`. Every TREFIN bill must also be in 4VD, or the VAT to pay comes out too high.

## 2. Payroll

All figures: `PAYROLL_RULES` in `services/payroll/payrollRules.ts`, one set per start month (`rulesFor`). Months already confirmed keep their figures. Add a new set when the law changes; don't edit the old one.

- **Law:** Law 05/L-028 on Personal Income Tax as amended by 08/L-142 (in force 23 Aug 2024; first full month September 2024). Not 08/L-257, which is the tax procedures law.
- **Monthly wage tax bands on taxable pay:** 0% up to €250, 8% from €250.01 to €450, 10% above.
- **Taxable pay** = gross − the employee's pension, the voluntary extra included. **Default, unconfirmed.**
- **Trust pension** (Law 04/L-101): 5% employee (held back from gross) + 5% employer (on top). Each side may add a voluntary extra, capped at 15% per side in all (`maxPensionEachSide`). **Default, unconfirmed** (sources disagree).
- **Second job:** all taxable pay at a flat 10%, no tax-free band (`secondaryRate`). **Default, unconfirmed.**
- **Non-resident:** no Trust pension, normal tax bands (`payFromGross`, `nonResident`). **Default, unconfirmed.**
- **Minimum wage:** €350 gross for a full-time main job, from 1 Oct 2024. 4VD only warns, never blocks (`minimumWage`). **Default, unconfirmed.**
- **Net-agreed pay:** `grossFromNet` finds the lowest gross whose net is at least the agreed net, to the cent. **Default, unconfirmed.**
- **Part month:** only warned about, not prorated; the gross is changed by hand. **Default, unconfirmed.**
- **Declare and pay ATK** by the 15th of the next month (`dueDay`, `dueDayOf`). **Default, unconfirmed.**
- **ATK payroll declaration file:** `DECLARATION_FORMAT` in `services/payroll/payrollExport.ts`, TREFIN's monthly payroll columns. **Default, unconfirmed:** waiting on ATK's sample file.
- **Leave** (`services/payroll/leave.ts`, Labour Law 03/L-212 Art. 32): at least 20 working days a year, +1 day per full 5 years of service (treated as law: **default, unconfirmed**). Earned 1/12 of the year per whole month worked (`earnedDays`). Untaken days carry on without limit. Leave days count Monday to Friday with no public holidays (`workingDays`). All **default, unconfirmed.**
- **Carwash staff** are on the same ATK declaration but not booked, so declared payroll won't match the books and those wages aren't deducted for profit tax (`payroll` in `services/books/postingRules.ts`). **Default, unconfirmed.**

## 3. Profit tax, TM instalments, yearly declaration

- **Company (sh.p.k., sh.a.):** files the CD, 10% corporate income tax (Law 06/L-105). Rate is in two places: `CORPORATE_RATE` (`services/statements/taxRules.ts`) and `PROFIT_TAX_RATE` (`services/statements/YearService.ts`). Keep them equal.
- **Individual business (B.I.):** files the PD. Bands = the monthly wage bands × 12: 0% to €3,000, 8% to €5,400, 10% above (`personalBands`). Real-profit filers only, not the 3%/9% turnover scheme under €30,000. **Default, unconfirmed.** Which form: `formOf`.
- **TM instalments** (`YearService.ts`): a business over €30,000 a year pays each quarter by the 15th after it (`TM_DUE_DAY`, `quarterDue`): ¼ × 110% × last year's tax (Law 06/L-105 Art. 38.2.2, `LAST_YEAR_FACTOR`). First year, or after a loss: estimated from this year's profit (`TmMethod`). The rest is paid with the declaration by 31 March (`DECLARATION_DUE_MONTH_DAY`). A PD business uses the same 110% rule. **Default, unconfirmed.**
- **Posting:** paying a TM: 2350 against the till, safe or bank. Closing a year: profit tax 8900 against 2350, then every income and cost account into retained earnings 3400, dated 31 December; the year is then locked. Direct cash flow method. **Default, unconfirmed.**
- **CD/PD figures** (`services/statements/DeclarationService.ts`): income, costs, book profit, adjustments, losses carried forward, taxable profit, tax, instalments, rest. **Default, unconfirmed:** ATK's real box layout isn't known (`DECLARATION_LAYOUT`); figures are typed into EDI by hand.
  - Representation (6020, 6910) deductible up to 2% of income (`REPRESENTATION_LIMIT`). **Default, unconfirmed.**
  - Gifts and donations (6300, 6600) up to 10% of taxable profit (`DONATIONS_LIMIT`). **Default, unconfirmed.**
  - Losses carried 6 years, oldest first (`LOSS_YEARS`). **Default, unconfirmed.**
  - Carwash on the CD: two lines, takings (incl. the change machine) and costs (wages gross + employer pension, carwash bills incl. VAT), behind the `includeCarwash` switch, on by default (`EMPTY_INPUTS`, `carwash`). **Default, unconfirmed.**

## 4. Chart of accounts and posting

- **Chart:** `TREFIN_ACCOUNTS` in `constants/chartOfAccounts.ts`: TREFIN's 144 accounts plus 8900. TREFIN codes never show in the UI as codes to type.
- **Link keys:** `DEFAULT_ACCOUNT_LINKS` (same file). Post with the key, never the number. Every document's posting: `services/books/postingRules.ts` (the comment above `PostingRules` lists them all).

| Key | Default | Used for |
|---|---|---|
| `owner_in` / `owner_out` | 3000 / 3100 | owner capital / drawings; money from / to a carwash till |
| `receivables` | 1230 | customer tabs, bonus |
| `vat_in` / `vat_out` | 1260 / 2340 | VAT to claim / VAT owed |
| `stock` | 1340 | stock (goods ready for sale) |
| `payables` | 2000 | owed to suppliers |
| `refunds_owed` | 2430 | refunds owed to customers by bank transfer until marked sent (card refunds come off the bank `places.defaultBank` on the return day) — **default, unconfirmed** |
| `revenue` / `sales_returns` | 4000 / 4200 | sales / returns and customer bonus |
| `cost_of_sales` | 5000 | cost of goods sold |
| `stock_corrections` | 5400 | write-offs, stock count lines, manual corrections, stock documents |
| `expense:wages` | 6500 | gross wages |
| `employer_pension` | 6520 | employer Trust pension |
| `wages_payable` | 2100 | net pay owed |
| `pension_payable_employer` / `_employee` | 2200 / 2210 | pension owed |
| `wage_tax_payable` | 2310 | wage tax owed |
| `depreciation` / `amortisation` | 6150 / 6040 | monthly depreciation / intangibles |
| `asset:*`, `accumulated:*` | 16xx–19xx, 1910–1960 | fixed assets and their depreciation so far |
| `asset_gain` / `asset_loss` | 7200 / 8200 | asset sold above / below value left |
| `withholding` | 2370 | tax held back on a bill for ATK |
| `profit_tax` / `profit_tax_payable` | 8900 / 2350 | year's profit tax / owed (TM paid sits here) |
| `retained_earnings` | 3400 | where a closed year's profit goes |

- Payroll posting (6500, 6520, 2100, 2200/2210, 2310) is TREFIN's: **default, unconfirmed.**
- **Money places** (`database/places.ts`, `accountForPlace`): each till, safe and bank has its own account. The shop till is 1110 itself, the first bank 1120 itself. New tills and safes get the next free number under 1110 (1111…1119, then 111010…), so the safe is usually 1111 and a carwash till 1112, but the number is given in order, not fixed. Carwash tills are outside the books (`loadPlaceAccounts`, `inBooks: false`). Handoff's money defaults: "cash" payments come from the safe; each carwash till gets its own sub-account. **Default, unconfirmed.**
- **Customs paper** posts its own entry on its own date (`customs` in `postingRules.ts`): VAT to 1260, duty and excise onto the goods (stock 1340, an equipment's asset account), paid from the bank or, in cash, from the shop till. **Cash from the till: default, unconfirmed.** The bill's entry posts the goods without the duty (`bill_lines.duty`, already in `landed`).
- **Duty that comes after some units were sold** (customs put on a saved bill, `spreadDuty` in `customsPapers.ts`): goes onto the cost of the units still in stock; sold units keep their cost; none left → cost of sales 5000 (`bill_lines.duty_expensed`). Equipment's duty can't change after the bill is saved. **Default, unconfirmed.**
- **Cash count differences** (till counts, `services/CashCountService.ts`) are **not posted**. **Default, unconfirmed.** Don't confuse with stock count lines, which do post to 5400.
- **Stock in at net cost, cost of sales VAT-inclusive:** **default, unconfirmed.** TREFIN's trial balance is €976.78 off from 4VD's.
- **Stock documents** (in/out) post to 5400 at current cost, goods received free included (`stockDocument`). **Default, unconfirmed.**
- **A delivery received before its bill** (an order ticked off, or staff's "A delivery came" with no order, `PurchaseOrderService.arrived`): the units go into stock at once at the order line's cost (no order: the product's cost price then), and nothing is booked until the bill. The order-linked bill then posts stock 1340 at the paper's total less its VAT (`bill` in `postingRules.ts`, "the paper's total wins"), whatever staff counted. A scanned bill linked to a no-order delivery (`bill_scans.arrived_order_id`) sets the lines' costs and saves the bill without adding the counted goods again.
- **Customer bonus:** 4200 against 1230 (`bonus`). Whether VAT applies to it: **default, unconfirmed.**
- **Make** (`services/MakeService.ts`): parts and made product are both stock 1340, so a Make posts nothing. **Default, unconfirmed.**
- **Profit by project** (`services/ProjectService.ts`): income without VAT, costs as kept (stock cost is VAT-inclusive). **Default, unconfirmed.**

## 5. Fixed assets

`DEFAULT_RATES` and `SMALL_ASSET_LIMIT` in `services/assets/depreciation.ts`; disposal in `services/FixedAssetService.ts`; assets from bill lines in `services/assets/billAssets.ts`. All **default, unconfirmed.**
- Straight-line, one schedule for books and tax (Law 06/L-105).
- Rates a year: buildings 5%, furniture / equipment / vehicles 20%, other 10%, intangibles 20%, land 0. Each asset can have its own rate.
- Starts the month after it's put in use, runs through the month it leaves. A month is worked out once it's over; a month in a closed year is caught up in the first open month.
- Under €1,000: flagged "may be a cost at once".
- Leaving: gain 7200 / loss 8200. Returned to the supplier: only the depreciation it had goes back out of 6150. Sale VAT in the normal sales boxes.
- Carwash assets are not posted. A part credit on equipment leaves the asset unchanged (known gap).

## 6. Carwash outside the books (summary)

The carwash belongs to 4VD SH.P.K. (one NUI) but is kept outside the books: its tills (`inBooks: false`), bills, assets and staff wages post nothing. Money crossing between a carwash till and the books is owner capital 3000 / drawings 3100. It still appears on the ATK payroll declaration and, behind a switch, on the CD. Its takings and wages stay off the VAT return. All **default, unconfirmed.**

## 7. Still waiting on files from the accountant

ATK's EDI books sample (`EDI_FORMAT`), ATK's payroll declaration sample (`DECLARATION_FORMAT`), a filed CD and PD (`DECLARATION_LAYOUT`), TREFIN exports (trial balance, partner balances, one month's books and VAT return), and a real Kosovo bank statement for the statement reader (`services/money/statementFile.ts`).
