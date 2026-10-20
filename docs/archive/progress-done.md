# 4VD progress: finished

Sections moved out of `progress.md` on 2026-10-20 once every item was done. Kept for history; nothing here is open.

## Flow overhaul

- [x] Phase 1: dashboard menu organised by job, one Inbox for approvals and alerts
- [x] Phase 2: supplier and customer pages, with bills, orders and invoices linking back
- [x] Phase 3: Shop day
  - [x] Backend: end-of-day checklist (cash, carwash, expenses, approvals) and a "No expenses today" tick
  - [x] Dashboard: "Close the day" checklist on Money → Day, plus a link from Overview
  - [x] Team app: Home shows what to do next, selling one tap away, "End shift" leads to the cash count
  - [x] tsc, lint and tests in admin, backend and mobile
  - [x] Playwright screenshots at 375 and 1440, fix what shows up
  - [x] Squash-merge into main, push, delete branch, check GitHub checks, update work-queue.md
- [x] Phase 4: full visual polish of every screen in both apps (light and dark, EN and SQ)
  - [x] Pass 1: screenshot every dashboard screen (1440 + 375) and the team app's main screens, fix what shows up (cash check layout, close-the-day badges, card corners, product page spacing, Inbox columns, shorter phone lists for sales and activity, device list capped)
  - [x] Pass 2: team app sub-screens checked; sale screen shows products on the shelf when there are no favourites, Tabs intro, phone filters tidied, accessibility and design-guideline review done
  - [x] You look it over locally and say yes, then merge and push
- [x] Phase 5: hardening, and update the out-of-date PRODUCT.md
  - [x] Security audit of all three apps (backend and dashboard clean; team app findings are only in Expo's build tools, patched to Expo's latest)
  - [x] Server: crashes are logged and alerted, then it restarts clean; shutdown can't hang; the minute-by-minute report job never overlaps itself
  - [x] Both apps show a calm "something went wrong" with a way back instead of a blank screen
  - [x] PRODUCT.md brought up to date (Albanian built, domains, everything the app does now)

## Requests 2026-10-10

- [x] Shop float editable right where the drawer is counted (usually €150, sometimes not), and the float used shows in reports
- [x] Tabs show more detail: who added each charge, who took each payment, and the time (hour:minute)

## Look (DESIGN.md gap list)

- [x] Warm status colours and an ink focus ring in both apps
- [x] Buttons: thinner 2px edge, no jump on hover, disabled buttons sit flat instead of half see-through
- [x] Glass: one clean recipe; the top bar only turns to glass once the page scrolls under it
- [x] Overview: what needs you comes first and largest; the Today panel is a slim strip with a small sunrise; zero counts hidden; title is "Overview"
- [x] Reports: big figures drop the cents, rises say a number ("12×") instead of "Much more", one huge day no longer flattens the graphs, cards line up in even rows
- [x] Every table is the shared table component (Sales, Promotions, Orders, stock count, price history, Reports, chart "Show as table"), so none sits as a box inside a card
- [x] Dashboard styles use only the rulebook sizes: no 14px or 20px text, spacing on the 4px grid, named corner sizes
- [x] Team app text uses named sizes (no typed-in numbers); screen titles in the serif, 700 weight only in the wordmark
- [x] Branded canvas in both apps: the four pillars woven very faintly; Overview opens with a hero (date, greeting, the shop at sunrise on the page rule)
- [x] Settings and Profile list their sections beside the page (chips on a phone)
- [x] Product page: form left, barcode and price history right, sticky Save bar
- [x] Record a sale, Count a drawer and Add an expense open in a side panel instead of sitting in the middle of the list pages
- [x] Reports split into tabs (Daily & weekly, Analytics, Team, Profit, Downloads); the period carries across
- [x] You look it over locally and say yes, then merge and push

## Logic gaps (DESIGN.md 13, items 1-6)

- [x] Menu names match page titles (Stock, Sales, Day, Reports), tabs name the views
- [x] One list of what needs you (To do), worked out from the shop's state, clears itself; badge, Inbox, Overview and team Home all use it; alerts become Updates that never count
- [x] Overview refreshed (2026-10-12): To do grouped like the Inbox (top six), figure tiles under Today (profit, carwash, restock, closing checks), 30-day chart on a baseline with the outlier capped, restock top five and hidden when empty, no paper grain, calmer dark-mode light
- [x] Product stock card (2026-10-12): − / + stepper, "20 → 23 after this" preview, alert level under the number and under its own heading
- [x] One page per product (2026-10-12): Stock and Details tabs at /products/:id, old /inventory/:id links redirect
- [x] Day page: one date with the close-the-day checklist, drawer counts, carwash and expenses; steps defined once on the server and read by both apps
- [x] End your shift: steps show done / to do and each open one opens its step
- [x] Sales history lists checkouts; a sale opens to show its lines
- [x] Team app tabs Home, Products, Sell, Account; Favourites is a filter on Products; Home has "Something happened"
- [x] Checks, screenshots at 375 and 1440, then you look it over before merge

## Ask, made better (branch ask-better, on top of logic-gaps)

- [x] Real conversations: follow-ups remember the chat; chats are saved per person, reopen and delete
- [x] Knows the whole business: day-by-day sales, expenses, open supplier bills, customer tabs, carwash takings, drawer counts
- [x] Answers can carry a table, a bar chart and links to the products, suppliers, customers, bills or pages they mention
- [x] New page look: chat list beside the conversation, starter questions, bubbles, pinned question box
- [x] You look it over locally, then merge (after logic-gaps) and push

## Stock and Sales pages, made better (branch better-stock-sales)

- [x] Stock: tiles for stock value, low, out and runs out this week; each filters the list
- [x] Stock: filter chips, category picker, sorting (emptiest, runs out soonest, name, value)
- [x] Stock: status tag and value on each row; Order button opens a new order with that product and its usual supplier
- [x] Sales: Today / Yesterday / This week / This month / Custom
- [x] Sales: revenue, profit, sales and average sale against the period before, with a revenue graph
- [x] Sales: checkouts grouped under each day with the day's total; search by product or invoice; click a row to open it; Returned badge
- [x] Analytics: best days of the week, busiest hours, revenue by category, top 10 products, team leaderboard
- [x] Team: leaderboard chart; each person opens their own page (figures against the period before, target progress, daily graph, hours, weekdays, top products, categories)
- [x] Downloads: each file as a card; Excel workbooks with a 4VD title band, euro and date formats, filters and a totals row; CSV kept plain for imports
- [x] Merged and pushed

## Buying, made better (branch buy-section)

- [x] One Suppliers menu item with tabs: All suppliers · Orders · Bills (old links still work)
- [x] All suppliers: what you owe, overdue, on the way, running low; search; last delivery; Order button per supplier; add a supplier in a side panel
- [x] Orders: one list with On the way / Needs a bill / Cancelled and a supplier filter; each row shows its next step (Receive, Add the bill, bill to pay)
- [x] New order is its own page: supplier, what is running low, price per line, a summary with the estimated cost
- [x] Order page: copy the order text, receive the delivery right there, cancel only after a confirm
- [x] Bills: every bill in one list, most urgent first; Unpaid / Overdue / Due this week / Paid / All; one supplier only via the filter or their page; Pay button; total left to pay; add a bill on its own page
- [x] Bill page: paying sits beside the payments, photo and details
- [x] Merged and pushed together with the invoice work

## Scanning supplier bills (branch bill-scanning)

- [x] Scan a bill on the Bills tab (photos or a PDF, up to 6 pages); Claude reads it (about 5-10 cents a bill)
- [x] Check page with a stamp per line: Matches / New price / New product / Barcode differs / Not sure
- [x] Per line: link to a product, add it as new, or skip; pieces per box; cost of one piece; update cost; update barcode
- [x] Warns on a bill number already saved and on lines that do not add up to the printed total
- [x] Confirm adds new products, receives the stock (into the open order from that supplier, if any) and saves the bill with its photo
- [x] Remembers each supplier code and box size, so the next bill matches by itself
- [x] Team app: Home > Something happened > A supplier brought goods; photos go to the owner, no costs shown
- [x] Waiting scans show on the Bills tab and in To do
- [x] Developer can reopen a confirmed scan: stock, bill (and payments), order, costs, barcodes, codes and new products are put back; the check page starts from the earlier choices

## History on every record

- [x] History card on product, bill, order, supplier, customer, invoice, scanned bill and Settings > Your shop
- [x] An invoice's history includes its sales, their undos and returns, and its credit notes
- [x] Now logged too: invoices and credit notes issued, shop details (field by field), cost changes from deliveries and scans, scan confirmed / reopened

## Fuller history, restore and country flags (branch record-history)

- [x] Every History card shows what changed, before → after, in plain words (prices as money, countries by name, roles by title)
- [x] Team: a person's History (role changes, blocked/allowed, renames) inside Manage
- [x] Product: "Barcodes it has had", with when and by whom; scanned bills and reopening log their barcode changes too
- [x] Developer only: "Restore to this point" on products, people, suppliers, customers and the shop; shows what goes back, then "Are you sure?"; refused if it changed meanwhile; logged and restorable again
- [x] Product Country field with flag, filled in from the barcode prefix (where the brand registered it), editable; existing products filled in
- [x] Labels: "Show the country's flag next to the price" switch
- [x] Merged and pushed

## Team app: requests and decisions (branch team-app-requests)

- [x] Owner can add and change products (dashboard and phone); deleting stays with admins and the developer
- [x] Team app: Home > Something happened > We got something new: scan, name, price, category, photo, how many on the shelf
- [x] An employee's new product waits as a request; the owner, admins and developer get an alert; approving (price/category can be fixed) puts it in the shop, rejecting needs a reason; the employee is told and sees it under Your requests
- [x] Dashboard Inbox: "New products" card with photo, flag, price and category to fix
- [x] An employee's scanned bill alerts the owner, admins and developer
- [x] Phone, for whoever runs the shop: Requests screen (new products, scanned bills, returns, damage and loss, stock counts), opened from To do or by tapping the alert
- [x] Phone: a simple scanned bill (known supplier, all lines matched, totals add up) is confirmed on the phone; anything else says to finish it on the computer
- [x] Phone: product page shows the country flag; whoever runs the shop can change name, price, category, barcode and photo
- [x] "The day is closed" alert to the owner, admins and developer, once a day, when the last step is done (from 18:00), with the day's numbers; opens that day; under the "Cash and closing" alert switch
- [x] "Send it to me now" (reports) turns alerts on in that browser first, so the browser asks to allow them; says clearly when they are blocked and how to unblock
- [x] Merged and pushed

## Alerts that actually arrive

- [x] Live server has its own Web Push keys (set on Render)
- [x] Turning alerts on (or sending a test or a report to yourself) registers the device again, and starts over if it was made with old keys
- [x] "Send a test alert" sends at once and lists every device: accepted, or refused with the reason Apple, Google or Microsoft gave
- [x] Merged and pushed

## Customers and Promotions, made better (branch customers-promotions)

- [x] Sales stay anonymous by default; at the till (dashboard and team app) a registered customer can be picked, then Paid now or On their tab
- [x] Customers: tiles for owed, overdue, bought this month and credit; search, filter chips (All / Owes / Overdue / Firms), sorting; spent this year and last purchase per row; add in a side panel
- [x] Customer page: owes, spent this year, purchases and average, last purchase; tab with payments beside what they buy most; purchases and invoices with how each was paid; edit in a side panel
- [x] Statement of account to print or save as PDF; Remind on WhatsApp with the amount filled in
- [x] Promotions: tiles for running, starting later, discount given and sold on promotion this month; Running / Starts later / Past; sold and discount per promotion; end or cancel after a confirm
- [x] New promotion in a side panel with quick dates and a live preview of every new price, profit each, and products below the minimum margin
- [x] Promotion page: sold at its price, revenue, discount given, profit, and what it covers against the same number of days before, with a day-by-day chart; Run again
- [x] Merged and pushed

## Inbox, Activity, Settings, Profile and People, made better (branch team-pages-polish)

- [x] Inbox To do: summary tiles, grouped Urgent / To check / Ideas, icon per kind, one main action, "All clear" empty state
- [x] Inbox Updates: grouped by day, filter chips, tap opens and marks read, mark as read on hover
- [x] Activity: grouped by day, icon per kind, avatars, clickable names, search + person/kind filters, phone layout; fix broken characters in names
- [x] Settings: each section its own page; carwashes as a list with a side panel; Before launch checklist with progress; danger zone
- [x] Profile: each section its own page; header card; proper switches; devices grouped with real names
- [x] People: tiles, role/status chips, last active, sales vs target; invite in a side panel
- [x] Person page: sales vs target, commission, refunds and write-offs, cash differences, recent activity, devices, manage
- [x] Merged and pushed

## Team app catches up (2026-10-13)

- [x] Pass 1, Selling: Sell screen with photo tiles and stock, receipt-style basket, − / + steppers, proper total and checkout key, title "Sell"; products without a photo show the box icon like the dashboard; Clear can be undone
- [x] Pass 2, Home and shift: one clay key, To do first (calm words when empty), the day as a slim strip, End shift with tick circles, My sales as whole sales with returns and the invoice from the sale; undone sales no longer show in sales history (dashboard too)
- [x] Pass 3, the rest: lighter Products list, Account reorganised into sections like the dashboard Profile (with segmented switches) and gaining Security (change password) and Devices (where you are signed in, sign out others), better headers and forms on sub-screens, open wording gaps, EN/SQ light/dark checked; form screens in raised panels; selected chips and switches now tell screen readers they are chosen

## UI audit fixes (branch ui-audit, see docs/archive/UI_AUDIT.md)

- [x] B1 Dates read like "14 Oct" in To do and Activity; "cash check" and "mobile app" wording gone
- [x] B1b Activity and request lines read in the reader's own language
- [x] B2 Tables sit on the page under their heading, never inside a card
- [x] B3 Metric rows even, big figures without cents, zeros as calm words, Overview greeting on the type scale
- [x] B4 One huge day no longer flattens any chart
- [x] B5 Healthy stock is quiet (stamps only for low and out); team app Products on one surface
- [x] B6 Dashboard on a phone: no empty "–" lines, tidy Stock toolbar, To do first on Overview, whole Sales row opens
- [x] B7 Busy buttons keep their label; team app gets a small key
- [x] B8 Team app matches the dashboard: stamps, segmented track, header sizes, favourites star, picker titles, error state, 44px targets
- [x] B9 Sell tiles without a photo give the name and price the room
- [x] B10 Every date field reads day / month / year
- [x] B11 Dashboard basket looks like a receipt
- [x] B12 Rulebook and design tooling match the code

## Requests 2026-10-15

- [x] Windows app (Electron, desktop/) that opens the live dashboard; install on any PC from dashboard.4vd.app/download, updates itself from GitHub Releases

## TREFIN data (2026-10-16)

- [x] Importer: products, barcodes, suppliers, customers and sales history in one command (tried on a test copy)
- [x] Products sorted into 20 real shop categories
- [x] Possible duplicates page: merge or keep each pair
- [x] Several barcodes per product; merging keeps them all
- [x] "TREFIN imported" step on the Before-launch list
