-- Migration 057: Workshop facilitator notes (shared, live)
-- ---------------------------------------------------------------------------
-- Backs the note boxes on the Day 1 facilitator script page (/workshop-script).
-- One row per (script, section) — e.g. ('day1','b3') is the note attached to the
-- Production Orders block.
--
-- These notes are SHARED, not per-browser: whoever prepares the script the night
-- before types once, and every facilitator opening the URL sees the same notes on
-- their own device. Realtime is enabled so edits appear live during the session
-- without a refresh.
--
-- Collaborative by design (same posture as the session wishlist, migration 055):
-- any signed-in user can read and edit. The facilitator team is small and works
-- against the clock; locking rows to an owner would cost more than it protects.
-- Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.workshop_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which script the note belongs to, so a Day 2 script can reuse this table.
  script_slug  text NOT NULL DEFAULT 'day1',
  -- Which section of that script: 'general', 'preflight', 'b1'…'b5'.
  section_key  text NOT NULL,
  body         text NOT NULL DEFAULT '',
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- One note per section — the page upserts against this.
  UNIQUE (script_slug, section_key)
);

CREATE INDEX IF NOT EXISTS idx_workshop_notes_script
  ON public.workshop_notes (script_slug);

-- updated_at maintenance -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_workshop_notes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workshop_notes_updated_at ON public.workshop_notes;
CREATE TRIGGER trg_workshop_notes_updated_at
  BEFORE UPDATE ON public.workshop_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_workshop_notes_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.workshop_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workshop_notes_select ON public.workshop_notes;
CREATE POLICY workshop_notes_select ON public.workshop_notes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS workshop_notes_insert ON public.workshop_notes;
CREATE POLICY workshop_notes_insert ON public.workshop_notes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND updated_by = auth.uid());

DROP POLICY IF EXISTS workshop_notes_update ON public.workshop_notes;
CREATE POLICY workshop_notes_update ON public.workshop_notes
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS workshop_notes_delete ON public.workshop_notes;
CREATE POLICY workshop_notes_delete ON public.workshop_notes
  FOR DELETE USING (public.current_user_role() = 'admin');

-- ─── Realtime (live co-editing during the session) ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='workshop_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workshop_notes;
  END IF;
END $$;
