-- Migration 054: Real-time notifications (supervisor deviation pop-up)
-- ---------------------------------------------------------------------------
-- Adds public.notifications to the Supabase realtime publication so the app can
-- subscribe to INSERTs and pop a live alert on supervisors' screens the moment
-- an operator flags a possible deviation (see components/DeviationAlert.tsx).
--
-- Realtime honours the table's RLS (migration 047): a subscriber only receives
-- rows they're allowed to SELECT — admins see all, and other roles see rows
-- whose `audience` includes their role. The deviation notification is raised
-- with audience {admin, approver}, so both of those roles get the pop-up.
--
-- Safe to re-run: the guard skips the ALTER if the table is already published.
-- Run in the Supabase SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
