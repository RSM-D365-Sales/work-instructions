# Rocket Ship — Epic Breakdown & Sequencing Recommendation

> Companion to [ROCKETSHIP_IMPLEMENTATION_PLAN.md](ROCKETSHIP_IMPLEMENTATION_PLAN.md).
> Written July 16, 2026, after reconciling the backlog against the codebase as it
> actually stands (migrations through **045**; the brief assumed 030). Purpose:
> decide whether to build the backlog all together or one item at a time.

---

## The epics, reconciled against what's already built

Sizes: **S** = extend an existing screen · **M** = new screen and/or migration · **L** = schema evolution or new infrastructure.

### EPIC A — Ordering & Planning
- **A1 · Auto-create production orders on insufficient stock** — gap, but small: the manual
  "create from reagent order" flow already exists (migration 039); this automates the click
  and preserves the transfer-order linkage. *(S/M)*
- **A2 · Workload visibility at assignment** — now **partial**: the Production Schedule page
  shows per-person load by day; missing piece is availability *inline in the assignment
  dialog*, with overload / non-working-day warnings. *(S/M)*
- **A3 · Auto-scheduling engine** — the brief says "mocked" — **stale**: a real engine ships
  today (deadline-aware, working days/time off, no double-booking, batch + selected
  auto-schedule, cover-an-absence reassign/unassign). Remaining gap: the **qualification
  matrix** (who may run which WIs) and equipment awareness (depends on A4). *(M for quals;
  rest done)*
- **A4 · Equipment & maintenance dependencies in scheduling** — genuine design decision first
  (D365 Enterprise Asset Management vs. local model) before any code. *(L, design-gated)*
- **A5 · Raw-material demand → purchase orders** — D365 configuration + verification, not app
  code. The Planned Production Orders page already tells this story in the demo. *(config/design)*

### EPIC B — Execution & Quality
- **B1 · Soft e-signature / "verified by" on step completion** — gap; compliance-sensitive —
  the brief itself says ask, don't guess. *(M)*
- **B2 · Step-level workflow routing & segments** ("it's your turn" queueing) — the biggest
  schema change in the backlog. *(L)*
- **B3 · Deviations that actually notify** — deviation steps exist (migration 038); real
  email/Teams delivery depends on E3. *(M, after E3)*
- **B4 · Quality trends by user / by instrument** — data already captured; this is chart
  pivots + a "flag for calibration" action feeding A4. *(S/M)*
- **B5 · Instrument data via file/CSV ingestion** — needs watcher infrastructure, not just UI. *(M/L)*
- *Not in the brief but adjacent and already done:* attachment steps, QC results + COA,
  inventory batches, cycle counting.

### EPIC C — Delivery & Inventory
- **C1 · Put-away / staging + location master** — gap; pairs naturally with the new
  batch/cycle-count work. *(M)*
- **C2 · Sync-timing design matrix per transaction type** — a document, not code. *(S)*

### EPIC D — Authoring & Governance
- **D1 · Side-by-side WI version diff** — pure frontend over data that already exists
  (versioning). Zero schema risk. *(M)*
- **D2 · Step-library change propagation ("update the Lego")** — guardrailed draft
  generation; touches the approval workflow. *(M/L)*
- **D3 · Multiple step libraries by department** — the user-defined step work (migration 041)
  is the seed. *(M)*
- **D4 · Catalog-linked reference data + specialist update tasks** — net-new model. *(M)*

### EPIC E — Departmental & Platform
- **E1 · Config-driven department dashboards** — pattern-setter; worth doing carefully once. *(M/L)*
- **E2 · Specimen collection support** — new integrations, HIPAA-adjacent, its own discovery
  track. *(L, keep last)*
- **E3 · Real notification service (email + Teams)** — currently simulated; unlocks B3 and
  A1's alerting. *(M)*

### EPIC F — Design workstreams (docs, not code)
- F1 costing · F2 store-and-forward queues · F3 identity/licensing · F4 audit-trail
  formalization · F5 QMS scoping · F6 co-dev onboarding.

---

## All together or one by one? **One by one — emphatically.**

The concrete reason: this project has **one shared Supabase database** and deploys `main`
straight to GitHub Pages. Code is easy to correct — a bad merge reverts. **Migrations are
not** — every migration runs against the same database the live demo runs on, and additive
schema changes can't be un-run cleanly. Building six epics in one sweep means six sets of
schema changes tangled together with no safe rollback point. One item per branch/PR (which
§4.5 of the implementation brief already mandates) keeps every step small enough to correct.

### Guardrails (the anti-"going rogue" checklist)
- **Freeze before the demo.** No new migrations or merges to `main` after ~July 20;
  everything until then is demo-prep only.
- **Branch per backlog item** (`feat/A1-auto-production-order`), merged only after
  `npm run build` passes plus a hands-on check of the demo path.
- **Migrations additive-only**, never destructive — the pattern so far, and why nothing yet
  has been uncorrectable.
- **Design-tagged items (A4, A5, C2, E2, F\*) produce documents first, never code.**
- **Stand up a second Supabase project as a dev environment** before Phase 2's heavier
  schema work (B2, D2) — the single best insurance against an uncorrectable mistake.

### Suggested sequence
1. **Reconciliation pass first (zero risk):** produce `ARCHITECTURE_NOTES.md` +
   `IMPLEMENTATION_PLAN.md` per §4 of the brief, marking each item exists / partial / absent
   against the real codebase. The brief is already out of date on A3, A2, and the migration
   count — correct it before building anything.
2. **Phase 1, low-schema-risk wins, one branch each:**
   **D1** (version diff) → **E3** (notifications) → **B3** (deviations act) →
   **A2** (assignment availability) → **B4** (trend pivots) → **A1** (auto-create).
3. **Phase 2+** per the brief's phasing table, re-ordered as the reconciliation suggests,
   with the dev environment in place before B2/D2.

**Phase 1 bar (from the prospect):** minimum viable to take the reagent lab off Uniflow.
