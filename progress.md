# 4VD progress

Tasks we agree on in chat. Ticked when done. When everything is ticked, Claude asks whether to add new tasks.
Finished sections are kept in `docs/archive/progress-done.md`.

## Still open from earlier

- [ ] iPhone alerts confirmed working (dashboard alerts, added to the home screen)
- [ ] Link from a product to the supplier you usually buy it from (optional)
- [ ] Run the TREFIN import for real at launch (`npm run import:trefin`)

## Code review fixes (three-model review, 2026-11-19)

Done:
- [x] Rebuilding the books keeps set-offs (kompensim) and customer bonuses (4ecf8f50)
- [x] Two-step: the first wrong code after a 15-minute lock no longer locks again (4ecf8f50)
- [x] "Sell past stock" goes by the role in this business (4ecf8f50)
- [x] Windows app tests run on GitHub; Windows app link checks tightened; render.yaml on Postgres 18 (4ecf8f50)
- [x] Retired mobile job out of GitHub's checks (already done in d566e263)

Security:
- [x] Large uploads (15–42 MB) are read only for someone signed in (46f6374c)
- [x] A sign-in ends at once after logging out, an ended device or a password reset (98e47b08)
- [x] Bill files, scans, stamps and signatures need sign-in and belong to the business (2f7d6782, migration 092)
- [x] Import zip/Excel files can't unpack into something huge (cd216b68)
- [x] The Windows app accepts only known printer commands (b658ba02)
- [x] Browser protection rules on 4vd.app: HSTS, no framing, nosniff, camera only for 4VD (1fc868c3)
- [ ] Switch the CSP from report-only to enforced once Sentry shows no reports from real use
- [x] Counter PIN: a daily cap on wrong tries and a note to the owner (a01e0645, migration 093)
- [x] Windows app: log update errors (d20dffd5)
- [x] Windows app: auto-update reaches the releases (repo made public 2026-11-19; history checked: no secrets, no shop data)
- [ ] Windows app: sign the installer (needs a code-signing certificate)

Books and money:
- [ ] Stock cost: in at net, out VAT-inclusive (ask the accountant which basis; then make both sides the same)
- [x] Refunds can go back by card or bank, not always cash from the till (card on the terminal, bank transfer to pay back in Money)
- [x] Half-cent rounding (1.005 → 1.01) (264bbf77)
- [x] Payroll payment and VAT filing safe when two people act at once (a01dd2e1)
- [x] Order-linked import bill: checked. It balanced, but a delivery from abroad received with its bill took Kosovo VAT out of the goods; fixed (1b8dc349)
- [x] Customs duty and VAT for an import that came through an order: a Customs card on every saved import bill (customs papers; scanner reading still to come)
- [x] Books posting lock per business, not one for all (e9301739)
- [x] Crash alert email runs inside a business (be60d895)

Counter:
- [ ] Offline sales keep their business, keep the printed prices, and never get lost when the browser can't save
- [ ] "Did it print?" state when the printer's answer is unclear
- [ ] Weighed items: receipt and sale use the same 3-decimal quantity

Setup:
- [x] Outside uptime monitor on /health/db (1daa2262): Sentry uptime monitor every 5 min + the GitHub job
- [x] Daily database backup instead of weekly: nightly, 35 days + Sundays 90 days (cd9d95da); the backup had been failing since migration 082, fixed in 364fe45a (094)
- [ ] Local Postgres to 18 (needs a dump and restore of the local data)

UI and features (ask first):
- [ ] Split the 1,834-line Counter page; the untranslated confirm box in Roles; heatmap figures by keyboard and touch
- [ ] For selling: subscriptions, self sign-up, data export per business, terms and privacy, status page
- [ ] Till: loyalty, gift cards, shifts per cashier, cash drawer, customer discount applied
- [ ] Books: FIFO or average cost, foreign-currency bills, editable chart of accounts, bank matching

## To test by hand

**Customs papers** (on 4vd.app after the deploy)
- [ ] Receive an order from a supplier abroad with its bill; on the bill page the Customs card asks for the paper; add VAT and duty: the bill's "In the books" shows a Customs paper entry (1260, 1340, bank or till) and the product's cost goes up
- [ ] Change and remove the paper; the entry is reversed and rewritten; the VAT return for the paper's month shows the customs VAT in boxes 35/36
- [ ] An import bill older than 7 days with no paper shows "Customs missing" in To do; "No customs on this one" makes it go away, and Undo brings the form back
- [ ] Albanian wording of the Customs card and its To do items reads naturally
- [ ] Scan a real customs declaration (DUD) from Dogana e Kosovës: it is recognised as a customs paper, VAT/duty/excise and the invoice numbers are read right (the reader was only told the usual boxes, never tried on a real one), and it finds its import bill
- [ ] A customs paper scanned before its bill: "Keep it waiting"; To do shows it; entering the bill with the invoice number it names puts it on by itself; or put it on from its page, or throw it away

**Card and bank refunds** (on 4vd.app after the deploy, and the Counter on the shop PC)
- [ ] A refund on a card sale: the screen says "Refund €X on the card terminal"; do it on the real Raiffeisen terminal, tick "Done on the terminal", type the slip's code; the drawer's expected cash at the count doesn't drop, and the bank book in Money shows the card money less the refund that day
- [ ] A refund by bank transfer (name, IBAN): it shows in Money → "To pay back"; send it from the bank, press "Mark sent" with the day: it leaves the list and the bank's balance drops; Undo on that return is refused after
- [ ] Counter: refund two lines of a card sale at once; "To pay back" or the bank shows one refund, not two
- [ ] An employee asks for a card refund over their limit: it waits for the owner, the owner sees "On the card terminal €X" on the decision, approves, then the refund is done on the terminal
- [ ] A split sale (part card, part cash): the refund starts split the same way and can be changed; the parts must add up
- [ ] Albanian wording of the refund step and "Për t’u kthyer" reads naturally; phone layout of the refund step
- [ ] When a sent bank refund shows on the bank statement, it isn't counted twice (statement matching for refunds isn't built yet: match it by hand or tell Claude)

**Code review fixes** (on 4vd.app after the deploy, and on the shop PC after the next Windows app release)
- [ ] Counter: type a wrong PIN for someone 10 times in a day (right ones in between don't help): it says their PIN is locked and they show as "PIN locked: ask the owner"; the person already at the Counter stays signed in
- [ ] As main admin: Inbox has an urgent "Counter PIN … is locked" To do; their page in People has Unlock PIN; after pressing it the PIN works again at once
- [ ] While locked, that person still signs in with password, Google or passkey; the same on the shop PC
- [ ] Albanian wording of the PIN lock messages reads naturally
- [ ] 4vd.app after the deploy: Google sign-in, camera scanner, product photos, push alerts and the Download page still work; Sentry shows any "CSP" reports (send them to Claude before the rule is switched on)
- [ ] Settings → Import with a normal Excel and a normal zip still reads them
- [ ] Open a bill scan, a mailed bill, an attached file and the stamp in Settings: they show while signed in; the same link in a private window says sign in
- [ ] Logos in emails and product photos in the customer portal still show
- [ ] Log out on one device (or Profile → log out other devices): the other device goes to the sign-in page at its next click
- [ ] The Counter left open overnight on the shop PC is still signed in next morning
- [ ] Shop PC, new Windows app: a sale, an X report, a Z report and the customer display still print; Google sign-in still opens

The user tests these later, by eye or on the shop PC. Every finished step adds what nobody tried by hand. Tick an item once it's checked.

**Settings → Import** (on 4vd.app, after the deploy; a main admin or the developer)
- [ ] The look by eye: drop tray, Found, Check, the bar while it brings things in, Done; light and dark, phone and PC; Albanian reads naturally
- [ ] Drag a real Excel from another program (not TREFIN) onto the tray: it guesses what each column is; pointing a column at something else changes the counts
- [ ] Drop the whole TREFIN export folder before launch day on a test business: it sends only products, suppliers and customers, says what it left out, and the totals match TREFIN (local test on the demo database: 4,248 products, 121 suppliers, 13 customers, then Undo took all of it back)
- [ ] Change a few prices in Excel and drop it again: only those prices change (update by barcode); Undo puts the old prices back (local test: worked on demo)
- [ ] "Download problem rows": fix them in Excel and drop the file back in
- [ ] The To do notice when an import finishes, and the import line in History and All logs
- [ ] A file with a password: it says so plainly

**Each business in its own look** (on 4vd.app, after the deploy; 4VD's own business must look exactly as before)
- [ ] A customer business (not 4VD): Settings → Business → "How your business looks": pick a preset and type any colour code; only your own screen turns that colour as you pick; Cancel puts it back; "Save for everyone" keeps it after a reload and on another device
- [ ] A very dark and a very pale colour: the card says words and outlines use a readable shade; the main key keeps the exact colour and its text stays readable, light and dark
- [ ] Name shown and receipt lines: the top bar, account menu ("Runs on 4VD" small print) and the preview show the new name; invoices keep the legal name, with the receipt lines under it
- [ ] Without a logo: its initials on a key in its colour (top bar, sign-in link, portal, invoice); with a logo: the logo everywhere instead
- [ ] Its own sign-in link (copy from the card) opens a sign-in page in its colour and name; plain 4vd.app/login stays 4VD's
- [ ] Its portal link and the portal after signing in: its name, mark and colour, "Runs on 4VD" under the sign-in
- [ ] An invite and a portal invite/sign-in email from that business, in Gmail and in Outlook (phone and PC): its logo or initials key at the top, the key in its colour, its name in the small print; Outlook shows the logo (it gets a PNG)
- [ ] Shop PC: the Z report header says the business's name; the fiscal slip header itself can't be set from 4VD (no F-Link command known), so it stays whatever the printer has
- [ ] An accent (e.g. Navy) on a customer business: the charts and the marker beside the page you're on take it; the rest of the dashboard keeps the main colour
- [ ] Gradient "Colour → accent": the main keys, the logo key and the marker run from one to the other; a pair too far apart (e.g. Cobalt + Coral) keeps the main key flat and the card says why; the logo key and marker still run
- [ ] 4VD's own business: the same card without name or receipt lines; it starts on today's amber; an accent changes only the charts and the marker; the 4VD logo stays
- [ ] "Back to previous" after a save puts the colours from before it back; "Reset to default" asks first, says what it goes back to, and Esc or "Keep mine" closes it
- [ ] The two small previews (light and dark) and the receipt match what the dashboard shows after saving; History shows one "colours" entry per save
- [ ] 4VD's own business on another main colour: the house logo (top left, Overview, sign-in after a reload) and the "4VD developer" badge take that colour, light and dark; back on default they are amber again; with the gradient on, the logo runs to the accent unless the card says the colours are too far apart

**Family can sign in** (on 4vd.app, after the deploy)
- [x] A family login signs in and lands on Products (phone layout, tabs Products and Account); a star keeps a favourite; the product page shows no Sell key, expiry or write-off

**Two-step sign-in: "Make them set it up again"** (on 4vd.app, after the deploy)
- [x] People → a person → Two-step sign-in: "Switch off" and "Make them set it up again" both show; the second opens a card that says what happens; Cancel closes it
- [ ] After "Make them set it up again", that person's open dashboard sends them to the sign-in page; after the password they see a QR code, scan it with a real phone app, type the code, see 10 backup codes, then "I saved them, continue" lands in 4VD (local test: computed code instead of a phone app: QR screen, 10 codes and continue into 4VD all worked; left for you: a real phone app)
- [ ] The same with a passkey sign-in: after the fingerprint/face it shows the QR setup instead of opening 4VD
- [ ] On the shop PC: a person who must set it up again can't take over the Counter with their PIN (a short message), and the one at the Counter stays signed in
- [x] "Don't ask any more" (while they still have to set it up) lets them sign in with the password alone again
- [ ] The look of the setup card and the backup codes, light and dark, phone and PC

**Invite for a deleted person's email** (on 4vd.app, after the deploy)
- [ ] The invite that gave "something on our side isn't working" earlier: open the same link again (it works for 7 days) and type a name and password; you're signed in
- [x] People → delete someone → invite the same email again → they accept: they start fresh (new name and password, no old phone, photo, PIN or two-step), and see only the business that invited them
- [x] An email that already has a 4VD account in another business: accepting the invite with a password says to log in first (no error page)

**Many businesses, phase 5e: All logs** (on 4vd.app, signed in as yourself)
- [x] Account menu → "All logs": the history of every business in one list, newest first, each line naming its business; your own lines carry the hammer
- [x] The business chips, the kinds (Sales, Products and stock, …) and the search narrow the list; "Support visits" lists when you opened which business, and "Show changes" opens what you changed there
- [x] "Open" on a line switches you into that business
- [x] Signed in as anyone else (e.g. a main admin of a shop): "All logs" isn't in the menu, and 4vd.app/all-logs shows no data

**Many businesses, phase 5d-2b: Add business, a bill address per business** (on 4vd.app, after the deploy; the bill address needs the Cloudflare steps first)
- [x] Signed in as yourself: account menu → "Add business…" → name, short name (the bill address shows as you type), NUI (optional), legal form, first main admin's email → "Add business": it says the business is ready, shows its bill address, and "Open it now" opens it with an empty catalogue, its own till, safe and bank
- [ ] The person invited gets the email, joins as main admin, and sees only that business (local test: joining as main admin and seeing only that business worked; the email itself not tried)
- [x] In the new business, Settings → Support visits shows your visit ("Created the business") and History shows it was created
- [x] Settings → Bills by email shows bills+<short name>@4vd.app; the short name card (with its warning) shows only for you
- [ ] After the Cloudflare steps: a bill PDF sent from a team member's email to bills+<short name>@4vd.app waits under Bills in that business only; bills@4vd.app still goes to 4VD; a made-up bills+nobody@4vd.app gets a reply that no business uses it

**Many businesses, phase 5d-2a: blocking per business, invite only** (on 4vd.app, after the deploy)
- [x] People → Invite someone: there's no "set them up yourself with a password" any more; after "Send invite" the link shows with "Send on WhatsApp" (opens WhatsApp with the message ready, you pick the person) and "Copy link"; "Send again" on a waiting invite shows them too
- [ ] The WhatsApp message reads well in English and Albanian (local test: English reads fine; fails: an invite set to Shqip still gets the English WhatsApp text (it follows the sender's dashboard language))
- [x] Block someone who also works in a second business (needs one): they can still log in, and the app opens the other business; blocked in both, the login says the account is no longer active
- [x] Try to delete someone who is the only main admin of another business: it refuses and names that business

**Many businesses, phase 5d-1: one person in two businesses** (on 4vd.app, after the deploy; needs a second business, e.g. after 5d-2's "Add business")
- [ ] Invite someone who already has a 4VD account: the email arrives; the link says they already have an account and shows "Log in to join"; after logging in, "Join …" opens the app in the new business with both businesses in the account menu (local test: API: link says hasAccount, join adds the business to the menu; the email and the Log in to join page not tried)
- [x] In the business that isn't their home, People shows them with the role they have there and a note that their account belongs to another business: no name, password, two-step or passkey settings, only role, access and "Remove" (which takes them off that business only)
- [ ] Block them in that business while they have it open in another tab: the tab goes to the sign-in page instead of carrying on; signing in again opens their home business (local test: API only: once blocked, both the token and the refresh are refused (401) and signing in again opens the home business; a tab moving to the sign-in page not watched)
- [ ] On the shop PC: someone from another business who works here too takes over the Counter with their PIN, and the sale lands in this business

**Many businesses, phase 5c: business picker and roles per business** (on 4vd.app, after the deploy)
- [x] Your account menu (top right) lists 4VD and every other business with the open one ticked; someone in only one business sees no list
- [ ] Pick another business: the app opens again from Home in it, and stays there after a reload and the next day; another open tab follows by itself (local test: opens from Home, stays after a reload, a second tab follows; the next day not tried)
- [ ] Pick a business while the Counter on that PC has a basket with products: it says to finish at the Counter first and stays put (local test: not tried: needs a Counter basket in the browser and two businesses on one login)
- [x] Settings → Roles: a change in one business doesn't change who may do what in another

**Many businesses, phase 5b: the 4VD developer** (on 4vd.app, after the deploy)
- [x] Signed in as yourself: an amber hammer with "4VD developer" shows in the top bar (on a phone the hammer alone), at the top of the account menu, on your profile, and beside your name in People
- [x] Your brothers keep the role they had (none shows "developer" or the hammer) and can still do everything they could before
- [x] Settings → Support visits opens for you and the admins and says nobody from 4VD has opened the business yet; an employee doesn't see it
- [x] Nobody else can change your account (name, role, sign-in), and "developer" isn't offered when inviting someone

**Backups and error tracking**
- [x] GitHub → Actions → Backup restore check → Run workflow: it goes green and its summary shows the newest sale and last migration in the copy
- [x] Sentry: after the API DSN is on Render and the dashboard DSN is in admin/.env.production, the first real error shows in Sentry with a stack trace and no email, name or request body in it

**Security: cookie sign-in, two-step sign-in** (after the deploy, on 4vd.app and the shop PC)
- [x] A browser that was signed in before the deploy stays signed in after it (it moves to the new cookies by itself); the shop PC's Windows app too
- [ ] Sign out, sign in again: works; closing and reopening the Windows app keeps you signed in (local test: sign out and in works in the browser; the Windows app not tried)
- [ ] Profile → Sign-in and security → Two-step sign-in → Turn on: scan the QR with Google or Microsoft Authenticator, type its code; ten backup codes show; Copy codes works; "I saved them" says it is on (local test: by API with a computed code: 10 backup codes and it is on; the Profile screen, Copy codes and a real authenticator app not tried)
- [x] Sign out and in: after the password it asks for the code; a wrong code says so; the right one signs in; the same code a second time is refused
- [x] Sign in with a backup code instead: works once; Profile then says 9 left
- [x] Turn off asks for a code first; with it off, the password alone signs in again
- [ ] As the developer: People → the owner → Two-step sign-in → Switch off; Activity shows who did it (local test: done on another person, not the owner: Switch off works and Activity says who; no confirm card shows before it switches off)
- [ ] Google sign-in with two-step on also asks for the code

**Passkeys: fingerprint, face or device PIN** (after the deploy, on 4vd.app, a phone and the Windows app)
- [ ] Profile → Sign-in and security → Passkeys → Add a passkey: it asks for your password (or your two-step code when that is on), then Windows Hello / Touch ID / Face ID / the Android fingerprint; the passkey shows with its device name, and an email says a passkey was added
- [ ] Sign out: the email field offers the passkey (Chrome, Edge, Safari); picking it signs you in with no password and no two-step code
- [ ] "Sign in with a passkey" under the form does the same; closing the device prompt shows no error
- [ ] On a computer without a fingerprint reader: "Sign in with a passkey" → "use a phone" shows a QR; scan it with the phone that has the passkey
- [ ] With two-step on: password → the code screen offers "Use a passkey instead", which signs in
- [ ] Rename and Remove a passkey; a removed one no longer signs in
- [ ] As an admin: People → an employee who has a passkey → Remove passkeys; Activity shows who did it
- [ ] Windows app (office PC): Windows Hello works for adding and signing in
- [ ] Counter PC (Windows app set up as the Counter) and /counter: no passkey key anywhere, the login page included
- [ ] Albanian: the Profile card, login key and errors read naturally ("çelës kalimi")

**Step 17: yearly declarations** (Books → Declaration, sign in as the owner or the accountant)
- [x] Settings → Business details: Legal form shows "Company (sh.p.k., sh.a.)"; switching it to "Individual business" turns the page into the PD with three bands, and Books → Year says "Personal income tax"; switch it back
- [ ] Books → Declaration, last year: income, costs and book profit match Books → Statements for the year; an income or cost line with several accounts lists them, and each opens its card (local test: checked on 2026 (the demo has no 2025 books): income and costs match Statements, wages lists 6500 and 6520; opening each card not tried)
- [x] The carwash takings and wages and bills show as two lines marked "outside the books"; unticking "Count the carwash" and Save takes them out and the tax drops
- [x] Type a representation figure, a fine, an "Other" line with a minus, and a TREFIN loss: Save, and the figures, taxable profit and tax follow; emptying representation goes back to 4VD's figure
- [ ] The quarterly instalments paid for the year are taken off (Q4 paid in January counts for last year); Pay the rest records it with an entry against 2350 and Take back removes it (local test: not tried: needs a finished year with tax in the demo)
- [ ] Mark as filed with a day in this year: the typed fields lock, the To do "File the CD by 31 March" goes; Reopen asks why and unlocks them (local test: not tried: needs a finished year in the demo)
- [x] Download → Excel opens; Download → Print shows the CD with the shop's name, NUI and signature lines

**Step 16: Make, serial numbers, projects** (Settings → Features switches each on; all off until then)
- [x] Settings → Features: switch on Projects, Made products and Serial numbers; Stock gets Make and Serial numbers tabs, Reports gets Projects
- [ ] Projects: add "Dasma Krasniqi" in Settings → Features; pick it on a new bill, an expense, a Stock out and a damage; change it on a bill, an invoice and a stock out afterwards; close it and it leaves the pickers (local test: adding, putting a bill and an invoice on it and closing work by API; the pickers on each form, an expense, a stock out and a damage not tried)
- [ ] Reports → Projects: income, goods sold, bills, stock out, damage and profit per project with totals; a project opens its documents; Excel, CSV and Print come out right (local test: income 71.19, goods 30, profit 41.19 and the project's documents are right; Excel, CSV and Print not tried)
- [ ] A product → Made from: add rakia and honey with how many go into one; "One costs …" shows; Make some opens the Make form with it picked (local test: a recipe of 2 parts gives "one costs €70"; the Make some key not tried)
- [ ] Stock → Make: pick the basket, 10, the location: the sentence says what comes out and goes in at what cost; best-before is the parts' earliest; a part with no cost or too little stock stops it; after saving, stock and costs moved, nothing in Books; Void puts it all back (local test: making 3 moved stock at €70 each, too much stock was refused, nothing in Books, Void put it back; the plan gives the parts' earliest best-before and the Make screen fills it in and sends it; the test make went straight to the API without a date, so it saved none (not a bug))
- [x] A product → Serial numbers: switch on, 24 months warranty; scan 3 serials (Enter after each) and Record; one already in stock is reported, not added twice
- [ ] On a bill or a Stock in with that product, the serial box shows per line and records them against the bill (local test: serials recorded against a bill show that bill in the serial search; the serial box on the bill and Stock in screens not looked at)
- [ ] Counter: a basket with 2 of that product → Pay asks for 2 serials first (scan, Enter, scan, Enter → straight to Pay); Esc leaves it; a serial sold before and not returned is refused; the invoice and its print show "S/N … · warranty until …" (local test: the sale refuses without 2 serials, refuses a serial already sold, warranty until 2028-11-18 recorded; the Counter's scan box and the printed S/N line not tried)
- [x] Stock → Serial numbers: type part of a serial: where it came from, the invoice, the customer and the warranty show; after a return it is back in stock

**Form card** (any "Add …" key, 2c48232)
- [ ] The card grows out of the key you pressed and folds back into it on close, smoothly (no stutter)
- [ ] Opened from a link (Overview, Ctrl K: ?new=1) it grows from the middle
- [x] Ctrl Enter saves; the faint "Ctrl ↵" cap shows on Save only once Save is allowed
- [ ] Long forms: numbered steps beside the fields, the one you are in amber (local test: numbered steps are there on the payroll form (13 steps); the amber one you're in is for your eye)
- [ ] Phone: the card rises from the bottom, pulling its head down closes it, the body still scrolls

**Payroll people** (on the dashboard)
- [x] Payroll → Add a person: pick an account first; name, phone and email fill in; typed values aren't overwritten.
- [x] People → a team member → "Put on payroll" opens the form already linked; once saved the button reads "Payroll record".
- [x] A person's page shows birthday, phone, email, address and "account · bank".

**Kit polish, last groups** (on /kit)
- [ ] Messages: "With Undo" shows a thin amber line draining at the bottom; pointing at the stack stops it (and every message's clock) and it carries on when you move away; "Problem" has a faint red wash
- [ ] Board: drag a card: a dashed hole stays where it was and the column under it shows a dashed slot; the card rises into its new column. With the keyboard, "Move to" → another column keeps focus on that card's Move key
- [ ] Calendar: the arrows slide the new month in from that side; planned things show a dot before their words, the late one a red square on red
- [ ] Steps: Next fills the line to the next step from the left, Back drains it; Loading: the table placeholder starts with a thin label band

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
- [ ] A business customer's page → Online portal: switch it on, set a smallest order and only some categories, Save; Invite someone with a mobile → Send by WhatsApp opens a chat with the link (local test: switching on, smallest order, only some categories and inviting by mobile work; the WhatsApp chat itself not opened)
- [ ] Open the link on a phone: WhatsApp's preview doesn't use it up; "Open my account" signs in; opening the same link again says it no longer works (local test: the link signs in once and says it no longer works the second time; the WhatsApp preview not tried)
- [ ] Order tab: prices show with and without VAT (wholesale for a wholesale customer), out-of-stock products can still be added, the basket splits without VAT / VAT / total, below the smallest order Send stays off (local test: with/without VAT split and the smallest order block work; wholesale prices and out-of-stock not tried)
- [ ] Send an order: it appears in To do and as an alert; Sales → Online orders opens it (the customer now sees "Seen by the shop"); Accept makes an offer at the order's prices; sell it at the Counter with Deliver it on the demo shop only, and the customer follows Being prepared → On the way → Delivered (local test: alert, Seen by the shop and Accept → offer OF-2026-000001 at the order prices work; selling it at the Counter with delivery not tried)
- [x] Orders → an old order → Order again fills the basket at today's prices; Cancel works only while it says Sent
- [ ] Invoices: invoices and credit notes show; PDF opens the invoice with stamp and signature (local test: the firm's 3 invoices show and the PDF has the stamp and signature; no credit note for that firm, so not seen)
- [ ] Account: balance, due dates and late items match the customer page; the statement prints cleanly and the CSV opens in Excel (local test: balance €120.54 and the open item match the customer page; the statement figures are right; its print and CSV (made in the browser) not tried)
- [ ] Switching the portal off, or removing a person, signs them out at once; the language switch (Shqip/English) sticks (local test: switching the portal off signs them out at once; removing a person and the language switch not tried)
- [ ] Email sign-in: ask for a link on 4vd.app/portal with a portal person's email and it arrives; asking for a link with an unknown email says the same as with a known one (local test: unknown and known email get the same answer; the email arriving not tried)
- [ ] Sales → Online orders → an order → Change order: change a quantity, take one out, add a product, write why, Send the change; the firm gets an email, and the WhatsApp button opens a message with the reason and the link (local test: the change with a reason works; the email and WhatsApp not tried)
- [ ] In the portal: Orders shows a dot and a notice; the order lists what changed (was 5, Added, Taken out, the old total) with the reason; Agree sends it back to the shop (alert + To do), Cancel the order tells the shop too; Accept stays blocked until they agree (local test: change details and old total come through, Agree sends an alert and unblocks Accept; Cancel the order after a change not tried)
- [ ] Portal on a PC: the basket sits beside the products and stays in view while scrolling; Orders and Invoices are tables; on Account the balance and open items sit side by side
- [ ] Offers → an offer → Print and Print as pro-forma show the offer sheet, not a blank page (also the customer statement and the LV note)

**Step 14: stock locations** (sign in as the owner; nothing shows until a second location exists)
- [x] Settings → Stock locations: add "Depo", rename it, make it "Goods come in here"; Stock now has a Move stock tab and stock screens ask which location
- [ ] Move stock: move a few products from Shop floor to Depo by scanning, print the LV note (two signature lines), find it in the list with the period, Excel and PDF, then void it (local test: move, the list and Void (and its refusal when the stock has gone) work; the printed LV note, Excel and PDF not tried)
- [x] On the shelf: the location filter, a shelf minimum on a product page, then Refill from storage and its Bring button opening Move stock filled in
- [x] A bill and an order received land in Depo; a product's page shows how much each location holds (local test: a bill lands in Depo and the product page shows each location; an order received not tried; an order received with no location named lands in the "goods come in here" location)
- [x] A sale bigger than the floor holds takes the rest from Depo and its stock history says "(from Depo)"
- [x] Count only Depo, and only the shop floor; the staff phone count always counts the shop floor (local test: a Depo-only count changed only Depo (4 → 3, the floor kept 7); a shop-floor count and a count with no location are the same count (the second is refused while the first is open))
- [x] Removing Depo is refused while it holds stock or is where goods come in, and the last location can never go

**Step 13: payroll** (sign in as the owner or the accountant)
- [x] Team → Payroll: add a person with a gross pay, one with a net pay, one second job and one at the carwash; check each line of a month on the Months tab against the tax bands (0% to €250, 8% to €450, 10% above) and 5% + 5% pension
- [x] A gross under €350 for a full-time main job warns, and a person who left with leave not taken warns "add them to the last pay"
- [x] Change one person's gross for a month with a reason, confirm the month, then check Books: wages 6500, employer pension 6520, owed 2100/2200/2210/2310 (carwash staff left out)
- [ ] Pay wages from the bank, then Pay ATK: two payments (tax and pension); on a bank statement each matches its own line (local test: two ATK payments (tax 115.38, pension 240.08) and their entries are right; the bank-statement matching not tried)
- [x] Download the declaration (Excel and CSV) and print a payslip; take a payment back, then take the month back
- [x] Record leave taken and a correction; the balance changes; link a person to their 4VD account and, signed in as them, see Account → Pay and leave with only their own payslips

**Step 19: short-dated stock**
- [ ] Mark a food product "Has a best-before date"; a bill line, a bill scan line and a stock-in for it show a Best before field, and the date appears under Stock → Expiring (local test: a bill line with a best-before shows under Stock → Expiring; the Best before fields on the bill, scan and stock-in screens not looked at)
- [ ] Two days before the date: at the Counter the line shows "Short-dated −30%"; tap it once per stickered unit (tapping past the last undoes it); the receipt and the sale charge the lower price for those units only (local test: two days before: −30% offered, a sale of 2 stickered + 1 normal charged 2 × €24.50 and 1 × €35; the Counter tapping not tried)
- [ ] Same on the employee Sell screen
- [ ] Settings → Shop rules: change the days and the discount steps; a category or product with its own days (local test: changing the days and steps changes the offered discount (30% → 50%); a category or product with its own days not tried) (local test: a product with its own 40 days is offered at 20% 32 days before its date; a category with its own days not tried)
- [x] The day after the date: To do opens Stock → Expiring; "Remove as expired" takes it off the shelf (an employee's waits for the owner) and it shows in the books as a write-off
- [x] A count: the Soonest best before field replaces the old dates (local test: counting with a soonest date replaces the two old dates with the one typed)
- [ ] On the shop PC: what the fiscal receipt prints for a short-dated unit (same article, lower price; no separate discount line)

**Step 18: bills by email** (after the setup in docs/DEPLOYMENT.md)
- [x] Forward a supplier PDF from your sign-in email to bills@4vd.app: a waiting scan "By email from …" appears under Bills and in To do, with supplier, lines, VAT and due date filled in
- [ ] Send a clear phone photo of a bill (no PDF): it is read too; an email with only a logo gives a "no PDF or bill photo" update
- [ ] Forward the same PDF again in a new email: an update says it was already received, and no second scan appears
- [ ] Settings → Bills by email: add a supplier's address or @domain; mail from them is read, mail from anyone else never shows up
- [ ] A mail with a faked From, and one carrying a made-up "Authentication-Results: mx.cloudflare.net; dkim=pass…" header, are both dropped (`npx wrangler tail` in mail/; see docs/DEPLOYMENT.md step 5)
- [ ] Under Bills, "Emailed, not read yet": Read now opens the scan; Remove clears it from To do

**Step 12: fixed assets**
- [x] Books → Fixed assets: add something owned before 4VD, with its wear before the books
- [ ] A supplier bill with an equipment line: the asset appears, and its first month posts after the month ends (local test: the asset appears from the bill; its first month posting after the month ends not seen yet (November))
- [ ] Sell one (paid into the till and on a customer's tab), throw one away, then Undo (local test: sold into the till (cash, VAT, loss to 8200 right), scrapped and Undo work; selling on a customer's tab not tried)
- [ ] Split a bill line of several pieces; a credit that gives one back (local test: splitting 3 shelves into 3 × €400 works; a credit that gives one back not tried)
- [x] The year's depreciation and the register in Excel; Next to the books
- [ ] An asset sale on the VAT return and the sales book

**Step 9: products and prices**
- [ ] Prices page: wholesale prices, mark-up, Excel download and upload (local test: wholesale prices from cost at a mark-up, a CSV upload (an unknown product reported, not saved) and saving work; the Excel download and an .xlsx upload not tried)
- [x] Pack barcodes and the new units on a product (local test: a 6-pack barcode at €1,350 scans to the product and adds a 6+ price of €225; a pack price that would beat the 5+ price is refused; the unit changes and saves; the screen itself not looked at)
- [x] Stock → In and out: a stock-in and a stock-out document, then Void

**Step 10: partners**
- [ ] Reading a partner from a photo or pasted text (needs a working ANTHROPIC_API_KEY)
- [x] Paying out a customer bonus (local test: 2% of €123 = €2.46 paid as a credit on the tab, the year then shows paid)
- [ ] Deliver it: the address chips (local test: a saved address and the delivery work; the chips on the Counter not looked at)
- [x] The delivery line on an invoice (local test: "Deliver to <address> · 19 November 2026" prints on the invoice)

**Step 11: settings and safety**
- [x] Print an invoice with the stamp and signature (local test: with a test stamp and signature uploaded, both print on the invoice and the portal PDF)
- [x] Ring up a Counter sale after changing the number format (local test: after VF / yy / 4 digits the next invoices were VF-26-0029, 0030, 0031)
- [ ] Settings → Recycle bin: bring back a product, supplier, customer, expense and file (local test: product, supplier, customer and expense go to the bin and come back; a file not tried)

**Step 8: sales documents**
- [x] Offers, deliveries and pay-later as a whole (local test: an offer sold on the tab with a delivery: the offer says sold, the delivery goes On the way then Delivered, the tab is paid against that invoice; question: with "pay at the door" the invoice is due on the delivery day, not the due date typed)

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
- [x] 5. Counter: barcode scanner selling, several receipts open at once, the Datecs FP-550 fiscal printer through F-Link (receipts, X and Z reports, sending the item list to the printer), receipt footer text; cashier patterns (voids, refunds and drawer opens without a sale, per person)
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
- [x] 16. Production (recipes, semi-finished goods), serial numbers, projects. Done 2026-11-16: three switches in Settings → Features. Projects go on bills, expenses, invoices, stock out and damage, with a profit-by-project report (Excel, CSV, Print). Make turns parts into a product at their cost at one location (made ahead, no books entry, voidable). Serial numbers with a warranty: recorded at intake, asked for at the Counter, printed on the invoice, looked up on their own page, freed by a return
- [x] 17. Yearly declarations (CD / PD). Done 2026-11-16: Books → Declaration. Settings → Business details has the legal form: a company files the CD (10%), an individual business the PD (personal bands, 0% / 8% / 10%, a default to confirm). Read from the books: income and costs by kind, the carwash kept outside the books as two lines behind a switch (on), profit typed before the books start; representation and donations above their limits added back by 4VD (changeable), fines and other lines typed; losses carried 6 years (from years closed or filed in 4VD, plus TREFIN years typed); the year's TM taken off (by the year they belong to); Pay the rest from a till, the safe or a bank; Mark as filed locks it (the change is flagged if the books move), reopened with a reason; To do from 1 January until filed; Excel and Print/PDF. No ATK file: the layout is 4VD's own until ATK's form is known
