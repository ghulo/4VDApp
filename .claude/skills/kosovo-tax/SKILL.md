---
name: kosovo-tax
description: The Kosovo tax and accounting rules 4VD already implements, with where each lives in code. Use before touching or adding anything about VAT (TVSH) or the VAT return boxes, the ATK EDI books, payroll (wage tax bands, Trust pension, second job, leave, minimum wage), profit tax and TM instalments, the CD/PD yearly declaration, the chart of accounts or which account a document posts to, fixed-asset depreciation, the carwash outside the books, or any "accountant default". Read it instead of re-researching Kosovo law.
---

# Kosovo tax and accounting in 4VD

4VD replaces TREFIN for a Kosovo shop (4VD SH.P.K.) with carwashes. The rules below are already built. Don't research them again: read `reference.md` (same folder), then the code file it names.

## How to use it

1. Find your topic in `reference.md`. Each rule says the file and the symbol that holds it.
2. Change a rule **in that one place**. Most files say so in their comment (for example `PAYROLL_RULES`, `DEFAULT_RATES`, `EDI_FORMAT`). Don't copy a rate or account number into new code: import the constant or use the account link key.
3. Rules marked **default, unconfirmed** are guesses waiting on the accountant. They are listed in handoff.md's "Accountant" section. If you add a new guess: put a comment `Default until the accountant confirms (handoff.md)` at the code, and add one line to that section.
4. Don't add law facts from memory. If a rule is new, find a source, write it in the code comment (as `payrollRules.ts` does), and add it to `reference.md` in the same commit.

## The five things that trip sessions up

- **Prices and costs include VAT.** The VAT part is split off by the rate: `vatOf(gross, rate)` = gross × rate / (100 + rate) (`backend/src/services/books/entryBuilder.ts`).
- **Account numbers are defaults.** Post with link keys (`'stock'`, `'expense:wages'`, `'vat_out'`…) from `DEFAULT_ACCOUNT_LINKS` in `backend/src/constants/chartOfAccounts.ts`. Owners can change the number under Books → Settings. Only `DeclarationService.ts` has numbers written in (its account lists).
- **The carwash is outside the books.** Carwash tills, bills, assets and wages post nothing. Money from a carwash till into the books is owner capital, money going to it is drawings. The carwash is still on the ATK payroll declaration and on the CD (behind a switch).
- **Filed months and closed years are locked.** Anything dated in them is refused (`backend/src/services/vat/periodLock.ts`). A supplier bill that arrives late counts in the next open VAT month.
- **The 10% profit tax rate is written twice:** `PROFIT_TAX_RATE` (`statements/YearService.ts`) and `CORPORATE_RATE` (`statements/taxRules.ts`). Change both, or merge them into one.
