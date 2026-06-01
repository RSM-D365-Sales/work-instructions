# Lab WI System — User Guide

**Reagent Production: Work Instructions & Production Orders**

This guide walks you through everything you need to know to use the Lab Work Instructions (WI) system. No technical background required — just follow the sections in order the first time, then use it as a reference.

---

## Table of Contents

1. [What This App Does](#1-what-this-app-does)
2. [Logging In](#2-logging-in)
3. [Understanding Your Role](#3-understanding-your-role)
4. [Getting Around (The Sidebar)](#4-getting-around-the-sidebar)
5. [The Dashboard](#5-the-dashboard)
6. [Work Instructions — The Full Lifecycle](#6-work-instructions--the-full-lifecycle)
7. [Production Orders — Running a Batch](#7-production-orders--running-a-batch)
8. [Reagent Orders](#8-reagent-orders)
9. [Admin Pages](#9-admin-pages-admins-only)
10. [Tips, Tricks & FAQ](#10-tips-tricks--faq)

---

## 1. What This App Does

In one sentence: **It lets you write step-by-step recipes for making lab reagents, get them approved, and then run them on the lab floor while recording the actual measurements.**

There are three big ideas:

| Concept | Think of it as… |
|---|---|
| **Work Instruction (WI)** | The recipe. Title, target product, list of steps. |
| **Production Order (PO)** | One actual batch being made from a recipe, on a specific date, by a specific person. |
| **Step Library** | Reusable building blocks (Weigh, Mix, Heat, etc.) used to build recipes. |

A recipe goes through this lifecycle:

```
   Draft  →  Pending Review  →  Approved  →  used to create Production Orders
                            ↘  Rejected  →  Author edits, sends again
```

Once approved, the recipe is locked. If you ever need to change it, you create a **New Version** — the old version stays available for any orders already in progress.

---

## 2. Logging In

1. Open the app URL in your browser (Chrome or Edge recommended).
2. You'll see the **Login** screen.
3. Type your email and password, then click **Sign in**.

**Forgot your password?** Ask the admin (Ryan) to reset it from the Users page.

**Demo accounts** (for training / playing around):

| Email | Password | Role |
|---|---|---|
| `author@demolab.com` | `Demo@Lab2026` | Author |
| `approver@demolab.com` | `Demo@Lab2026` | Approver |
| `operator@demolab.com` | `Demo@Lab2026` | Operator |

There are also quick **demo login buttons** on the login screen — handy for testing.

---

## 3. Understanding Your Role

The app has four roles. Your role determines what you can see and do.

| Role | What you do |
|---|---|
| **Author** | Writes work instructions (the recipes). |
| **Approver** | Reviews and approves/rejects WIs submitted by authors. |
| **Operator** | Executes production orders on the lab floor, records weights/measurements. |
| **Admin** | Can do everything. Also manages users, scales, labs, and reagent items. |

### Who can do what?

| Action | Admin | Author | Approver | Operator |
|---|:---:|:---:|:---:|:---:|
| Create / edit a WI | ✓ | ✓ (own) | — | — |
| Submit a WI for review | ✓ | ✓ (own) | — | — |
| Approve or reject a WI | ✓ | — | ✓ | — |
| Create a new version of an approved WI | ✓ | ✓ | — | — |
| Start a Production Order | ✓ | ✓ | ✓ | ✓ |
| Record steps during production | ✓ | ✓ | ✓ | ✓ |
| Manage the Step Library | ✓ | ✓ | ✓ | — |
| Manage users / scales / labs | ✓ | — | — | — |

> If a menu item is missing from your sidebar, it's because your role doesn't have access. That's normal.

---

## 4. Getting Around (The Sidebar)

The left-hand sidebar is your map. Here's what each item does:

| Menu item | What's there |
|---|---|
| **Dashboard** | Summary tiles — at-a-glance numbers. |
| **Work Instructions** | List of all recipes. Click one to view; click **+ New** to create. |
| **Step Library** | The reusable steps you can drag into a WI. |
| **Production Orders** | List of batches — past, in-progress, and scheduled. |
| **Reagent Orders** | Requests for reagent stock (linked to D365). |
| **Reagents** | The catalogue of reagent items. |
| **Scales** | (Admin) Configure connected weigh scales. |
| **Labs** | (Admin) Configure your labs and which is your default. |
| **Users** | (Admin) Create, edit, and remove user accounts. |
| **Unscheduled Orders** | (Admin) Orders waiting to be scheduled. |

In the top-right corner you'll find your name and a **Sign out** button.

---

## 5. The Dashboard

The first thing you see after login. It shows summary tiles like:

- Work instructions in **Draft**, **Pending Review**, **Approved**
- Production orders **In Progress** and **Completed**
- Quick links to the most-used pages

Use this as your starting point each morning to see what needs attention.

---

## 6. Work Instructions — The Full Lifecycle

### 6.1 Creating a new WI (Author)

1. Go to **Work Instructions** in the sidebar.
2. Click **+ New Work Instruction** (top right).
3. Fill in the header:
   - **Title** — short name (e.g. "1 M NaCl Buffer")
   - **Description** — what it's for
   - **Product Name** — what's being made
   - **Target Molarity** — if relevant
4. Add steps using the **Step Library** panel on the right:
   - Drag a step type (Weigh, Mix, Heat, etc.) into the middle column, **or** click the **+** button next to it.
   - Click each step to fill in its parameters (target weight, duration, temperature, etc.).
   - Drag the **grip handle** (≡) on the left of each step to reorder.
   - Click the trash icon to delete a step.
5. Click **Save Draft** at the top to save progress at any time.

> **Tip — Materials in a Weigh step:** If you add a **Gather Inputs** step first listing the materials, then in any Weigh step further down the dropdown will let you pick from those materials by name. No re-typing.

### 6.2 Submitting for review (Author)

When the recipe is complete and you want it approved:

1. Open the WI.
2. Click **Submit for Review** at the top.
3. The status changes from **Draft** to **Pending Review** — the approvers can now see it.

### 6.3 Approving or rejecting (Approver)

1. Go to **Work Instructions**. Anything in **Pending Review** needs your attention.
2. Click into it and read through all the steps.
3. At the bottom you'll see the **Approval panel**:
   - **Approve** — locks the WI as version 1 (or whatever the current version is) and makes it available for Production Orders.
   - **Reject** — type a comment explaining what needs to change, then send it back to the author.
4. The author will see your comment, fix things, and resubmit.

### 6.4 Creating a new version (Author / Admin)

Once a WI is **Approved** you can't edit it directly (that would invalidate any orders already made from it). Instead:

1. Open the approved WI.
2. Click **New Version**.
3. The system clones the WI and all its steps into a fresh **Draft** at the next version number.
4. Edit, submit, get approved as normal. The old version stays available for orders already in flight.

---

## 7. Production Orders — Running a Batch

### 7.1 Creating a Production Order

1. Go to **Production Orders** → **+ New Production Order**.
2. Pick the **approved** Work Instruction you want to use.
3. Fill in:
   - **Lot Number** — your batch ID
   - **Batch Size** — e.g. 5 L
   - **Notes** — anything the operator needs to know
   - **Assigned to** — which operator will run it (optional)
4. Click **Create**. The order is now **Pending**.

> The system **snapshots the WI version** at the moment you create the order. If a new version of the WI gets approved later, this order still uses the version it was created against.

### 7.2 Executing the order (Operator)

1. Go to **Production Orders**.
2. Click your assigned order. The status pill at the top will show **Pending** or **In Progress**.
3. The steps appear one at a time, in order. For each step:
   - Read the instruction carefully.
   - Enter the actual measurement (e.g. measured weight, pH, temperature).
   - Click **Complete Step**.
4. If a Weigh step has a tolerance, the app will tell you if you're **In Tolerance** ✅ or **Out of Tolerance** ⚠.
5. When the last step is done, the order automatically marks as **Completed**.

### 7.3 Fixing a mistake on a completed step

Click the **Reopen** button on any completed step. It resets that step to **Pending** and puts the order back to **In Progress**. Redo it and complete again.

### 7.4 The Orders list — filter pills

At the top of the Orders list you'll see status pills with counts:

- **Pending** — created but not started
- **In Progress** — currently being executed
- **Completed** / **Cancelled** — hidden by default (click to show)
- **Failed** — something went wrong

Click any pill to filter the list.

---

## 8. Reagent Orders

This is for ordering reagent stock (separate from making reagents).

1. Go to **Reagent Orders** → **+ New Reagent Order**.
2. Pick the reagent items and quantities you need.
3. Submit. The order syncs to D365 (Microsoft Dynamics).

You'll see the order status on the list as it progresses.

---

## 9. Admin Pages (admins only)

### 9.1 Users

- **Add a user**: click **+ Add User**, enter email, name, role, and a starting password. They'll log in with that.
- **Change a role**: edit the user, pick the new role, save.
- **Reset password**: edit the user, type a new password, save.
- **Delete**: removes the account permanently.

### 9.2 Labs

Configure your lab locations and pick which one is the **default** for new users.

### 9.3 Scales

Register the digital weigh scales that operators can pull measurements from. Each scale needs a name and connection details.

### 9.4 Reagents

The master catalogue of every reagent item. Synced from D365 — usually you don't need to add these manually.

### 9.5 Unscheduled Orders

Production orders that need to be slotted into a schedule. Drag them onto the Gantt-style timeline.

---

## 10. Tips, Tricks & FAQ

**Q: I made a typo in an approved WI. What do I do?**
A: Click **New Version**, fix the typo, submit for approval. The new version supersedes the old one for any future orders.

**Q: I can't see a "New" button anywhere.**
A: Your role probably doesn't allow it. Authors create WIs, anyone can create Production Orders, only admins manage users/labs/scales.

**Q: I accidentally completed the wrong step.**
A: On the order page, click **Reopen** next to that step, then redo it.

**Q: The app looks broken / blank screen.**
A: Press **Ctrl + Shift + R** to do a hard refresh. If still broken, sign out and back in. If still broken, message Ryan.

**Q: Where do I see my saved drafts?**
A: **Work Instructions** page — filter or scroll to the ones with status **Draft**.

**Q: How do I sign out?**
A: Top-right corner of the screen, click your name → **Sign out**.

**Q: I changed something but it didn't save.**
A: Most pages save when you click a **Save** or **Submit** button at the top. The WI editor only saves when you click **Save Draft** or **Submit for Review** — closing the tab loses changes.

**Q: What does "In Tolerance" mean on a Weigh step?**
A: The Weigh step has a target weight and a tolerance percentage (e.g. ±2%). If your measured weight is within that range, ✅. If not, ⚠ and the order may need supervisor sign-off.

**Q: Why are some menu items missing for me?**
A: They're restricted to admins (Scales, Labs, Users, Unscheduled Orders) or to authors/approvers (Step Library).

---

## Need help?

Contact **Ryan** (the admin). Include:

- What you were trying to do
- What you clicked
- What happened (or didn't happen)
- A screenshot if possible

Welcome aboard 👋
