# Phase 2.5 — Reference Commission Auto Flow Design

## Goal

When an invoice is **issued**, automatically create Expense rows (category = Reference Commission) for the hospital's linked Reference, based on which of the invoice's line items hit a service the Reference is eligible for. Eliminates manual commission bookkeeping.

This is the "power feature" the brief calls out. Everything it needs already exists by the time we get here: Reference master (2.0), invoice line items with `billingServiceNameId` and `referenceIdAtIssue` snapshot (2.1), Expense rows with `sourceType='invoice_commission'` idempotency key (2.2).

## Trigger

Single hook: `POST /api/invoices/:id/issue` succeeds. The engine runs inside the same transaction as the issue, so issue + commission either both happen or neither does.

We deliberately do NOT trigger on:
- Draft creation — drafts can be discarded; would generate spurious expenses.
- Payment received — commission is owed on issue, not on collection. (Operator can defer paying the commission, but it's already on the books.)
- Claim `isBilled` flip alone — that flip happens inside invoice issue; one trigger covers it.

## Algorithm

```text
Inputs: invoiceId
Run inside the issue transaction.

1. Load invoice with lineItems, hospital (incl. reference + applicableServices).
2. If hospital.referenceId is null or hospital.reference.isActive=false → no-op. Done.
3. For each lineItem where lineType IN ('claim_tpa_desk', 'service_fixed', 'service_percentage'):
     - If lineItem.billingServiceNameId is null → skip (cannot match without it).
     - If reference.applicableServices does NOT include lineItem.billingServiceNameId → skip.
     - commissionAmount = round(lineItem.amount * reference.commissionRate / 100)
     - If commissionAmount <= 0 → skip.
     - Create Expense:
         date           = invoice.issuedAt
         categoryId     = (lookup expense_categories where slug='reference_commission')
         amount         = commissionAmount
         referenceId    = hospital.referenceId
         notes          = "Auto: ${reference.name} on ${lineItem.description} (Invoice ${invoice.invoiceNumber})"
         sourceType     = 'invoice_commission'
         sourceId       = invoice.id
         sourceLineId   = lineItem.id
         createdById    = invoice.issuedById
4. The (sourceType, sourceLineId) unique index guarantees idempotency if step is re-run.
```

**Adjustment lines (`lineType='adjustment'`) are skipped.** They carry no `billingServiceNameId` and represent manual operator additions; commission on them would be guess-work. If the operator wants commission on an adjustment, they create a manual Reference Commission expense row.

## Void / reissue interaction

When an invoice is voided (`POST /api/invoices/:id/void`):

```text
1. Inside the void transaction:
     DELETE FROM expenses WHERE source_type='invoice_commission' AND source_id=:invoiceId
2. Operator sees the commission rows disappear; their referenced reference's
   "Commission paid" tile in the Reference report drops accordingly.
```

Reissue (rare): if an invoice is voided then a new one is generated for the same month, the new invoice has a new `id`, so the engine writes a fresh set of expense rows. No collision with the deleted ones.

## Snapshot fidelity

Commission is calculated from values captured at issue time:
- `reference.commissionRate` — read live (the rate at issue).
- `reference.applicableServices` — read live.
- `lineItem.amount` — already a snapshot.

Once the Expense row is written, **changing the reference's rate or applicable services does NOT update existing rows.** Past commission stays as paid/owed. New invoices use the new rate.

This deliberate choice (vs. recomputing on read) keeps the Expense ledger immutable for closed periods.

## API surface

No new endpoints. The engine is internal — called from the invoice issue controller.

One read endpoint is useful for the Reports module (2.6) but lives in Expense:

```
GET /api/expenses?categoryId=<reference_commission>&referenceId=<X>&from&to
```

already covers "commission paid to reference X". Already specified in 2.2.

## Edge cases

| Case | Behaviour |
|---|---|
| Hospital has no reference | Engine no-ops. No expense rows. |
| Reference has zero applicable services | Engine no-ops. Operator missed configuration; rerun by void+regenerate after fixing. |
| Line amount is 0 (e.g. waived service) | Skipped (commissionAmount=0). |
| Reference rate is 0 | Skipped. |
| Reference soft-deleted between hospital save and invoice issue | Engine no-ops on issue (isActive check). Invoice still issues. Operator notified via response payload (`commissionAutoFlow: { skipped: true, reason: 'reference inactive' }`). |
| Multiple invoices issued in same month for same hospital (after a void) | Only the live (non-void) invoice has commission rows. |
| Service appears twice in same invoice (e.g. two claims, both TPA Desk) | Two expense rows, one per `sourceLineId`. Correct — commission is per service line, not per service type. |
| Percentage line where amount was rounded | Engine uses the rounded line amount. Consistency with invoice display > tax-grade precision. |
| Race: two operators hitting `/issue` concurrently | Issue endpoint already locks via transaction (per 2.1 sequence-race handling). Engine runs inside that transaction. Idempotency unique index is the belt-and-braces. |

## Observability

- The issue endpoint response includes a `commissionAutoFlow` summary: `{ rowsCreated, totalAmount, skipped: false }` so the UI can confirm.
- Audit log entry on invoice timeline: "Issued: 7 service lines → 4 commission entries (₹3,250) for [Reference Name]".

## Testing

- **Unit:** the engine function `computeCommissionForInvoice(invoice, hospital, reference)` → `[{amount, sourceLineId, ...}]`. Test all skip cases.
- **Integration:**
  - Issue invoice with hospital→reference→2 of 4 services applicable. Assert exactly the right rows in `expenses`.
  - Void → assert rows gone.
  - Re-run issue (forced) → no duplicate rows.
  - Hospital without reference → no rows, issue still succeeds.
- **Manual:** Reports "Reference Commission paid" reflects auto rows.

## Migration & rollout

No schema changes (all needed columns ship in 2.0 / 2.1 / 2.2). Ship as a controller-layer change to the invoice issue/void endpoints.

## What 2.5 does NOT include

- Commission on direct-patient claims (`Claim.isDirectPatient=true`) — those don't have a hospital and therefore no reference. Engine no-ops naturally.
- Multi-tier commissions / sub-references.
- Manual commission overrides per claim (operator can edit invoice line amounts before issue if they need to influence the math).
- Commission payment tracking (that's a 2.3 Cash/Bank OUT entry against the Expense row, no new logic needed).
