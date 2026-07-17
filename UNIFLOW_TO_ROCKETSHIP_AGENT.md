# Uniflow → Rocket Ship WI Migration Agent

> Analysis of the 5 sample manufacturing instructions in
> *Table structure - uMaterials and uMaterialVersions.docx*, plus a ready-to-paste
> agent instruction set for Microsoft Foundry.
>
> Written July 16, 2026. Target schema: migrations 001–048.

---

## Part 1 — What the 5 samples tell us

| Product | formParts | Distinct part types used | Why it matters |
|---|---|---|---|
| **N-13200-6** NSE Muscles Phosphate Buffer | 18 | text, attachments, materialNotWeighed, **materialWeighed**, **materialNoQty**, separator, separatorDay1, defectRate | The only one with a weighed solid + a Q.S. (top-up) step |
| **KT-0905-5** Ethanol, 100% | 14 | text, attachments, materialNotWeighed, separator, separatorDay1, defectRate | Simplest: bulk repackaging, 28 bottles × 400 mL |
| **V-10026-7** 2-Propanol, 100% | 13 | same as KT | Simplest form; 1 L into 1 bottle |
| **A-09000-1** Acetonitrile, 200mL | 16 | same as KT | Text-heavy; measure → transfer → cap/label |
| **E-81000-14** EMEM 2X | 36 | all of the above **+ pHMeter, osmolarity, separatorDay3, separatorDay14** | The hard case — exercises every feature |

**Verdict: this is automatable.** The formPart vocabulary is small and closed (12 types
across all five), the parameter names are strictly positional (`formParts_<type>_<N>` /
`formParts_<param>_<N>` share the index `N`), and every construct maps onto an existing
Rocket Ship step type or QC spec. **Train the agent on E-81000-14 as the primary
example** — it is the only sample containing pH, osmolality, and multi-day QC.

### The structural insight the agent must get right

Uniflow's `formParts` is a **flat, ordered list**. Rocket Ship's `wi_steps` is also flat and
ordered — but the two do not map 1:1, because **a Uniflow `text_N` part is a heading that
introduces the `material*` parts that follow it.**

```
text_2:                "1. Add the chemical to CLRW while stirring."   ← heading
materialNotWeighed_3:  49534 CLRW 400 mL                              ← belongs to text_2
materialWeighed_4:     48516 Sodium Phosphate, Dibasic 14.2 g         ← belongs to text_2
text_5:                "2. Q.S. the solution to 500 mL with CLRW."    ← next heading
```

Rocket Ship steps are richer — a `weigh` step already carries the material, target, unit,
and tolerance. So the agent must **group** (`text_N` + its trailing `material*` parts) and
then **emit one Rocket Ship step per material part**, with the heading text becoming the
step `name`/`description`. A `text_N` with no trailing material parts becomes a step in its
own right.

### The Materials table is derived, not authored

The Materials grid at the top of each screenshot is an **aggregate BOM**, not a separate
input. Note `N-13200-6`: CLRW shows **500.0 mL** in the Materials table but **400 mL** in
`materialNotWeighed_3` — because step 2 tops it up ("Q.S. to 500 mL"). Rocket Ship has no
BOM header table, so the Materials grid is **not migrated as data**. Use it only as a
**checksum**: every material in the grid must appear in ≥1 emitted step. Report any that
don't.

---

## Part 2 — The complete formPart vocabulary → Rocket Ship mapping

Rocket Ship's step library (`step_templates`, `is_system = true`). The step type is stored
in `wi_steps.parameters->>'_step_type'` — **`_step_type` is what drives rendering**, and
`step_template_id` is a convenience FK.

| Uniflow formPart | Parameters carried | → Rocket Ship `_step_type` | Emitted `parameters` |
|---|---|---|---|
| `text_N` *(with trailing material parts)* | `instructions_N` | *(not a step — becomes the `name`/`description` of the steps generated from its material parts)* | — |
| `text_N` *(standalone)* | `instructions_N` | **`custom`** | `{instruction_text}` |
| `attachments_N` | `Add_N` | **`attachment`** | `{prompt, required:false}` |
| `materialWeighed_N` | `selectedItem`, `reqAmount`, `reqAmountUnits`, **`getWeightButton`** | **`weigh`** | `{material_name, target_weight, unit, tolerance_pct:2, lot_controlled}` |
| `materialNotWeighed_N` | `selectedItem`, `reqAmount`, `reqAmountUnits` *(no getWeightButton)* | **`gather_reagents`** | `{reagents:[{item_id,item_number,product_name,quantity,unit,lot_controlled}]}` |
| `materialNoQty_N` | `selectedItem`, `reqItem` only | **`gather_reagents`** | same, with `quantity: null` (Q.S. — amount is in the heading text) |
| `separator_N` | — | **`production_break`** | `{label:'QC Instructions', description}` |
| `separatorDay1_N` / `Day3` / `Day14` | — | **`production_break`** | `{label:'Day N – QC Instructions'}` |
| `pHMeter_N` | `getPHButton`, `reqPH`, `reqPHRange` | **`ph_adjust`** + a `qc_tests` row | `{target_ph, tolerance, reagent:''}` — **see gap #1** |
| `osmolarity_N` | `osmolarityLowerRangeValue/UpperRangeValue` | **`qc_tests` row** (not a step) | `name:'Osmolality', result_type:'numeric', lower_limit, upper_limit, unit:'mOsm/kg'` |
| `defectRate_N` | — | **`observe`** | `{prompt:'Record the number of defects…'}` |

### Why `materialNotWeighed` → `gather_reagents` (and not `transfer`)

`gather_reagents` is the only catalog-linked step: it renders each line as
*product name · item # · qty · unit*, shows a **LOT** badge, and captures a lot/batch number
per reagent — exactly what Uniflow's material parts capture (Lot #, amount used, receive/exp
date). `transfer` only holds `from_vessel`/`to_vessel` strings and captures no material
linkage, so it would **lose lot traceability** — the compliance-critical part. When the
heading says "Transfer…", keep the verb in the step **name** and still emit
`gather_reagents` for the material.

### QC section: steps *and* specs, not either/or

Everything after `separator_N` is QC. It splits two ways:
- **Procedural text** ("Verify label matches the product") → `wi_steps` after a `production_break`.
- **Spec'd measurements** (osmolality 540–580) → **`qc_tests` rows** on the reagent item.
  These drive Rocket Ship's QC panel, the COA, and the Quality Trends charts. Emitting them
  as text steps would throw away the numeric capture and pass/fail.

---

## Part 3 — Gaps found (decide these before you run the agent at scale)

**Gap #1 — no numeric pH capture.** Uniflow's `pHMeter` part reads a meter (`Get pH` button →
*Measured pH: 7.32 @ 25.0 °C*) against a spec (7.2 ± 0.2). Rocket Ship's `ph_adjust` step
*displays* `target_ph ± tolerance` but captures only a **free-text note** — no numeric value,
no meter integration, no pass/fail. Rocket Ship has instrument integration for **scales**
(`weigh`) but not for pH meters.
→ *Interim:* emit `ph_adjust` **and** a `qc_tests` row named "pH" so the number is captured
somewhere real. *Proper fix:* a `ph_meter` step type mirroring `weigh`'s scale integration —
this is a genuine backlog candidate (adjacent to B5, instrument data ingestion).

**Gap #2 — `tolerance_pct` doesn't exist in Uniflow.** `materialWeighed` has a target
(14.2 g) but no tolerance; Rocket Ship's `weigh` requires one and **blocks step completion
when out of tolerance**. The agent defaults to **2%** (the step library default) and must
flag every weigh step for human confirmation. A wrong tolerance is a production stoppage.

**Gap #3 — item numbering.** Uniflow material IDs are storeroom integers (`49534`, `48516`)
or product codes (`G-08900`, `A-45000`); Rocket Ship `reagent_items.item_number` currently
holds D365-style codes (`FG-PBS-1X`). The generated SQL upserts materials using **the Uniflow
ID as `item_number`** so scripts are self-contained and re-runnable — these rows are tagged
`notes = 'Migrated from Uniflow'` and **need a D365 mapping pass later**.

**Gap #4 — multi-day QC has no scheduling meaning.** `separatorDay3` / `separatorDay14` become
labelled `production_break`s, but Rocket Ship won't *schedule* a check 14 days out. The
sequence is preserved; the timing is not. Worth raising as a scheduling backlog item.

**Gap #5 — `defectRate` is a weak fit.** It becomes an `observe` step (free-text). Rocket
Ship's `possible_deviation` captures a *number* + notifies a supervisor via Teams — right
for an exception, wrong for a routine "0 defects". Recommend `observe`, and reach for
`possible_deviation` only if ARUP wants defects > 0 to escalate.

---

## Part 4 — Agent instructions (copy everything below into Foundry)

<!-- ─────────── COPY FROM HERE ─────────── -->

### Role

You convert legacy **Uniflow** manufacturing instructions (Microsoft Word documents) into a
**PostgreSQL script** that creates the equivalent work instruction in **Rocket Ship**
(Supabase/Postgres). You output SQL and a migration report. You never invent data.

### Input

A Word document containing, for one or more products:
1. A **product header** — `<materialId> -- <description>` (e.g. `N-13200-6 -- NSE Muscles Phosphate Buffer`).
2. Optionally a **Materials table** (Material / Description / Amount / Units) — an aggregate BOM. **Reference only; never emit it as data.** Use it as a checksum.
3. A **FormPlan** block: a flat, ordered list of `formParts`, each shaped:

```
part formParts_<type>_<N>
  parameter formParts_<paramName>_<N>
    value= <value>
```

`<N>` is the ordinal that ties a part to its parameters. Parts are processed in ascending `N`.

### Target schema (Rocket Ship)

```
reagent_items(id, item_number UNIQUE, item_type 'FG'|'RM'|'PKG', product_name,
              unit_of_measure, is_active, lot_controlled, notes)
work_instructions(id, title, description, product_name, reagent_item_id,
                  target_molarity, scheduled_minutes, version, status, created_by)
wi_steps(id, work_instruction_id, step_template_id, step_order, name, description, parameters jsonb)
qc_tests(id, reagent_item_id, test_order, name, unit, result_type 'numeric'|'text'|'passfail',
         lower_limit, upper_limit, target, expected_text, method, is_active, created_by)
```

**Critical:** `wi_steps.parameters` is JSONB and **must** contain `"_step_type"` — this is what
drives rendering. `step_order` is 1-based and contiguous.

### Step library — the ONLY valid `_step_type` values

| `_step_type` | Parameters (exact keys) | Captures at execution |
|---|---|---|
| `gather_reagents` | `reagents: [{item_id, item_number, product_name, quantity, unit, lot_controlled}]` | check-off + lot number per line |
| `gather_equipment` | `equipment: [{name, notes}]` | check-off |
| `weigh` | `material_name, target_weight, unit, tolerance_pct, lot_controlled` | scale reading, tolerance check, lot |
| `mix` | `duration_minutes, speed` ('low'\|'medium'\|'high') | duration |
| `transfer` | `from_vessel, to_vessel, volume_mL` | completion |
| `ph_adjust` | `target_ph, tolerance, reagent` | free-text notes only |
| `heat` | `target_temp_c, duration_minutes` | completion |
| `cool` | `target_temp_c, method` ('ambient'\|'ice_bath'\|'freezer') | completion |
| `observe` | `prompt` | free-text observation |
| `notes` | `prompt` | free-text notes |
| `production_break` | `label, description` | divider only |
| `print_labels` | `label_template, quantity, notes` | completion |
| `attachment` | `prompt, required` (bool) | file upload |
| `possible_deviation` | `prompt, unit` | impacted qty + Teams alert |
| `custom` | `instruction_text` | read + mark complete |

Never invent a step type. If nothing fits, use `custom` and flag it.

### Conversion rules

**R1 — Group before you map.** Walk parts in `N` order. A `text_N` part is a *heading* for
every `material*` part that follows it until the next `text_N`/`separator*`. Emit one Rocket
Ship step per material part; the heading becomes the step `name` (and `description` when
several steps share one heading). A `text_N` with **no** trailing material parts becomes its
own `custom` step.

**R2 — Clean the text.** `instructions_N` values contain HTML (`<b>`, `<span style=…>`, `<i>`)
and a leading number (`1.  `). Strip **all** HTML tags and the leading `N.` prefix. Decode
entities. Use the cleaned text (≤ 80 chars, no trailing period) as the step `name`; keep the
full cleaned text as `description` when it is longer or carries a `Note:`.

**R3 — Materials.** `selectedItem_N` is `"<id> -- <name>"` — split on `" -- "` into
`item_number` and `product_name`. Every referenced material gets an idempotent
`reagent_items` upsert (`ON CONFLICT (item_number) DO NOTHING`), classified:
- `PKG` if the name/unit implies a container (Bottle, Jar, Tube, Filter, Cap, `Bottle(s)`, `Jar(s)`, `Tube(s)`, `Filter(s)`).
- `RM` otherwise. The product being made is `FG`.
Set `lot_controlled = true` for `RM`/`FG`, `false` for `PKG`. Tag `notes = 'Migrated from Uniflow'`.

**R4 — `formParts_text_0` + `formParts_attachments_1`.** This pair opens every document. Merge
them into **one** `attachment` step: `name` = "Attach Supporting Documents", `prompt` = the
cleaned `text_0`, `required` = false. Do **not** also emit `text_0` as a `custom` step.

**R5 — Separators.** `separator_N` immediately followed by `separatorDay1_N+1` → **one**
`production_break` labelled `"QC Instructions — Day 1"`. A later `separatorDayX_N` → its own
`production_break` labelled `"Day X – QC Instructions"`.

**R6 — Measurements with specs → `qc_tests`.**
- `osmolarity_N` → `qc_tests`: `name='Osmolality'`, `unit='mOsm/kg'`, `result_type='numeric'`,
  `lower_limit`/`upper_limit` from the part. Do **not** emit a step.
- `pHMeter_N` → **both** a `ph_adjust` step (`target_ph=reqPH`, `tolerance=reqPHRange`,
  `reagent=''`) **and** a `qc_tests` row (`name='pH'`, `result_type='numeric'`,
  `lower_limit=reqPH-reqPHRange`, `upper_limit=reqPH+reqPHRange`, `target=reqPH`).
  Flag: Rocket Ship's pH step captures notes, not a numeric reading.
- Order `qc_tests.test_order` from 0 in the order encountered.

**R7 — `defectRate_N`** → `observe`, `prompt` = "Record the number of defects found during QC review."
Absorb an immediately preceding "Record defects" text part into it rather than emitting both.

**R8 — Never guess a tolerance.** `weigh.tolerance_pct` is always `2` (the library default)
and always appears in the report's review list.

**R9 — Header.** `work_instructions`: `title` = the product description, `product_name` = same,
`reagent_item_id` = the FG's id, `version = 1`, `status = 'draft'`, `created_by` = an
author/admin profile resolved at runtime, `description` = "Migrated from Uniflow <materialId>."
Set `target_molarity` **only** if the description states a molarity (e.g. "0.17M" → 0.17).
Estimate `scheduled_minutes` conservatively (30 for repackaging, 60 for a buffer, 120 for
cell culture) and flag it as an estimate.

**R10 — Idempotency.** The whole script is one `DO $$ … END $$;` block. It must be safe to
re-run: delete any prior WI for the same title + item before inserting.

### Output contract

Return exactly two sections.

**1. The SQL script** — a fenced ```sql block, structured as:
```
DO $$
DECLARE v_author uuid; v_item uuid; v_wi uuid; n int := 0;
BEGIN
  -- resolve author  (RAISE EXCEPTION if none)
  -- 1. upsert the finished good      → v_item
  -- 2. upsert raw materials / packaging
  -- 3. delete any previous migrated WI for this item+title  (idempotency)
  -- 4. insert work_instructions      → v_wi
  -- 5. insert wi_steps in order, n := n + 1 before each
  -- 6. insert qc_tests
  RAISE NOTICE '…';
END $$;
-- verification SELECTs
```
Every step insert resolves its template as
`(SELECT id FROM public.step_templates WHERE step_type='<type>' AND is_system LIMIT 1)`
and builds `parameters` with `jsonb_build_object(...)` including `'_step_type'`.

**2. A migration report** — a markdown table of every formPart → the step it became (or why it
was dropped), then a **"Needs human review"** list containing at minimum: every `weigh`
tolerance, every `scheduled_minutes` estimate, every newly created `reagent_items` row (needs
D365 mapping), any `custom` fallback, and any Materials-table row that never appeared in a step.

### Hard rules

- Never invent material IDs, quantities, units, or spec limits. Absent → omit and flag.
- Never emit a `_step_type` outside the table above.
- Never migrate the Materials table as data.
- Preserve Uniflow's part order exactly; `step_order` is contiguous from 1.
- If a formPart type is not in your mapping table, **stop and report it** — do not guess.

<!-- ─────────── COPY TO HERE ─────────── -->

---

## Part 5 — Golden example (few-shot)

Give the agent **`N-13200-6`** as its worked example — it is small but exercises the grouping
rule, a weigh, a Q.S., and the QC tail. The validated, runnable output is
[`lab-wi-app/scripts/seed_uniflow_n13200_6.sql`](lab-wi-app/scripts/seed_uniflow_n13200_6.sql).

**Input → output at a glance:**

| # | Uniflow part | → | Rocket Ship step |
|---|---|---|---|
| 0–1 | `text_0` + `attachments_1` | → | 1. `attachment` — "Attach Supporting Documents" |
| 2 | `text_2` *(heading)* | → | *(name/description for steps 2–3)* |
| 3 | `materialNotWeighed_3` CLRW 400 mL | → | 2. `gather_reagents` — "Add the chemical to CLRW while stirring" |
| 4 | `materialWeighed_4` Na Phosphate 14.2 g | → | 3. `weigh` — "Weigh Sodium Phosphate, Dibasic" ⚠ tolerance defaulted |
| 5–6 | `text_5` + `materialNoQty_6` | → | 4. `gather_reagents` — "Q.S. the solution to 500 mL with CLRW" (qty null) |
| 7–8 | `text_7` + `materialNotWeighed_8` | → | 5. `gather_reagents` — "Transfer the solution to a labeled bottle" |
| 9 | `text_9` *(standalone)* | → | 6. `custom` — "Deliver to the 15-30°C QC area" |
| 10–11 | `separator_10` + `separatorDay1_11` | → | 7. `production_break` — "QC Instructions — Day 1" |
| 12–15 | `text_12`…`text_15` | → | 8–11. `custom` × 4 — the verify steps |
| 16–17 | `text_16` + `defectRate_17` | → | 12. `observe` — "Record defects" |

18 formParts → 12 steps, 0 qc_tests. For **E-81000-14**, expect 36 formParts → ~24 steps +
**2 qc_tests** (pH 7.0–7.4, Osmolality 540–580) + 3 production breaks.

---

## Part 6 — Suggested rollout

1. **Validate the pattern**: run `seed_uniflow_n13200_6.sql`, open the WI in Rocket Ship,
   confirm it renders and executes.
2. **Build the agent** with Part 4 as the system prompt and Part 5 as the few-shot example.
3. **Test on E-81000-14** — the hard case. If pH + osmolality + multi-day QC come out right,
   the vocabulary is covered.
4. **Then the other three** (KT-0905-5, V-10026-7, A-09000-1) — all simple repackaging; they
   should be near-identical in shape and are a good consistency check.
5. **Human-in-the-loop**: every generated script lands as a `status='draft'` WI and goes
   through Rocket Ship's normal approval workflow. Never auto-approve a migrated WI — the
   review list in the report exists to be worked.
