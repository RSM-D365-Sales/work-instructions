-- Migration 046: Stable step identity across WI versions (source_step_id)
--
-- Supports the version diff (D1): steps get new ids when a version is cloned
-- or when the editor re-saves (delete + reinsert), so a RENAMED step used to
-- diff as removed + added. source_step_id is a lineage TOKEN — the id of the
-- step's earliest ancestor — carried forward on every clone/re-save:
--
--   * newly authored step   → source_step_id = its own id (set on next save,
--                             or implicitly: lineage key = source_step_id ?? id)
--   * cloned / re-saved     → source_step_id = source's source_step_id ?? source's id
--
-- Deliberately NOT a foreign key: old versions can be deleted without
-- destroying the lineage token on their descendants.
--
-- The backfill walks every existing WI lineage in version order and links
-- steps across consecutive versions by (step type + name + occurrence) — the
-- same heuristic the diff used before this column existed — so history diffs
-- correctly immediately. Safe to re-run.
-- Run in the Supabase SQL Editor.

-- 1) Column ------------------------------------------------------------
ALTER TABLE public.wi_steps
  ADD COLUMN IF NOT EXISTS source_step_id uuid;

COMMENT ON COLUMN public.wi_steps.source_step_id IS
  'Lineage token: id of this step''s earliest ancestor across WI versions. Not a FK — survives deletion of old versions.';

-- 2) Backfill ----------------------------------------------------------
DO $$
DECLARE
  pair record;
BEGIN
  -- Every step starts as its own lineage root.
  UPDATE public.wi_steps SET source_step_id = id WHERE source_step_id IS NULL;

  -- Walk consecutive version pairs per lineage (same identity rule as the
  -- app's wiLineageKey: item link — or product name when unlinked — + title),
  -- ascending, so lineage tokens propagate transitively v1 → v2 → v3 …
  FOR pair IN
    WITH v AS (
      SELECT id, version,
             (COALESCE(reagent_item_id::text, 'noitem:' || COALESCE(product_name, ''))
              || '::' || COALESCE(title, '')) AS lin
        FROM public.work_instructions
    )
    SELECT lag(id) OVER (PARTITION BY lin ORDER BY version) AS prev_wi,
           id AS next_wi,
           version
      FROM v
     ORDER BY lin, version
  LOOP
    CONTINUE WHEN pair.prev_wi IS NULL;

    UPDATE public.wi_steps ns
       SET source_step_id = m.src
      FROM (
        SELECT nt.id AS next_id, ps.source_step_id AS src
          FROM (
            SELECT id, lower(trim(name)) AS nm, parameters->>'_step_type' AS st,
                   row_number() OVER (PARTITION BY lower(trim(name)), parameters->>'_step_type'
                                      ORDER BY step_order) AS rn
              FROM public.wi_steps
             WHERE work_instruction_id = pair.next_wi
          ) nt
          JOIN (
            SELECT source_step_id, lower(trim(name)) AS nm, parameters->>'_step_type' AS st,
                   row_number() OVER (PARTITION BY lower(trim(name)), parameters->>'_step_type'
                                      ORDER BY step_order) AS rn
              FROM public.wi_steps
             WHERE work_instruction_id = pair.prev_wi
          ) ps
            ON ps.nm = nt.nm
           AND ps.st IS NOT DISTINCT FROM nt.st
           AND ps.rn = nt.rn
      ) m
     WHERE ns.id = m.next_id;
  END LOOP;

  RAISE NOTICE 'source_step_id backfilled across all WI version lineages.';
END $$;

-- Verify: how many steps carry a lineage token inherited from an ancestor
-- (i.e., were matched across versions) vs. lineage roots.
SELECT count(*)                                        AS steps,
       count(*) FILTER (WHERE source_step_id = id)     AS lineage_roots,
       count(*) FILTER (WHERE source_step_id <> id)    AS inherited_from_ancestor
  FROM public.wi_steps;
