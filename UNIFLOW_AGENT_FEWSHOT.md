# Uniflow Agent — Few-Shot Example (N-13200-6)
####Worked Example

The worked input→output pair for the migration agent. Companion to
[UNIFLOW_TO_ROCKETSHIP_AGENT.md](UNIFLOW_TO_ROCKETSHIP_AGENT.md) — that file holds the
**instructions**; this file holds the **example**. Both go into the agent.

**How to load it into Foundry:** seed the agent with one prior exchange —
Block A below as the **user** message, Block B as the **assistant** message. If your setup
has no way to seed a conversation, append both blocks to the end of the instructions under a
heading like `### Worked example — study this before converting anything`, keeping the
`INPUT:` / `OUTPUT:` framing.

Chosen because it is small but exercises the grouping rule (R1) and its verb table (a Q.S.
→ `bring_to_volume` via R12, a "Deliver to …" → `package`, and the "Verify …" tail →
`observe`), a merged attachment pair (R4), a weigh with a defaulted tolerance (R9), a merged
separator (R5), and the defectRate tail (R7). It is a representative **reagent-lab** recipe —
the covered Phase-1 subset (Part 0 of the instructions) — and it lands **0 custom steps**,
which is the target the custom-count metric (R13) exists to protect.

> Identity note: this recipe's `materialVersionId` is `N-13200-6`, so its `materialId` is
> `N-13200` and its Uniflow version is `6`. The FG's `item_number` is the **materialId**
> (`N-13200`), not the version-stamped code — that is the v2 correction from the Word-doc
> era, and it's why the SQL below uses `N-13200`.

---

## Block A — the user message (INPUT)

The four dump fields, verbatim. (`formPlan` is shown indented for readability; in the real
dump it is one cell with `- ` continuation markers — the agent handles both.)

---

```
materialId:        N-13200
materialVersionId: N-13200-6
description:       NSE Muscles Phosphate Buffer
formPlan:
formPartValues
  part formParts_text_0
    parameter formParts_instructions_0
      value= <b><span style='color:rgb(0,120,215);'>NOTE: Attach the appropriate documents when needed.</span></b>
  part formParts_attachments_1
    parameter formParts_Add_1
      value= Add
  part formParts_text_2
    parameter formParts_instructions_2
      value= 1.   Add the chemical to CLRW while stirring.
  part formParts_materialNotWeighed_3
    parameter formParts_selectedItem_3
      value= 49534 -- Clinical Laboratory Reagent Water (CLRW)
    parameter formParts_reqAmount_3
      value= 400
    parameter formParts_reqAmountUnits_3
      value= mL
    parameter formParts_reqItem_3
      value= 49534
    parameter formParts_usedAmountUnits_3
      value= mL
  part formParts_materialWeighed_4
    parameter formParts_selectedItem_4
      value= 48516 -- Sodium Phosphate, Dibasic
    parameter formParts_reqAmount_4
      value= 14.2
    parameter formParts_reqAmountUnits_4
      value= g
    parameter formParts_getWeightButton_4
      value= Get weight
    parameter formParts_reqItem_4
      value= 48516
    parameter formParts_usedAmountUnits_4
      value= g
  part formParts_text_5
    parameter formParts_instructions_5
      value= 2.   Q.S. the solution to 500 mL with CLRW.
  part formParts_materialNoQty_6
    parameter formParts_selectedItem_6
      value= 49534 -- Clinical Laboratory Reagent Water (CLRW)
    parameter formParts_reqItem_6
      value= 49534
  part formParts_text_7
    parameter formParts_instructions_7
      value= 3.   Transfer the solution to a labeled bottle.
  part formParts_materialNotWeighed_8
    parameter formParts_selectedItem_8
      value= 48364 -- Bottle, Glass, 500mL
    parameter formParts_reqAmount_8
      value= 1
    parameter formParts_reqAmountUnits_8
      value= Bottle(s)
    parameter formParts_reqItem_8
      value= 48364
    parameter formParts_usedAmountUnits_8
      value= Bottle(s)
  part formParts_text_9
    parameter formParts_instructions_9
      value= 4.   Deliver to the 15-30°C QC area.
  part formParts_separator_10
  part formParts_separatorDay1_11
  part formParts_text_12
    parameter formParts_instructions_12
      value= 1.  Verify that the documentation is complete.
  part formParts_text_13
    parameter formParts_instructions_13
      value= 2.  Verify label matches the product.
  part formParts_text_14
    parameter formParts_instructions_14
      value= 3.  Verify volume of product.
  part formParts_text_15
    parameter formParts_instructions_15
      value= 4.  Verify that the proper container was used.
  part formParts_text_16
    parameter formParts_instructions_16
      value= 5. Record defects
  part formParts_defectRate_17
```

---

## Block B — the assistant message (OUTPUT)

Everything between the rules below, verbatim. This is the agent's target: two sections, SQL
then report.

---

## 1. SQL script

```sql
DO $$
DECLARE
  v_author uuid;
  v_item   uuid;
  v_wi     uuid;
  n        int := 0;   -- step_order counter
  v_clrw   text;       -- reagent_items.id values, as text, for the JSONB payloads
  v_naphos text;
  v_bottle text;
BEGIN
  -- Author to own the draft (authors can insert WIs; admins bypass RLS).
  SELECT id INTO v_author FROM public.profiles
   WHERE role IN ('author', 'admin')
   ORDER BY (role = 'author') DESC, created_at
   LIMIT 1;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'No author/admin profile found to own the migrated work instruction.';
  END IF;

  -- ── 1. The finished good (item_number = Uniflow materialId) ──────────────
  INSERT INTO public.reagent_items
    (item_number, item_type, product_name, unit_of_measure, is_active, lot_controlled, notes)
  VALUES
    ('N-13200', 'FG', 'NSE Muscles Phosphate Buffer', 'mL', true, true,
     'Migrated from Uniflow — needs D365 item mapping')
  ON CONFLICT (item_number) DO UPDATE
    SET product_name = EXCLUDED.product_name, updated_at = now()
  RETURNING id INTO v_item;

  -- ── 2. Raw materials + packaging referenced by the steps ─────────────────
  INSERT INTO public.reagent_items
    (item_number, item_type, product_name, unit_of_measure, is_active, lot_controlled, notes)
  VALUES
    ('49534', 'RM',  'Clinical Laboratory Reagent Water (CLRW)', 'mL',        true, true,  'Migrated from Uniflow — needs D365 item mapping'),
    ('48516', 'RM',  'Sodium Phosphate, Dibasic',                'g',         true, true,  'Migrated from Uniflow — needs D365 item mapping'),
    ('48364', 'PKG', 'Bottle, Glass, 500mL',                     'Bottle(s)', true, false, 'Migrated from Uniflow — needs D365 item mapping')
  ON CONFLICT (item_number) DO NOTHING;

  SELECT id::text INTO v_clrw   FROM public.reagent_items WHERE item_number = '49534';
  SELECT id::text INTO v_naphos FROM public.reagent_items WHERE item_number = '48516';
  SELECT id::text INTO v_bottle FROM public.reagent_items WHERE item_number = '48364';

  -- ── 3. Idempotency: clear a previous migration of this WI ────────────────
  DELETE FROM public.work_instructions
   WHERE reagent_item_id = v_item
     AND title = 'NSE Muscles Phosphate Buffer'
     AND description LIKE 'Migrated from Uniflow%';   -- steps cascade

  -- ── 4. The work instruction (draft v1, Uniflow provenance kept) ──────────
  INSERT INTO public.work_instructions
    (title, description, product_name, reagent_item_id, version, status, scheduled_minutes,
     uniflow_material_id, uniflow_version_id, uniflow_version, created_by)
  VALUES
    ('NSE Muscles Phosphate Buffer',
     'Migrated from Uniflow N-13200-6.',
     'NSE Muscles Phosphate Buffer',
     v_item, 1, 'draft', 60,
     'N-13200', 'N-13200-6', 6,
     v_author)
  RETURNING id INTO v_wi;

  -- ── 5. Steps ─────────────────────────────────────────────────────────────

  -- [text_0 + attachments_1] → attachment  (R4)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'attachment' AND is_system LIMIT 1),
    n, 'Attach Supporting Documents', NULL,
    jsonb_build_object(
      '_step_type', 'attachment',
      'prompt',     'Attach the appropriate documents when needed.',
      'required',   false));

  -- [text_2 + materialNotWeighed_3] → gather_reagents  (R1)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'gather_reagents' AND is_system LIMIT 1),
    n, 'Add the chemical to CLRW while stirring', 'Add the chemical to CLRW while stirring.',
    jsonb_build_object(
      '_step_type', 'gather_reagents',
      'reagents',   jsonb_build_array(jsonb_build_object(
        'item_id',        v_clrw,
        'item_number',    '49534',
        'product_name',   'Clinical Laboratory Reagent Water (CLRW)',
        'quantity',       400,
        'unit',           'mL',
        'lot_controlled', true))));

  -- [materialWeighed_4] → weigh   ⚠ tolerance_pct defaulted to 2%  (R8)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'weigh' AND is_system LIMIT 1),
    n, 'Weigh Sodium Phosphate, Dibasic', 'Add the chemical to CLRW while stirring.',
    jsonb_build_object(
      '_step_type',     'weigh',
      'material_id',    v_naphos,
      'material_name',  'Sodium Phosphate, Dibasic',
      'target_weight',  14.2,
      'unit',           'g',
      'tolerance_pct',  2,
      'lot_controlled', true));

  -- [text_5 + materialNoQty_6] → bring_to_volume  (Q.S. cue, R12)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'bring_to_volume' AND is_system LIMIT 1),
    n, 'Q.S. the solution to 500 mL with CLRW', 'Q.S. the solution to 500 mL with CLRW.',
    jsonb_build_object(
      '_step_type',    'bring_to_volume',
      'material_name', 'NSE Muscles Phosphate Buffer',
      'target_volume', 500,
      'unit',          'mL',
      'diluent',       'Clinical Laboratory Reagent Water (CLRW)'));

  -- [text_7 + materialNotWeighed_8] → gather_reagents
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'gather_reagents' AND is_system LIMIT 1),
    n, 'Transfer the solution to a labeled bottle', 'Transfer the solution to a labeled bottle.',
    jsonb_build_object(
      '_step_type', 'gather_reagents',
      'reagents',   jsonb_build_array(jsonb_build_object(
        'item_id',        v_bottle,
        'item_number',    '48364',
        'product_name',   'Bottle, Glass, 500mL',
        'quantity',       1,
        'unit',           'Bottle(s)',
        'lot_controlled', false))));

  -- [text_9] standalone "Deliver to … QC area" → package  (R1 verb table)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'package' AND is_system LIMIT 1),
    n, 'Deliver to the 15-30°C QC area', NULL,
    jsonb_build_object(
      '_step_type',  'package',
      'container',   '',
      'label_ref',   '',
      'destination', '15-30°C QC area',
      'notes',       ''));

  -- [separator_10 + separatorDay1_11] → one production_break  (R5)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'production_break' AND is_system LIMIT 1),
    n, 'QC Instructions — Day 1', NULL,
    jsonb_build_object(
      '_step_type',  'production_break',
      'label',       'QC Instructions — Day 1',
      'description', 'Everything below is performed by QC on Day 1.'));

  -- [text_12 … text_15] "Verify …" → observe × 4  (R1: verify/check → observe)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Verify that the documentation is complete', NULL,
    jsonb_build_object('_step_type', 'observe', 'prompt', 'Verify that the documentation is complete.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Verify label matches the product', NULL,
    jsonb_build_object('_step_type', 'observe', 'prompt', 'Verify label matches the product.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Verify volume of product', NULL,
    jsonb_build_object('_step_type', 'observe', 'prompt', 'Verify volume of product.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Verify that the proper container was used', NULL,
    jsonb_build_object('_step_type', 'observe', 'prompt', 'Verify that the proper container was used.'));

  -- [text_16 + defectRate_17] → observe  (R7)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Record defects', NULL,
    jsonb_build_object(
      '_step_type', 'observe',
      'prompt',     'Record the number of defects found during QC review.'));

  -- ── 6. QC specifications ─────────────────────────────────────────────────
  -- None: N-13200-6 has no pHMeter or osmolarity formPart.

  RAISE NOTICE 'Migrated N-13200-6 → work_instruction % with % steps', v_wi, n;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT wi.title, wi.version, wi.status, ri.item_number, count(s.id) AS steps
  FROM public.work_instructions wi
  JOIN public.reagent_items ri ON ri.id = wi.reagent_item_id
  LEFT JOIN public.wi_steps s ON s.work_instruction_id = wi.id
 WHERE ri.item_number = 'N-13200'
 GROUP BY wi.title, wi.version, wi.status, ri.item_number;

SELECT s.step_order, s.parameters->>'_step_type' AS step_type, s.name
  FROM public.wi_steps s
  JOIN public.work_instructions wi ON wi.id = s.work_instruction_id
  JOIN public.reagent_items ri ON ri.id = wi.reagent_item_id
 WHERE ri.item_number = 'N-13200'
 ORDER BY s.step_order;
```

## 2. Migration report

**Steps: 12 total · custom: 0 (0%) · typed: 12**

**N-13200-6 — NSE Muscles Phosphate Buffer** · 18 formParts → 12 steps · 0 qc_tests

| formPart | Disposition |
|---|---|
| `text_0` | Merged into step 1 as the attachment prompt (R4) |
| `attachments_1` | **1.** `attachment` — "Attach Supporting Documents" |
| `text_2` | Heading — became the name/description of steps 2–3 (R1) |
| `materialNotWeighed_3` | **2.** `gather_reagents` — CLRW 400 mL |
| `materialWeighed_4` | **3.** `weigh` — Sodium Phosphate, Dibasic 14.2 g (mass unit → weigh, R3a) ⚠ |
| `text_5` | Heading — became the name of step 4 (R1) |
| `materialNoQty_6` | **4.** `bring_to_volume` — to 500 mL, diluent CLRW (Q.S. cue, R12) |
| `text_7` | Heading — became the name of step 5 (R1) |
| `materialNotWeighed_8` | **5.** `gather_reagents` — Bottle, Glass, 500mL × 1 |
| `text_9` | **6.** `package` — "Deliver to the 15-30°C QC area" (destination) (R1 verb table) |
| `separator_10` + `separatorDay1_11` | **7.** `production_break` — "QC Instructions — Day 1" (merged, R5) |
| `text_12` | **8.** `observe` — "Verify that the documentation is complete" (verify → observe, R1) |
| `text_13` | **9.** `observe` — "Verify label matches the product" |
| `text_14` | **10.** `observe` — "Verify volume of product" |
| `text_15` | **11.** `observe` — "Verify that the proper container was used" |
| `text_16` + `defectRate_17` | **12.** `observe` — "Record defects" (merged, R7) |

**Materials checksum** — all 3 Materials-table rows appear in ≥1 step:
`48364` → step 5 · `48516` → step 3 · `49534` → step 2 (400 mL); also named as the Q.S.
diluent in step 4 (`bring_to_volume` carries the diluent as text, not a linked item).

### Needs human review

1. **`weigh` tolerance defaulted to 2%** (step 3, Sodium Phosphate, Dibasic). Uniflow carries
   no tolerance. Out-of-tolerance **blocks step completion** in Rocket Ship — confirm with the
   reagent lab before approving.
2. **`scheduled_minutes = 60` is an estimate** (buffer preparation). Uniflow's `processingTime`
   was not available in this input.
3. **4 new `reagent_items` created with Uniflow IDs as `item_number`**
   (`N-13200` the FG, plus storeroom IDs `49534`, `48516`, `48364`) — all need a
   D365 item mapping pass.
4. **Step 4 is a `bring_to_volume`** (Q.S. to 500 mL). The diluent CLRW is carried as text,
   not a linked `reagent_items` row, so its top-up volume isn't tracked against inventory —
   confirm that's acceptable, or add a companion `gather_reagents` if the CLRW draw must be counted.
5. **Custom steps introduced: 0** — nothing to review here, which is the goal. (Reported for
   every recipe per R13 so the batch-level custom rate stays visible.)
6. **WI is `status='draft'`** — route through the normal approval workflow. Do not auto-approve.

---

## Expected agent behaviour

Fed Block A, the agent should return output materially identical to Block B. Cosmetic drift is
fine (comment wording, whitespace). These are **not** fine and mean the instructions aren't
landing:

- A different step **count** or **order** — the grouping rule (R1) isn't being applied.
- `text_0` emitted as its own `custom` step — R4 ignored.
- The Q.S. (`materialNoQty_6`) emitted as `gather_reagents` instead of `bring_to_volume` — R12 ignored.
- "Deliver to …" or the "Verify …" steps emitted as `custom` — R1's verb table isn't being applied.
- A non-zero custom count, or a report missing the **`Steps: … · custom: …`** summary line — R13 ignored.
- Two `production_break`s instead of one — R5 ignored.
- A `_step_type` outside the library table — the hard rule is being violated.
- Missing `_step_type` in any `jsonb_build_object` — the step won't render in Rocket Ship.
- A report without the "Needs human review" list — half the output contract is missing.
