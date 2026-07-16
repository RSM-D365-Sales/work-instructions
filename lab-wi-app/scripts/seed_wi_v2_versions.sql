-- ============================================================
-- DEMO SEED: v2 work-instruction versions for the Compare demo
-- ------------------------------------------------------------
--   Picks the TWO approved work instructions with the most steps
--   (≥5, no newer version in their lineage yet) and creates a v2
--   for each, engineered so the version diff shows every change
--   kind:
--
--     * MODIFIED (params) — first weigh step: target weight +5%,
--       tolerance tightened to 1.5% (falls back to the first mix
--       step's duration, then to a description tweak).
--     * MODIFIED (rename) — first non-weigh step renamed
--       "… (rev B)": proves source_step_id rename detection
--       (needs migration 046 — run it first).
--     * REMOVED  — the final step is dropped.
--     * ADDED    — an Attachment step ("Attach Balance Printout")
--       takes its slot (ties in the new attachment step type;
--       migration 043).
--     * MOVED    — steps 3 and 4 swap positions.
--     * HEADER   — description note + scheduled minutes changed.
--
--   WI #1's v2 → status 'pending_review' (+ a submitted approval
--   record) so the reviewer banner + diff shortcut appears.
--   WI #2's v2 → status 'draft' (author-in-progress view).
--
--   Idempotency: a lineage that already has a v2 is skipped, so
--   re-running picks different WIs (or none). To reset and re-run:
--     DELETE FROM public.work_instructions
--      WHERE version > 1 AND status IN ('pending_review','draft')
--        AND description LIKE '%Revised per Q2 QC trend review%';
--
--   Run in the Supabase SQL Editor AFTER migrations 043 + 046.
-- ============================================================

DO $$
DECLARE
  v_src     uuid;
  v_new     uuid;
  v_creator uuid;
  v_title   text;
  v_slot    int;
  v_count   int;
  i         int := 0;
  r         record;
BEGIN
  FOR r IN
    SELECT wi.id, wi.title, wi.created_by
      FROM public.work_instructions wi
      JOIN (
        SELECT work_instruction_id, count(*) AS n
          FROM public.wi_steps GROUP BY work_instruction_id
      ) s ON s.work_instruction_id = wi.id
     WHERE wi.status = 'approved'
       AND s.n >= 5
       -- lineage must not already have a newer version
       AND NOT EXISTS (
         SELECT 1 FROM public.work_instructions w2
          WHERE w2.id <> wi.id
            AND w2.title = wi.title
            AND COALESCE(w2.reagent_item_id::text, 'noitem:' || COALESCE(w2.product_name, ''))
              = COALESCE(wi.reagent_item_id::text, 'noitem:' || COALESCE(wi.product_name, ''))
            AND w2.version > wi.version
       )
     ORDER BY s.n DESC, wi.title
     LIMIT 2
  LOOP
    i := i + 1;
    v_src     := r.id;
    v_title   := r.title;
    v_creator := r.created_by;

    -- ── v2 header: copy + revision note + duration change ──────────────
    INSERT INTO public.work_instructions
      (title, description, product_name, reagent_item_id, target_molarity,
       scheduled_minutes, version, status, created_by)
    SELECT title,
           trim(COALESCE(description, '') ||
                ' Revised per Q2 QC trend review — updated weights and verification steps.'),
           product_name, reagent_item_id, target_molarity,
           GREATEST(15, COALESCE(scheduled_minutes, 60) + CASE WHEN i = 1 THEN 15 ELSE -10 END),
           version + 1,
           CASE WHEN i = 1 THEN 'pending_review' ELSE 'draft' END,
           created_by
      FROM public.work_instructions
     WHERE id = v_src
    RETURNING id INTO v_new;

    -- ── Clone steps, carrying the lineage token (source_step_id) ───────
    INSERT INTO public.wi_steps
      (work_instruction_id, step_template_id, source_step_id, step_order, name, description, parameters)
    SELECT v_new, step_template_id, COALESCE(source_step_id, id), step_order, name, description, parameters
      FROM public.wi_steps
     WHERE work_instruction_id = v_src;

    SELECT count(*) INTO v_count FROM public.wi_steps WHERE work_instruction_id = v_new;

    -- ── MODIFIED (params): first weigh step — weight +5%, tolerance 1.5 ─
    UPDATE public.wi_steps
       SET parameters = jsonb_set(
                          jsonb_set(parameters, '{target_weight}',
                            to_jsonb(round((parameters->>'target_weight')::numeric * 1.05, 2)), true),
                          '{tolerance_pct}', '1.5', true)
     WHERE id = (
       SELECT id FROM public.wi_steps
        WHERE work_instruction_id = v_new
          AND parameters->>'_step_type' = 'weigh'
          AND parameters ? 'target_weight'
        ORDER BY step_order LIMIT 1
     );
    IF NOT FOUND THEN
      -- fallback: first mix step +5 minutes
      UPDATE public.wi_steps
         SET parameters = jsonb_set(parameters, '{duration_minutes}',
               to_jsonb(COALESCE((parameters->>'duration_minutes')::numeric, 10) + 5), true)
       WHERE id = (
         SELECT id FROM public.wi_steps
          WHERE work_instruction_id = v_new AND parameters->>'_step_type' = 'mix'
          ORDER BY step_order LIMIT 1
       );
      IF NOT FOUND THEN
        -- last resort: tweak the first step's description
        UPDATE public.wi_steps
           SET description = trim(COALESCE(description, '') || ' Verify against updated SOP-114.')
         WHERE id = (SELECT id FROM public.wi_steps WHERE work_instruction_id = v_new ORDER BY step_order LIMIT 1);
      END IF;
    END IF;

    -- ── MODIFIED (rename only): first non-weigh step — "… (rev B)" ─────
    -- Same source_step_id as v1, so the diff shows a Name change instead
    -- of removed + added (the migration-046 payoff).
    UPDATE public.wi_steps
       SET name = name || ' (rev B)'
     WHERE id = (
       SELECT id FROM public.wi_steps
        WHERE work_instruction_id = v_new
          AND COALESCE(parameters->>'_step_type', 'custom') <> 'weigh'
        ORDER BY step_order LIMIT 1
     );

    -- ── REMOVED: drop the final step; ADDED takes its slot ─────────────
    DELETE FROM public.wi_steps
     WHERE work_instruction_id = v_new
       AND step_order = (SELECT max(step_order) FROM public.wi_steps WHERE work_instruction_id = v_new)
    RETURNING step_order INTO v_slot;

    IF i = 1 THEN
      INSERT INTO public.wi_steps
        (work_instruction_id, step_template_id, step_order, name, description, parameters)
      VALUES
        (v_new,
         (SELECT id FROM public.step_templates WHERE step_type = 'attachment' AND is_system LIMIT 1),
         v_slot,
         'Attach Balance Printout',
         'Attach the balance printout and CoA scan for this batch.',
         '{"_step_type": "attachment", "prompt": "Attach the balance printout and CoA scan for this batch.", "required": true}'::jsonb);
    ELSE
      INSERT INTO public.wi_steps
        (work_instruction_id, step_template_id, step_order, name, description, parameters)
      VALUES
        (v_new,
         (SELECT id FROM public.step_templates WHERE step_type = 'notes' AND is_system LIMIT 1),
         v_slot,
         'Record Ambient Conditions',
         'Capture temperature and humidity before starting the run.',
         '{"_step_type": "notes", "prompt": "Record ambient temperature (°C) and relative humidity (%)."}'::jsonb);
    END IF;

    -- ── MOVED: swap steps 3 and 4 ───────────────────────────────────────
    IF v_count >= 4 THEN
      UPDATE public.wi_steps
         SET step_order = CASE step_order WHEN 3 THEN 4 WHEN 4 THEN 3 END
       WHERE work_instruction_id = v_new AND step_order IN (3, 4);
    END IF;

    -- ── Submit WI #1's v2 for review (drives the reviewer banner) ──────
    IF i = 1 THEN
      INSERT INTO public.wi_approvals (work_instruction_id, reviewer_id, action, comment)
      VALUES (v_new, v_creator, 'submitted',
              'Submitted for review: +5% target weight per QC trend, added balance-printout attachment step, removed redundant final step.');
    END IF;

    RAISE NOTICE 'Created v2 (%) for "%": modified, renamed, removed, added, moved steps.',
      CASE WHEN i = 1 THEN 'pending_review' ELSE 'draft' END, v_title;
  END LOOP;

  IF i = 0 THEN
    RAISE NOTICE 'No eligible WIs found (need approved WIs with ≥5 steps and no newer version). Nothing seeded.';
  END IF;
END $$;

-- Verify: the seeded lineages with both versions side by side.
SELECT wi.title, wi.version, wi.status,
       (SELECT count(*) FROM public.wi_steps s WHERE s.work_instruction_id = wi.id) AS steps,
       wi.scheduled_minutes
  FROM public.work_instructions wi
 WHERE EXISTS (
   SELECT 1 FROM public.work_instructions w2
    WHERE w2.title = wi.title
      AND COALESCE(w2.reagent_item_id::text, 'noitem:' || COALESCE(w2.product_name, ''))
        = COALESCE(wi.reagent_item_id::text, 'noitem:' || COALESCE(wi.product_name, ''))
      AND w2.id <> wi.id
 )
 ORDER BY wi.title, wi.version;

-- Verify rename detection is possible: v2 steps sharing a lineage token
-- with a v1 step but carrying a different name.
SELECT s2.name AS v2_name, s1.name AS v1_name
  FROM public.wi_steps s2
  JOIN public.wi_steps s1
    ON s1.id = s2.source_step_id AND s1.id <> s2.id
 WHERE s2.name <> s1.name;
