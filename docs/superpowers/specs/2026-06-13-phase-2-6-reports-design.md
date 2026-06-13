# Phase 2.6 — Reports (Control Dashboard) Design

## Goal

Read-only control dashboard with five report families:
1. **Sales** — monthly revenue, hospital-wise, service-wise.
2. **Expense** — category-wise, monthly.
3. **Profit** — Sales − Expense (a derived single-line view).
4. **Reference** — total business given vs. commission paid, per reference.
5. **Cash/Bank** — running balance, In vs Out, per mode.

Every report is just an aggregation over data shipped in 2.1–2.5. Reports do not introduce new state, only computed views and export.

## Non-goals

- Scheduled report email delivery.
- Charts beyond the basics already in `frontend/src/pages/dashboard` (we reuse the same chart stack).
- Custom report builder. Filters are fixed per report.
- Drilling all the way down to PDF previews from a report row — the row links to the relevant detail page instead.

## Source of truth per report

| Report | Reads from |
|---|---|
| Sales — monthly revenue | `invoices` where status in (issued, partially_paid, paid), grouped by `month` |
| Sales — hospital-wise | same, grouped by `hospitalId` |
| Sales — service-wise | `invoice_line_items` grouped by `billingServiceNameId` (TPA Desk lines aggregate under one bucket) |
| Expense — category-wise | `expenses` grouped by `categoryId` |
| Expense — monthly | `expenses` grouped by `date_trunc('month', date)` |
| Profit | sum(Sales monthly) − sum(Expense monthly), aligned by month |
| Reference — business given | `invoice_line_items` joined to `hospitals.referenceId`, summed |
| Reference — commission paid | `expenses` where categoryId='reference_commission', grouped by `referenceId` |
| Cash/Bank — balances | `/api/cash-bank/balances` (already exists in 2.3 with contras from 2.4) |
| Cash/Bank — In vs Out | `cash_bank_entries` grouped by `direction`, optionally by `mode` |

## API surface

One controller, one prefix:

```
GET /api/reports/sales              ?from&to&hospitalId&groupBy=month|hospital|service
GET /api/reports/expenses           ?from&to&categoryId&groupBy=month|category
GET /api/reports/profit             ?from&to → [{month, sales, expense, profit}]
GET /api/reports/references         ?from&to&referenceId → [{referenceId, name, businessGiven, commissionPaid, commissionPending}]
GET /api/reports/cash-bank          ?from&to&mode&groupBy=day|month|mode → [{bucket, in, out, net, runningBalance}]
GET /api/reports/dashboard          → summary tiles: this month's sales, expense, profit, cash balance, top hospital, top reference
```

Each endpoint returns a normalized shape:

```json
{
  "filters": { "from": "...", "to": "...", "groupBy": "month" },
  "totals": { "sales": 123456, "rowCount": 12 },
  "rows":   [ { "key": "2026-04", "label": "Apr 2026", "value": 12300, "...": "..." } ]
}
```

The same shape feeds both tables and charts in the UI.

### Export

Reuse existing claim-list export pattern (`backend/controllers/claimController.js` uses csv/xlsx libraries already). Each report endpoint accepts `?format=xlsx|csv` and streams the rows.

RBAC module name: `reports`. Granular per-report view permissions could be added later; v1 ships as one module.

## UI surface

```
/reports                       — landing with five report cards (Sales / Expense / Profit / Reference / Cash-Bank) + Dashboard tiles
/reports/sales                 — date range, groupBy toggle (Month | Hospital | Service), chart + table + export
/reports/expenses              — same pattern; groupBy (Month | Category)
/reports/profit                — single chart: bars for sales & expense per month + line for profit
/reports/references            — table: reference / business given / commission paid / commission pending (= business * rate − paid)
/reports/cash-bank             — balance tiles (Cash/Bank/UPI/Total) + In-vs-Out chart + filterable ledger snapshot
```

Existing `/reports` page (claims-report list) stays. We rename the route to `/reports/claims` and turn `/reports` into the landing hub. Existing claim-report link continues to work via a redirect.

## Profit computation

```text
profit(month) = sales(month) − expenses(month)
```

Where `sales` is the **issued net total** (`Invoice.netTotal`, excluding `previousBalance`) for invoices issued in that month, and `expenses` is all expense rows dated in that month. Cash/Bank entries don't affect profit (they are payment timing, not income/cost recognition).

This is a cash-ish "operational profit" — not GAAP. Documented in the UI as such.

## Edge cases

| Case | Behaviour |
|---|---|
| Invoice voided after issue | Excluded from sales sums (status='void' filter). Profit recomputes. |
| Expense row was auto-created then later voided invoice → expense deleted | Both removed from profit; consistency by construction. |
| Reference business given (gross) vs commission paid | `commissionPending = sum(business * rate) − sum(paid)`. Negative result = over-paid; UI shows in red. |
| Hospital deleted | Restrict already enforced on invoices (per 2.1). Soft-delete preserves report history. |
| Date range crosses a financial year | No special handling; reports group by month, FY boundaries are visual via month labels. |
| Empty range | Returns `totals.rowCount=0`, `rows=[]`. UI shows empty state. |
| Service-wise grouping when many TPA Desk lines | All `billingServiceNameId=TPA Desk` lines collapse to one row; same for NABH/Empanelment/Doc Processing. |

## Performance notes

- All reports execute as a single Postgres query each via Prisma `groupBy` or `$queryRaw` for the trickier ones (e.g. profit which spans two tables).
- Default range cap: 24 months. Beyond that, UI requires explicit "all time" toggle and warns.
- No materialized views yet. Add if `/reports/dashboard` exceeds 300ms on real data.

## Testing

- **Unit:** profit math, reference commission-pending math.
- **Integration:** seed 3 hospitals, 6 months of invoices + expenses; assert each report returns expected totals; assert export streams.
- **Manual:** dashboard tiles match the figures shown in individual report pages for the same month.

## Migration & rollout

No schema changes. Pure read endpoints + a new UI section.

## What 2.6 does NOT include

- Scheduled email reports.
- Custom report builder.
- Drill-through PDF preview.
- Forecasting / trend lines beyond a simple month-over-month delta.
