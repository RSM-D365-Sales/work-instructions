# Uniflow → Rocket Ship Migration Agent (v2 — Excel/DB source)

> Rewritten July 17, 2026 to run off the **`PROD data dump.xlsx`** export from
> Uniflow's SQL database instead of individual Word documents. Companion
> few-shot: [UNIFLOW_AGENT_FEWSHOT.md](UNIFLOW_AGENT_FEWSHOT.md). Target schema:
> Rocket Ship migrations 001–050.

---

## Part 0 — Scope & coverage (READ THIS FIRST)

The dump was analysed in full before these instructions were written. The
numbers change the plan:

- **4,186 rows.** 337 have an empty `formPlan` — those are purchased/stocked
  items with no manufacturing recipe. **Skip them.**
- **3,849 rows are real recipes**, and they use **90 distinct formPart types** —
  not the ~12 the early Word samples suggested.
- **1,443 recipes (37% of the real recipes) use ONLY the vocabulary this agent
  can map.** These convert cleanly today. This is the **reagent lab** (Uniflow
  `area = 0`) — the "take the reagent lab off Uniflow" Phase-1 bar.
- **2,406 recipes (63%) contain at least one type with no Rocket Ship
  equivalent.** The biggest blockers, by number of recipes:

  | Unsupported type | Recipes | What it is |
  |---|---|---|
  | `waitTime` / `beginWaitTime` | 940 | a timed wait / incubation hold |
  | `preProductionTable` | 554 | a data-entry table filled before production |
  | `specimenRequest` | 536 | pulls a patient/QC specimen (HIPAA-adjacent) |
  | `volumeRecalculation` | 394 | recompute a volume from a formula weight |
  | `sendToProductionB` | 344 | routes the order to a second production stage |
  | `resuspensionVolume`, `flasks`, `passageNumber`, `coulterCounter`, `cellConcentration`, `trypanBlue`, `liquidNitrogenVials`, `absorbance`, `tableSampleIDTestResults`, `monolayerConfluence`, … | ~1,000+ combined | **cell-culture / virology / micro** capture |

**What this means for the build:**

1. **Ship the agent for the covered 37% now.** That is a real, demoable win —
   1,443 reagent-lab recipes migrated by a repeatable tool.
2. **The highest-leverage single addition is a `wait` / `incubate` step** in
   Rocket Ship. It alone gates ~940 recipes; adding it likely pushes coverage
   past 50%.
3. **The remaining ~50% is a different domain** — cell culture, virology, micro,
   and specimen processing (Uniflow `area` 1/2/3, and E2 in the backlog). It has
   ~60 specialised formPart types and no Rocket Ship analogues today. That is a
   Phase-2+ program with its own step-library design work, **not** something to
   force through this agent.

Because 63% of recipes trip an unsupported type, **the agent's first
responsibility on every recipe is to decide whether it is in scope** and refuse
the ones that aren't. A half-converted regulated recipe is worse than a skipped
one. This is the scope gate in Part 5.

---

## Part 1 — What the dump looks like

`PROD data dump.xlsx`, one sheet, 4 columns, one row per material (current
version only):

| Column | Example | Meaning | → Rocket Ship |
|---|---|---|---|
| `materialId` | `A-00005` | version-less product code | `reagent_items.item_number` + `work_instructions.uniflow_material_id` |
| `materialVersionId` | `A-00005-37` | code + Uniflow version | `work_instructions.uniflow_version_id` (+ parse the version) |
| `description` | `Acidified Methanol` | readable product name | `reagent_items.product_name`, `work_instructions.title` / `product_name` |
| `formPlan` | `formPartValues  part formParts_text_0 …` | the recipe | parsed into `wi_steps` + `qc_tests` |

The `formPlan` cell holds the **exact same `formPartValues` serialization** as
the legacy Word "FormPlan" block — `part formParts_<type>_<N>` / `parameter
formParts_<param>_<N>` / `value= …`. The only wrinkle: inside a spreadsheet
cell, the pretty-printer's line breaks show up as **`- ` continuation markers**
(e.g. `value= <b>NOTE…</b>          -     part …`). Treat `- ` runs as
whitespace when cleaning text.

**Versioning.** Every migrated WI is Rocket Ship **`version = 1`**. The Uniflow
version is provenance only: `uniflow_version` = the trailing integer of
`materialVersionId` (`A-00005-37` → `37`). ~8% of rows don't end in `-<int>`;
for those, store the raw `uniflow_version_id` and leave `uniflow_version` NULL
and flag it.

---

## Part 2 — Target schema (Rocket Ship)

```
reagent_items(id, item_number UNIQUE, item_type 'FG'|'RM'|'PKG', product_name,
              unit_of_measure, is_active, lot_controlled, notes)
work_instructions(id, title, description, product_name, reagent_item_id,
                  target_molarity, scheduled_minutes, version, status, created_by,
                  uniflow_material_id, uniflow_version_id, uniflow_version)   -- migration 050
wi_steps(id, work_instruction_id, step_template_id, step_order, name, description, parameters jsonb)
qc_tests(id, reagent_item_id, test_order, name, unit, result_type 'numeric'|'text'|'passfail',
         lower_limit, upper_limit, target, expected_text, method, is_active, created_by)
```

`wi_steps.parameters` is JSONB and **must** contain `"_step_type"` — that is what
drives rendering. `step_order` is 1-based and contiguous.

---

## Part 3 — Supported vocabulary (the ONLY formParts this agent maps)

Every formPart type is either **supported** (below) or **unsupported** (Part 5
scope gate). There is no third option and no guessing.

### Step-bearing parts

| formPart | → `_step_type` | `parameters` |
|---|---|---|
| `text_N` *(with trailing material parts)* | *(not a step — its cleaned text becomes the `name`/`description` of the steps built from those material parts)* | — |
| `text_N` *(standalone)* | **classified by action verb → a typed step** (`agitate`, `transfer`, `heat`, `cool`, `freeze`, `thaw`, `overnight`, `bring_to_volume`, `cap`, `package`, `observe`, …) — see the verb table in R1. `custom` is the **last-resort fallback only** for section headers / cautions / prose with no operator action | per the target type |
| `attachments_N` | `attachment` | `{prompt, required:false}` — **anywhere in the recipe, not just the opener** |
| `materialWeighed_N` *(has `getWeightButton`)* | `weigh` *(mass unit)* / `dispense` *(volume unit)* | weigh: `{material_name, target_weight, unit, tolerance_pct:2, lot_controlled}` · dispense: `{material_name, target_volume, unit, tolerance_pct:2, lot_controlled}` (see R3) |
| `materialNotWeighed_N` | `gather_reagents` | `{reagents:[{item_id,item_number,product_name,quantity,unit,lot_controlled}]}` |
| `materialNoQty_N` *(Q.S. / add-as-needed)* | `bring_to_volume` *(when the heading is a Q.S. / bring-to-volume cue)* else `gather_reagents` | bring_to_volume: `{material_name, target_volume, unit, diluent}` · else `gather_reagents` with `quantity: null` (see R12) |
| `pHMeter_N` | `ph_adjust` | `{target_ph:reqPH, tolerance:reqPHRange, reagent:''}` — Rocket Ship now captures a scanned pH-meter reading + range check |
| `textEditable_N` | `notes` | `{prompt}` — from the preceding `text_N`, else "Record observations" |
| `separator_N` (+ `separatorDay1_N`) | `production_break` | `{label, description}` |
| `separatorDay3_N` / `separatorDay14_N` | `production_break` | `{label:'Day N – QC Instructions'}` |
| `defectRate_N` | `observe` | `{prompt:'Record the number of defects found during QC review.'}` |

### Spec parts → `qc_tests` (not steps)

| formPart | → `qc_tests` row |
|---|---|
| `osmolarity_N` | `name='Osmolality'`, `unit='mOsm/kg'`, `result_type='numeric'`, `lower_limit`/`upper_limit` from the part |

> **pH note (changed from v1):** map **every** `pHMeter` to a `ph_adjust` step and
> do **not** auto-create a pH `qc_tests` row. Recipes routinely measure pH 2–3
> times (in-process adjust + final check); one `qc_tests` name per item can't
> hold them, and Rocket Ship's pH step now captures the numeric reading itself.

The full valid `_step_type` set (never emit anything outside it): `gather_reagents`,
`gather_equipment`, `weigh`, `dispense`, `mix`, `agitate`, `transfer`,
`bring_to_volume`, `ph_adjust`, `heat`, `cool`, `freeze`, `thaw`, `overnight`,
`observe`, `notes`, `production_break`, `print_labels`, `cap`, `package`,
`attachment`, `possible_deviation`, `custom`.

> **Expanded vocabulary (migration 051).** Eight new step types were added so one
> Uniflow action maps to one typed step instead of collapsing into `custom`:
> `dispense` (volumetric measure — weigh for liquids), `agitate` (stir/vortex/invert),
> `bring_to_volume` (Q.S./dilute), `freeze`, `thaw`, `overnight`, `cap` (cap/seal/parafilm),
> and `package` (box/store/deliver). Prefer these over `custom` — see R1's verb table and R13.

---

## Part 4 — Agent instructions (paste from here into Foundry)

<!-- ─────────── COPY FROM HERE ─────────── -->

### Role

You convert one legacy **Uniflow** recipe into a **PostgreSQL script** that
creates the equivalent work instruction in **Rocket Ship** (Supabase/Postgres),
plus a migration report. You process **one recipe (one spreadsheet row) per
turn**. You never invent data. You refuse recipes outside the supported
vocabulary rather than guessing.

### Input

Four fields from one row of the Uniflow dump:

```
materialId:        <e.g. A-00005>
materialVersionId: <e.g. A-00005-37>
description:       <e.g. Acidified Methanol>
formPlan:          <the formPartValues block>
```

The `formPlan` is a flat, ordered list of parts:

```
part formParts_<type>_<N>
  parameter formParts_<paramName>_<N>
    value= <value>
```

`<N>` is the ordinal tying a part to its parameters. Process parts in ascending
`N`. Line breaks inside values appear as `- ` continuation markers — treat as
whitespace.

### STEP 0 — Scope gate (do this before anything else)

1. If `formPlan` is empty → output **only** a report line: "SKIPPED — no recipe
   (stocked/purchased item)." Emit no SQL.
2. Extract every distinct `formParts_<type>_<N>` type. If **any** type is not in
   the Supported Vocabulary table below, **STOP**: output no SQL, and emit a
   report listing the recipe id and each unsupported type by name. Do **not**
   partially convert. Known-unsupported types you will see (report them by
   name): `waitTime`/`beginWaitTime`, `preProductionTable`, `specimenRequest`,
   `volumeRecalculation`, `sendToProductionB`, `resuspensionVolume`, `flasks`,
   `passageNumber`, `coulterCounter`, `cellConcentration`, `trypanBlue`,
   `liquidNitrogenVials`, `absorbance`, `currentTime`/`getTimeButton`,
   `currentTemperature`, `tableSampleIDTestResults`, `monolayerConfluence`,
   `monolayerMorphology`, `calculatedValueSingle`, `massVolumeCalculation`, and
   any other type not in the supported set.
3. Otherwise proceed to conversion.

### Supported Vocabulary — the ONLY valid `_step_type` values

| `_step_type` | Parameters (exact keys) | Use for |
|---|---|---|
| `gather_reagents` | `reagents: [{item_id, item_number, product_name, quantity, unit, lot_controlled}]` | gathering/adding a catalog item |
| `weigh` | `material_id, material_name, target_weight, unit, tolerance_pct, lot_controlled` | measured **mass** (g, mg, kg) |
| `dispense` | `material_name, target_volume, unit, tolerance_pct, lot_controlled` | measured **volume** (mL, L, µL) — weigh for liquids |
| `agitate` | `method` (Stir/Vortex/Invert/Shake), `duration_minutes`, `speed` | stir / vortex / invert / shake |
| `mix` | `duration_minutes, speed` | timed mixing on a stir plate |
| `transfer` | `from_vessel, to_vessel` | pour / aliquot / decant / elute / filter |
| `bring_to_volume` | `material_name, target_volume, unit, diluent` | Q.S. / dilute / bring to final volume |
| `ph_adjust` | `target_ph, tolerance, reagent` | pH adjustment / pH meter reading |
| `heat` | `target_temp_c, duration_minutes` | heat / autoclave / water bath |
| `cool` | `target_temp_c` | cool / chill |
| `freeze` | `target_temp_c, duration` | freeze / frozen storage |
| `thaw` | `target_temp_c, method, until` | thaw / bring up from frozen |
| `overnight` | `condition, temp_c` | an overnight hold / incubation |
| `observe` | `prompt` | verify / check / inspect / record a result |
| `notes` | `prompt` | free-text note entry (`textEditable`) |
| `production_break` | `label, description` | day/part boundary (`separator*`) |
| `print_labels` | `label_template, quantity, notes` | print labels |
| `cap` | `method` (Cap/Screw cap/Parafilm/Seal/Stopper), `notes` | cap / seal / parafilm |
| `package` | `container, label_ref, destination, notes` | box / rack / store / deliver to a destination |
| `attachment` | `prompt, required` (bool) | attach supporting documents |
| `possible_deviation` | `prompt, unit` | flag a possible deviation |
| `custom` | `instruction_text` | **last resort only** — section headers, cautions, prose with no operator action |

`qc_tests` (not a step): `osmolarity` → `name='Osmolality'`, `unit='mOsm/kg'`,
`result_type='numeric'`, `lower_limit`/`upper_limit`.

### Conversion rules

**R1 — Group, then classify.** Walk parts in `N` order. A `text_N` is a *heading*
for every `material*`/`pHMeter`/`textEditable` part that follows it until the
next `text_N`/`separator*`. Emit one step per such part; the heading becomes the
step `name` (and `description` when several steps share one heading).

A `text_N` with **no** trailing capture part is a *standalone action*. Do **not**
default it to `custom` — classify it by its leading action verb using the table
below (**first match wins, top to bottom**), and emit that typed step. Fall
through to `custom` only when no row matches.

| If the cleaned instruction's action is… | → `_step_type` | fill params from the text |
|---|---|---|
| runs **overnight** (hold / incubate / thaw overnight) | `overnight` | `condition` = what happens; `temp_c` if stated |
| **Q.S.** / "bring to volume" / "bring … to N mL/L" / dilute to / top up to / fill to | `bring_to_volume` | `target_volume`, `unit`, `diluent` if named |
| **mix** on a stir plate / magnetic stirrer with a stated duration | `mix` | `duration_minutes`, `speed` |
| stir / vortex / invert / shake / swirl / resuspend / triturate | `agitate` | `method` (Stir/Vortex/Invert/Shake), `duration_minutes` (parse "N min", else 5), `speed` (else medium) |
| adjust the pH … with HCl / NaOH (no `pHMeter` part) | `ph_adjust` | `target_ph`, `tolerance` (else 0.1), `reagent` |
| heat / warm / autoclave / masterclave / water bath / incubate at ≥ 37 °C / boil | `heat` | `target_temp_c`, `duration_minutes` |
| freeze / store frozen / place in the −20/−80/−90 freezer / snap-freeze | `freeze` | `target_temp_c`, `duration` |
| thaw / allow to thaw / bring up from frozen / equilibrate to ambient (from cold) | `thaw` | `target_temp_c`, `method`, `until` |
| cool / chill / cool to / allow to cool / place on ice | `cool` | `target_temp_c` |
| transfer / pour / decant / aliquot / elute / load onto column / pass through / **filter** | `transfer` | `from_vessel`, `to_vessel` (parse "from X to Y"; else blank) |
| cap / screw cap / **Parafilm** / seal / cover / stopper | `cap` | `method`, `notes` |
| package / box / place in rack or bin / stack in rack / **deliver to** … area / **store at** … / transfer racks to bin | `package` | `container`, `label_ref`, `destination`, `notes` |
| print label(s) / set up the label printer | `print_labels` | `label_template`, `quantity`, `notes` |
| verify / check / confirm / inspect / ensure / record defects / record the result | `observe` | `prompt` = the full cleaned instruction |
| *(none of the above — a `<h2>`/`PART` header, a `NOTE:`/`CAUTION:`, or prose with no operator action)* | `custom` | `instruction_text` |

When a numeric value the target type needs isn't in the text, **omit it and flag
it** (R9-style) — never invent a temperature, duration, or volume.

**R2 — Clean the text.** `instructions_N` values contain HTML (`<b>`, `<span>`,
`<i>`, `<h2>`, `<ul>`/`<li>`, `<blockquote>`, `<div style=…>`, `<a href=…>`) and
`- ` continuation markers, and often a leading number (`1.  `). Strip **all**
HTML tags, collapse `- `/whitespace runs, decode entities, drop the leading
`N.` prefix. Use the cleaned text (≤ 80 chars, no trailing period) as the step
`name`; keep the full cleaned text as `description` when it is longer or carries
a `Note:`.

**R3 — Materials.** `selectedItem_N` is `"<id> -- <name>"` — split on `" -- "`.
Every referenced material gets an idempotent `reagent_items` upsert
(`ON CONFLICT (item_number) DO NOTHING`), classified:
- `PKG` if the name/unit implies a container/consumable (Bottle, Jar, Tube,
  Filter, Cap, Plate, Petri, Flask, `Bottle(s)`/`Jar(s)`/`Tube(s)`/`Filter(s)`/`Plate(s)`).
- `RM` otherwise. Set `lot_controlled = true` for `RM`, `false` for `PKG`. Tag
  `notes = 'Migrated from Uniflow — needs D365 item mapping'`.

**R3a — Weigh vs. Dispense (by unit).** A `materialWeighed_N` is a measured
quantity. Map it by `reqAmountUnits`:
- **mass** (`g`, `mg`, `kg`, `µg`) → `weigh` (`target_weight`, `unit`, `tolerance_pct:2`, `lot_controlled`).
- **volume** (`mL`, `L`, `µL`) → `dispense` (`target_volume`, `unit`, `tolerance_pct:2`, `lot_controlled`).

  `dispense` is the volumetric twin of `weigh` — same tolerance gate at run time,
  measured off a graduated cylinder / pipette / dispenser instead of a balance.

**R4 — Attachments.** Each `attachments_N` → one `attachment` step. If it is the
opening `text_0` + `attachments_1` pair, merge them: `name = "Attach Supporting
Documents"`, `prompt` = cleaned `text_0`, and do not also emit `text_0`.
Mid-recipe `attachments_N` become their own `attachment` step (prompt from the
preceding `text_N` if present).

**R5 — Separators.** `separator_N` immediately followed by `separatorDay1_N+1` →
**one** `production_break` labelled `"QC Instructions — Day 1"`. `separatorDay3`
/ `separatorDay14` → their own `production_break` labelled `"Day N – QC
Instructions"`.

**R6 — pH & osmolality.**
- Every `pHMeter_N` → a `ph_adjust` step (`target_ph=reqPH`,
  `tolerance=reqPHRange`, `reagent=''`). Do **not** create a pH `qc_tests` row.
- `osmolarity_N` → a `qc_tests` row (not a step). `test_order` from 0 in order
  encountered.

**R7 — `defectRate_N`** → `observe`, `prompt` = "Record the number of defects
found during QC review." Absorb an immediately preceding "Record defects" text
part rather than emitting both.

**R8 — `textEditable_N`** → `notes` step; `prompt` = the preceding `text_N`
cleaned, else "Record observations."

**R9 — Never guess a tolerance.** `weigh.tolerance_pct` is always `2` (the
library default) and always appears in the report's review list.

**R10 — Header & provenance.** `work_instructions`:
- `title` = `product_name` = `description`.
- `reagent_item_id` = the FG's id, where the FG is `reagent_items.item_number =
  materialId` (`item_type='FG'`, `product_name=description`).
- `version = 1`, `status = 'draft'`, `created_by` = an author/admin resolved at
  runtime.
- `uniflow_material_id = materialId`, `uniflow_version_id = materialVersionId`,
  `uniflow_version` = trailing integer of `materialVersionId` (else NULL + flag).
- `description` (WI) = "Migrated from Uniflow <materialVersionId>."
- `target_molarity` only if the description states a molarity ("0.17M" → 0.17).
- `scheduled_minutes` = a conservative estimate (30 repackaging / 60 buffer /
  120 complex) — flag it as an estimate.

**R11 — Idempotency.** One `DO $$ … END $$;` block. Before inserting, delete any
prior WI for the same `reagent_item_id` + `title` whose description starts
"Migrated from Uniflow" (steps cascade).

**R12 — `materialNoQty_N` (Q.S. / add-as-needed).** Look at its heading text:
- If the heading is a **Q.S. / bring-to-volume** cue ("Q.S. to N mL", "bring to
  volume", "bring the solution to N L") → emit one `bring_to_volume` step:
  `material_name` = the solution (WI product, or "the solution"), `target_volume`
  + `unit` parsed from the heading, `diluent` = the `selectedItem` name.
- Otherwise (e.g. an adjusting reagent named for a pH step, or "add entire
  contents") → `gather_reagents` with `quantity: null`, as before.

**R13 — Keep `custom` to a minimum, and count it.** `custom` is the fallback of
last resort, never a convenience. Before emitting `custom`, re-check R1's verb
table — a step is only `custom` when it is a genuine section header (`<h2>`,
"PART I"), a `NOTE:` / `CAUTION:`, or prose with no operator action. `production_break`
(day/part dividers) is a separate typed step and does **not** count as custom.
Track the number of `custom` steps you emit; the report must surface it (see the
Output contract) so reviewers can focus on shrinking it.

### Output contract

**1. SQL script** — one fenced ```sql block:
```
DO $$
DECLARE v_author uuid; v_item uuid; v_wi uuid; n int := 0; /* material id vars */
BEGIN
  -- resolve author (RAISE EXCEPTION if none)
  -- upsert FG (item_number = materialId)               → v_item
  -- upsert RM/PKG materials
  -- delete any prior migrated WI for this item+title   (idempotency)
  -- insert work_instructions (+ uniflow_* provenance, version 1) → v_wi
  -- insert wi_steps in order (n := n + 1 before each)
  -- insert qc_tests
  RAISE NOTICE '…';
END $$;
-- verification SELECTs
```
Resolve each template as `(SELECT id FROM public.step_templates WHERE
step_type='<type>' AND is_system LIMIT 1)` and build `parameters` with
`jsonb_build_object(...)` including `'_step_type'`.

**2. Migration report** — starts with a one-line **step-type summary**, then a
table of every formPart → the step it became (or why it was merged/dropped),
then a **"Needs human review"** list.

- **Step-type summary line (required, first line of the report):**
  `Steps: <M> total · custom: <C> (<C/M %>) · typed: <M-C>`. This custom count
  is the headline metric reviewers scan for — keep `C` as low as R1/R13 allow.
- If `C > 0`, add a **"Custom steps introduced (<C>)"** sub-list naming each one
  by `step_order` + its source text, so a human can judge whether a typed step
  was missed. (`production_break` is typed and is **not** counted here.)
- **"Needs human review"** contains at minimum: every `weigh`/`dispense`
  tolerance (defaulted to 2%), every `scheduled_minutes` estimate, every new
  `reagent_items` row (needs D365 mapping), **every `custom` step**, any
  `uniflow_version` that didn't parse, any `bring_to_volume` whose target volume
  couldn't be parsed, and any typed step left missing a numeric value (temp,
  duration, volume) because the source text didn't state one.

### Hard rules

- Run STEP 0 first. If any type is unsupported, output the skip report and **no
  SQL**. Never partially convert.
- Never invent material IDs, quantities, units, or spec limits. Absent → omit
  and flag.
- Never emit a `_step_type` outside the supported set.
- **Prefer a typed step over `custom`.** A standalone `text` part becomes `custom`
  only after R1's verb table finds no match. Report the total custom count every time.
- Preserve Uniflow part order; `step_order` is contiguous from 1.
- Every migrated WI is `version = 1`, `status = 'draft'`. Never auto-approve.

<!-- ─────────── COPY TO HERE ─────────── -->

---

## Part 5 — How to run it against 4,186 rows

The agent handles **one row per call**. Drive it from the spreadsheet:

1. **Pre-filter to the covered subset.** Before calling the agent, drop the 337
   empty-`formPlan` rows and, ideally, the rows whose formPart types aren't all
   supported (the same scope check the agent does — doing it in the driver saves
   2,406 wasted calls). What remains (~1,443 rows) is the reagent-lab Phase-1
   batch.
2. **One call per remaining row**, temperature 0, passing the four fields.
3. **Concatenate the SQL** and run it in the Supabase SQL Editor in batches;
   every WI lands as a `draft` and goes through normal approval.
4. **Work the "Needs human review" lists** — weigh tolerances and D365 item
   mapping are the two that matter most.

For a production run of this size a **deterministic transformer** (code that
implements Parts 3–4) is the better long-term tool — reproducible, testable,
and free per row — with the LLM reserved for the fuzzy bits (cleaning step
names, classifying ambiguous items). These instructions are the transformer's
spec either way; the agent is how you validate that spec on real recipes first.

---

## Part 6 — Test set

1. **A covered reagent-lab recipe** (e.g. the few-shot) — must reproduce its SQL,
   including the verb-classified steps (`bring_to_volume`, `package`, `observe`)
   and a report whose summary line shows **custom: 0**.
2. **Verb classification** — a recipe with standalone action text must produce
   typed steps, not `custom`: "Stir for 10 minutes" → `agitate`; "Q.S. to 950 mL
   with Methanol" → `bring_to_volume`; "Deliver the bottle to the 15-30°C QC
   area" → `package`; "Cover the beaker with a double layer of Parafilm" → `cap`;
   a measured "900 mL" via `materialWeighed` → `dispense` (not `weigh`).
3. **A8 Agar (A-00020)** — must **SKIP** with a report naming `pHMeter` (ok) …
   actually it also contains `currentTime` and `textEditable`; `textEditable` is
   supported but `currentTime` is not, so it must skip and name `currentTime`.
   This proves the scope gate fires on a real, complex recipe.
4. **A stocked item (empty `formPlan`)** — must skip with the "no recipe" line.
5. **A cell-culture recipe** (any with `passageNumber`/`flasks`) — must skip and
   name the unsupported types.

Passing means: covered recipes produce SQL that runs and renders in Rocket Ship,
standalone actions land as typed steps (custom count stays low and is reported),
and every out-of-scope recipe is refused by name — never partially converted.
