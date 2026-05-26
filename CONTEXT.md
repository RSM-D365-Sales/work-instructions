# Lab Work Instructions System — Session Context

> Drop this file into a Copilot chat at the start of any new session to restore full project context.
sogxm60xBUvd5eaegxxnr5QoYGgpwLc2pGgEABFz4xwHeUbRPn6MUAK4
---

## 1. What This App Is

A **reagent lab work instruction authoring and production execution system** built as a demo/presales VIBE for ARUP. It lets authors write step-by-step work instructions for preparing reagents, have them approved, and then have operators execute the instructions against a production order — recording actual weights, measurements and observations.

**App name in UI:** Lab WI System — Reagent Production

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` plugin, `@import "tailwindcss"` in `index.css`) |
| State / Data | TanStack Query v5 (`@tanstack/react-query`) |
| Backend / DB | Supabase (Postgres + Auth + RLS) |
| Icons | Lucide React |
| Routing | React Router v6 |

**Project root:** `c:\Users\e059591\OneDrive - RSM\ClientWork\Presales\VIBE\ARUP-Work-Instructions\lab-wi-app`

---

## 3. Supabase Project

| Item | Value |
|---|---|
| Project URL | `https://txjqoynbucpjhrkjedeo.supabase.co` |
| Env file | `.env.local` at project root |
| Env vars | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| Client init | `src/lib/supabase.ts` |

---

## 4. User Roles & Demo Accounts

### Roles
`'admin' | 'author' | 'approver' | 'operator'`

Stored in `public.profiles.role`. Auto-created on signup via `handle_new_user()` trigger.

### Permission Matrix

| Action | admin | author | approver | operator |
|---|:---:|:---:|:---:|:---:|
| Create / edit WI | ✓ | ✓ (own) | — | — |
| Submit for review | ✓ | ✓ (own) | — | — |
| Approve / reject WI | ✓ | — | ✓ | — |
| Start production order | ✓ | ✓ | ✓ | ✓ |
| Execute production steps | ✓ | ✓ | ✓ | ✓ |
| View step library | ✓ | ✓ | ✓ | — |
| Create new WI version | ✓ | ✓ | — | — |

`admin` bypasses all `ProtectedRoute` role checks (see `src/components/ProtectedRoute.tsx`).

### Demo Accounts (all password: `Demo@Lab2026`)

| Email | Role |
|---|---|
| `author@demolab.com` | author |
| `approver@demolab.com` | approver |
| `operator@demolab.com` | operator |
| `ryan@lab.com` | admin |

To recreate demo users (e.g. after a Supabase reset):
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node scripts/create-demo-users.mjs
```

To assign admin role to any user:
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node scripts/assign-admin.mjs ryan@lab.com
```
> Note: `NODE_TLS_REJECT_UNAUTHORIZED=0` is needed due to RSM corporate proxy SSL inspection.

---

## 5. Database Schema

### Tables

#### `public.profiles`
Extends `auth.users`. Auto-populated by `handle_new_user()` trigger.
```
id uuid PK (= auth.users.id)
full_name text
role text CHECK ('admin','author','approver','operator')
created_at timestamptz
```

#### `public.work_instructions`
```
id uuid PK
title text
description text
product_name text
target_molarity numeric
version integer DEFAULT 1
status text CHECK ('draft','pending_review','approved','rejected')
created_by uuid → profiles
approved_by uuid → profiles
approved_at timestamptz
created_at / updated_at timestamptz
```
`updated_at` auto-set by `set_updated_at()` trigger.

#### `public.wi_steps`
```
id uuid PK
work_instruction_id uuid → work_instructions (cascade delete)
step_template_id uuid → step_templates
step_order integer
name text
description text
parameters jsonb   -- includes _step_type key
created_at timestamptz
```
`parameters._step_type` is always written by the editor to know how to render the step.

#### `public.step_templates`
```
id uuid PK
name text
description text
step_type text CHECK ('gather_inputs','weigh','mix','transfer','ph_adjust','heat','cool','observe','custom')
parameter_schema jsonb
is_system boolean
created_by uuid → profiles
```
System templates are seeded in migration 001 and cannot be deleted.

#### `public.wi_approvals`
```
id uuid PK
work_instruction_id uuid → work_instructions (cascade delete)
reviewer_id uuid → profiles
action text CHECK ('submitted','approved','rejected','revision_requested')
comment text
created_at timestamptz
```

#### `public.production_orders`
```
id uuid PK
work_instruction_id uuid → work_instructions
wi_version integer   -- snapshot of WI version at order creation (migration 004)
lot_number text
batch_size numeric
batch_size_unit text DEFAULT 'L'
status text CHECK ('pending','in_progress','completed','failed','cancelled')
notes text
created_by uuid → profiles
assigned_to uuid → profiles
started_at / completed_at timestamptz
created_at timestamptz
```

#### `public.po_steps`
```
id uuid PK
production_order_id uuid → production_orders (cascade delete)
wi_step_id uuid → wi_steps
step_order integer
status text CHECK ('pending','in_progress','completed','skipped')
actual_values jsonb   -- recorded measurements
notes text
operator_id uuid → profiles
started_at / completed_at timestamptz
created_at timestamptz
```

### `parameters` / `actual_values` JSONB Shapes

| step_type | parameters keys | actual_values keys |
|---|---|---|
| `gather_inputs` | `inputs: [{material_name, quantity, unit}]` | — |
| `weigh` | `material_name, target_weight, unit, tolerance_pct` | `measured_weight, unit, in_tolerance, deviation_pct` |
| `mix` | `duration_minutes, speed` | `actual_duration_minutes, completed` |
| `heat` | `target_temp_c, duration_minutes` | `actual_temp_c, actual_duration_minutes` |
| `cool` | `target_temp_c` | `actual_temp_c` |
| `ph_adjust` | `target_ph, tolerance, reagent` | `measured_ph, in_tolerance` |
| `observe` | `prompt` | `observation` |
| `transfer` | `from_vessel, to_vessel` | `completed` |
| `custom` | `instruction_text` | `completed, notes` |

---
sogxm60xBUvd5eaegxxnr5QoYGgpwLc2pGgEABFz4xwHeUbRPn6MUAK4
## 6. SQL Migrations (run in order in Supabase SQL Editor)

| File | Purpose | Status |
|---|---|---|
| `001_initial_schema.sql` | All tables, triggers, indexes, seed step templates | ✅ Run |
| `002_rls_policies.sql` | Row Level Security for all tables | ✅ Run |
| `003_admin_role.sql` | Adds `admin` to role constraint + admin bypass RLS policies | ✅ Run |
| `004_wi_versioning.sql` | Adds `wi_version` column to `production_orders`, backfills existing rows | ✅ Run |
| `005_fix_rls_visibility.sql` | Fixes approver/admin visibility of `pending_review` WIs; fixes admin approval INSERT | ✅ Run |

> Migrations 006–014 cover reagent_items, D365 sync, scales, weigh-scale params, and lot control.
>
> **`015_user_management.sql`** — adds `email` column to `profiles`, updates `handle_new_user()` trigger, backfills emails from `auth.users`, indexes `role`. **Run this in the Supabase SQL editor before using the Users page.**

> The **`admin-users` Edge Function** (in `supabase/functions/admin-users/`) powers the admin Users UI (create/update/delete users via the service-role-key, with caller-role verification). Deploy with:
> ```powershell
> supabase functions deploy admin-users
> ```

> All migration files are in `lab-wi-app/supabase/migrations/`.

---

## 7. Project File Structure

```
lab-wi-app/
├── .env.local                       Supabase URL + anon key (never commit)
├── scripts/
│   ├── create-demo-users.mjs        Creates/updates the 3 demo users via admin API
│   └── assign-admin.mjs             Upserts a profile with role='admin'
├── supabase/migrations/             SQL migration files (001–005)
└── src/
    ├── main.tsx                     Vite entry point
    ├── App.tsx                      Router tree + QueryClient + AuthProvider
    ├── index.css                    Tailwind import
    ├── lib/
    │   ├── supabase.ts              Supabase client (reads from env)
    │   └── utils.ts                 cn() (clsx), formatDate()
    ├── context/
    │   └── AuthContext.tsx          session, user, profile, signIn/Out/Up
    ├── types/
    │   └── index.ts                 All TypeScript interfaces matching DB schema
    ├── components/
    │   ├── AppLayout.tsx            Sidebar nav + Outlet
    │   └── ProtectedRoute.tsx       Auth guard; admin bypasses role checks
    └── pages/
        ├── LoginPage.tsx            Login form + 3 demo buttons (Author/Approver/Operator)
        ├── DashboardPage.tsx        Summary cards
        ├── StepLibraryPage.tsx      Manage reusable step templates
        ├── WorkInstructionsListPage.tsx   WI list + New button
        ├── WorkInstructionEditorPage.tsx  WI create/edit with drag-and-drop steps
        ├── WorkInstructionDetailPage.tsx  WI view + approval panel + New Version button
        ├── ProductionOrdersListPage.tsx   Orders list with status filter pills
        ├── ProductionOrderNewPage.tsx     Create new production order
        └── ProductionOrderExecutionPage.tsx  Step-by-step order execution
```

---

## 8. Key Page Behaviours

### WorkInstructionEditorPage
- Single `useQuery` with key `['work-instruction', id]` fetches `*, wi_steps(*)` 
- `useEffect` populates form state once (guarded by `headerLoadedRef`)
- Steps stored as `LocalStep[]` (local state, only saved on Save/Submit)
- **Drag-and-drop:** grip handle only via `fromGripRef`; reorder applied on `dragEnd`, not `dragEnter`
- **Weigh step material selector:** dropdown populated from all `gather_inputs` steps in the same WI; falls back to free text if none exist
- Save deletes + reinserts all `wi_steps` to maintain order

### WorkInstructionDetailPage
- `canEdit`: author (own) or admin, only when status is `draft` or `rejected`
- `canApprove`: approver or admin, only when status is `pending_review`
- `canCreateNewVersion`: author or admin, only when status is `approved`
- **New Version** button clones current WI + all its steps at `version + 1`, status `draft`, navigates to editor
- Approval errors shown inline (red box) above the approval buttons

### ProductionOrderExecutionPage
- Steps fetched fresh from DB after each completion to avoid stale state triggering early auto-complete
- Completed steps can be reopened (resets `po_step` to `pending`, reverts order to `in_progress`)
- Shows `WI v{n}` in header subtitle

### ProductionOrdersListPage
- Status filter pills: Pending, In Progress, Completed, Failed, Cancelled
- `completed` and `cancelled` hidden by default
- Each pill shows a count badge

---

## 9. WI Workflow

```
draft  →  pending_review  →  approved
                          ↘  rejected  → (author edits) → draft
                          ↘  revision_requested → draft
```

Once `approved`, a WI can:
- Be used to create a Production Order (locks the WI version at `wi_version`)
- Have a **New Version** created (copies to a new `draft` at `version + 1`)

---

## 10. Known RLS Notes

- The `current_user_role()` helper function is used in all RLS policies; it reads `profiles.role` for `auth.uid()`.
- Migration 003 adds admin bypass policies (`FOR ALL ... USING current_user_role() = 'admin'`).
- Migration 005 fixes the visibility gap where approvers/admins could not see `pending_review` WIs they didn't author.
- The `wi_steps` DELETE during WI save (editor) requires the author to own the WI and it to be in `draft`/`rejected` — the `"Authors can manage steps of own draft WIs"` policy covers this.

---

## 11. Common Dev Commands

```powershell
# Start dev server
npm run dev

# Type-check only (no emit)
npx tsc --noEmit

# Build for production
npx vite build

# Scripts need NODE_TLS_REJECT_UNAUTHORIZED due to RSM proxy
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node scripts/create-demo-users.mjs
node scripts/assign-admin.mjs ryan@lab.com
```

---

## 12. Open Issues / Pending Work

- [ ] Migration 005 `005_fix_rls_visibility.sql` must be run in Supabase SQL Editor if not done yet — this fixes the approval not working after submit for review
- [ ] Migration 004 `004_wi_versioning.sql` must also be run if not yet done
