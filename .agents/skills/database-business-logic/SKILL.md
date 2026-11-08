---
name: database-business-logic
description: Preserve and assess Data-base commercial logic when changing import, enrichment, campaigns, distribution, sales, CRM typifications, recycling, exports, or dashboard indicators. Use for business-rule implementation or review; not for purely visual work.
---

# Data-base business logic

Use this skill before changing commercial or recycling behavior. Read
[`references/current-state.md`](references/current-state.md) and the current
[`docs/REGLAS_INVIOLABLES.md`](../../../docs/REGLAS_INVIOLABLES.md) first.
The latter prevails if they differ.

## Operating rules

- Distinguish **approved business rule**, **implemented behavior**, **gap**, and
  **undecided policy**. Never turn a gap or an assumption into a rule.
- Preserve original rows, identifiers, source files, chronological CRM
  managements, immutable recycling snapshots, and audit events. Exclusion is
  not deletion.
- Treat the server and persisted data as authoritative. Revalidate sales,
  reservations, campaign eligibility, and ownership inside transactions; UI
  state and previews never authorize a commercial action.
- A confirmed external sale blocks globally and permanently. An active
  reservation blocks redistribution/recycling until an explicit audited
  release. A CRM sale label alone is not a confirmed external sale.
- Use only normalized Spanish mobile numbers (`+34`/`0034` accepted; nine
  digits beginning 6 or 7) as contact identity. Do not use row position or
  filename as identity.
- MOCK is development evidence only: it cannot authorize commercial
  distribution. API_REAL, CRM, EXCEL, and MOCK stay distinguishable.
- Keep the 24-column CRM contract and batches of at most 100 records where
  commercial export applies.
- Sozar requires explicit authorization. Do not open shared/bulk gates, retry
  uncertain outcomes, log protected values, or infer undocumented response
  fields.

## Change workflow

1. Locate the relevant service and its regression tests listed in the
   reference. Read the affected implementation, not only the component.
2. For a proposed rule change, name its classification and identify affected
   persisted history, transaction boundary, and regression cases.
3. If approval or policy is missing, preserve the conservative current
   behavior and report the decision required. Do not silently relax a blocker.
4. For a schema change, use an additive migration, Test-only validation, and a
   recovery plan. Never use `db push` or mutate Production without explicit
   authorization.

## Routing

- Import/cleaning and source contracts: read **Import and enrichment**.
- Campaigns, lots, reservations, sales, or commercial XLSX: read **Commercial
  distribution**.
- CRM files, legacy/global recycling, or tipifications: read **CRM and
  recycling**.
- Real Sozar work: also read **Sozar** and stop before any billable request
  unless the user explicitly authorizes that exact request.

The reference identifies known divergences; do not “fix” them while doing an
unrelated task.
