# Lab WI System — Demo Script

**Format:** "A Day in the Life" — follow this script top-to-bottom for a complete ~20–25 minute demo covering admin setup, authoring, approvals, reagent ordering, scheduling, and shop-floor execution.

**Audience:** Lab managers, QA, IT, and operators.

**Cast of characters:**
| Persona | Login | Plays the role of |
|---|---|---|
| **Riley (Admin)** | `ryan@lab.com` | Lab IT / system owner — does setup |
| **Alex (Author)** | `author@demolab.com` | Senior chemist — writes the recipe |
| **Sam (Approver)** | `approver@demolab.com` | QA reviewer — signs off |
| **Olivia (Operator)** | `operator@demolab.com` | Lab tech — makes the batch |

**All demo passwords:** `Demo@Lab2026`

**Story arc:** The lab needs a new buffer — *1 M Phosphate Buffer pH 7.4*. By the end of the demo we'll have configured the system, written and approved the recipe, ordered the raw reagents, scheduled the production, and watched an operator make the batch on the floor.

---

## Pre-Demo Checklist

Run through this 5 minutes before going live so nothing surprises you:

- [ ] All four demo users exist (`author@demolab.com`, `approver@demolab.com`, `operator@demolab.com`, `ryan@lab.com`).
- [ ] You have at least **one approved WI** already in the system that you can fall back on if the live authoring section gets cut for time.
- [ ] You have **one in-progress production order** ready to show on the Dashboard.
- [ ] Browser: zoom to 110%, close all other tabs, sign out before starting.
- [ ] Have **two browser profiles or windows** open so you can switch personas without re-typing passwords.

---

## Act 1 — Setup (Riley the Admin) — ~4 min

> **Opening line:** "Before we walk through a real day on the lab floor, let's quickly look at how the lab manager — Riley — sets the system up. This part happens once."

### 1.1 Sign in as Riley

- Go to the login page.
- Sign in as `ryan@lab.com` / `Demo@Lab2026`.
- Land on the **Dashboard**. Pause. Point to the summary tiles.

> *"This is what Riley sees every morning — a snapshot of what's in draft, what's pending review, what's running on the floor right now."*

### 1.2 Labs

- Click **Labs** in the sidebar.
- Show the list of configured labs.
- Click into one — point out the **Default lab** flag.

> *"Every user is associated with a default lab. That controls which production orders and reagent stock they see first."*

### 1.3 Scales

- Click **Scales**.
- Show one configured scale — name, location, connection details.

> *"When we get to the shop floor in Act 4, you'll see why this matters — weigh steps can pull live readings straight from these scales instead of an operator hand-typing a number."*

### 1.4 Reagents

- Click **Reagents**.
- Scroll the catalogue.
- Filter or search for "Sodium Phosphate".

> *"Reagent items here are synced from Dynamics 365 — we don't maintain a separate master list. Lot-controlled items are flagged so the system enforces lot tracking downstream."*

### 1.5 Users

- Click **Users**.
- Point out the four demo accounts and their roles.
- (Optional) Click **+ Add User** to show the dialog, then **Cancel**.

> *"Four roles — Admin, Author, Approver, Operator. The role determines what menu items show up and what they can do. Let's see that in action."*

### 1.6 Step Library

- Click **Step Library**.
- Scroll through the system templates: Gather Inputs, Weigh, Mix, Heat, Cool, pH Adjust, Observe, Transfer, Custom, Print Labels.

> *"These are the Lego bricks. Authors snap them together to build recipes. You can add your own custom step types here too — for example if you have a unique sterilisation procedure."*

**Sign out.**

---

## Act 2 — Authoring a Work Instruction (Alex the Author) — ~6 min

> **Transition:** "Now let's meet Alex. Alex is a senior chemist. The lab needs a new buffer recipe, and Alex is going to write it."

### 2.1 Sign in as Alex

- Sign in as `author@demolab.com` / `Demo@Lab2026` (or use the **Author** demo button).
- Land on the Dashboard. Note the sidebar is **smaller** — no Users, Labs, Scales, Unscheduled Orders.

> *"Notice Alex can't see the admin pages. The same app, but a different experience driven by the role."*

### 2.2 Create the WI

- Sidebar → **Work Instructions** → **+ New Work Instruction**.
- Fill in:
  - **Title:** `1 M Phosphate Buffer pH 7.4`
  - **Description:** `Standard phosphate buffer used in cell culture rinse stations.`
  - **Product Name:** `Phosphate Buffer 1M`
  - **Target Molarity:** `1`

> *"Header info first — title, product, target molarity. This is what shows up on the shop floor and in any printouts."*

### 2.3 Build the steps

Add these steps in order. For each, drag from the right-hand library OR click the **+** button:

1. **Gather Inputs** — three rows:
   | Material | Quantity | Unit |
   |---|---|---|
   | Sodium Phosphate Dibasic | 180 | g |
   | Sodium Phosphate Monobasic | 60 | g |
   | Deionised Water | 1000 | mL |

   > *"This first step is a checklist the operator confirms before starting. It also drives the materials dropdown in later weigh steps."*

2. **Weigh** — Sodium Phosphate Dibasic
   - **Material** dropdown — point out it's auto-populated from the Gather Inputs step.
   - **Target weight:** 180 g
   - **Tolerance:** 2%

3. **Weigh** — Sodium Phosphate Monobasic, 60 g, tolerance 2%.

4. **Transfer** — From `Weigh Bench`, To `Mixing Vessel 1`.

5. **Mix** — Duration `5` min, Speed `Medium`.

6. **pH Adjust** — Target `7.4`, Tolerance `0.05`, Reagent `1 M HCl`.

7. **Observe** — Prompt: `Confirm solution is clear with no visible particulates.`

8. **Print Labels** — point out it generates lot labels at the end.

> *"Notice the drag handle on the left of every step. Let me reorder one to show it works — [drag step 5 above step 4, then drag it back]."*

### 2.4 Save as draft

- Click **Save Draft**.
- Point to the status badge: **Draft**.

> *"Saved. Alex can leave and come back tomorrow — it's safely stored as a draft."*

### 2.5 Submit for review

- Click **Submit for Review**.
- Status badge changes to **Pending Review**.

> *"Now it's locked from further edits and visible to the QA approvers."*

**Sign out.**

---

## Act 3 — Approval (Sam the Approver) — ~2 min

> **Transition:** "Sam is the QA lead. Sam gets pinged that something needs approval."

### 3.1 Sign in as Sam

- Sign in as `approver@demolab.com` / `Demo@Lab2026` (or use the **Approver** demo button).

### 3.2 Find the pending WI

- Dashboard tile shows **1 Pending Review**. Click it.
- Or: sidebar → **Work Instructions** → filter to **Pending Review**.
- Click into Alex's WI.

### 3.3 Review the steps

- Scroll through each step. Briefly read the parameters.

> *"Sam sees the whole recipe exactly as the operator will see it. Every parameter, every tolerance, every prompt."*

### 3.4 Optional: demonstrate Reject

- Click **Reject**, type "Please add a cooling step at the end", click confirm.
- Status → **Rejected**.

> *"In a real review the author would now see this comment, fix it, and resubmit. For the demo, let me approve a similar one that's already pending."*

(Open a different pre-prepared pending WI, or just re-approve this one.)

### 3.5 Approve

- Click **Approve**.
- Status → **Approved**. Approval timestamp + reviewer name appear.

> *"Approved. The recipe is now locked at version 1, frozen, and available for the floor."*

**Sign out.**

---

## Act 4 — Sourcing Reagents (back to Riley) — ~2 min

> **Transition:** "Before the operator can make this buffer, we need to make sure the raw reagents are on the shelf. Let's switch back to Riley."

### 4.1 Sign in as Riley

- Use the admin login.

### 4.2 Create a Reagent Order

- Sidebar → **Reagent Orders** → **+ New Reagent Order**.
- Add line items:
  | Reagent | Qty | Unit |
  |---|---|---|
  | Sodium Phosphate Dibasic | 500 | g |
  | Sodium Phosphate Monobasic | 250 | g |
- Pick the destination warehouse / lab.
- Submit.

> *"This is a Transfer Order request that pushes straight into Dynamics 365. The warehouse team picks it, ships it to the lab, and the receipt closes the loop. We're not running a separate ordering system."*

### 4.3 Show the list

- **Reagent Orders** list — show the new order, status pill.

> *"Same status-pill pattern you'll see everywhere — pending, in progress, received."*

---

## Act 5 — Creating & Scheduling a Production Order (Riley) — ~3 min

> **Transition:** "Reagents are inbound. Now let's schedule the actual batch."

### 5.1 Create a Production Order

- Sidebar → **Production Orders** → **+ New Production Order**.
- **Work Instruction:** pick `1 M Phosphate Buffer pH 7.4` (Alex's approved one).
- **Lot Number:** `PB-2026-0527-01`
- **Batch Size:** `2` L
- **Notes:** `For QC team's Friday run.`
- **Assigned to:** Olivia (operator).
- Click **Create**.

> *"Critical detail — when this order was created, the system stamped it with **WI version 1**. If Alex publishes a new version tomorrow, this order keeps using version 1. Total traceability."*

### 5.2 Unscheduled Orders

- Sidebar → **Unscheduled Orders**.
- Show the Gantt-style timeline.
- Drag the new order onto a slot for tomorrow morning.

> *"Riley can see the whole production schedule at a glance and slot orders into available capacity."*

### 5.3 Optional: D365 ingest

- Mention briefly: *"Production orders can also flow in automatically from D365 via the `ingest-d365-prod-order` endpoint — no manual creation needed in a real deployment."*

**Sign out.**

---

## Act 6 — Day of Production (Olivia the Operator) — ~5 min

> **Transition:** "It's 8 AM the next morning. Olivia walks into the lab, fires up the tablet at her bench, and signs in."

### 6.1 Sign in as Olivia

- Sign in as `operator@demolab.com` / `Demo@Lab2026` (or the **Operator** button).
- Land on the Dashboard. **Even simpler sidebar** — just Dashboard, Production Orders, Reagent Orders.

> *"Operators get a focused experience. No clutter. No menus they don't need."*

### 6.2 Open the assigned order

- Sidebar → **Production Orders**.
- The new PB-2026-0527-01 order is right at the top (status **Pending**).
- Click into it.

### 6.3 Execute step by step

Walk through each step. Talk slowly — this is the money shot of the demo.

1. **Gather Inputs**
   - Olivia checks the materials at her bench.
   - Click **Complete Step**. Order status flips to **In Progress**.

2. **Weigh — Sodium Phosphate Dibasic**
   - Point out the target (180 g) and tolerance (2%).
   - Type a measured weight of `181.2`. Show the green **In Tolerance** badge.
   - Click **Complete Step**.
   - *(Optional drama:)* Reopen the step, change to `186` — show the red **Out of Tolerance** warning. Then fix it.

   > *"This is where audit-quality data capture lives. We're storing the actual measured value, the deviation percentage, and whether it passed tolerance — not just a yes/no checkbox."*

3. **Weigh — Sodium Phosphate Monobasic**
   - Measured: `60.4 g`. Complete.

4. **Transfer** — Complete.

5. **Mix** — Enter actual duration `5` min. Complete.

6. **pH Adjust**
   - Measured pH: `7.41`. In tolerance ✓. Complete.

7. **Observe**
   - Type: `Clear, no particulates.` Complete.

8. **Print Labels** — Complete.

### 6.4 Order completes automatically

- Status flips to **Completed** with a green badge.
- Completion timestamp shown.

> *"That's a full batch. Lot number stamped, version of the recipe stamped, every measurement captured, who did what when. If QA ever has to investigate this lot a year from now — they have everything."*

### 6.5 Reopen demo (optional)

- Scroll back, click **Reopen** on any completed step.
- Show that the step resets and the order goes back to **In Progress**.

> *"And if an operator clicks the wrong button — easily fixed. One click to reopen and redo."*

---

## Act 7 — The Audit Trail Payoff — ~2 min

> **Closing punch.** Use this to drive home the "why".

### 7.1 Back on the order

- Show the completed PB-2026-0527-01 with all steps green.
- Point to the **WI v1** badge in the header.

> *"Version 1 of the recipe is what was used. Even if Alex makes 50 more versions, this order is forever traceable to v1."*

### 7.2 New Version walkthrough (quick)

- Sign back in as Alex (or just describe it).
- Open the approved WI. Click **New Version**.
- Show the new draft v2 appear.

> *"This is how we handle change control. The old version is preserved. The new version goes through its own approval cycle. Production orders never get pulled out from under operators."*

### 7.3 Recap slide / verbal recap

> *"In the last 20 minutes we have:*
> - *Set up the lab, scales, and users (Riley, once)*
> - *Authored a recipe with drag-and-drop steps (Alex)*
> - *Reviewed and approved it (Sam)*
> - *Ordered raw reagents into the lab via D365 (Riley)*
> - *Scheduled the production order against capacity (Riley)*
> - *Executed it on the floor with full measurement capture and tolerance checking (Olivia)*
> - *And built an audit trail that pins every batch to a specific frozen version of its recipe.*"

---

## Demo Tips

| Situation | What to do |
|---|---|
| Live authoring takes too long | Have a pre-built "Phosphate Buffer (Pre-built)" WI ready — submit it from existing draft. |
| Internet flaky | Have screenshots of each Act in a backup deck. |
| Audience asks about offline operation | "The PWA / offline-capable shop-floor mode is on the roadmap — current build assumes always-connected tablet." |
| Audience asks about ERP integration | Point at the `ingest-d365-prod-order`, `sync-d365-reagents`, `sync-d365-warehouses`, `create-d365-transfer-order` Edge Functions. |
| Audience asks about electronic signatures (21 CFR Part 11) | Today: every action is timestamped + user-stamped. Full Part 11 e-sig flow is a roadmap item. |
| Audience asks how new users are onboarded | Show the Users page → Add User flow. |
| Audience asks about reporting / dashboards | The Dashboard tiles are starter-set; full BI is via the D365 sync — data flows back into Power BI naturally. |

---

## Demo Reset (between runs)

Before your next demo:

1. Sign in as Riley.
2. **Production Orders** → cancel or delete the PB-2026-0527-01 order from the last run.
3. **Work Instructions** → delete the v2 draft if you created one.
4. **Reagent Orders** → delete the last demo order.
5. Sign out.

Or, faster: run the recreate-demo-data script if/when one exists, or restore the Supabase snapshot tagged `demo-baseline`.

---

## One-Liner Elevator Pitch (if you only have 30 seconds)

> *"It's the recipe book, the QA sign-off folder, the reagent order pad, the production scheduler, and the shop-floor checklist — all in one role-aware app, with every batch traceable back to the exact frozen version of the recipe it was made from. Built on the Microsoft stack, integrated with D365."*

Good luck! 🧪
