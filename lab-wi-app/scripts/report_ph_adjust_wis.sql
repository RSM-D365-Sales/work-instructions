-- ============================================================
-- REPORT (read-only): Work instructions with an Adjust pH step,
--   and their outstanding production orders.
-- ------------------------------------------------------------
--   "Adjust pH" is stored as wi_steps.parameters->>'_step_type' = 'ph_adjust'.
--   "Outstanding" = a production order not yet finished:
--     status IN ('pending','in_progress','awaiting_qc').
--   Run in the Supabase SQL Editor. Changes nothing.
-- ============================================================

-- ── 1. Every work instruction that contains an Adjust pH step ────────────────
SELECT
  wi.title,
  wi.version,
  wi.status,
  wi.product_name,
  ri.item_number,
  count(*) AS ph_steps,
  string_agg(
    format('step %s: target pH %s ± %s%s',
           s.step_order,
           s.parameters->>'target_ph',
           s.parameters->>'tolerance',
           CASE WHEN COALESCE(s.parameters->>'reagent','') <> ''
                THEN ' with ' || (s.parameters->>'reagent') ELSE '' END),
    '; ' ORDER BY s.step_order) AS ph_step_details
FROM public.wi_steps s
JOIN public.work_instructions wi ON wi.id = s.work_instruction_id
LEFT JOIN public.reagent_items ri ON ri.id = wi.reagent_item_id
WHERE s.parameters->>'_step_type' = 'ph_adjust'
GROUP BY wi.id, wi.title, wi.version, wi.status, wi.product_name, ri.item_number
ORDER BY wi.title, wi.version;

-- ── 2. Outstanding production orders for those work instructions ─────────────
-- One row per open order whose work instruction has ≥1 Adjust pH step.
SELECT
  po.production_order_number,
  po.lot_number,
  po.status,
  wi.title            AS work_instruction,
  po.wi_version,
  ri.item_number,
  asg.full_name       AS assigned_to,
  po.scheduled_start,
  po.required_by,
  po.created_at
FROM public.production_orders po
JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
LEFT JOIN public.reagent_items ri  ON ri.id = wi.reagent_item_id
LEFT JOIN public.profiles       asg ON asg.id = po.assigned_to
WHERE po.status IN ('pending','in_progress','awaiting_qc')
  AND EXISTS (
    SELECT 1 FROM public.wi_steps s
     WHERE s.work_instruction_id = wi.id
       AND s.parameters->>'_step_type' = 'ph_adjust'
  )
ORDER BY
  array_position(ARRAY['in_progress','awaiting_qc','pending'], po.status),
  po.required_by NULLS LAST,
  po.created_at;

-- ── 3. One-line summary ──────────────────────────────────────────────────────
SELECT
  count(DISTINCT wi.id)                                                    AS ph_work_instructions,
  count(po.id) FILTER (WHERE po.status IN ('pending','in_progress','awaiting_qc')) AS outstanding_orders
FROM public.work_instructions wi
LEFT JOIN public.production_orders po ON po.work_instruction_id = wi.id
WHERE EXISTS (
  SELECT 1 FROM public.wi_steps s
   WHERE s.work_instruction_id = wi.id
     AND s.parameters->>'_step_type' = 'ph_adjust'
);
