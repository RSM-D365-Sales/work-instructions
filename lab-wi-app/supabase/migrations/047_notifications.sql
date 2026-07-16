-- Migration 047: Notification service (Epic E3)
--
-- Persists the notifications that were previously simulated in the UI only:
--   * Possible-deviation "Notify Supervisor" (production order execution)
--   * High-priority reagent order email/Teams broadcast (new reagent order)
-- Each row records what the notification service delivered and on which
-- channels (in_app / email / teams). In-app delivery IS this table — the
-- admin Notifications page reads it. Email/Teams delivery stays simulated
-- for the demo; a real sender (SMTP / MS Graph edge function) hooks in
-- behind the same insert later without touching callers.
--
-- `type` is intentionally unconstrained text so later epics (B3 deviations,
-- A1 auto-created production orders) can add new notification types without
-- another migration.
-- Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 text NOT NULL,          -- 'possible_deviation' | 'high_priority_order' | future types
  severity             text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title                text NOT NULL,
  body                 text,
  channels             text[] NOT NULL DEFAULT '{in_app}',  -- subset of {in_app,email,teams}
  audience             text[] NOT NULL DEFAULT '{admin}',   -- roles this notification targets
  link                 text,                                -- in-app route to the related record
  production_order_id  uuid REFERENCES public.production_orders(id) ON DELETE CASCADE,
  reagent_order_id     uuid REFERENCES public.reagent_orders(id)    ON DELETE CASCADE,
  work_instruction_id  uuid REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  metadata             jsonb NOT NULL DEFAULT '{}',
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Shared group inbox: the first audience member to mark a notification
  -- read clears it for everyone (sufficient for the demo's admin inbox).
  read_at              timestamptz,
  read_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON public.notifications (created_at DESC) WHERE read_at IS NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Anyone signed in may raise a notification (operators flag deviations,
-- lab scientists submit high-priority orders).
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;
CREATE POLICY "notifications_insert_authenticated" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

-- Admins see everything; other roles see notifications addressed to them
-- (future-proofing for B3 — today only the admin page reads this table).
DROP POLICY IF EXISTS "notifications_read_audience" ON public.notifications;
CREATE POLICY "notifications_read_audience" ON public.notifications
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = ANY (audience)
  );

-- Mark-as-read is limited to the same audience.
DROP POLICY IF EXISTS "notifications_update_audience" ON public.notifications;
CREATE POLICY "notifications_update_audience" ON public.notifications
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = ANY (audience)
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.current_user_role() = ANY (audience)
  );
