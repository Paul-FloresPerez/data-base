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
  reservation prevents simultaneous redistribution, but it is not a permanent
  veto on a later authorized recycling cycle. A CRM sale label alone is not a
  confirmed external sale.
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

## Recycling cycles and authorized reservation transition (Phase 3)

The following distinguishes approved policy from the currently implemented
server path. Preserve this distinction when evaluating a future change.

### Approved policy

- A normalized mobile appears only once in each confirmed distribution cycle.
  Reservations prevent simultaneous incompatible assignments; they do not
  prohibit a future recycled distribution that passes all current controls.
- The administrator decides when to recycle and which CRM typifications are
  included for that execution. There is no mandatory fixed interval between
  distributions. Historical `AGENDADO` and `INTERESADO` are retained as
  evidence, not automatic vetoes.
- Confirmed sales remain globally and permanently excluded. Robinson or an
  explicit no-contact instruction remain mandatory exclusions. Trusted current
  operator and commercial permanence still require verification, and MOCK
  cannot be represented as `API_REAL` or authorize commercial distribution.
- A valid candidate must not require a prior manual release merely to enter a
  new recycled distribution. When the new distribution is confirmed, the
  relevant prior captured assignments must close atomically and audibly with
  the new ones. All cycles, lots, reservations, sales and CRM managements
  remain historical.

### Implemented Phase 3 path

- `lockCommercialMobiles` uses deterministic, transaction-scoped PostgreSQL
  advisory locks for the normalized mobiles. `completeBaseSave` takes those
  locks before rechecking confirmed sales and confirming lots.
- Global Recycling snapshots retain `activeReservationIds`. Generation accepts
  a still-active reservation only when its identifier matches that immutable
  snapshot; a later or unrelated reservation rejects the new confirmation.
- In the same Prisma transaction, `completeBaseSave` validates the global
  execution and `ELEGIBLE` decisions, closes only captured active reservations,
  creates the replacement lots and active reservations, and writes the
  `TRANSICION_RECICLAJE_AUTORIZADA` audit event. A rollback leaves neither a
  partial replacement nor a silent release.
- The transition is idempotent: a repeated confirmation cannot create another
  active assignment. The active-reservation uniqueness constraint remains the
  final database guard. Generated recycled bases preserve server-side snapshot
  evidence when reopened for distribution.

### Scope still pending or deliberately unchanged

- The existing explicit individual-release endpoint remains the manual path.
  Phase 3 did not add a bulk-release interface, scheduled release, or a
  general permission to release reservations outside an authorized transition.
- Legacy and initial-distribution flows retain their previous controls. Do not
  route them through a recycling transition unless they carry an immutable
  Global Recycling execution and its captured reservation evidence.
- Do not describe a snapshot-only preview as a transition: no reservation is
  closed until the server confirms the new commercial lot.

### Required regression controls for this path

- A captured active reservation can transition only with its matching
  snapshot; a changed reservation rejects without new lots, reservations or
  partial audit state.
- Repeated and concurrent confirmations produce one replacement cycle per
  mobile, preserve the prior reservation as historical `LIBERADA`, and retain
  `TRANSICION_RECICLAJE_AUTORIZADA` evidence.
- Sales, Robinson/no-contact, invalid mobile, unverified operator,
  insufficient permanence and MOCK provenance continue to prevail over a
  selected typification or transition request.
- Validate rollback, 100-record lot boundaries, 24-column export, reopening a
  generated recycled base, and no deletion of historical CRM managements.

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
