# Data-base: approved logic versus current implementation

Last contrasted against source and tests on 2026-11-08. This is a maintained
decision aid, not a replacement for `docs/REGLAS_INVIOLABLES.md`.

## Import and enrichment

| Classification | Rule or behavior | Evidence |
|---|---|---|
| Approved | An ORIGINAL preserves rows and source columns; invalid operational records remain traceable. | `docs/REGLAS_INVIOLABLES.md` § Identidad. |
| Implemented | Spanish mobile normalization accepts `+34`/`0034`, then exactly nine digits beginning 6/7; fixed, invalid, duplicate and blank/null name rows become incidences. | `lib/excel/cleaning.ts`, `lib/server/base-integrity.ts`, `tests/excel-processing.test.ts`. |
| Gap | Document and identity fields are mapped and preserved, but there is no approved/documented DNI/NIE validation or full-name quality policy. Names are only rejected when a mapped name column is blank/`NULL`/`N/A`. | `lib/excel/import-excel.ts`, `lib/excel/cleaning.ts`. |
| Approved | Only verifiable real enrichment may authorize commercial distribution; MOCK is test-only. | Rules § Reciclaje and Distribución. |
| Implemented | Provenance is persisted as EXCEL, CRM, MOCK or API_REAL; campaign eligibility rejects MOCK. | `lib/campaigns/campaign-engine.ts`, `lib/server/base-integrity.ts`, `tests/server-base-integrity.test.ts`. |
| Undecided | Sozar fields, authentication, price and JSON mapping beyond documented paths are not approved. Do not assume a portability date or operator. | `docs/plans/sozar-response-contract.md`, `lib/services/sozar-response-contract.ts`. |

## Commercial distribution

| Classification | Rule or behavior | Evidence |
|---|---|---|
| Approved + implemented | Matrix `2026-11-01.v1`: Vodafone accepts Euskaltel, MasMovil, Orange, Pepephone, R_Cable, Yoigo; Yoigo accepts Finetwork, Movistar, Vodafone, Lowi. It uses trustworthy current operator only. | `lib/campaigns/campaign-engine.ts`, `tests/excel-processing.test.ts`. |
| Approved + implemented | A lot has 1–100 records; definitive download reads confirmed persisted lots and matching active reservations. | `lib/server/base-integrity.ts`, `lib/server/commercial-export-storage.ts`. |
| Approved + implemented | Confirmed external sales block globally and permanently; ambiguous or CRM-only sale data does not become a confirmed sale. | `lib/server/sales-storage.ts`, `lib/sales/sales-import.ts`, `tests/external-sales.test.ts`. |
| Approved + implemented | Active reservations are global per normalized mobile, historical, explicitly releasable and audited; archive does not release them. | `lib/server/commercial-reservation-storage.ts`, `app/api/reservas/[reservationId]/liberar/route.ts`, `tests/base-archive-policy.test.ts`. |
| Gap | The approved business meaning of “assignment closed” needs a documented operational release workflow and authority model beyond the existing individual administrative release endpoint. | Review before bulk/operational release UX. |

## CRM and recycling

| Classification | Rule or behavior | Evidence |
|---|---|---|
| Approved + implemented | CRM managements are append-only; canonical files can have multiple sources and global recycling consolidates one logical mobile with provenance. | `lib/server/canonical-crm-storage.ts`, `lib/server/global-crm-conciliation-storage.ts`, global recycling tests. |
| Approved + implemented | Four completed calendar months, historical minimum 2019-02-01, confirmed sales, active reservations, opposition and material conflicts are conservative gates. | `lib/recycling/intelligent-recycling.ts`, `lib/server/global-recycling-storage.ts`. |
| Gap | The business instruction says historical AGENDADO/INTERESADO alone should not be permanent automatic blocks. Current evaluator marks any such management as review until explicit resolution, even if historical. | `lib/recycling/intelligent-recycling.ts`, `tests/intelligent-recycling.test.ts`. Requires explicit policy before change. |
| Undecided | The lifecycle/caducity or explicit resolution rules for AGENDADO and INTERESADO, and future typification mappings, are not defined. | Rules § Tipificaciones. |
| Implemented | Eligible recycled output projects exactly 24 CRM headers as text; absent values remain empty. | `lib/export/crm-recycling-export.ts`, `tests/crm-recycling-export.test.ts`. |

## Sozar

- Shared gates remain closed: `SOZAR_EXECUTION_CODE_GATE=false` and
  `isSozarHlrExecutionEnabled=false`. The reviewed single administrative path
  is separate and does not enable bulk work.
- A real attempt has a UUID, encrypted response storage, phases/events, a
  mobile fingerprint, no automatic retry, and terminal `FALLIDA` or
  `INCIERTA` handling. An existing `EN_CURSO` attempt must be marked
  `INCIERTA` with evidence; only confirmed non-send can close as `FALLIDA`.
- Future additional attempts require an explicit server-only count/budget/cost
  policy and separate authorization. A same-mobile uncertain attempt remains
  blocked.
- Relevant files: `lib/server/sozar-first-real-executor.ts`,
  `lib/server/sozar-http-client.ts`, `lib/server/sozar-first-real-gate.ts`,
  `tests/sozar-first-real-control.test.ts`.

## Source-format status and regression coverage

- No real `BASE_ORIGEN.xlsx` or `tipificaciones_comerciales.xlsx` is versioned
  in this checkout; do not invent their columns. The verified CRM export
  contract is the 24 headers in `lib/export/crm-recycling-export.ts`.
- Use synthetic fixtures only. Never version personal data, numbers, secrets,
  or raw provider responses.
- For a relevant change, retain/add coverage for normalization and duplicates;
  global sales/reservations; MOCK exclusion; 100-record lots; CRM headers;
  immutable snapshots and idempotency; and authorization/no Sozar traffic.

## Priority corrections needing business approval

1. Define a lawful, auditable document and identity validation policy; then
   implement it server-side without excluding legitimate foreign documents.
2. Define resolution/aging semantics for AGENDADO and INTERESADO so historical
   records do not remain in review indefinitely by accidental implementation.
3. Define operational authorization and evidence requirements for controlled
   multi-reservation release; retain individual release and all sales blocks
   until then.
