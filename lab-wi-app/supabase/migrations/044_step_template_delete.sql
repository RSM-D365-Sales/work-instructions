-- Migration 044: Step Library deletion management
-- Admins can delete any step template — including system ones — UNLESS the
-- template is used by an ACTIVE work instruction (draft / pending_review /
-- approved). Admin DELETE permission already exists via the migration-003
-- "Admin full access to step templates" policy; this migration adds the
-- in-use guard and makes deletion safe for historical data:
--
--   * wi_steps snapshot everything they need to render into `parameters`
--     (_step_type, _param_schema, …), so steps on old / rejected WIs keep
--     working after their template is deleted — the FK becomes SET NULL
--     instead of blocking the delete outright.
--   * A BEFORE DELETE trigger enforces the active-WI rule at the database
--     level (SECURITY DEFINER so the check sees every WI regardless of the
--     caller's row-level visibility). The UI shows a friendlier message,
--     but nothing can bypass this.

-- 1) Historical references survive template deletion --------------------
ALTER TABLE public.wi_steps
  DROP CONSTRAINT IF EXISTS wi_steps_step_template_id_fkey;

ALTER TABLE public.wi_steps
  ADD CONSTRAINT wi_steps_step_template_id_fkey
    FOREIGN KEY (step_template_id) REFERENCES public.step_templates(id)
    ON DELETE SET NULL;

-- 2) Block deletion while an active work instruction uses the template --
CREATE OR REPLACE FUNCTION public.block_step_template_delete_when_in_use()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  SELECT count(DISTINCT wi.id) INTO n
    FROM public.wi_steps ws
    JOIN public.work_instructions wi ON wi.id = ws.work_instruction_id
   WHERE ws.step_template_id = OLD.id
     AND wi.status IN ('draft', 'pending_review', 'approved');

  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot delete step template "%": it is used by % active work instruction(s). Remove the step from those work instructions first.',
      OLD.name, n;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_step_templates_block_delete ON public.step_templates;
CREATE TRIGGER trg_step_templates_block_delete
  BEFORE DELETE ON public.step_templates
  FOR EACH ROW EXECUTE FUNCTION public.block_step_template_delete_when_in_use();
