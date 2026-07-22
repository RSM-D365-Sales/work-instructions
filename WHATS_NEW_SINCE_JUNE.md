# What's New Since Early June

**Baseline:** `ec46a50` — 4 Jun 2026, the last commit before the build resumed on 10 Jul.
**Current:** `af48975` — 21 Jul 2026.
**Scope:** 41 commits · 96 files · +21,071 / −527 lines · database migrations **041 → 057**.

Development paused between 4 Jun and 10 Jul, so that gap is a clean release boundary — everything below is new since the version you last demoed.

> **Before you demo:** the demo database needs migrations **041–057** applied, in order, via the Supabase SQL Editor. Roughly half of what follows (Standing Orders, Cycle Count, Planned Orders, Notifications, the new step types) will not render without them.

---

## 1. Six new destinations in the left nav

The single most visible change — the sidebar is materially longer, and it now collapses.

| Nav item | Route | What it does |
|---|---|---|
| **Production Schedule** | `/schedule` | Gantt of scheduled runs; drag-and-drop reschedule, reassign, group by person or item. |
| **Planned Production Orders** | `/planned-orders` | D365 Master Planning output — planned orders reviewed and *firmed* into real production orders. |
| **Standing Orders** | `/standing-orders` | Recurring reagent requests ("20 L of X every Monday until 21 Dec"). |
| **Cycle Count** | `/cycle-count` | Per-lab batch-level counting with variance posting. |
| **Notifications** | `/notifications` | Admin view of what the notification service actually delivered. |
| **Equipment** | `/scales` | The Scales page, relabelled — it now holds pH meters and osmometers, not just balances. |

---

## 2. Work Instruction authoring

**Version diff** — `/work-instructions/:id/diff` compares any two versions side by side. Backed by `source_step_id` (migration 046), a lineage token that survives clone and re-save, so a *renamed* step now diffs as renamed rather than "removed + added."

**Copy a Work Instruction** — clone an existing WI as the starting point for a new one.

**Ten new step types.** The vocabulary went from a handful of generic steps to one typed step per lab action (migrations 051, 052):

`dispense` · `agitate` · `freeze` · `thaw` · `overnight` · `bring_to_volume` · `cap` · `package` · `record_time` · `attachment`

- **`dispense`** — the liquid analogue of `weigh` (volume + tolerance + lot).
- **`record_time`** — operator taps "Record current time"; the ISO timestamp is captured. This is Uniflow's "Start time / End time" pattern.
- **`attachment`** — operator attaches PDFs/images to the run via a paperclip; files land in the `po-attachments` storage bucket and stay viewable on the completed step.

**User-defined steps** (migration 041) — authors build their own step templates with configurable parameters, rendered generically in both the editor and execution. No code change required for a new step type.

**Step Library management** (migration 044) — admins can delete any template, including system ones, *unless* an active WI uses it. Historical data stays intact because `wi_steps` snapshot everything they need into `parameters`.

**Uniflow provenance** (migration 050) — migrated recipes carry `uniflow_material_id` / `uniflow_version_id`, so a Rocket Ship WI traces back to its Uniflow source while starting fresh at version 1.

---

## 3. Production execution

- **Step navigation panel** — a jump-to-step sidebar within a running order, instead of scrolling a long form.
- **Hand-off / send back** (migration 053) — hand a mid-run order to someone else; they can send it back to you. Symmetric, so it can bounce. No status change; only ownership moves.
- **Possible-deviation alert** — a popup during execution that raises a deviation and notifies a supervisor.
- **Materials summary** on the order — what the run consumes, at a glance.
- **Insufficient-stock handling** when creating production from a reagent order.

---

## 4. Quality

- **Quality Trends pivots** — compare QC results **by user** and **by instrument**, not just overall.
- **Flag for calibration** (migration 048) — when an instrument's results trend toward the spec limit, an admin flags that equipment from the trend chart; it surfaces on the Equipment page, cleared with "Mark calibrated" (stamps `last_calibrated_at`).
- **Equipment types** (migration 049) — balance / pH meter / osmometer, so the Weigh step offers balances and the Adjust pH step offers meters.
- **Finished goods only** (21 Jul) — the Quality Trends item picker now lists only `FG` items, so tubes, pipettes and bottles no longer clutter it.

---

## 5. Inventory

**Batch-level inventory + cycle counting** (migration 045) — `inventory_batches` adds the lot dimension beneath `inventory_on_hand`, with batch quantities summing to the item's physical inventory. Cycle counts are per-lab, and posting one keeps both levels in sync — mirroring a D365 counting journal.

---

## 6. D365 / Rocket Ship story

- **Planned Production Orders** (migration 042) — models D365 F&SC planned production orders, with the review → firm workflow. Seeded for the demo; in a live build these come from Planning Optimization output.
- **Integration Map** — `/integration-map`, a visual of what flows between D365 and Rocket Ship.
- **Master Planning Flow** — `/master-planning-flow`, the reagent replenishment path end to end.
- **Notification service** (migrations 047, 054) — notifications that were previously simulated in the UI are now persisted and realtime. In-app delivery *is* the table the Notifications page reads; email/Teams remain simulated.

---

## 7. Workshop & demo tooling

- **Day 1 facilitator script** — `/workshop-script`, with **shared** note boxes (migration 057): whoever preps the night before types once, and every facilitator sees the same notes.
- **Workshop agenda** — `/work-instructions/workshop-agenda`.
- **Session Wishlist** — `/wishlist` (migration 055), a live feedback board everyone signed in can add to, grouped by priority and tracked to Completed. Realtime, so it updates on every screen.
- **User guides** — Work Instructions, Production Orders, and Planned Production Scheduling, as standalone HTML and served in-app.
- **Agent instructions** — [UNIFLOW_TO_ROCKETSHIP_AGENT.md](UNIFLOW_TO_ROCKETSHIP_AGENT.md), [UNIFLOW_AGENT_FEWSHOT.md](UNIFLOW_AGENT_FEWSHOT.md), [FULL_AGENT_INSTRUCTIONS.md](FULL_AGENT_INSTRUCTIONS.md) for the Uniflow → Rocket Ship conversion.
- **Seed and maintenance scripts** in [lab-wi-app/scripts/](lab-wi-app/scripts/): quality trends, inventory batches, planned orders, WI v2 versions, a Uniflow sample recipe, and a demo reset.

---

## Demo prep checklist

1. Apply migrations **041–057** to the demo database, in order.
2. Run the seed scripts you need — `seed_quality_trends.sql` is the one that makes the Quality Trends story land (pH Meter 02 drifting toward the upper limit, last two lots out of spec, ready to flag for calibration).
3. Confirm the **Quality Trends** item picker is populated — it now shows only `FG` items, so anything you plan to trend must be typed FG on the Reagent Items page.
4. Check **Production Orders** for stale open runs from prior sessions — `close_out_production_orders_2026-07-20_21.sql` closes out a date range, and `randomize_qc_trends.sql` scatters flat QC readings so charts don't plot as a straight line.
