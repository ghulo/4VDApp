---
target: whole admin dashboard
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\labid\\desktop\\4vdapp\\admin\\src\\pages\\OverviewPage.tsx"
target_fingerprint: "sha256:d4e0ad5413f48f8872c1cc10bab63ed94a6a4a143e1e70be87cb9570dd527533"
target_path: "C:\\Users\\labid\\desktop\\4vdapp\\admin\\src\\pages\\OverviewPage.tsx"
timestamp: 2026-10-03T18-01-43Z
slug: admin-src-pages-overviewpage-tsx
---
# Critique: 4VD admin dashboard (whole app), 2026-10-03
Method: dual-agent. Score 28/40 (Good, weak on consistency + minimalism).
Heuristics: 1=3 status (Alerts/Approvals disagree) 2=3 (77,093.7% badges) 3=3 (People Remove w/o confirm) 4=2 (Start promotion full-width, salmon disabled primaries, Hi Admin header, ⋯ link looks like menu, 2 primaries in Settings) 5=3 6=3 (Activity flooded by logins) 7=3 8=2 (Overview pile-up, figures repeated 2-3x) 9=3 10=3.
Detector: 0 CLI findings; browser 3x dark-glow (sidebar badge shell.css:209, highlight ui.css:784, today board pages.css:167), documented in DESIGN.md but this critique recommends removing them.
Priority issues:
- P1 Overview pile-up: board + 4 tiles + 5 analytics cards + attention + restock + dot chart + best sellers; 2450px desktop / 3430px phone. Fix: today / waiting / restock only; analytics + chart to Reports; remove StatGrid.
- P1 Orange everywhere (board, checklist, highlight, glow). Fix: board becomes paper card, orange only for primary action + current nav.
- P1 Phone overflow: Sales 546px, Promotions 442px at 375px; Reports tables clipped; dates wrap. Fix: min-width:0, stacked rows <600px, short nowrap dates.
- P2 Decoration without meaning: dashed rails, corner nodes, glow, dot-matrix chart. Fix: drop in app, keep halftones for sign-in/empty/brand; plain bars.
- P2 Machine numbers: 77,093.7%, Down 100%, €187.5K; stale approval alerts. Fix: capped wording, "No sales yet today", resolve alerts when decided.
- P3 People rows 5 controls; salmon disabled primary; full-width Start promotion.
Personas: owner text 14px too small, top bar clutter, unlabeled logout; Alex wants sales filters, Activity w/o logins; Sam 30 tab stops in dot chart.
Direction: keep grouped sidebar, warm neutrals, hairline tables, settings rows, Ctrl K, orange for one action; add a serif for page titles (Source Serif 4), 15-16px body, more room, sentence summaries; drop rails/nodes/glow/dot chart in working screens.
