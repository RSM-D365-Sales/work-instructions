# Project Rocket Ship — Prospect Feature Backlog & Implementation Planning Brief

> **Purpose of this file:** This document lives in the repo root and is the working brief for Claude Code.
> It captures everything the prospect asked for during the June 4, 2026 follow-up demo, organized as an
> implementation backlog. Claude Code: read this file, explore the codebase, then produce a phased,
> repo-specific implementation plan before writing any code. See **"Instructions for Claude Code"** at the bottom.

---

## 1. Project context

**What this app is:** A custom lab work-instruction / reagent-production application ("Rocket Ship") that acts as
a tailored MES front end tethered to **Microsoft Dynamics 365 Finance & Supply Chain (D365 F&SC)**. D365 remains
the system of record for items, inventory, warehouses (labs), transfer orders, production orders, formulas, and
financials. This app owns the lab-facing UX: ordering, planning/scheduling, guided execution, QC, delivery, and
work-instruction authoring/approval.

**Known stack facts (from the demo build):**
- Frontend web app with role-based navigation; five personas (see below).
- **Supabase** backend — Postgres with **row-level security** scoping data by role and lab; SQL migrations
  (through `030` as of the demo: `026` inventory, `027/028` delivery + D365 start message, `029` search name,
  `030` demo scales); demo seeding via `node scripts/create-demo-users.mjs`.
- D365 communication via **OData** and a **message-processor queue** (service class in D365 with an exposed
  endpoint; transactions queued and processed on a ~1-minute batch cadence, with automatic retry).
- Integrations built so far are **point-to-point proof-of-concept**; production design calls for staging tables /
  store-and-forward queues on both sides.
- Auth: single sign-on, Azure AD (Entra ID) is the intended identity core.

**Personas / roles:**
| Persona | Role | Sees |
|---|---|---|
| Dana | Lab Scientist (satellite lab) | Dashboard, Reagent Orders only |
| Riley | Admin / Planner | Everything: scheduling Gantt, users, labs, scales, items, inventory |
| Olivia | Operator (shop-floor tech) | Her dashboard/Gantt, her assigned production orders, execution screens |
| Alex | Author (senior chemist) | + Authoring, Step Library, Reagent Items |
| Sam | Approver (QA) | + Approvals, Step Library |

**Core flow already demoed end-to-end:** reagent order → D365 transfer order → insufficient-stock alert →
production order (+ formula) in D365 → assignment/scheduling → guided 39-step execution with scale capture,
timers, tolerances, deviations → QC results + Certificate of Quality (PDF) → delivery/pick/receive with automatic
D365 posting → work-instruction authoring with step library, versioning, and segregated approval.

**Compliance posture:** Regulated lab environment. E-signatures, audit trails, change control, and traceability
are first-class requirements, not nice-to-haves. HIPAA considerations apply anywhere specimen data appears
(prospect's specimen systems hold de-identified/tokenized data).

---

## 2. Feature backlog (what the prospect asked for)

Each item below came directly from prospect questions during the demo ("can it do X?"). Status legend:
**[GAP]** = not built, needs net-new work · **[PARTIAL]** = exists in some form, needs completion ·
**[DESIGN]** = architecture/design decision required before build.

### EPIC A — Ordering & Planning

**A1. Auto-create production orders on insufficient stock** `[GAP]`
- When a reagent order line has no available inventory, automatically generate a linked production order
  (today the planner clicks "create" from the insufficient-stock alert).
- Must remain linked to the originating transfer order so finished goods auto-allocate to it.
- Consider a config flag: auto-create in "Unscheduled" status vs. manual creation, per lab or per item.
- Acceptance: order submitted with zero stock → production order exists in app **and** D365 within one queue
  cycle, appears in the planner's Unscheduled queue, linkage visible on both records.

**A2. Workload visibility at assignment** `[GAP]`
- When assigning a production order to an operator, show that operator's current load and open time inline
  (today the planner must open the Gantt separately).
- Include working-schedule and time-off awareness (data already modeled).
- Acceptance: assignment dialog shows per-operator availability for the required window; warns on overload
  or non-working day.

**A3. Auto-scheduling engine** `[PARTIAL — mocked in demo]`
- Real implementation: given unscheduled orders, find a qualified operator with open time before the
  requirement date. Respect: working days/hours, time off, training/qualification matrix (who may perform
  which work instructions), and equipment availability (see A4).
- Support batch "auto-schedule selected" and per-order auto-schedule.
- Acceptance: deterministic, explainable assignment; planner can accept/override; no assignment to
  unqualified or unavailable operators.

**A4. Equipment & maintenance dependencies in scheduling** `[GAP / DESIGN]`
- Block or sequence work based on instrument availability, calibration status, and preventive-maintenance
  schedules. Evaluate leaning on D365 Enterprise Asset Management for source data vs. modeling locally.
- Acceptance: an order requiring an out-of-calibration or in-maintenance instrument cannot be scheduled
  into that window without an override + reason.

**A5. Raw-material demand → purchase orders** `[DESIGN]`
- Confirmed to work via D365 master planning (production order formula creates demand; min/max drives
  POs/transfers). Implementation task is configuration + verification, not app code: ensure formulas created
  by the app carry correct quantities/UoM and that planning picks them up.
- Acceptance: producing an item below raw-material min triggers planned PO in D365 demo environment.

### EPIC B — Execution & Quality

**B1. Soft e-signature / "verified by" on step completion** `[GAP]`
- On configurable steps, completing prompts a verification dialog (re-auth or credential confirmation),
  recording who verified, when, and in what role. Foundation for full 21 CFR Part 11-style e-signatures later.
- Configurable per step type / per work instruction (not every step needs it).
- Acceptance: signed steps store signer identity + timestamp immutably; appears in the run's audit trail
  and on the Certificate of Quality where relevant.

**B2. Step-level workflow routing & reassignment** `[PARTIAL]`
- Today: supervisor can reassign a whole in-progress order. Needed:
  - Route **segments** of a work instruction to different roles/people (e.g., Olivia does steps 1–20,
    QC analyst does 21–24, back to Olivia for 25+).
  - Steps don't appear in a person's queue until predecessors complete ("it's your turn" model).
  - On segment completion, auto-assign next segment and notify.
- Acceptance: a WI authored with role-segmented sections flows across two users' dashboards without
  supervisor intervention; mid-run reassignment by supervisor still works at any step boundary.

**B3. Active deviation triggering & notifications** `[PARTIAL]`
- Deviation steps exist; make them **act**: notify supervisor via Teams message, email, and in-app alert
  (red banner if logged in). Configurable prompt text and escalation target per deviation step.
- Out-of-tolerance values on weigh/pH steps should be able to raise the same notification path.
- Acceptance: triggering a deviation creates a trackable deviation record + delivers at least one real
  notification channel (start with in-app + email; Teams via Graph API as fast-follow).

**B4. Quality trends by user and by instrument** `[GAP — data exists, views don't]`
- Extend the existing quality-trends screen (item/test over 10/30/60 days) with:
  - Group/compare by **user** (operator-to-operator variance).
  - Group/compare by **instrument** (e.g., a pH meter trending toward upper spec) with a
    "flag for calibration" action that feeds A4.
- Acceptance: admin can pivot any test's history by user or instrument and flag an instrument, which
  surfaces on the Scales/Equipment page and in scheduling checks.

**B5. Instrument data via file/CSV ingestion** `[GAP]`
- For non-networked instruments: watch a network folder / ingest a published CSV, read the latest value
  (pattern: instrument continuously appends readings; app pulls last value on capture).
- Per-instrument connection config on the Equipment page (folder path, file pattern, column mapping,
  staleness threshold).
- Acceptance: a weigh step bound to a file-based scale captures the most recent reading with a timestamp
  and flags stale data.

### EPIC C — Delivery & Inventory

**C1. Put-away / staging step after delivery** `[GAP]`
- Delivery to the lab isn't terminal: add a put-away flow ("staged at Lab 1 → placed in Freezer B / Drawer 3"),
  scannable locations, usable from handheld devices. Location master per lab (fridges, freezers, drawers, bins).
- Acceptance: delivered items carry a final storage location; searchable in inventory by location.

**C2. Sync-timing design per transaction type** `[DESIGN]`
- Prospect currently syncs every ~3 minutes Uniflow↔LIMS. Decide per transaction: real-time OData vs.
  queue + 1-minute batch (recommended default). Document the matrix (order creation, material consumption,
  report-as-finished, delivery/receipt) and make cadence configurable.
- Acceptance: written design doc in repo + configurable batch cadence; delivery completion reflected in
  D365 within the agreed SLA.

### EPIC D — Authoring & Governance

**D1. Side-by-side version diff for work instructions** `[GAP]`
- Reviewer view: old version vs. new version with changes highlighted (added/removed/edited steps and
  changed parameters), so approvers don't re-read the whole WI.
- Acceptance: opening any "in review" WI shows a diff against the currently active version; step-level
  add/remove/modify all visually distinct.

**D2. Step-library change propagation ("update the Lego")** `[GAP]`
- Editing a library step can optionally propagate to all work instructions using it — with guardrails:
  - Never silently changes an approved WI: propagation creates **new draft versions** in a pending-review state.
  - Preview: "this will affect N work instructions" with the list, before confirming.
  - Approvals required per normal workflow (or bulk-approve by authorized role, with audit).
- Acceptance: library-step edit generates draft versions for affected WIs; active versions untouched until
  approved; full audit of who propagated what and when.

**D3. Multiple step libraries by department/work type** `[GAP]`
- Separate libraries for reagent manufacturing, cell-based protocols, and specimen collections (their step
  types differ substantially). Library visibility scoped by role/department; custom step types per library.
- Acceptance: an author sees only their department's libraries by default; a WI declares its library
  context; step pickers filter accordingly.

**D4. Catalog-linked reference data** `[GAP]`
- Tie technical references, seeding concentrations, and templates to **catalog numbers**; link catalog
  numbers to responsible **specialists**; when a linked catalog item changes, auto-assign an update task
  to the responsible specialist.
- Acceptance: a catalog item's detail page lists linked references/templates/specialist; changing it
  creates a review task on the specialist's dashboard.

### EPIC E — Departmental & Platform

**E1. Department-specific views/workflows** `[PARTIAL — role framework exists]`
- Collections team keeps 60–80 orders open for months — the production Gantt is wrong for them; they need
  a persistent list/board view. Build a per-department dashboard configuration so a "specimen supervisor"
  and a "reagent lab supervisor" get different layouts, widgets, and default views.
- Acceptance: two supervisor roles in different departments see materially different home screens driven
  by config, not code forks.

**E2. Specimen collection support** `[GAP / DESIGN]`
- Nothing built today. Scope: pull specimen inventory from the prospect's two existing specimen systems
  (data is de-identified/tokenized; treat as HIPAA-adjacent regardless), present within the same unified
  app experience, and support collections-team workflows (long-lived orders, expiry watching — "looking
  every night at specimens on hand going out of date").
- Start with read-only inventory + expiry dashboard; write flows are a later phase.
- Acceptance (phase 1): specimen inventory visible with expiry alerts; no PHI stored; integration
  contract documented.

**E3. Notification infrastructure (email + Microsoft Teams)** `[PARTIAL — simulated in demo]`
- The demo mocked email/Teams alerts for high-priority orders and deviations. Build the real thing:
  a notification service (in-app, email, Teams via Graph API/webhooks) with per-event-type routing rules
  (e.g., "high-priority order for Lab 1 → Reagent Lab Help Desk channel").
- Acceptance: high-priority order submission and deviation triggers deliver real notifications to
  configured targets; delivery logged.

### EPIC F — Architecture, Compliance & Delivery Model (design workstreams)

**F1. Costing & financial design** — Align production-order costing with the prospect's current
  "keep it simple" D365 financial setup (materials + optional labor via standard journals; WIP bucket
  concept; WIP reporting through native ERP reports). No app code until design is signed off.

**F2. Offline resilience / store-and-forward** — Replace point-to-point calls with staging tables +
  queues on both sides so the lab keeps operating during D365 outages; sync on reconnect. Includes retry,
  ordering guarantees, and idempotency on the message processor.

**F3. Identity, licensing & security model** — Azure AD/Entra SSO throughout; evaluate the MES-style
  one-to-many transaction tier so operators don't need full D365 licenses; unified role/security governance
  spanning app RLS and D365 security (avoid "configure it in five places").

**F4. E-signatures & audit trail (regulated readiness)** — Beyond B1: comprehensive, immutable audit trail
  of who did what/when across execution, authoring, approvals, deliveries; groundwork for validation
  (IQ/OQ/PQ) later. Timestamped step completions already exist — formalize and make tamper-evident.

**F5. QMS/LIMS integration scoping** — Future inflection with QMS (e.g., dot compliance) as a recipient of
  CoQ/quality data and a source of controlled SOPs/work instructions. Scoping doc only for now.

**F6. Co-development enablement** — Prospect's internal builders will work alongside the delivery team.
  Ensure: README/onboarding docs, migration conventions, seed scripts, branch strategy, environment setup
  (including the proxy note: `NODE_TLS_REJECT_UNAUTHORIZED` workaround should be replaced with proper cert
  handling), and CI checks.

---

## 3. Suggested phasing (adjust after codebase review)

| Phase | Theme | Candidate items | Rationale |
|---|---|---|---|
| **1** | Close demo gaps that won the deal | A1, A2, B1, B3, E3, D1 | Highest prospect enthusiasm; mostly extend existing screens/data |
| **2** | Execution depth & governance | B2, B4, B5, D2, D3, C1 | Requires schema evolution (step routing, libraries, locations) |
| **3** | Scheduling intelligence & scale | A3, A4, D4, E1 | Depends on Phase 2 data (qualifications, equipment status) |
| **4** | New territory | E2 (specimens), F5 (QMS) | New integrations, HIPAA-adjacent, own discovery track |
| **Continuous** | Architecture workstreams | C2, F1–F4, F6 | Design docs early (Phase 1), implementation threaded throughout |

**Phase 1 definition of done (business framing):** "Minimum viable to take the reagent lab off Uniflow" —
the prospect explicitly framed Uniflow replacement as the Phase 1 bar.

---

## 4. Instructions for Claude Code

You are working inside the Rocket Ship repository. Before writing any code:

1. **Explore the repo.** Map the actual structure: frontend framework and routing, Supabase schema and all
   migrations (confirm current highest migration number), RLS policies, the D365 integration layer
   (OData calls, message-queue client), notification stubs, existing role/permission model, and the step
   library / work-instruction data model. Produce a short `ARCHITECTURE_NOTES.md` summarizing what you find.
2. **Reconcile this backlog against reality.** For every item above, mark it: already exists / partially
   exists (name the files) / absent. Correct any assumption in this document that the code contradicts,
   and note the correction.
3. **Produce `IMPLEMENTATION_PLAN.md`** with, per backlog item: affected files/modules, new migrations
   needed (schema sketch), API/integration changes, RLS implications, test approach, estimated size
   (S/M/L), and dependency ordering. Respect the phasing table but propose changes where the code suggests
   a better order.
4. **Ground rules while implementing:**
   - Never weaken RLS. Every new table gets explicit policies; every new screen respects role scoping.
   - All D365 writes go through the message-queue pattern (idempotent, retry-safe) — no new point-to-point
     writes.
   - Anything touching approved work instructions must create new versions; never mutate an approved version.
   - Every state-changing action records actor + timestamp (audit-trail groundwork, F4).
   - Migrations are additive and numbered sequentially after the current highest; include seed updates for
     the demo dataset so the demo script keeps working.
   - Prefer configuration over code forks for per-department/per-lab behavior (E1 is the pattern-setter).
5. **Work one backlog item per branch/PR**, referencing its ID (e.g., `feat/A1-auto-production-order`),
   with a summary of schema, code, and test changes in the PR description.
6. **When ambiguous, ask** — especially on compliance-sensitive items (B1, F4), financial postings (F1),
   and anything involving specimen data (E2). Do not guess on regulated behavior.

---

## 5. Source & traceability

Backlog derived from: RSM "Uniflow Follow-Up Demo" meeting recording transcript, June 4, 2026 (1h48m),
cross-referenced with the internal 2-hour demo script (`DEMO_SCRIPT_2HR.html`). Each EPIC item corresponds
to a direct prospect question or request during that session. Keep this file updated as scope decisions
are made with the prospect; it is the contract between the demo promises and the build.
